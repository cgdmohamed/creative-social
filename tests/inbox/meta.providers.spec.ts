import {
  FacebookProvider,
  META_GRAPH_API_VERSION,
} from '../../libraries/nestjs-libraries/src/integrations/social/facebook.provider';
import { InstagramProvider } from '../../libraries/nestjs-libraries/src/integrations/social/instagram.provider';

jest.mock('@prisma/client', () => ({}), { virtual: true });
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
  BadBody: class extends Error {},
  Disconnect: class extends Error {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto',
  () => ({ FacebookDto: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto',
  () => ({ InstagramDto: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto',
  () => ({ DribbbleDto: class {} })
);
jest.mock('@gitroom/nestjs-libraries/chat/rules.description.decorator', () => ({
  Rules: () => () => {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/dashboard.function.decorator',
  () => ({ DashboardFunction: () => () => {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/tool.decorator', () => ({
  Tool: () => () => {},
}));
const response = (body: any) => ({ json: async () => body });

test('Facebook normalizes comment authors and parents using the shared API version', async () => {
  const provider = new FacebookProvider();
  const fetch = jest.fn(async () =>
    response({
      data: [
        {
          id: 'reply',
          message: 'Hi',
          created_time: '2026-01-01T00:00:00Z',
          from: { id: 'page', name: 'Us' },
          parent: { id: 'parent' },
        },
      ],
    })
  );
  (provider as any).fetch = fetch;
  const comments = await provider.comments('page', 'post', 'token');
  expect(comments[0]).toMatchObject({
    id: 'reply',
    parentId: 'parent',
    authorId: 'page',
    isOwnComment: true,
  });
  expect(fetch.mock.calls[0][0]).toContain(
    `/${META_GRAPH_API_VERSION}/post/comments`
  );
});
test('Instagram strips the composite token and flattens comment replies', async () => {
  const provider = new InstagramProvider();
  const fetch = jest.fn(async () =>
    response({
      data: [
        {
          id: 'comment',
          text: 'Hello',
          timestamp: '2026-01-01T00:00:00Z',
          username: 'customer',
          replies: {
            data: [
              {
                id: 'reply',
                text: 'Thanks',
                timestamp: '2026-01-01T01:00:00Z',
                username: 'us',
              },
            ],
          },
        },
      ],
    })
  );
  (provider as any).fetch = fetch;
  expect(
    await provider.comments('ig', 'media', 'PAGE_TOKEN___USER_TOKEN')
  ).toEqual([
    expect.objectContaining({ id: 'comment', message: 'Hello' }),
    expect.objectContaining({ id: 'reply', parentId: 'comment' }),
  ]);
  expect(fetch.mock.calls[0][0]).toContain('access_token=PAGE_TOKEN&');
  expect(fetch.mock.calls[0][0]).not.toContain('USER_TOKEN');
  expect(provider.scopes).toContain('instagram_manage_messages');
  expect(provider.scopes).not.toContain('instagram_business_manage_messages');
});
test('Instagram resolves the linked Page for Facebook Login conversations and preserves sender identity', async () => {
  const provider = new InstagramProvider();
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ id: 'page' }))
    .mockResolvedValueOnce(
      response({
        data: [
          {
            id: 'thread',
            updated_time: new Date().toISOString(),
            participants: { data: [{ id: 'page' }, { id: 'customer' }] },
            messages: {
              data: [
                {
                  id: 'outgoing',
                  from: { id: 'page' },
                  created_time: new Date().toISOString(),
                  message: 'Thanks',
                },
              ],
            },
          },
        ],
      })
    );
  (provider as any).fetch = fetch;
  const conversations = await provider.conversations(
    'ig',
    'PAGE_TOKEN___USER_TOKEN'
  );
  expect(fetch.mock.calls[1][0]).toContain('/page/conversations?');
  expect(conversations[0]).toMatchObject({
    participantId: 'customer',
    canReplyFreely: false,
    messages: [expect.objectContaining({ isFromUs: true })],
  });
});
test('Instagram sends through the linked Page with only the Page token', async () => {
  const provider = new InstagramProvider();
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ id: 'page' }))
    .mockResolvedValueOnce(response({ message_id: 'sent' }));
  (provider as any).fetch = fetch;
  expect(
    await provider.sendInboxMessage(
      'ig',
      'customer',
      'Hello',
      'PAGE_TOKEN___USER_TOKEN'
    )
  ).toEqual({ id: 'sent' });
  expect(fetch.mock.calls[1][0]).toContain(
    '/page/messages?access_token=PAGE_TOKEN'
  );
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
    recipient: { id: 'customer' },
    message: { text: 'Hello' },
  });
});
