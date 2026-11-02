import { SyncInbox } from '../../apps/backend/src/tasks/sync.inbox';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { Logger } from '@nestjs/common';
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(async () => 'OK'), eval: jest.fn(async () => 1) },
}));

test('a failing tenant cannot starve the remaining Inbox sweep and logs no raw provider payload', async () => {
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => {});
  const syncOrganization = jest.fn(async (org: string) => {
    if (org === 'broken') throw new Error('SECRET_TOKEN');
  });
  const job = new SyncInbox(
    { syncOrganization } as any,
    {
      model: {
        organization: {
          findMany: async () => [{ id: 'broken' }, { id: 'healthy' }],
        },
      },
    } as any
  );
  try {
    await job.handleCron();
    expect(syncOrganization.mock.calls).toEqual([
      ['broken', 'comment'],
      ['healthy', 'comment'],
      ['healthy', 'conversation'],
    ]);
    expect(ioRedis.eval).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET_TOKEN');
  } finally {
    warn.mockRestore();
  }
});
