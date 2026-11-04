import { createHmac } from 'crypto';
import { providerJson } from '../providers/advertising.http';
import { AdsProviderError } from '../advertising.types';
import { CampaignSpec, budgetUnits, campaignId } from './campaign.specification';

export class MetaCampaignAdapter {
  async list(account: any, token: string, level: string, signal?: AbortSignal) {
    if (!/^v\d+\.0$/.test(process.env.META_ADS_API_VERSION || '') || !process.env.META_ADS_APP_SECRET) throw new AdsProviderError('NOT_CONFIGURED');
    if (!/^act_\d{1,20}$/.test(account.externalAccountId)) throw new AdsProviderError('INVALID_RESPONSE');
    const edge = { CAMPAIGN: 'campaigns', AD_GROUP: 'adsets', AD: 'ads' }[level];
    if (!edge) throw new AdsProviderError('INVALID_RESPONSE');
    const fields = level === 'CAMPAIGN' ? 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time' : level === 'AD_GROUP'
      ? 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time' : 'id,name,campaign_id,adset_id,status,effective_status,issues_info';
    const rows: any[] = []; let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ fields, limit: '100', appsecret_proof: createHmac('sha256', process.env.META_ADS_APP_SECRET).update(token).digest('hex') });
      if (after) params.set('after', after);
      const body = await providerJson(`https://graph.facebook.com/${process.env.META_ADS_API_VERSION}/${account.externalAccountId}/${edge}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!Array.isArray(body.data) || body.data.length > 100) throw new AdsProviderError('INVALID_RESPONSE');
      for (const row of body.data) {
        const id = campaignId(row.id);
        rows.push({ id, campaignId: level === 'CAMPAIGN' ? id : campaignId(row.campaign_id), adGroupId: row.adset_id ? campaignId(row.adset_id) : null,
          name: String(row.name || id).slice(0, 500), status: String(row.status || 'UNKNOWN').slice(0, 40), approval: String(row.effective_status || 'UNKNOWN').slice(0, 40),
          validationErrors: Array.isArray(row.issues_info) ? row.issues_info.slice(0, 20).map((issue: any) => ({ code: String(issue.error_code || issue.code || 'PROVIDER_ISSUE').slice(0, 40) })) : [],
          objective: row.objective || null, dailyBudgetMinor: row.daily_budget || null, lifetimeBudgetMinor: row.lifetime_budget || null, start: row.start_time || null, end: row.stop_time || row.end_time || null });
      }
      if (!body.paging?.next) return rows;
      after = body.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 2048) throw new AdsProviderError('INVALID_RESPONSE');
    }
    throw new AdsProviderError('INVALID_RESPONSE'); // Never silently return a partial list.
  }
  plan(account: any, name: string, spec: CampaignSpec) {
    if (spec.operation !== 'CREATE') return { provider: 'META_ADS', supported: spec.operation !== 'UPDATE',
      operations: [{ resource: spec.campaignId, status: spec.operation === 'PAUSE' ? 'PAUSED' : spec.operation === 'RESUME' ? 'ACTIVE' : 'UNCHANGED' }],
      blockers: spec.operation === 'UPDATE' ? ['Existing Meta budget/date edits require provider reconciliation and are not supported in this release.'] : [] };
    const blockers = !spec.pageId || !spec.providerImageHash ? ['Select an authorized Page and an account-owned uploaded image hash; local media is not a provider asset.'] : [];
    return { provider: 'META_ADS', supported: blockers.length === 0, blockers, operations: [
      { edge: 'campaigns', body: { name, objective: spec.objective, special_ad_categories: [] as string[], status: 'PAUSED', is_adset_budget_sharing_enabled: false } },
      { edge: 'adsets', body: { name: `${name} · Ad set`, campaign_id: '$campaign.id', status: 'PAUSED', daily_budget: budgetUnits(spec.dailyBudget, spec.currency, false),
        billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS', bid_strategy: spec.bidStrategy, start_time: spec.start, end_time: spec.end,
        targeting: { geo_locations: { countries: spec.countries }, ...(spec.placements === 'FACEBOOK_FEED' ? { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } : {}) } } },
      { edge: 'adcreatives', body: { name: `${name} · Creative`, object_story_spec: { page_id: spec.pageId || '$authorizedPage', link_data: {
        image_hash: spec.providerImageHash || '$uploadedImageHash', link: spec.destinationUrl, name: spec.headlines[0], message: spec.descriptions[0], call_to_action: { type: 'LEARN_MORE' } } } } },
      { edge: 'ads', body: { name: `${name} · Ad`, adset_id: '$adset.id', creative: { creative_id: '$creative.id' }, status: 'PAUSED' } },
    ] };
  }
}
