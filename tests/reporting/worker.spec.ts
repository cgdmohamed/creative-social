import { ReportingSchedule } from '../../apps/backend/src/reporting/reporting.module';
jest.mock('@gitroom/nestjs-libraries/database/prisma/database.module', () => ({
  DatabaseModule: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('puppeteer-core', () => ({ launch: jest.fn() }));
const job = {
  organizationId: 'org',
  integrationId: 'channel',
  requestedFor: 'client-a',
  requestKey: 'request-one',
};
const repo: any = {
  pendingRequests: async () => [job],
  channels: jest.fn(async () => [{ id: 'channel', customerId: 'client-a' }]),
  acknowledge: jest.fn(async () => {}),
  state: jest.fn(async () => {}),
};
const collector: any = { channel: jest.fn(async () => ({ status: 'ok' })) };
const worker = new ReportingSchedule({} as any, repo, collector);
beforeEach(() => jest.clearAllMocks());
test('worker acknowledges exactly the durable request it consumed', async () => {
  await worker.requested();
  expect(collector.channel).toHaveBeenCalledWith(
    'org',
    expect.objectContaining({ id: 'channel' })
  );
  expect(repo.acknowledge).toHaveBeenCalledWith(
    'org',
    'channel',
    'request-one'
  );
});
test('busy leases keep requests pending for the next poll', async () => {
  collector.channel.mockResolvedValueOnce({ status: 'busy' });
  await worker.requested();
  expect(repo.acknowledge).not.toHaveBeenCalled();
});
test('client reassignment between enqueue and execution never imports new-owner data into old-client requests', async () => {
  repo.channels.mockResolvedValueOnce([
    { id: 'channel', customerId: 'new-client' },
  ]);
  await worker.requested();
  expect(collector.channel).not.toHaveBeenCalled();
  expect(repo.state).toHaveBeenCalledWith(
    'org',
    'channel',
    'unavailable',
    expect.any(String)
  );
  expect(repo.acknowledge).toHaveBeenCalledWith(
    'org',
    'channel',
    'request-one'
  );
});

test('scheduled live collection is disabled until an operator explicitly enables it', () => {
  expect(
    Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ReportingSchedule.prototype.run
    ).disabled
  ).toBe(true);
  expect(
    Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ReportingSchedule.prototype.requested
    ).disabled
  ).toBe(true);
});
