import { ReportingCollector } from '../../libraries/nestjs-libraries/src/reporting/reporting.collector';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(async () => 'OK'), eval: jest.fn(async () => 1) },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
const channel: any = {
  id: 'c',
  organizationId: 'org',
  name: 'Channel',
  customerId: 'client',
  providerIdentifier: 'youtube',
  token: 'PRIVATE_TOKEN',
  tokenExpiration: new Date(Date.now() + 86400000),
};
const provider: any = {
  analytics: jest.fn(async () => [
    {
      label: 'Likes',
      data: [{ date: new Date().toISOString().slice(0, 10), total: 3 }],
    },
  ]),
  postAnalytics: jest.fn(async () => [
    { label: 'Likes', data: [{ date: '2026-01-01', total: 12 }] },
  ]),
};
const repo: any = {
  states: async () => [{ integrationId: 'c', postCursor: 'old-cursor' }],
  collectPosts: jest.fn(async () => [{ id: 'p', releaseId: 'external' }]),
  request: jest.fn(async () => ({})),
  save: jest.fn(async () => {}),
  state: jest.fn(async () => {}),
};
const refresh = { refresh: jest.fn(async () => false) };
const reports: any = { selection: async () => [channel] };
const collector = new ReportingCollector(
  repo,
  reports,
  { getSocialIntegration: () => provider } as any,
  refresh as any
);
const priorCollectionFlag = process.env.REPORTING_COLLECTION_ENABLED;
beforeAll(() => {
  process.env.REPORTING_COLLECTION_ENABLED = 'true';
});
afterAll(() => {
  if (priorCollectionFlag === undefined)
    delete process.env.REPORTING_COLLECTION_ENABLED;
  else process.env.REPORTING_COLLECTION_ENABLED = priorCollectionFlag;
});
beforeEach(() => jest.clearAllMocks());
test('collects channel dailies and post lifetime levels with immutable client attribution and keyset batching', async () => {
  expect(await collector.channel('org', channel)).toMatchObject({
    status: 'ok',
    samples: 2,
  });
  expect(repo.collectPosts).toHaveBeenCalledWith('org', 'c', 'old-cursor');
  expect(repo.save).toHaveBeenCalledWith(
    'org',
    'client',
    'POST',
    [expect.objectContaining({ entityId: 'p', kind: 'LEVEL', value: 12 })],
    'Channel'
  );
  expect(ioRedis.eval).toHaveBeenCalled();
});
test('unsupported providers produce status without requesting metrics', async () => {
  expect(
    await collector.channel('org', {
      ...channel,
      providerIdentifier: 'wordpress',
    })
  ).toMatchObject({ status: 'unsupported' });
  expect(provider.analytics).not.toHaveBeenCalled();
});
test('a held distributed lease suppresses duplicate collection', async () => {
  (ioRedis.set as jest.Mock).mockResolvedValueOnce(null);
  expect(await collector.channel('org', channel)).toMatchObject({
    status: 'busy',
  });
  expect(provider.analytics).not.toHaveBeenCalled();
});
test('expired tokens require reconnect, and failures never expose token-bearing URLs', async () => {
  expect(
    await collector.channel('org', { ...channel, tokenExpiration: new Date(0) })
  ).toMatchObject({ status: 'relogin' });
  expect(provider.analytics).not.toHaveBeenCalled();
  provider.analytics.mockRejectedValueOnce(
    new Error('https://example.com?token=PRIVATE_TOKEN')
  );
  expect(await collector.channel('org', channel)).toMatchObject({
    status: 'partial',
  });
  expect(JSON.stringify(repo.state.mock.calls)).not.toContain('PRIVATE_TOKEN');
});
test('former client channels are readable history but cannot collect for the new owner', async () => {
  expect(await collector.request('org', ['c'], 'former-client')).toEqual([
    { integrationId: 'c', status: 'historical_only' },
  ]);
  expect(provider.analytics).not.toHaveBeenCalled();
});

test('one failed post does not starve subsequent posts or block the next cursor page', async () => {
  repo.collectPosts.mockResolvedValueOnce([
    { id: 'bad', releaseId: 'bad' },
    { id: 'good', releaseId: 'good' },
  ]);
  provider.postAnalytics.mockRejectedValueOnce(new Error('Bad post'));
  expect(await collector.channel('org', channel)).toMatchObject({
    status: 'partial',
  });
  expect(provider.postAnalytics).toHaveBeenCalledTimes(2);
  expect(repo.save).toHaveBeenCalledWith(
    'org',
    'client',
    'POST',
    [expect.objectContaining({ entityId: 'good' })],
    'Channel'
  );
});

test('manual collection persists a durable request without awaiting live APIs', async () => {
  expect(await collector.request('org', ['c'], 'client')).toEqual([
    { integrationId: 'c', status: 'queued' },
  ]);
  expect(repo.request).toHaveBeenCalledWith(
    'org',
    'c',
    'client',
    expect.any(String)
  );
  expect(provider.analytics).not.toHaveBeenCalled();
});

test('collection is opt-in and disabled requests cannot queue platform reads', async () => {
  delete process.env.REPORTING_COLLECTION_ENABLED;
  try {
    await expect(collector.request('org', ['c'], 'client')).rejects.toThrow(
      'disabled'
    );
    expect(repo.request).not.toHaveBeenCalled();
  } finally {
    process.env.REPORTING_COLLECTION_ENABLED = 'true';
  }
});
