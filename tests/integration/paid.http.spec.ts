import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { PaidAnalyticsController } from '../../apps/backend/src/api/routes/paid-analytics.controller';
import { PaidAnalyticsService } from '../../apps/backend/src/advertising/paid-analytics.service';
import { PaidReportsService } from '../../apps/backend/src/advertising/paid-reports.service';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { advertisingDatabase } from './advertising.fixture';
import { paidContext } from '../../libraries/nestjs-libraries/src/advertising/paid.types';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { verifyJWT: (id: string) => ({ id }) } }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({ setSentryUserContext: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/reporting/reporting.pdf', () => ({ ReportingPdf: class {} }));
let app: any, base: string, fixture: ReturnType<typeof advertisingDatabase>, analytics: PaidAnalyticsService, reports: PaidReportsService;
let role: string;
const previous = process.env.FRONTEND_URL;
beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://social.example.com';
  const applicationModule = await Test.createTestingModule({ controllers: [PaidAnalyticsController], providers: [
    { provide: PaidAnalyticsService, useFactory: () => new Proxy({}, { get: (_target, key) => typeof (analytics as any)?.[key] === 'function' ? (analytics as any)[key].bind(analytics) : (analytics as any)?.[key] }) },
    { provide: PaidReportsService, useFactory: () => new Proxy({}, { get: (_target, key) => typeof (reports as any)?.[key] === 'function' ? (reports as any)[key].bind(reports) : (reports as any)?.[key] }) },
  ] }).compile();
  app = applicationModule.createNestApplication({ logger: false });
  const auth = new AuthMiddleware({ getOrgsByUserId: async (user: string) => [{ id: user === 'alice' ? 'a' : 'b', apiKey: 'synthetic', users: [{ role, disabled: false, userId: user }] }] } as any,
    { getUserById: async (id: string) => ({ id, activated: true, isSuperAdmin: false }) } as any);
  app.use((req: any, res: any, next: any) => { req.cookies = {}; void auth.use(req, res, next).catch(() => res.status(403).json({ message: 'Unauthorized' })); });
  app.useGlobalPipes(new ValidationPipe({ transform: true })); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
afterAll(async () => { await app?.close(); if (previous === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previous; });
beforeEach(async () => {
  role = 'ADMIN'; fixture = advertisingDatabase(['customer', 'adReportingDailyMetric', 'paidReachSnapshot', 'paidSyncJob', 'paidReportSchedule', 'paidReportRun']);
  fixture.db.userOrganization.findFirst.mockImplementation(async ({ where }: any) => where.organizationId === 'a' && where.userId === 'alice' && (!where.role || role === 'ADMIN') ? { id: 'member' } : null);
  const account = { id: 'account-a', organizationId: 'a', name: 'A', currency: 'USD', timezone: 'UTC', provider: 'META_ADS', valueTrackingVerified: true };
  await fixture.db.adReportingAccount.create({ data: account });
  await fixture.db.adReportingAccount.create({ data: { ...account, id: 'account-b', organizationId: 'b', name: 'B' } });
  await fixture.db.adReportingDailyMetric.create({ data: { accountId: account.id, date: new Date('2026-01-01'), level: 'ACCOUNT', externalEntityId: 'act_123',
    entityName: 'Page', currency: 'USD', timezone: 'UTC', attributionWindow: paidContext(account), definitionVersion: 'paid-v1',
    spend: '1.234567', impressions: 100n, clicks: 10n, conversions: '1.5', leads: null, purchaseConversionValue: '10', valueTrackingVerified: true, customerId: null } });
  analytics = new PaidAnalyticsService(fixture.db);
  reports = new PaidReportsService(analytics, { renderHtml: async () => Buffer.from('%PDF-test') } as any, { hasDeliveryConfiguration: () => false } as any, {} as any);
});
const query = 'from=2026-01-01&to=2026-01-02&level=ACCOUNT';
const request = (path: string, body?: any, headers = {}) => fetch(base + '/paid-analytics' + path, { method: body === undefined ? 'GET' : 'POST',
  headers: { auth: 'alice', Origin: 'https://social.example.com', 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('HTTP paid reports enforce authenticated workspace selection and serialize precise counts safely', async () => {
  expect((await request('/report?' + query, undefined, { auth: '' })).status).toBe(403);
  expect((await request('/report?' + query, undefined, { showorg: 'b' })).status).toBe(403);
  expect((await request('/report?' + query + '&accountId=account-b')).status).toBe(403);
  const response = await request('/report?' + query); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json(); expect(body.traffic).toBe('PAID'); expect(body.groups).toHaveLength(1);
  expect(body.groups[0].current).toMatchObject({ spend: '1.234567', impressions: '100', conversions: '1.5' });
});
test('read-only member can export but cannot mutate reporting configuration', async () => {
  role = 'USER'; const csv = await request('/export?' + query + '&format=CSV');
  expect(csv.status).toBe(200); expect(csv.headers.get('content-type')).toContain('text/csv'); expect(await csv.text()).toContain('"PAID"');
  expect((await request('/accounts/account-a', { valueTrackingVerified: true })).status).toBe(403);
  expect((await request('/schedules')).status).toBe(403);
});
test('foreign origins, impersonation and invalid date/level/format input fail before collection', async () => {
  expect((await request('/accounts/account-a', { valueTrackingVerified: true }, { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await request('/accounts/account-a', { valueTrackingVerified: true }, { impersonate: 'victim' })).status).toBe(403);
  expect((await request('/report?' + query.replace('2026-01-01', '2026-02-30'))).status).toBe(400);
  expect((await request('/report?' + query.replace('ACCOUNT', 'ALL'))).status).toBe(400);
  expect((await request('/export?' + query + '&format=HTML')).status).toBe(400);
});
test('schedule DTO requires query/booleans and report artifacts remain private', async () => {
  expect((await request('/schedules', { name: 'Missing query' })).status).toBe(400);
  expect((await request('/runs/unknown/download')).status).toBe(403);
  const pdf = await request('/export?' + query + '&format=PDF');
  expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toContain('application/pdf'); expect(await pdf.text()).toContain('%PDF');
});
