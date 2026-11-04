import { MetaAdsProvider } from '../../libraries/nestjs-libraries/src/advertising/providers/meta.ads.provider';
import { GoogleAdsProvider } from '../../libraries/nestjs-libraries/src/advertising/providers/google.ads.provider';
import { providerJson, accountResult } from '../../libraries/nestjs-libraries/src/advertising/providers/advertising.http';
import { seal, unseal } from '../../libraries/nestjs-libraries/src/advertising/advertising.crypto';

const previous = { ...process.env };
const originalFetch = global.fetch;
let fetchMock: jest.Mock;
const response = (body: any, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
beforeEach(() => {
  Object.assign(process.env, { FRONTEND_URL: 'https://social.example.com', ADS_ENCRYPTION_KEY: '12'.repeat(32),
    META_ADS_APP_ID: 'meta-client', META_ADS_APP_SECRET: 'meta-secret', META_ADS_API_VERSION: 'v25.0',
    GOOGLE_ADS_CLIENT_ID: 'google-client', GOOGLE_ADS_CLIENT_SECRET: 'google-secret',
    GOOGLE_ADS_API_VERSION: 'v26' });
  fetchMock = jest.fn(async () => { throw new Error('Unexpected mock request'); });
  global.fetch = fetchMock;
});
afterEach(() => { process.env = { ...previous }; global.fetch = originalFetch; });

test('AES-GCM credentials use random nonces and bind ciphertext to tenant/provider', () => {
  const secret = { accessToken: 'NEVER_RETURN_THIS', refreshToken: 'PRIVATE_REFRESH' };
  const a = seal(secret, 'org-a:google'); const b = seal(secret, 'org-a:google');
  expect(a).not.toBe(b);
  expect(a).not.toContain(secret.accessToken);
  expect(unseal(a, 'org-a:google')).toEqual(secret);
  expect(() => unseal(a, 'org-b:google')).toThrow('decryption failed');
  expect(() => unseal(a, 'org-a:meta')).toThrow();
  expect(() => unseal(a.slice(0, -5) + 'AAAAA', 'org-a:google')).toThrow();
  process.env.ADS_ENCRYPTION_KEY = '34'.repeat(32);
  expect(() => unseal(a, 'org-a:google')).toThrow();
});
test('encryption rejects missing or malformed keys', () => {
  delete process.env.ADS_ENCRYPTION_KEY;
  expect(() => seal({}, 'org')).toThrow();
  process.env.ADS_ENCRYPTION_KEY = 'placeholder';
  expect(() => seal({}, 'org')).toThrow();
});

test('OAuth URLs request Ads scopes only; Google uses offline PKCE and exact redirect', () => {
  const meta = new URL(new MetaAdsProvider().authorize('state', 'verifier'));
  expect(meta.searchParams.get('scope')).toBe('ads_read');
  expect(meta.searchParams.get('redirect_uri')).toBe('https://social.example.com/settings/advertising/callback/meta');
  expect(meta.href).not.toContain('meta-secret');
  const google = new URL(new GoogleAdsProvider().authorize('state', 'verifier'));
  expect(google.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
  expect(google.searchParams.get('access_type')).toBe('offline');
  expect(google.searchParams.get('code_challenge_method')).toBe('S256');
  expect(google.searchParams.get('code_challenge')).toBeTruthy();
  expect(google.href).not.toContain('google-secret');
});

test('Meta exchanges short token for long token and checks granted ads_read', async () => {
  fetchMock.mockResolvedValueOnce(response({ access_token: 'short-private' }))
    .mockResolvedValueOnce(response({ access_token: 'long-private', expires_in: 5000000 }))
    .mockResolvedValueOnce(response({ data: [{ permission: 'ads_read', status: 'granted' }] }));
  const tokens = await new MetaAdsProvider().exchange('code-private', 'unused');
  expect(tokens.accessToken).toBe('long-private');
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).not.toMatch(/short-private|long-private|meta-secret|code-private/);
    expect(options.redirect).toBe('error');
  }
  expect(String(fetchMock.mock.calls[1][1].body)).toContain('fb_exchange_token=short-private');
});

test('Meta requires permission and reauthorization rather than inventing refresh tokens', async () => {
  fetchMock.mockResolvedValueOnce(response({ access_token: 'short' }))
    .mockResolvedValueOnce(response({ access_token: 'long', expires_in: 1000 }))
    .mockResolvedValueOnce(response({ data: [{ permission: 'ads_read', status: 'declined' }] }));
  const provider = new MetaAdsProvider();
  await expect(provider.exchange('code', 'verifier')).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  await expect(provider.refresh({ accessToken: 'old', expiresAt: 0 })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
});

test('Meta paginates using bounded cursors without following token-bearing next URLs', async () => {
  const item = { id: 'act_123', name: 'Client', currency: 'USD', timezone_name: 'Asia/Riyadh', account_status: 1 };
  fetchMock.mockResolvedValueOnce(response({ data: [item], paging: { next: 'https://evil.invalid/?access_token=DO_NOT_FOLLOW', cursors: { after: 'cursor' } } }))
    .mockResolvedValueOnce(response({ data: [{ ...item, id: 'act_456', account_status: 2 }] }));
  const rows = await new MetaAdsProvider().accounts('meta-private');
  expect(rows.map((a) => a.status)).toEqual(['ENABLED', 'DISABLED']);
  expect(fetchMock.mock.calls[1][0]).toContain('graph.facebook.com/v25.0/me/adaccounts?');
  expect(fetchMock.mock.calls[1][0]).toContain('after=cursor');
  expect(fetchMock.mock.calls.every(([url]) => !url.includes('meta-private') && !url.includes('evil.invalid'))).toBe(true);
});

test('Google exchanges code with PKCE, requires refresh token, and retains it on refresh', async () => {
  const provider = new GoogleAdsProvider();
  fetchMock.mockResolvedValueOnce(response({ access_token: 'access', refresh_token: 'refresh-private', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' }))
    .mockResolvedValueOnce(response({ access_token: 'new-access', expires_in: 3600 }));
  const grant = await provider.exchange('code', 'verifier');
  expect(String(fetchMock.mock.calls[0][1].body)).toContain('code_verifier=verifier');
  expect((await provider.refresh(grant)).refreshToken).toBe('refresh-private');
  fetchMock.mockResolvedValueOnce(response({ access_token: 'access', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' }));
  await expect(provider.exchange('code', 'verifier')).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
});

test('Google discovers manager children and direct accounts without campaign mutate calls', async () => {
  fetchMock.mockResolvedValueOnce(response({ resourceNames: ['customers/123', 'customers/456'] }))
    .mockResolvedValueOnce(response({ results: [{ customer: { id: '123', manager: true } }] }))
    .mockResolvedValueOnce(response({ results: [{ customerClient: { id: '789', descriptiveName: 'Managed client', currencyCode: 'EUR', timeZone: 'Europe/Paris', manager: false, status: 'ENABLED' } }] }))
    .mockResolvedValueOnce(response({ results: [{ customer: { id: '456', descriptiveName: 'Direct client', currencyCode: 'USD', timeZone: 'America/New_York', manager: false, status: 'ENABLED' } }] }));
  const accounts = await new GoogleAdsProvider().accounts('google-private');
  expect(accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: '789', loginCustomerId: '123' }), expect.objectContaining({ id: '456' })]));
  expect(fetchMock.mock.calls[2][1].headers['login-customer-id']).toBe('123');
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).not.toContain('google-private');
    expect(url).not.toContain('mutate');
    expect(options.headers['developer-token']).toBeUndefined();
  }
});

test.each([
  [429, { error: { message: 'PRIVATE_TOKEN_ERROR' } }, 'RATE_LIMITED'],
  [400, { error: { code: 190, message: 'PRIVATE_TOKEN_ERROR' } }, 'REAUTH_REQUIRED'],
  [400, { error: 'invalid_grant', error_description: 'PRIVATE_TOKEN_ERROR' }, 'REAUTH_REQUIRED'],
  [503, { error: { message: 'PRIVATE_TOKEN_ERROR' } }, 'UNAVAILABLE'],
])('provider HTTP error %s is sanitized', async (status, body, expected) => {
  fetchMock.mockResolvedValueOnce(response(body, status as number, { 'retry-after': '120' }));
  await expect(providerJson('https://googleads.googleapis.com/v26/test')).rejects.toMatchObject({ code: expected });
  fetchMock.mockResolvedValueOnce(response(body, status as number));
  try { await providerJson('https://googleads.googleapis.com/v26/test'); }
  catch (error) { expect(String(error)).not.toContain('PRIVATE_TOKEN_ERROR'); }
});

test('disconnection uses provider permission/token revocation, never advertising mutations', async () => {
  fetchMock.mockResolvedValueOnce(response({ success: true }));
  await new MetaAdsProvider().revoke({ accessToken: 'meta-private', expiresAt: 0 });
  expect(fetchMock.mock.calls[0][0]).toContain('/me/permissions');
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
  await new GoogleAdsProvider().revoke({ accessToken: 'google-private', refreshToken: 'refresh-private', expiresAt: 0 });
  expect(fetchMock.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke');
  expect(String(fetchMock.mock.calls[1][1].body)).toBe('token=refresh-private');
});

test('network failures and malformed responses fail closed', async () => {
  await expect(new GoogleAdsProvider().accounts('private')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  fetchMock.mockResolvedValueOnce(new Response('broken json', { status: 200 }));
  await expect(providerJson('https://graph.facebook.com/test')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

test('Google configuration no longer requires the sunset developer token', () => {
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  expect(new GoogleAdsProvider().configured()).toBe(true);
});
test('Google empty accessible-customer result is a valid empty discovery', async () => {
  fetchMock.mockResolvedValueOnce(response({}));
  await expect(new GoogleAdsProvider().accounts('private')).resolves.toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test.each([undefined, '', 'Not/A_Timezone'])('rejects incomplete account timezone: %j', (timezone) => {
  expect(() => accountResult({ id: '123', name: 'Client', currency: 'USD', timezone, status: 'ENABLED' } as any)).toThrow();
});
test('HTTP-date rate limits are respected without retaining raw error payloads', async () => {
  fetchMock.mockResolvedValueOnce(response({ error: { message: 'private' } }, 429,
    { 'retry-after': new Date(Date.now() + 120000).toUTCString() }));
  const error = await providerJson('https://googleads.googleapis.com/test').catch((failure) => failure);
  expect(error.code).toBe('RATE_LIMITED'); expect(error.retryAfter).toBeGreaterThan(100);
  expect(error.retryAfter).toBeLessThanOrEqual(120); expect(String(error)).not.toContain('private');
});
test('an aborted discovery deadline propagates into provider HTTP requests', async () => {
  const controller = new AbortController(); controller.abort();
  fetchMock.mockImplementationOnce(async (_url, options) => {
    expect(options.signal.aborted).toBe(true); throw new Error('Aborted');
  });
  await expect(new GoogleAdsProvider().accounts('private', controller.signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('revoked Meta permissions request reauthorization rather than treating failure as empty discovery', async () => {
  fetchMock.mockResolvedValueOnce(response({ error: { code: 200, message: 'private permission error' } }, 403));
  await expect(new MetaAdsProvider().accounts('private')).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
});
