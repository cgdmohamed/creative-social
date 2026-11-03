import { AdsProviderError, AdsTokens, AdsAccount } from '../advertising.types';

// Only provider implementations construct URLs. No user-supplied URLs or paging
// links are followed; tokens use headers/form bodies, never query strings.
export async function providerJson(url: string, options: RequestInit = {}): Promise<any> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(20000);
    response = await fetch(url, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  } catch { throw new AdsProviderError('UNAVAILABLE'); }
  let body: any;
  try { body = await response.json(); } catch { throw new AdsProviderError('INVALID_RESPONSE'); }
  if (!response.ok || body?.error) {
    const error = body?.error;
    const metaCode = Number(error?.code);
    const googleAuth = error?.details?.some?.((detail: any) => detail.errors?.some?.((item: any) => item.errorCode?.authenticationError));
    if (response.status === 429 || [4, 17, 32, 613].includes(metaCode) || error?.status === 'RESOURCE_EXHAUSTED') {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 60;
      throw new AdsProviderError('RATE_LIMITED', Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60);
    }
    if (response.status === 401 || [10, 190, 200, 294].includes(metaCode) || error === 'invalid_grant' || googleAuth) {
      throw new AdsProviderError('REAUTH_REQUIRED');
    }
    throw new AdsProviderError('UNAVAILABLE');
  }
  return body;
}
export function tokenResult(body: any, refreshToken?: string): AdsTokens {
  if (typeof body?.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in)) || Number(body.expires_in) <= 0 || Number(body.expires_in) > 366 * 86400) {
    throw new AdsProviderError('INVALID_RESPONSE');
  }
  if (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token)) throw new AdsProviderError('INVALID_RESPONSE');
  return { accessToken: body.access_token, refreshToken: body.refresh_token || refreshToken,
    expiresAt: Date.now() + Number(body.expires_in) * 1000 };
}
export function accountResult(account: AdsAccount): AdsAccount {
  if (typeof account.id !== 'string' || !/^(act_)?\d{1,20}$/.test(account.id) || !/^[A-Z]{3}$/.test(account.currency) ||
    typeof account.name !== 'string' || !account.name || account.name.length > 500 ||
    typeof account.timezone !== 'string' || !account.timezone || account.timezone.length > 100) throw new AdsProviderError('INVALID_RESPONSE');
  try { new Intl.DateTimeFormat('en', { timeZone: account.timezone }); }
  catch { throw new AdsProviderError('INVALID_RESPONSE'); }
  return account;
}
export function frontendOrigin() {
  try {
    const url = new URL(process.env.FRONTEND_URL!);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new AdsProviderError('NOT_CONFIGURED'); }
}
