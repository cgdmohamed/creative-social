import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AdvertisingController } from '../../apps/backend/src/api/routes/advertising.controller';
import { AdvertisingService } from '../../apps/backend/src/advertising/advertising.service';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { advertisingDatabase } from './advertising.fixture';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: { verifyJWT: (id: string) => ({ id }) } }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({ setSentryUserContext: jest.fn() }));

const original = { key: process.env.ADS_ENCRYPTION_KEY, frontend: process.env.FRONTEND_URL };
let app: any, base: string, fixture: ReturnType<typeof advertisingDatabase>, api: any;
beforeAll(async () => {
  process.env.ADS_ENCRYPTION_KEY = 'ab'.repeat(32); process.env.FRONTEND_URL = 'https://social.example.com';
  const applicationModule = await Test.createTestingModule({ controllers: [AdvertisingController],
    providers: [{ provide: AdvertisingService, useFactory: () => new AdvertisingService(new Proxy({}, {
      get: (_target, name) => fixture.db[name],
    }) as any, new Proxy({}, { get: (_target, name) => api[name] }) as any, new Proxy({}, { get: (_target, name) => api[name] }) as any) }],
  }).compile();
  app = applicationModule.createNestApplication({ logger: false });
  const auth = new AuthMiddleware({ getOrgsByUserId: async (id: string) => [{ id: id === 'alice' ? 'a' : 'b',
    apiKey: 'synthetic', users: [{ role: 'ADMIN', disabled: false, userId: id }] }] } as any,
    { getUserById: async (id: string) => ({ id, activated: true, isSuperAdmin: false }) } as any);
  app.use((req: any, res: any, next: any) => {
    req.cookies = {};
    void auth.use(req, res, next).catch((error) => res.status(error.status || 403).json({ message: 'Unauthorized' }));
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  for (const [name, value] of [['ADS_ENCRYPTION_KEY', original.key], ['FRONTEND_URL', original.frontend]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
beforeEach(() => {
  fixture = advertisingDatabase();
  api = { configured: () => true, authorize: (state: string) => `https://accounts.google.com/auth?state=${state}`,
    exchange: jest.fn(async () => ({ accessToken: 'PRIVATE_ACCESS', refreshToken: 'PRIVATE_REFRESH', expiresAt: Date.now() + 3600000 })),
    accounts: jest.fn(async () => [{ id: '123', name: 'Client A', currency: 'USD', timezone: 'UTC', status: 'ENABLED' }]) };
});
const request = (path: string, body?: any, headers: Record<string, string> = {}) => fetch(base + '/advertising' + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { auth: 'alice', Origin: 'https://social.example.com', 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const start = async () => {
  const body = await (await request('/google/authorize', {})).json();
  return new URL(body.url).searchParams.get('state');
};

test('actual HTTP routes require authentication, current membership and trusted Origin', async () => {
  expect((await request('', undefined, { auth: '' })).status).toBe(403);
  expect((await request('', undefined, { showorg: 'b' })).status).toBe(403);
  expect((await request('/google/authorize', {}, { Origin: 'https://evil.example' })).status).toBe(403);
  expect((await request('/google/authorize', {}, { Origin: 'null' })).status).toBe(403);
  expect((await request('/google/authorize', {}, { impersonate: 'someone' })).status).toBe(403);
  const response = await request('');
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
});
test('HTTP OAuth callbacks validate DTOs, state ownership and replay', async () => {
  const state = await start();
  expect((await request('/google/callback', { state, code: 'x'.repeat(4097) })).status).toBe(400);
  expect((await request('/google/callback', { state, code: 'code' }, { auth: 'bob' })).status).toBe(400);
  expect(api.exchange).not.toHaveBeenCalled();
  const response = await request('/google/callback', { state, code: 'code' });
  expect(response.status).toBe(201); expect(await response.json()).toEqual({ connected: true });
  expect((await request('/google/callback', { state, code: 'replay' })).status).toBe(400);
});
test('HTTP account selection ignores injected organization and credentials, returns metadata only', async () => {
  const state = await start(); await request('/google/callback', { state, code: 'code' });
  expect((await request('/google/accounts', { accountIds: ['123'], organizationId: 'b', accessToken: 'injected' })).status).toBe(201);
  expect(fixture.rows('adReportingAccount')[0].organizationId).toBe('a');
  const text = await (await request('')).text();
  expect(text).toContain('Client A'); expect(text).not.toMatch(/PRIVATE_ACCESS|PRIVATE_REFRESH|credentialCiphertext|injected/);
  expect((await request('/google/accounts', { accountIds: ['123', '123'] })).status).toBe(400);
  expect((await request('/google/disconnect', { revoke: 'true' })).status).toBe(400);
});
test('HTTP management denies ordinary members regardless of plan/guard bypass', async () => {
  fixture.deny();
  expect((await request('')).status).toBe(403);
  expect((await request('/google/authorize', {})).status).toBe(403);
  expect((await request('/google/disconnect', {})).status).toBe(403);
});
