import { AdvertisingService } from '../../apps/backend/src/advertising/advertising.service';
import { seal, unseal } from '../../libraries/nestjs-libraries/src/advertising/advertising.crypto';
import { AdsProviderError } from '../../libraries/nestjs-libraries/src/advertising/advertising.types';
import { advertisingDatabase } from './advertising.fixture';

const previous = process.env.ADS_ENCRYPTION_KEY;
let fixture: ReturnType<typeof advertisingDatabase>, service: AdvertisingService, api: any;
const metadata = (id: string) => ({ id, name: `Client ${id}`, currency: 'USD', timezone: 'Asia/Riyadh', status: 'ENABLED' });
const tokens = () => ({ accessToken: 'PRIVATE_ACCESS', refreshToken: 'PRIVATE_REFRESH', expiresAt: Date.now() + 3600000 });
const row = (org = 'a') => fixture.rows('advertisingConnection').find((connection) => connection.organizationId === org);
const authorize = async (org = 'a', user = 'alice') => {
  const start = await service.start(org, user, 'google');
  return new URL(start.url).searchParams.get('state')!;
};
const connect = async (org = 'a', user = 'alice') => service.callback(org, user, 'google', { state: await authorize(org, user), code: 'code-private' });
beforeEach(() => {
  process.env.ADS_ENCRYPTION_KEY = 'ab'.repeat(32);
  fixture = advertisingDatabase();
  api = { configured: jest.fn(() => true), authorize: jest.fn((state) => `https://accounts.google.com/auth?state=${state}`),
    exchange: jest.fn(async () => tokens()), refresh: jest.fn(async () => ({ ...tokens(), accessToken: 'NEW_PRIVATE_ACCESS' })),
    accounts: jest.fn(async () => [metadata('123'), metadata('456')]), revoke: jest.fn(async () => {}) };
  service = new AdvertisingService(fixture.db, api, api);
});
afterEach(() => { if (previous === undefined) delete process.env.ADS_ENCRYPTION_KEY; else process.env.ADS_ENCRYPTION_KEY = previous; });

test('OAuth state is hashed, PKCE verifier encrypted, single use and tenant/user/provider bound', async () => {
  const state = await authorize();
  const stored = fixture.rows('advertisingOAuthState')[0];
  expect(stored.hash).not.toBe(state);
  expect(stored.verifierCiphertext).not.toContain(api.authorize.mock.calls[0][1]);
  await expect(service.callback('b', 'bob', 'google', { state, code: 'stolen' })).rejects.toMatchObject({ status: 400 });
  await expect(service.callback('a', 'alice', 'meta', { state, code: 'stolen' })).rejects.toMatchObject({ status: 400 });
  await expect(service.callback('a', 'outsider', 'google', { state, code: 'stolen' })).rejects.toMatchObject({ status: 403 });
  expect(api.exchange).not.toHaveBeenCalled();
  await expect(service.callback('a', 'alice', 'google', { state, code: 'valid' })).resolves.toEqual({ connected: true });
  expect(unseal<any>(row().credentialCiphertext, 'advertising:a:GOOGLE_ADS').accessToken).toBe('PRIVATE_ACCESS');
  await expect(service.callback('a', 'alice', 'google', { state, code: 'replay' })).rejects.toMatchObject({ status: 400 });
  expect(api.exchange).toHaveBeenCalledTimes(1);
});

test('expired, malformed and cancelled callbacks cannot exchange codes', async () => {
  const state = await authorize();
  fixture.rows('advertisingOAuthState')[0].expiresAt = new Date(0);
  await expect(service.callback('a', 'alice', 'google', { state, code: 'code' })).rejects.toMatchObject({ status: 400 });
  await expect(service.callback('a', 'alice', 'google', { state: 'bad', code: 'code' })).rejects.toMatchObject({ status: 400 });
  const fresh = await authorize();
  await expect(service.callback('a', 'alice', 'google', { state: fresh, error: 'access_denied' })).rejects.toMatchObject({ status: 400 });
  expect(api.exchange).not.toHaveBeenCalled();
});

test('starting another flow invalidates prior state for that user/workspace/provider', async () => {
  const old = await authorize(); const latest = await authorize();
  await expect(service.callback('a', 'alice', 'google', { state: old, code: 'code' })).rejects.toMatchObject({ status: 400 });
  await expect(service.callback('a', 'alice', 'google', { state: latest, code: 'code' })).resolves.toEqual({ connected: true });
});

test('disconnect invalidates pending callbacks; exchanged stale code cannot restore a disconnected grant', async () => {
  const state = await authorize();
  api.exchange.mockImplementationOnce(async () => { await service.disconnect('a', 'alice', 'google'); return tokens(); });
  await expect(service.callback('a', 'alice', 'google', { state, code: 'code' })).rejects.toMatchObject({ status: 409 });
  expect(row().status).toBe('DISCONNECTED');
  expect(row().credentialCiphertext).toBeNull();
});

test('multiple selected accounts are unique per workspace and provider, with server-sourced metadata', async () => {
  await connect();
  await service.select('a', 'alice', 'google', ['123', '456']);
  await service.select('a', 'alice', 'google', ['456']);
  expect(fixture.rows('adReportingAccount')).toHaveLength(2);
  expect(fixture.rows('adReportingAccount').filter((a) => a.enabled).map((a) => a.externalAccountId)).toEqual(['456']);
  await connect('b', 'bob');
  await service.select('b', 'bob', 'google', ['456']);
  expect(fixture.rows('adReportingAccount')).toHaveLength(3);
  expect(fixture.rows('adReportingAccount').filter((a) => a.organizationId === 'b')[0]).toMatchObject({ name: 'Client 456', currency: 'USD' });
});

test('selection rejects duplicate, unadvertised and disabled accounts without changing saved selection', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  await expect(service.select('a', 'alice', 'google', ['123', '123'])).rejects.toMatchObject({ status: 400 });
  await expect(service.select('a', 'alice', 'google', ['foreign'])).rejects.toMatchObject({ status: 400 });
  api.accounts.mockResolvedValueOnce([{ ...metadata('456'), status: 'DISABLED' }]);
  await expect(service.select('a', 'alice', 'google', ['456'])).rejects.toMatchObject({ status: 400 });
  expect(fixture.rows('adReportingAccount').filter((a) => a.enabled)[0].externalAccountId).toBe('123');
});

test('transaction failure rolls back replacement selection', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  fixture.db.adReportingAccount.upsert.mockRejectedValueOnce(new Error('write failed'));
  await expect(service.select('a', 'alice', 'google', ['456'])).rejects.toThrow('write failed');
  expect(fixture.rows('adReportingAccount').filter((a) => a.enabled)[0].externalAccountId).toBe('123');
});

test('outsiders and revoked memberships cannot list, discover, connect or disconnect another workspace', async () => {
  await connect();
  for (const work of [() => service.list('a', 'bob'), () => service.discover('a', 'bob', 'google'),
    () => service.select('a', 'bob', 'google', ['123']), () => service.disconnect('a', 'bob', 'google'),
    () => service.start('a', 'bob', 'google')]) await expect(work()).rejects.toMatchObject({ status: 403 });
  fixture.deny();
  await expect(service.list('a', 'alice')).rejects.toMatchObject({ status: 403 });
});

test('membership revoked during discovery is rechecked before exposing accounts or writing selections', async () => {
  await connect();
  api.accounts.mockImplementationOnce(async () => { fixture.deny(); return [metadata('123')]; });
  await expect(service.discover('a', 'alice', 'google')).rejects.toMatchObject({ status: 403 });
});

test('expired Google token refreshes once and persists encrypted credentials before discovery', async () => {
  await connect();
  row().credentialCiphertext = seal({ ...tokens(), expiresAt: 0 }, 'advertising:a:GOOGLE_ADS');
  await service.discover('a', 'alice', 'google');
  expect(api.refresh).toHaveBeenCalledTimes(1);
  expect(api.accounts).toHaveBeenLastCalledWith('NEW_PRIVATE_ACCESS', expect.any(AbortSignal));
  expect(unseal<any>(row().credentialCiphertext, 'advertising:a:GOOGLE_ADS').refreshToken).toBe('PRIVATE_REFRESH');
  expect(row().refreshLeaseUntil).toBeNull();
});

test('active refresh lease rejects a competing refresh without provider calls', async () => {
  await connect();
  row().credentialCiphertext = seal({ ...tokens(), expiresAt: 0 }, 'advertising:a:GOOGLE_ADS');
  row().refreshLeaseUntil = new Date(Date.now() + 30000);
  await expect(service.discover('a', 'alice', 'google')).rejects.toMatchObject({ status: 409 });
  expect(api.refresh).not.toHaveBeenCalled();
});

test('revoked refresh token disables accounts and requires reauthorization without leaking provider errors', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  row().credentialCiphertext = seal({ ...tokens(), expiresAt: 0 }, 'advertising:a:GOOGLE_ADS');
  api.refresh.mockRejectedValueOnce(new AdsProviderError('REAUTH_REQUIRED'));
  await expect(service.discover('a', 'alice', 'google')).rejects.toMatchObject({ status: 409 });
  expect(row().status).toBe('REAUTH_REQUIRED'); expect(row().credentialCiphertext).toBeNull();
  expect(fixture.rows('adReportingAccount')[0].enabled).toBe(false);
});

test('rate limiting applies cooldown, preserves credentials/selection and avoids repeat calls', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  api.accounts.mockRejectedValueOnce(new AdsProviderError('RATE_LIMITED', 120));
  await expect(service.discover('a', 'alice', 'google')).rejects.toMatchObject({ status: 429 });
  const count = api.accounts.mock.calls.length;
  await expect(service.discover('a', 'alice', 'google')).rejects.toMatchObject({ status: 429 });
  expect(api.accounts).toHaveBeenCalledTimes(count);
  expect(row().status).toBe('CONNECTED'); expect(row().credentialCiphertext).toBeTruthy();
  expect(fixture.rows('adReportingAccount')[0].enabled).toBe(true);
});

test('unavailable provider does not erase credentials or account history', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  api.accounts.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR_PAYLOAD'));
  const error = await service.discover('a', 'alice', 'google').catch((failure) => failure);
  expect(error.status).toBe(503);
  expect(String(error)).not.toContain('PRIVATE_PROVIDER_ERROR_PAYLOAD');
  expect(row().credentialCiphertext).toBeTruthy();
  expect(fixture.rows('adReportingAccount')).toHaveLength(1);
});

test('fresh discovery disables accounts removed by provider and refreshes selected metadata', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123', '456']);
  api.accounts.mockResolvedValueOnce([{ ...metadata('456'), name: 'Renamed client', status: 'DISABLED' }]);
  const accounts = await service.discover('a', 'alice', 'google');
  expect(accounts[0].selected).toBe(false);
  expect(fixture.rows('adReportingAccount').find((a) => a.externalAccountId === '123')).toMatchObject({ enabled: false, providerStatus: 'UNAVAILABLE' });
  expect(fixture.rows('adReportingAccount').find((a) => a.externalAccountId === '456')).toMatchObject({ enabled: false, name: 'Renamed client' });
});

test('reconnection replaces credentials but requires fresh account selection', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  api.exchange.mockResolvedValueOnce({ ...tokens(), accessToken: 'OTHER_IDENTITY' });
  await connect();
  expect(unseal<any>(row().credentialCiphertext, 'advertising:a:GOOGLE_ADS').accessToken).toBe('OTHER_IDENTITY');
  expect(fixture.rows('adReportingAccount')[0]).toMatchObject({ enabled: false, providerStatus: 'RESELECT_REQUIRED' });
});

test('failed reauthorization does not destroy a previously working grant', async () => {
  await connect(); const stored = row().credentialCiphertext;
  api.exchange.mockRejectedValueOnce(new AdsProviderError('REAUTH_REQUIRED'));
  await expect(connect()).rejects.toMatchObject({ status: 409 });
  expect(row().status).toBe('CONNECTED'); expect(row().credentialCiphertext).toBe(stored);
});

test('local disconnect erases secrets, disables selections, preserves history and does not revoke other grants', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']); await connect('b', 'bob');
  await expect(service.disconnect('a', 'alice', 'google')).resolves.toMatchObject({ disconnected: true, revocation: 'NOT_REQUESTED' });
  expect(row().credentialCiphertext).toBeNull(); expect(row().status).toBe('DISCONNECTED');
  expect(row('b').status).toBe('CONNECTED'); expect(api.revoke).not.toHaveBeenCalled();
  expect(fixture.rows('adReportingAccount')[0].enabled).toBe(false);
  expect(fixture.rows('adReportingAccount')).toHaveLength(1);
});

test('remote revocation failure still erases local tokens and explicitly reports unconfirmed result', async () => {
  await connect(); api.revoke.mockRejectedValueOnce(new Error('private'));
  await expect(service.disconnect('a', 'alice', 'google', true)).resolves.toMatchObject({ revocation: 'UNCONFIRMED' });
  expect(row().credentialCiphertext).toBeNull();
});

test('public connection listing never serializes access/refresh tokens or ciphertext', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  const json = JSON.stringify(await service.list('a', 'alice'));
  expect(json).not.toMatch(/PRIVATE_ACCESS|PRIVATE_REFRESH|credentialCiphertext|refreshToken|v1\./);
  expect(json).toContain('Client 123');
});

test('ciphertext copied from another workspace fails authenticated decryption', async () => {
  await connect(); await connect('b', 'bob');
  row('b').credentialCiphertext = row().credentialCiphertext;
  await expect(service.discover('b', 'bob', 'google')).rejects.toMatchObject({ status: 503 });
  expect(api.accounts).not.toHaveBeenCalled();
});
test('internal paid reader cannot use another workspace account and returns only read result plus lease metadata', async () => {
  await connect(); await service.select('a', 'alice', 'google', ['123']);
  const id = fixture.rows('adReportingAccount')[0].id;
  const reader = jest.fn(async (account, token) => { expect(account.organizationId).toBe('a'); expect(token).toBe('PRIVATE_ACCESS'); return { rows: 1 }; });
  await expect(service.readForReporting('b', id, reader)).rejects.toMatchObject({ status: 403 });
  expect(reader).not.toHaveBeenCalled();
  const result = await service.readForReporting('a', id, reader);
  expect(result.value).toEqual({ rows: 1 }); expect(result.connectionId).toBe(row().id);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ACCESS|PRIVATE_REFRESH/);
});
