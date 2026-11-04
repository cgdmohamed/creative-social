import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AdvertisingProvider, AdsProviderError, AdsTokens, AdsAccount } from '../advertising.types';
import { providerJson, tokenResult, accountResult, frontendOrigin } from './advertising.http';

@Injectable()
export class MetaAdsProvider implements AdvertisingProvider {
  configured() { return !!(process.env.META_ADS_APP_ID && process.env.META_ADS_APP_SECRET && /^v\d+\.0$/.test(process.env.META_ADS_API_VERSION || '')); }
  private settings() {
    if (!this.configured()) throw new AdsProviderError('NOT_CONFIGURED');
    return { id: process.env.META_ADS_APP_ID!, secret: process.env.META_ADS_APP_SECRET!,
      base: `https://graph.facebook.com/${process.env.META_ADS_API_VERSION}`,
      redirect: `${frontendOrigin()}/settings/advertising/callback/meta` };
  }
  authorize(state: string, _verifier: string) {
    const c = this.settings();
    return `https://www.facebook.com/${process.env.META_ADS_API_VERSION}/dialog/oauth?` + new URLSearchParams({
      client_id: c.id, redirect_uri: c.redirect, response_type: 'code', state,
      scope: 'ads_read', auth_type: 'rerequest',
    });
  }
  async exchange(code: string, _verifier: string) {
    const c = this.settings();
    const short = await providerJson(`${c.base}/oauth/access_token`, { method: 'POST',
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, code }) });
    if (typeof short.access_token !== 'string' || !short.access_token) throw new AdsProviderError('INVALID_RESPONSE');
    const long = await providerJson(`${c.base}/oauth/access_token`, { method: 'POST',
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token }) });
    const tokens = tokenResult(long);
    const permissions = await providerJson(`${c.base}/me/permissions`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!permissions.data?.some((p: any) => p.permission === 'ads_read' && p.status === 'granted')) throw new AdsProviderError('REAUTH_REQUIRED');
    return tokens;
  }
  async refresh(_tokens: AdsTokens): Promise<AdsTokens> {
    // Meta long-lived user tokens have no OAuth refresh_token. Reauthorize on expiry.
    throw new AdsProviderError('REAUTH_REQUIRED');
  }
  async accounts(accessToken: string, signal?: AbortSignal): Promise<AdsAccount[]> {
    const c = this.settings();
    const accounts: AdsAccount[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ fields: 'id,name,currency,timezone_name,account_status', limit: '100',
        appsecret_proof: createHmac('sha256', c.secret).update(accessToken).digest('hex') });
      if (after) params.set('after', after);
      const body = await providerJson(`${c.base}/me/adaccounts?${params}`, { signal, headers: { Authorization: `Bearer ${accessToken}` } });
      if (!Array.isArray(body.data)) throw new AdsProviderError('INVALID_RESPONSE');
      accounts.push(...body.data.map((a: any) => accountResult({ id: a.id, name: a.name, currency: a.currency,
        timezone: a.timezone_name, status: a.account_status === 1 ? 'ENABLED' : 'DISABLED' })));
      if (!body.paging?.next) return accounts;
      const cursor = body.paging?.cursors?.after;
      if (typeof cursor !== 'string' || !cursor || cursor === after) throw new AdsProviderError('INVALID_RESPONSE');
      after = cursor; // Do not follow provider-supplied next URLs containing credentials.
    }
    throw new AdsProviderError('UNAVAILABLE'); // Never treat a truncated discovery as complete.
  }
  async revoke(tokens: AdsTokens) {
    const c = this.settings();
    // Use a dedicated Ads app. This revokes its permissions, not campaigns.
    await providerJson(`${c.base}/me/permissions`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  }
}
