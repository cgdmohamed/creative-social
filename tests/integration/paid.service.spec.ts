import { advertisingDatabase } from './advertising.fixture';
import { PaidAnalyticsService } from '../../apps/backend/src/advertising/paid-analytics.service';
import { PaidSyncService } from '../../apps/backend/src/advertising/paid-sync.service';
import { PaidReportsService } from '../../apps/backend/src/advertising/paid-reports.service';
import { paidContext } from '../../libraries/nestjs-libraries/src/advertising/paid.types';
import { paidCsv, paidHtml } from '../../libraries/nestjs-libraries/src/advertising/paid.export';
import { paidInsights } from '../../libraries/nestjs-libraries/src/advertising/paid.providers';
import { attributionFingerprint } from '../../libraries/nestjs-libraries/src/advertising/paid.math';
jest.mock('@gitroom/nestjs-libraries/advertising/paid.providers', () => ({ paidInsights: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/reporting/reporting.pdf', () => ({ ReportingPdf: class {} }));
let fixture: ReturnType<typeof advertisingDatabase>, analytics: PaidAnalyticsService, sync: PaidSyncService, reports: PaidReportsService;
let account: any, read: any, email: any, workflow: any, role: string;
const oldSync = process.env.PAID_ANALYTICS_SYNC_ENABLED, oldSchedules = process.env.PAID_REPORT_SCHEDULES_ENABLED;
const oldFrontend = process.env.FRONTEND_URL;
const query = { from: '2026-01-01', to: '2026-01-02', level: 'ACCOUNT' as const };
const point = { date: '2026-01-01', externalEntityId: 'act_123', entityName: 'Client <script>', externalCampaignId: null, externalAdGroupId: null,
  spend: '10.123456', impressions: '100', clicks: '10', conversions: '2', conversionValue: '30', leads: '1', purchaseConversionValue: '30', reach: '80' };
beforeEach(async () => {
  fixture = advertisingDatabase(['customer', 'adReportingDailyMetric', 'paidReachSnapshot', 'paidSyncJob', 'paidReportSchedule', 'paidReportRun']);
  role = 'ADMIN';
  fixture.db.userOrganization.findFirst.mockImplementation(async ({ where }: any) => where.organizationId === 'a' &&
    (where.userId === 'alice' || where.user?.email?.equals === 'alice@example.test') && (!where.role || role !== 'USER') ? { id: 'membership' } : null);
  account = await fixture.db.adReportingAccount.create({ data: { id: 'account', organizationId: 'a', provider: 'META_ADS',
    externalAccountId: 'act_123', name: 'Client <script>', currency: 'USD', timezone: 'UTC', enabled: true,
    reportingRevision: 0, valueTrackingVerified: true, connectionId: 'grant', customerId: 'client-a' } });
  await fixture.db.advertisingConnection.create({ data: { id: 'grant', organizationId: 'a', provider: 'META_ADS', status: 'CONNECTED' } });
  await fixture.db.customer.create({ data: { id: 'client-a', orgId: 'a', name: 'A', deletedAt: null } });
  await fixture.db.customer.create({ data: { id: 'foreign-client', orgId: 'b', name: 'Foreign', deletedAt: null } });
  analytics = new PaidAnalyticsService(fixture.db);
  read = { readForReporting: jest.fn(async (org, id, callback) => ({
    value: await callback(fixture.rows('adReportingAccount').find((a) => a.id === id), 'PRIVATE_TOKEN', AbortSignal.timeout(60000)),
    account, connectionId: 'grant', connectionRevision: 0,
  })) };
  (paidInsights as jest.Mock).mockReset().mockResolvedValue([point]);
  sync = new PaidSyncService(analytics, read);
  email = { hasProvider: jest.fn(() => true), hasDeliveryConfiguration: jest.fn(() => true) }; workflow = { start: jest.fn(async () => ({})) };
  reports = new PaidReportsService(analytics, { renderHtml: jest.fn(async () => Buffer.from('%PDF-synthetic')) } as any,
    email as any, { client: { getRawClient: () => ({ workflow }) } } as any);
  process.env.PAID_ANALYTICS_SYNC_ENABLED = 'true'; process.env.PAID_REPORT_SCHEDULES_ENABLED = 'true';
  process.env.FRONTEND_URL = 'https://social.example.com';
});
afterEach(() => {
  if (oldSync === undefined) delete process.env.PAID_ANALYTICS_SYNC_ENABLED; else process.env.PAID_ANALYTICS_SYNC_ENABLED = oldSync;
  if (oldSchedules === undefined) delete process.env.PAID_REPORT_SCHEDULES_ENABLED; else process.env.PAID_REPORT_SCHEDULES_ENABLED = oldSchedules;
  if (oldFrontend === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = oldFrontend;
});
const job = async (kind = 'DAILY') => fixture.db.paidSyncJob.create({ data: { organizationId: 'a', accountId: 'account', reportingRevision: fixture.rows('adReportingAccount')[0].reportingRevision,
  requestedById: 'alice', level: 'ACCOUNT', kind, fromDate: new Date(query.from), toDate: new Date(query.to), attributionWindow: paidContext(account), dedupeKey: `job-${fixture.rows('paidSyncJob').length}` } });
const collect = async () => { const task = await job(); await sync.process(task); return task; };
test('incremental refresh replaces values rather than adding and preserves original client ownership', async () => {
  await collect(); expect(fixture.rows('adReportingDailyMetric')[0].spend).toBe('10.123456');
  fixture.rows('adReportingAccount')[0].customerId = 'client-b';
  (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, spend: '12' }]); await collect();
  expect(fixture.rows('adReportingDailyMetric')).toHaveLength(1);
  expect(fixture.rows('adReportingDailyMetric')[0]).toMatchObject({ spend: '12', customerId: 'client-a' });
});
test('duplicate provider rows fail without partial snapshot writes', async () => {
  (paidInsights as jest.Mock).mockResolvedValueOnce([point, point]); const task = await collect();
  expect(fixture.rows('adReportingDailyMetric')).toHaveLength(0);
  expect(fixture.rows('paidSyncJob').find((j) => j.id === task.id).errorCode).toBe('COLLECTION_FAILED');
});
test('a database write failure rolls back the entire daily slice and completion marker', async () => {
  (paidInsights as jest.Mock).mockResolvedValueOnce([point, { ...point, date: '2026-01-02' }]);
  const original = fixture.db.adReportingDailyMetric.upsert.getMockImplementation();
  fixture.db.adReportingDailyMetric.upsert.mockImplementationOnce(original).mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAILS'));
  await collect(); expect(fixture.rows('adReportingDailyMetric')).toHaveLength(0);
  expect(fixture.rows('paidSyncJob')[0]).toMatchObject({ status: 'PENDING', errorCode: 'COLLECTION_FAILED' });
});
test('a stale schedule worker cannot overwrite a new lease owner artifact or delivery status', async () => {
  await reports.save('a', 'alice', scheduleInput());
  jest.spyOn(reports, 'artifact').mockImplementationOnce(async () => {
    fixture.rows('paidReportSchedule')[0].leaseUntil = new Date(Date.now() + 300000);
    Object.assign(fixture.rows('paidReportRun')[0], { status: 'READY', artifact: Buffer.from('new-owner'), deliveryStatus: 'QUEUED' });
    return Buffer.from('old-owner');
  });
  await reports.generate(structuredClone(fixture.rows('paidReportSchedule')[0]));
  expect(fixture.rows('paidReportRun')[0]).toMatchObject({ status: 'READY', deliveryStatus: 'QUEUED' });
  expect(Buffer.from(fixture.rows('paidReportRun')[0].artifact).toString()).toBe('new-owner');
});
test('an expired/reassigned lease cannot commit; configuration changes prevent provider use', async () => {
  const task = await job();
  read.readForReporting.mockImplementationOnce(async () => { fixture.rows('paidSyncJob')[0].leaseToken = 'new-owner'; return { value: [point], connectionId: 'grant', connectionRevision: 0 }; });
  await sync.process(task); expect(fixture.rows('adReportingDailyMetric')).toHaveLength(0);
  const stale = await job(); fixture.rows('adReportingAccount')[0].reportingRevision = 1;
  await sync.process(stale); expect(paidInsights).not.toHaveBeenCalled();
});
test('revoked membership or disconnected credentials cannot write paid snapshots', async () => {
  role = 'USER'; await collect(); expect(read.readForReporting).not.toHaveBeenCalled();
  role = 'ADMIN'; read.readForReporting.mockImplementationOnce(async () => { fixture.rows('advertisingConnection')[0].revision = 1; return { value: [point], connectionId: 'grant', connectionRevision: 0 }; });
  await collect(); expect(fixture.rows('adReportingDailyMetric')).toHaveLength(0);
});
test('omitted rows become unavailable on a complete refresh, never stale spend or fabricated zero', async () => {
  await collect(); (paidInsights as jest.Mock).mockResolvedValueOnce([]); await collect();
  expect(fixture.rows('adReportingDailyMetric')[0]).toMatchObject({ spend: null, conversions: null, clicks: null });
});
test('period reach is fetched separately and is not added to daily reach', async () => {
  await collect(); (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, reach: '90' }]); await sync.process(await job('REACH'));
  const report = await analytics.report('a', 'alice', query);
  expect(report.groups[0].current.reach).toBe('90'); expect(report.groups[0].current.spend).toBe('10.123456');
});
test('manual sync includes equal previous period, splits ranges and deduplicates within a minute', async () => {
  await analytics.requestSync('a', 'alice', { ...query, accountId: 'account' });
  const count = fixture.rows('paidSyncJob').length;
  await analytics.requestSync('a', 'alice', { ...query, accountId: 'account' });
  expect(fixture.rows('paidSyncJob')).toHaveLength(count);
  expect(fixture.rows('paidSyncJob').some((j) => j.fromDate.toISOString().startsWith('2025-12-30'))).toBe(true);
  expect(fixture.rows('paidSyncJob').filter((j) => j.kind === 'REACH')).toHaveLength(2);
});
test('server flag disables collection without touching organic collectors or querying providers', async () => {
  process.env.PAID_ANALYTICS_SYNC_ENABLED = 'false';
  await expect(analytics.requestSync('a', 'alice', query)).rejects.toMatchObject({ status: 503 });
  await sync.tick(); expect(read.readForReporting).not.toHaveBeenCalled();
});
test('reports and client/account configuration reject cross-workspace IDs and ordinary management', async () => {
  await collect();
  await expect(analytics.report('a', 'bob', query)).rejects.toMatchObject({ status: 403 });
  await expect(analytics.report('a', 'alice', { ...query, customerId: 'foreign-client' })).rejects.toMatchObject({ status: 403 });
  await expect(analytics.configure('a', 'alice', 'account', 'foreign-client', true)).rejects.toMatchObject({ status: 403 });
  role = 'USER';
  await expect(analytics.report('a', 'alice', query)).resolves.toMatchObject({ traffic: 'PAID' });
  await expect(analytics.configure('a', 'alice', 'account', null, false)).rejects.toMatchObject({ status: 403 });
});
test('provider/currency/timezone groups never share totals and campaign/level filters stay scoped', async () => {
  await collect();
  await fixture.db.adReportingAccount.create({ data: { id: 'other', organizationId: 'a', provider: 'GOOGLE_ADS', name: 'EUR client', currency: 'EUR', timezone: 'Europe/Paris', valueTrackingVerified: false } });
  await fixture.db.adReportingDailyMetric.create({ data: { ...fixture.rows('adReportingDailyMetric')[0], id: 'other-point', accountId: 'other', currency: 'EUR', timezone: 'Europe/Paris', spend: '50' } });
  const report = await analytics.report('a', 'alice', query);
  expect(report.groups).toHaveLength(2); expect(report.groups.map((g) => g.current.spend)).toEqual(['10.123456', '50']);
  expect(report.groups[1].current.roas).toBeNull();
  expect((await analytics.report('a', 'alice', { ...query, provider: 'META_ADS' })).groups).toHaveLength(1);
  expect((await analytics.report('a', 'alice', { ...query, level: 'AD', campaignId: 'missing' })).groups[0].current.spend).toBeNull();
});
test('date gaps stay unavailable in trend data, exports escape HTML/CSV injection and carry units', async () => {
  await collect(); const report = await analytics.report('a', 'alice', query);
  expect(report.groups[0].trends).toHaveLength(2); expect(report.groups[0].trends[1].spend).toBeNull();
  const html = paidHtml(report), csv = paidCsv(report);
  expect(html).not.toContain('Client <script>'); expect(html).toContain('&lt;script&gt;');
  expect(csv).toContain('"PAID"'); expect(csv).toContain('"USD"'); expect(csv).toContain('"UNAVAILABLE"');
  report.groups[0].entities[0].name = '=HYPERLINK("evil")'; expect(paidCsv(report)).toContain("'=HYPERLINK");
});
test('withdrawn purchase-value verification hides ROAS without destroying historical metric rows', async () => {
  await collect(); fixture.rows('adReportingAccount')[0].valueTrackingVerified = false;
  expect((await analytics.report('a', 'alice', query)).groups[0].current.roas).toBeNull();
  expect(fixture.rows('adReportingDailyMetric')[0].purchaseConversionValue).toBe('30');
});
test('moving an account cannot move historical client metrics or attribute mixed-client reach to one client', async () => {
  await collect(); await fixture.db.customer.create({ data: { id: 'client-b', orgId: 'a', name: 'B', deletedAt: null } });
  await analytics.configure('a', 'alice', 'account', 'client-b', true);
  (paidInsights as jest.Mock).mockResolvedValueOnce([point, { ...point, date: '2026-01-02', spend: '20' }]); await collect();
  (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, reach: '99' }]); await sync.process(await job('REACH'));
  const a = await analytics.report('a', 'alice', { ...query, customerId: 'client-a' });
  const b = await analytics.report('a', 'alice', { ...query, customerId: 'client-b' });
  expect(a.groups[0].current.spend).toBe('10.123456'); expect(b.groups[0].current.spend).toBe('20');
  expect(a.groups[0].current.reach).toBeNull(); expect(b.groups[0].current.reach).toBeNull();
  expect((await analytics.report('a', 'alice', query)).groups[0].current.reach).toBe('99');
});
test('observed attribution-setting changes create separate report groups rather than mixed conversion totals', async () => {
  (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, attributionDetails: { clickDays: 7 } }]); await collect();
  const old = fixture.rows('adReportingDailyMetric')[0];
  await fixture.db.adReportingDailyMetric.create({ data: { ...old, id: 'new-definition', date: new Date('2026-01-02'),
    spend: '20', attributionFingerprint: attributionFingerprint({ clickDays: 30 }) } });
  const report = await analytics.report('a', 'alice', query);
  expect(report.groups).toHaveLength(2); expect(report.groups.map((g) => g.current.spend)).toEqual(['10.123456', '20']);
  expect(report.groups[0].attributionDetails).toEqual({ clickDays: 7 });
  expect(fixture.rows('paidSyncJob')[0].attributionDetails).toEqual({ clickDays: 7 });
});
const scheduleInput = () => ({ name: 'Client report', query, rollingDays: 7, cadenceDays: 7, format: 'CSV' as const, delivery: 'ARCHIVE' as const,
  requireFresh: false, nextRunAt: new Date(Date.now() + 60000).toISOString() });
test('scheduled generation archives a private report and download remains organization scoped', async () => {
  await collect(); await reports.save('a', 'alice', scheduleInput());
  const schedule = fixture.rows('paidReportSchedule')[0]; await reports.generate(schedule);
  const run = fixture.rows('paidReportRun')[0]; expect(run.status).toBe('READY'); expect(workflow.start).not.toHaveBeenCalled();
  await expect(reports.download('b', 'bob', run.id)).rejects.toMatchObject({ status: 403 });
  const downloaded = await reports.download('a', 'alice', run.id); expect(downloaded.bytes.toString()).toContain('PAID');
});
test('freshness-required schedules fail closed rather than emailing incomplete metrics', async () => {
  await reports.save('a', 'alice', { ...scheduleInput(), requireFresh: true }); await reports.generate(fixture.rows('paidReportSchedule')[0]);
  expect(fixture.rows('paidReportRun')[0].status).toBe('FAILED'); expect(workflow.start).not.toHaveBeenCalled();
});
test('schedule email recipients must be active members and delivery is opt-in', async () => {
  await expect(reports.save('a', 'alice', { ...scheduleInput(), delivery: 'EMAIL', recipient: 'outsider@example.test' })).rejects.toMatchObject({ status: 400 });
  await reports.save('a', 'alice', { ...scheduleInput(), delivery: 'EMAIL', recipient: 'alice@example.test' });
  process.env.PAID_REPORT_SCHEDULES_ENABLED = 'false'; await reports.tick(); expect(workflow.start).not.toHaveBeenCalled();
});
test('email delivery queues a deterministic workflow with an authenticated link, never ad values in the message', async () => {
  const previous = process.env.FRONTEND_URL; process.env.FRONTEND_URL = 'https://social.example.com';
  try {
    await collect(); await reports.save('a', 'alice', { ...scheduleInput(), delivery: 'EMAIL', recipient: 'alice@example.test' });
    const schedule = structuredClone(fixture.rows('paidReportSchedule')[0]); await reports.generate(schedule);
    expect(workflow.start).toHaveBeenCalledTimes(1);
    const request = workflow.start.mock.calls[0][1];
    expect(request.workflowId).toBe(`paid-report-email-${fixture.rows('paidReportRun')[0].id}`);
    expect(request.workflowIdReusePolicy).toBe('REJECT_DUPLICATE');
    expect(request.args[0].html).toContain('/api/paid-analytics/runs/');
    expect(request.args[0].html).not.toContain('10.123456');
    expect(fixture.rows('paidReportRun')[0].deliveryStatus).toBe('QUEUED');
    await reports.generate(schedule); expect(workflow.start).toHaveBeenCalledTimes(1);
  } finally { if (previous === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previous; }
});
test('delivery failure preserves downloadable artifacts and reports unconfirmed delivery', async () => {
  await collect(); await reports.save('a', 'alice', { ...scheduleInput(), delivery: 'EMAIL', recipient: 'alice@example.test' });
  workflow.start.mockRejectedValueOnce(new Error('private SMTP payload'));
  await reports.generate(fixture.rows('paidReportSchedule')[0]);
  expect(workflow.start).toHaveBeenCalled();
  expect(fixture.rows('paidReportRun')[0]).toMatchObject({ status: 'READY', deliveryStatus: 'UNCONFIRMED', errorCode: 'GENERATION_OR_DELIVERY_FAILED' });
});

test.each([['RUNNING', null, 'QUEUED'], ['COMPLETED', { accepted: true, provider: 'smtp', messageId: 'id' }, 'PROVIDER_ACCEPTED'], ['COMPLETED', undefined, 'UNCONFIRMED'], ['FAILED', null, 'UNCONFIRMED']])('delivery reconciliation %s requires a receipt, not just workflow completion', async (status, receipt, expected) => {
  workflow.getHandle = jest.fn(() => ({ describe: async () => ({ status: { name: status } }), result: async () => receipt }));
  await fixture.db.paidReportRun.create({ data: { id: 'delivery', organizationId: 'a', status: 'READY', deliveryStatus: 'QUEUED' } });
  await reports.reconcileDelivery(); expect(fixture.rows('paidReportRun')[0].deliveryStatus).toBe(expected); expect(workflow.start).not.toHaveBeenCalled();
});

test('current-day collection is provisional until a collection starts after the account day closes', async () => {
  jest.useFakeTimers({ now: new Date('2026-01-01T23:59:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  try {
    await collect();
    const reportQuery = { from: '2026-01-01', to: '2026-01-01', level: 'ACCOUNT' as const };
    let group = (await analytics.report('a', 'alice', reportQuery)).groups[0];
    expect(group).toMatchObject({ coverageComplete: true, complete: false, provisional: true });
    jest.setSystemTime(new Date('2026-01-02T00:10:00Z'));
    group = (await analytics.report('a', 'alice', reportQuery)).groups[0]; expect(group.complete).toBe(false);
    await collect(); group = (await analytics.report('a', 'alice', reportQuery)).groups[0]; expect(group).toMatchObject({ complete: true, provisional: false });
  } finally { jest.useRealTimers(); }
});
test('CSV/PDF export cap and schedule editing retain tenant authorization', async () => {
  const pdf = { renderHtml: jest.fn(async () => Buffer.alloc(11 * 1024 * 1024)) };
  const exporter = new PaidReportsService(analytics, pdf as any, email, {} as any);
  await expect(exporter.artifact({ groups: [], previous: {}, definitions: {} }, 'PDF')).rejects.toMatchObject({ status: 400 });
  await expect(reports.toggle('a', 'alice', 'foreign', false)).rejects.toMatchObject({ status: 403 });
});

test('client filter applies before the 100-account report cap', async () => {
  await collect();
  for (let i = 0; i < 101; i++) {
    await fixture.db.adReportingAccount.create({ data: { id: `unrelated-${i}`, organizationId: 'a',
      provider: 'META_ADS', externalAccountId: `act_${i + 200}`, name: 'Another client',
      currency: 'USD', timezone: 'UTC', enabled: true, customerId: 'client-b' } });
  }
  const scoped = await analytics.report('a', 'alice', { ...query, customerId: 'client-a' });
  expect(scoped.groups).toHaveLength(1);
  expect(scoped.groups[0].accountId).toBe('account');
  await expect(analytics.report('a', 'alice', query)).rejects.toMatchObject({ status: 400 });
});

test('successful reach refresh to unavailable invalidates previous exact-period snapshot', async () => {
  await collect();
  (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, reach: '90' }]);
  await sync.process(await job('REACH'));
  expect(fixture.rows('paidReachSnapshot')).toHaveLength(1);
  (paidInsights as jest.Mock).mockResolvedValueOnce([{ ...point, reach: null }]);
  await sync.process(await job('REACH'));
  expect(fixture.rows('paidReachSnapshot')).toHaveLength(0);
  expect((await analytics.report('a', 'alice', query)).groups[0].current.reach).toBeNull();
});
