import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AdvertisingProvider, AdsProviderError, AdsTokens, AdsAccount } from '../advertising.types';
import { providerJson, tokenResult, accountResult, frontendOrigin } from './advertising.http';
const scope = 'https://www.googleapis.com/auth/adwords';

@Injectable()
export class GoogleAdsProvider implements AdvertisingProvider {
  configured() { return !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && /^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '')); }
  private settings() {
    if (!this.configured()) throw new AdsProviderError('NOT_CONFIGURED');
    return { id: process.env.GOOGLE_ADS_CLIENT_ID!, secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      base: `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION}`,
      redirect: `${frontendOrigin()}/settings/advertising/callback/google` };
  }
  authorize(state: string, verifier: string, _management = false) {
    const c = this.settings();
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope, state,
      access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
  }
  async exchange(code: string, verifier: string) {
    const c = this.settings();
    const body = await providerJson('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, code,
      code_verifier: verifier, grant_type: 'authorization_code',
    }) });
    if (!body.scope?.split(' ').includes(scope) || !body.refresh_token) throw new AdsProviderError('REAUTH_REQUIRED');
    return tokenResult(body);
  }
  async refresh(tokens: AdsTokens) {
    if (!tokens.refreshToken) throw new AdsProviderError('REAUTH_REQUIRED');
    const c = this.settings();
    const body = await providerJson('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
      client_id: c.id, client_secret: c.secret, refresh_token: tokens.refreshToken, grant_type: 'refresh_token',
    }) });
    if (body.scope && !body.scope.split(' ').includes(scope)) throw new AdsProviderError('REAUTH_REQUIRED');
    return tokenResult(body, tokens.refreshToken);
  }
  async accounts(accessToken: string, signal?: AbortSignal): Promise<AdsAccount[]> {
    const c = this.settings();
    // Developer tokens were sunset in September 2026. Access follows the Cloud
    // project owning the OAuth client; do not send the obsolete header.
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const roots = await providerJson(`${c.base}/customers:listAccessibleCustomers`, { headers, signal });
    if (!roots || typeof roots !== 'object' || Array.isArray(roots) ||
      (roots.resourceNames !== undefined && !Array.isArray(roots.resourceNames)) ||
      (roots.resourceNames?.length || 0) > 50) throw new AdsProviderError('INVALID_RESPONSE');
    const accounts = new Map<string, AdsAccount>();
    // Protobuf JSON may omit an empty repeated resourceNames field.
    for (const resource of roots.resourceNames || []) {
      const root = /^customers\/(\d{1,20})$/.exec(resource)?.[1];
      if (!root) throw new AdsProviderError('INVALID_RESPONSE');
      const search = async (query: string, manager?: string) => {
        const rows: any[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < 20; page++) {
          const result = await providerJson(`${c.base}/customers/${root}/googleAds:search`, {
            method: 'POST', signal, headers: { ...headers, ...(manager ? { 'login-customer-id': manager } : {}) },
            body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
          });
          if (result.results && !Array.isArray(result.results)) throw new AdsProviderError('INVALID_RESPONSE');
          rows.push(...(result.results || []));
          if (!result.nextPageToken) return rows;
          if (typeof result.nextPageToken !== 'string' || pageToken === result.nextPageToken) throw new AdsProviderError('INVALID_RESPONSE');
          pageToken = result.nextPageToken;
        }
        throw new AdsProviderError('UNAVAILABLE');
      };
      const self = (await search('SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer'))[0]?.customer;
      if (!self) throw new AdsProviderError('INVALID_RESPONSE');
      const rows = self.manager ? (await search('SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client', root)).map((r) => r.customerClient) : [self];
      for (const row of rows) {
        if (!row || row.manager) continue;
        const account = accountResult({ id: String(row.id), name: row.descriptiveName || `Google Ads ${row.id}`,
          currency: row.currencyCode, timezone: row.timeZone, status: row.status || 'UNKNOWN',
          ...(self.manager ? { loginCustomerId: root } : {}) });
        if (!accounts.has(account.id)) accounts.set(account.id, account);
      }
      if (accounts.size > 2000) throw new AdsProviderError('UNAVAILABLE');
    }
    return [...accounts.values()];
  }
  async revoke(tokens: AdsTokens) {
    // A dedicated OAuth client avoids revoking unrelated organic Google grants.
    let response: Response;
    try { response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST',
      body: new URLSearchParams({ token: tokens.refreshToken || tokens.accessToken }),
      redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new AdsProviderError('UNAVAILABLE'); }
    if (!response.ok) throw new AdsProviderError(response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE');
  }
}
