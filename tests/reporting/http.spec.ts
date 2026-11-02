import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ReportsController } from '../../apps/backend/src/api/routes/reports.controller';
import { ReportingService } from '../../libraries/nestjs-libraries/src/reporting/reporting.service';
import { ReportingCollector } from '../../libraries/nestjs-libraries/src/reporting/reporting.collector';
import { ReportingPdf } from '../../libraries/nestjs-libraries/src/reporting/reporting.pdf';
jest.mock('puppeteer-core', () => ({ launch: jest.fn() }));
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
const channel = {
  id: 'c-a',
  organizationId: 'org-a',
  customerId: 'client-a',
  name: 'Channel',
  token: 'SHOULD_NOT_LEAK',
  providerIdentifier: 'youtube',
};
const observed = [28, 29, 30, 31].map((d, i) => ({
  integrationId: 'c-a',
  entityId: '',
  metric: 'likes',
  kind: 'FLOW',
  unit: 'count',
  value: i + 1,
  date: new Date(`2026-10-${d}`),
  channelName: 'Original client channel',
}));
const repo: any = {
  customer: async (org: string, id: string) =>
    org === 'org-a' && id === 'client-a' ? { id, name: 'Client A' } : null,
  clients: async () => [{ id: 'client-a', name: 'Client A' }],
  channels: async (org: string, customer?: string, ids?: string[]) =>
    org === 'org-a' &&
    (!customer || customer === 'client-a') &&
    (!ids || ids.includes('c-a'))
      ? [channel]
      : [],
  states: async () => [],
  campaigns: async () => [],
  snapshots: jest.fn(async (org: string) => (org === 'org-a' ? observed : [])),
  posts: async (_org: string, _ids: string[], postIds?: string[]) =>
    !postIds || postIds.includes('p-a')
      ? [
          {
            id: 'p-a',
            integrationId: 'c-a',
            title: 'Post',
            publishDate: new Date('2026-01-01'),
          },
        ]
      : [],
  campaign: async (org: string, id: string) =>
    org === 'org-a' && id === 'campaign-a'
      ? {
          id,
          name: 'Campaign A',
          customerId: 'client-a',
          posts: [{ postId: 'p-a' }],
        }
      : null,
  createCampaign: jest.fn(async (org: string, input: any) => ({
    id: 'created',
    organizationId: org,
    ...input,
  })),
};
const service = new ReportingService(repo);
const collector = {
  request: jest.fn(async () => [{ integrationId: 'c-a', status: 'queued' }]),
};
@Module({
  controllers: [ReportsController],
  providers: [
    { provide: ReportingService, useValue: service },
    { provide: ReportingCollector, useValue: collector },
    ReportingPdf,
  ],
})
class TestModule {}
let app: any, base: string;
const request = (path: string, body?: any, org = 'org-a') =>
  fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-test-org': org },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const range = 'from=2026-10-30&to=2026-10-31&customerId=client-a';
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
beforeEach(() => jest.clearAllMocks());
test('HTTP report composes stored comparisons and excludes token-bearing channel fields', async () => {
  const res = await request('/reports/organic?' + range);
  expect(res.status).toBe(200);
  const result = await res.json();
  expect(result.metrics[0]).toMatchObject({
    current: 7,
    previous: 3,
    complete: true,
  });
  expect(result.channels[0].name).toBe('Original client channel');
  expect(JSON.stringify(result)).not.toContain('accessToken');
  expect(JSON.stringify(result)).not.toContain('SHOULD_NOT_LEAK');
});
test('cross-organization clients, channels and campaigns are rejected before data access', async () => {
  expect(
    (await request('/reports/organic?' + range, undefined, 'org-b')).status
  ).toBe(404);
  expect(
    (await request('/reports/organic?' + range + '&integrationIds=foreign'))
      .status
  ).toBe(404);
  expect(
    (await request('/reports/organic?' + range + '&campaignId=foreign')).status
  ).toBe(404);
  expect(repo.snapshots).not.toHaveBeenCalled();
});
test('campaign filters force post scope and use only approved membership IDs', async () => {
  const res = await request(
    '/reports/organic?' + range + '&campaignId=campaign-a'
  );
  expect(res.status).toBe(200);
  expect((await res.json()).scope).toBe('POST');
  expect(repo.snapshots.mock.calls[0][2]).toBe('POST');
  expect(repo.snapshots.mock.calls[0][5]).toBe('client-a');
  expect(repo.snapshots.mock.calls[0][6]).toEqual(['p-a']);
});
test.each([
  'from=2026-02-30&to=2026-03-01',
  'from=2020-01-01&to=2026-01-01',
  range + '&scope=ADS',
  range + '&extra=untrusted',
])('validates query inputs %s', async (query) => {
  expect((await request('/reports/organic?' + query)).status).toBe(400);
});
test('rejects whitespace names and foreign campaign posts', async () => {
  expect(
    (
      await request('/reports/campaigns', {
        name: '   ',
        from: '2026-10-01',
        to: '2026-10-31',
        customerId: 'client-a',
        postIds: ['p-a'],
      })
    ).status
  ).toBe(400);
  expect(
    (
      await request('/reports/campaigns', {
        name: 'Campaign',
        from: '2026-10-01',
        to: '2026-10-31',
        customerId: 'client-a',
        postIds: ['foreign'],
      })
    ).status
  ).toBe(404);
  expect(repo.createCampaign).not.toHaveBeenCalled();
});
test('creates a client-owned campaign without importing unrelated campaign hub modules', async () => {
  const res = await request('/reports/campaigns', {
    name: 'Campaign',
    from: '2026-10-01',
    to: '2026-10-31',
    customerId: 'client-a',
    postIds: ['p-a'],
  });
  expect(res.status).toBe(201);
  expect((await res.json()).customerId).toBe('client-a');
});
test('CSV has private download headers and PDF gracefully reports missing browser configuration', async () => {
  const csv = await request('/reports/organic.csv?' + range);
  expect(csv.headers.get('content-type')).toContain('text/csv');
  expect(csv.headers.get('cache-control')).toBe('private, no-store');
  expect(await csv.text()).toContain('Client A');
  const prior = process.env.REPORT_CHROMIUM_EXECUTABLE_PATH;
  delete process.env.REPORT_CHROMIUM_EXECUTABLE_PATH;
  try {
    expect((await request('/reports/organic.pdf?' + range)).status).toBe(503);
  } finally {
    if (prior) process.env.REPORT_CHROMIUM_EXECUTABLE_PATH = prior;
  }
});
test('bounds manual collection batch size before any provider call', async () => {
  expect(
    (
      await request('/reports/sync', {
        integrationIds: Array.from({ length: 11 }, (_, i) => 'c-' + i),
      })
    ).status
  ).toBe(400);
  expect(collector.request).not.toHaveBeenCalled();
});

test('manual collection returns 202 promptly with a queued result', async () => {
  const res = await request('/reports/sync', {
    integrationIds: ['c-a'],
    customerId: 'client-a',
  });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual([
    { integrationId: 'c-a', status: 'queued' },
  ]);
  expect(collector.request).toHaveBeenCalledWith('org-a', ['c-a'], 'client-a');
});
