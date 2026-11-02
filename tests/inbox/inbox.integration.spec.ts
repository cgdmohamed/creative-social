import 'reflect-metadata';
jest.mock('@prisma/client', () => ({}), { virtual: true });
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InboxController } from '../../apps/backend/src/api/routes/inbox.controller';
import { IntegrationService } from '../../libraries/nestjs-libraries/src/database/prisma/integrations/integration.service';
import { InboxRepository } from '../../libraries/nestjs-libraries/src/database/prisma/integrations/inbox.repository';

// External infrastructure is replaced at its boundary; controllers, validation,
// synchronization, tenant checks and persistence mapping run together.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository',
  () => ({ AutopostRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    smembers: async () => [],
    sadd: async () => {},
    expire: async () => {},
  },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  NotEnoughScopes: class extends Error {},
  RefreshToken: class extends Error {},
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

const channel: any = {
  id: 'channel-a',
  organizationId: 'org-a',
  internalId: 'page-a',
  name: 'Page',
  providerIdentifier: 'facebook',
  type: 'social',
  token: 'token',
  tokenExpiration: new Date(Date.now() + 86400000),
};
const rows: any[] = [];
const syncs: any[] = [];
const matches = (row: any, where: any) =>
  Object.entries(where).every(
    ([key, value]: any) =>
      key === 'integration' ||
      (value?.in ? value.in.includes(row[key]) : row[key] === value)
  );
const itemModel = {
  findFirst: async ({ where }: any) =>
    rows.find((row) => matches(row, where)) || null,
  findMany: async ({ where }: any) => rows.filter((row) => matches(row, where)),
  upsert: async ({ create, update }: any) => {
    const old = rows.find(
      (row) =>
        row.integrationId === create.integrationId &&
        row.externalId === create.externalId &&
        row.kind === create.kind
    );
    if (old) Object.assign(old, update);
    else rows.push({ isRead: false, ...create });
  },
  updateMany: async ({ where, data }: any) => {
    const found = rows.filter((row) => matches(row, where));
    found.forEach((row) => Object.assign(row, data));
    return { count: found.length };
  },
};
const commentTime = new Date().toISOString();
const provider: any = {
  recentComments: jest.fn(async () => [
    {
      id: 'comment-a',
      message: 'Hello',
      authorId: 'customer',
      createdAt: commentTime,
      postId: 'post-a',
    },
  ]),
  reply: jest.fn(async () => ({ id: 'reply-a' })),
  hideComment: jest.fn(async () => ({ success: true })),
  conversations: jest.fn(async () => [
    {
      id: 'thread-a',
      participantId: 'customer',
      messages: [{ isFromUs: false, createdAt: new Date().toISOString() }],
    },
  ]),
  sendInboxMessage: jest.fn(async () => ({ id: 'message-a' })),
};
const repository = new InboxRepository(
  { model: { inboxItem: itemModel } } as any,
  {
    model: {
      inboxSync: {
        findMany: async ({ where }: any) =>
          syncs.filter((row) => matches(row, where)),
        upsert: async ({ create, update }: any) => {
          const old = syncs.find(
            (row) =>
              row.integrationId === create.integrationId &&
              row.kind === create.kind
          );
          if (old) Object.assign(old, update);
          else syncs.push(create);
        },
      },
    },
  } as any
);
const service = new IntegrationService(
  {
    getIntegrationsList: async (org: string) =>
      org === channel.organizationId ? [channel] : [],
    getIntegrationById: async (org: string, id: string) =>
      org === channel.organizationId && id === channel.id ? channel : null,
  } as any,
  {} as any,
  { getSocialIntegration: () => provider } as any,
  {} as any,
  {} as any,
  {} as any,
  repository
);

@Module({
  controllers: [InboxController],
  providers: [{ provide: IntegrationService, useValue: service }],
})
class TestModule {}
let app: any;
let base: string;
const request = (path: string, body?: any, org = 'org-a') =>
  fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-org': org },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.use((req: any, _res: any, next: any) => {
    req.org = { id: req.headers['x-test-org'] };
    next();
  });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  rows.length = 0;
  syncs.length = 0;
  jest.clearAllMocks();
});

test('sync persists comments, serves them from the database and preserves read state', async () => {
  expect((await request('/inbox/sync/comment', {})).status).toBe(201);
  expect(rows).toHaveLength(1);
  expect(
    (await request('/inbox/read', { ids: ['comment-a'], read: true })).status
  ).toBe(201);
  await service.syncOrganization('org-a', 'comment');
  const result = await (await request('/inbox/db/comment')).json();
  expect(result.items[0]).toMatchObject({ id: 'comment-a', isRead: true });
  const calls = provider.recentComments.mock.calls.length;
  await request('/inbox/db/comment');
  expect(provider.recentComments).toHaveBeenCalledTimes(calls);
});
test('tenant isolation applies to reads and replies', async () => {
  await service.syncOrganization('org-a', 'comment');
  expect(
    (await (await request('/inbox/db/comment', undefined, 'org-b')).json())
      .items
  ).toEqual([]);
  expect(
    (
      await request(
        '/inbox/comments/channel-a/reply',
        { commentId: 'comment-a', message: 'Thanks' },
        'org-b'
      )
    ).status
  ).toBe(404);
  expect(provider.reply).not.toHaveBeenCalled();
});
test('rejects comments from another channel and allows a synced reply', async () => {
  expect(
    (
      await request('/inbox/comments/channel-a/reply', {
        commentId: 'foreign',
        message: 'Thanks',
      })
    ).status
  ).toBe(404);
  await service.syncOrganization('org-a', 'comment');
  expect(
    (
      await request('/inbox/comments/channel-a/reply', {
        commentId: 'comment-a',
        message: 'Thanks',
      })
    ).status
  ).toBe(201);
  expect(provider.reply).toHaveBeenCalledWith(
    'page-a',
    'comment-a',
    'Thanks',
    'token'
  );
});
test('rejects invalid kinds, empty messages, malformed read flags and moderation actions', async () => {
  expect((await request('/inbox/sync/invalid', {})).status).toBe(400);
  expect(
    (
      await request('/inbox/comments/channel-a/reply', {
        commentId: 'comment-a',
        message: '',
      })
    ).status
  ).toBe(400);
  expect(
    (await request('/inbox/read', { ids: ['comment-a'], read: 'yes' })).status
  ).toBe(400);
  expect(
    (
      await request('/inbox/comments/channel-a/moderate', {
        commentId: 'comment-a',
        action: 'erase',
      })
    ).status
  ).toBe(400);
});
test('checks the live messaging window server-side before sending', async () => {
  provider.conversations.mockResolvedValueOnce([
    {
      participantId: 'customer',
      messages: [
        {
          isFromUs: false,
          createdAt: new Date(Date.now() - 86400001).toISOString(),
        },
      ],
    },
  ]);
  expect(
    (
      await request('/inbox/chats/channel-a/send', {
        recipientId: 'customer',
        message: 'Hello',
      })
    ).status
  ).toBe(403);
  expect(provider.sendInboxMessage).not.toHaveBeenCalled();
  expect(
    (
      await request('/inbox/chats/channel-a/send', {
        recipientId: 'customer',
        message: 'Hello',
      })
    ).status
  ).toBe(201);
});
test('platform failures become per-channel sync errors', async () => {
  provider.recentComments.mockRejectedValueOnce(new Error('Permission denied'));
  await service.syncOrganization('org-a', 'comment');
  expect(syncs[0].lastError).toContain('Permission denied');
  expect(rows).toEqual([]);
});
test('unsupported providers advertise capabilities without calling APIs', async () => {
  const comments = provider.recentComments;
  const conversations = provider.conversations;
  provider.recentComments = undefined;
  provider.conversations = undefined;
  try {
    const result = await (await request('/inbox/channels')).json();
    expect(result[0]).toMatchObject({
      supportsComments: false,
      supportsChats: false,
    });
    await service.syncOrganization('org-a', 'comment');
    expect(rows).toEqual([]);
  } finally {
    provider.recentComments = comments;
    provider.conversations = conversations;
  }
});

test('moderates only comments owned by the organization and channel', async () => {
  await service.syncOrganization('org-a', 'comment');
  expect(
    (
      await request('/inbox/comments/channel-a/moderate', {
        commentId: 'comment-a',
        action: 'hide',
      })
    ).status
  ).toBe(201);
  expect(provider.hideComment).toHaveBeenCalledWith('comment-a', true, 'token');
  expect(
    (
      await request('/inbox/comments/channel-a/moderate', {
        commentId: 'foreign',
        action: 'delete',
      })
    ).status
  ).toBe(404);
});
test('new conversation activity reopens a read thread', async () => {
  const first = new Date('2026-01-01T00:00:00Z');
  await repository.upsertMany('org-a', 'channel-a', 'conversation', [
    { externalId: 'thread', content: 'Hello', happenedAt: first },
  ]);
  await repository.markRead('org-a', ['thread'], true);
  await repository.upsertMany('org-a', 'channel-a', 'conversation', [
    {
      externalId: 'thread',
      content: 'Hello again',
      happenedAt: new Date(first.getTime() + 1000),
    },
  ]);
  expect(rows[0].isRead).toBe(false);
});
