import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { CampaignManagerController } from '../../apps/backend/src/api/routes/campaign-manager.controller';
import { CampaignManagerService } from '../../apps/backend/src/advertising/campaign-manager.service';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { advertisingDatabase } from './advertising.fixture';
import { campaignAccount, campaignBody } from './campaign.fixture';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { verifyJWT: (id: string) => ({ id }) } }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({ setSentryUserContext: jest.fn() }));
let app: any, base: string, service: CampaignManagerService, role: string;
const oldOrigin = process.env.FRONTEND_URL;
beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://social.example.com';
  const applicationModule = await Test.createTestingModule({ controllers: [CampaignManagerController], providers: [{ provide: CampaignManagerService,
    useFactory: () => new Proxy({}, { get: (_target, key) => typeof (service as any)?.[key] === 'function' ? (service as any)[key].bind(service) : undefined }) }] }).compile();
  app = applicationModule.createNestApplication({ logger: false });
  const auth = new AuthMiddleware({ getOrgsByUserId: async (user: string) => [{ id: user === 'alice' ? 'a' : 'b', apiKey: 'synthetic', users: [{ role, disabled: false, userId: user }] }] } as any,
    { getUserById: async (id: string) => ({ id, activated: true, isSuperAdmin: false }) } as any);
  app.use((req: any, res: any, next: any) => { req.cookies = {}; void auth.use(req, res, next).catch(() => res.status(403).json({ message: 'Unauthorized' })); });
  app.useGlobalPipes(new ValidationPipe({ transform: true })); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
afterAll(async () => { await app?.close(); if (oldOrigin === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = oldOrigin; });
beforeEach(async () => {
  role = 'SUPERADMIN'; const fixture = advertisingDatabase(['adCampaignDraft', 'adCampaignReview', 'adCampaignAudit', 'media']);
  fixture.db.userOrganization.findFirst.mockImplementation(async ({ where }: any) => where.organizationId === 'a' && where.userId === 'alice' && (!where.role || typeof where.role === 'string' ? !where.role || role === where.role : where.role.in.includes(role)) ? { id: 'member' } : null);
  await fixture.db.adReportingAccount.create({ data: campaignAccount });
  await fixture.db.adReportingAccount.create({ data: { ...campaignAccount, id: 'account-b', organizationId: 'b' } });
  service = new CampaignManagerService(fixture.db, { readForReporting: jest.fn() } as any);
});
const request = (path: string, body?: any, headers = {}) => fetch(base + '/campaign-manager' + path, { method: body === undefined ? 'GET' : 'POST',
  headers: { auth: 'alice', Origin: 'https://social.example.com', 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
test('real auth middleware blocks anonymous and foreign workspace selection', async () => {
  expect((await request('/catalog', undefined, { auth: '' })).status).toBe(403);
  expect((await request('/catalog', undefined, { showorg: 'b' })).status).toBe(403);
  const response = await request('/catalog'); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json(); expect(body.accounts.map((a: any) => a.id)).toEqual(['account-a']); expect(body.liveWritesEnabled).toBe(false);
});
test('HTTP writes require trusted Origin, active manager role and no impersonation', async () => {
  expect((await request('/drafts', campaignBody(), { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await request('/drafts', campaignBody(), { impersonate: 'true' })).status).toBe(403);
  role = 'USER'; expect((await request('/drafts', campaignBody())).status).toBe(403); expect((await request('/catalog')).status).toBe(200);
});
test('HTTP validates input and prevents account/draft IDOR', async () => {
  expect((await request('/drafts', { ...campaignBody(), spec: null })).status).toBe(400);
  expect((await request('/drafts', { ...campaignBody(), accountId: 'account-b' })).status).toBe(403);
  expect((await request('/drafts/foreign/review', { revision: 0 })).status).toBe(403);
  expect((await request('/drafts/foreign/review', { revision: -1 })).status).toBe(400);
});
test('HTTP final approval cannot submit live campaigns and repeat submission remains blocked', async () => {
  const draft = await (await request('/drafts', campaignBody())).json();
  const review = await (await request(`/drafts/${draft.id}/review`, { revision: draft.revision })).json();
  expect((await request(`/reviews/${review.id}/approve`, { digest: review.digest, confirmation: 'yes' })).status).toBe(409);
  role = 'ADMIN'; expect((await request(`/reviews/${review.id}/approve`, { digest: review.digest, confirmation: review.snapshot.confirmation })).status).toBe(403);
  role = 'SUPERADMIN'; const approved = await request(`/reviews/${review.id}/approve`, { digest: review.digest, confirmation: review.snapshot.confirmation });
  expect(approved.status).toBe(201); expect((await approved.json()).status).toBe('APPROVED_BLOCKED');
  for (let n = 0; n < 2; n++) { const response = await request(`/reviews/${review.id}/submit`, {}); expect(response.status).toBe(423); expect((await response.json()).code).toBe('LIVE_AD_WRITES_DISABLED'); }
});
