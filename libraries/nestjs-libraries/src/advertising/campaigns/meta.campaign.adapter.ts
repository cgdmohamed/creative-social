import { createHmac } from 'crypto';
import { providerJson } from '../providers/advertising.http';
import { AdsProviderError } from '../advertising.types';
import { CampaignSpec, budgetUnits, campaignId } from './campaign.specification';
import { campaignBudget, campaignMetadata, campaignText } from './campaign.response';

export class MetaCampaignAdapter {
  async list(account: any, token: string, level: string, signal?: AbortSignal) {
    if (!/^v\d+\.0$/.test(process.env.META_ADS_API_VERSION || '') || !process.env.META_ADS_APP_SECRET) throw new AdsProviderError('NOT_CONFIGURED');
    if (!/^act_\d{1,20}$/.test(account.externalAccountId)) throw new AdsProviderError('INVALID_RESPONSE');
    const edge = { CAMPAIGN: 'campaigns', AD_GROUP: 'adsets', AD: 'ads' }[level];
    if (!edge) throw new AdsProviderError('INVALID_RESPONSE');
    const fields = level === 'CAMPAIGN' ? 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time' : level === 'AD_GROUP'
      ? 'id,name,campaign_id,campaign{id,objective},status,effective_status,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,bid_strategy' : 'id,name,campaign_id,campaign{id,objective},adset_id,status,effective_status,issues_info,creative{id,name,object_story_spec}';
    const rows: any[] = []; let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ fields, limit: '100', appsecret_proof: createHmac('sha256', process.env.META_ADS_APP_SECRET).update(token).digest('hex') });
      if (after) params.set('after', after);
      const body = await providerJson(`https://graph.facebook.com/${process.env.META_ADS_API_VERSION}/${account.externalAccountId}/${edge}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!Array.isArray(body.data) || body.data.length > 100) throw new AdsProviderError('INVALID_RESPONSE');
      for (const row of body.data) {
        const id = campaignId(row.id);
        rows.push({ id, campaignId: level === 'CAMPAIGN' ? id : campaignId(row.campaign_id), adGroupId: row.adset_id ? campaignId(row.adset_id) : null,
          name: campaignText(row.name, id), status: campaignText(row.status, 'UNKNOWN', 40), approval: campaignText(row.effective_status, 'UNKNOWN', 40),
          validationErrors: Array.isArray(row.issues_info) ? row.issues_info.slice(0, 20).map((issue: any) => ({ code: String(issue.error_code || issue.code || 'PROVIDER_ISSUE').slice(0, 40) })) : [],
          objective: campaignText(row.objective || row.campaign?.objective, null, 80), dailyBudgetMinor: campaignBudget(row.daily_budget), lifetimeBudgetMinor: campaignBudget(row.lifetime_budget), start: campaignText(row.start_time, null, 100), end: campaignText(row.stop_time || row.end_time, null, 100),
          targeting: campaignMetadata(row.targeting), creative: campaignMetadata(row.creative), optimization: campaignText(row.optimization_goal, null, 80), bidStrategy: campaignText(row.bid_strategy, null, 80) });
      }
      if (!body.paging?.next) return rows;
      after = body.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 2048) throw new AdsProviderError('INVALID_RESPONSE');
    }
    throw new AdsProviderError('INVALID_RESPONSE'); // Never silently return a partial list.
  }
  plan(account: any, name: string, spec: CampaignSpec): any {
    if (spec.operation !== 'CREATE') return { provider: 'META_ADS', supported: true, blockers: [], review: { resourceType: spec.resourceType || 'CAMPAIGN', resourceId: spec.resourceId || spec.campaignId,
      operation: spec.operation, updateFields: spec.updateFields || [], intendedStatus: spec.operation === 'PAUSE' || spec.operation === 'DUPLICATE' ? 'PAUSED' : spec.operation === 'RESUME' ? 'ACTIVE' : 'UNCHANGED',
      providerValidation: 'Submission rechecks resource ownership, budget association and builds only the explicitly selected fields.' } };
    const blockers = !spec.pageId || !spec.providerImageHash && !spec.advertisingAssetId ? ['Select an authorized Page and an account-owned ready image/video asset; local media is not a provider asset.'] : [];
    const conversion = spec.objective === 'OUTCOME_SALES' || spec.objective === 'OUTCOME_LEADS';
    const app = spec.objective === 'OUTCOME_APP_PROMOTION';
    const optimization = spec.objective === 'OUTCOME_AWARENESS' ? 'REACH' : spec.objective === 'OUTCOME_ENGAGEMENT' ? 'POST_ENGAGEMENT' : conversion ? 'OFFSITE_CONVERSIONS' : app ? 'APP_INSTALLS' : 'LINK_CLICKS';
    return { provider: 'META_ADS', supported: blockers.length === 0, blockers, operations: [
      { edge: 'campaigns', body: { name, objective: spec.objective, special_ad_categories: [] as string[], status: 'PAUSED', is_adset_budget_sharing_enabled: false } },
      { edge: 'adsets', body: { name: `${name} · Ad set`, campaign_id: '$campaign.id', status: 'PAUSED', daily_budget: budgetUnits(spec.dailyBudget, spec.currency, false),
        billing_event: 'IMPRESSIONS', optimization_goal: optimization, bid_strategy: spec.bidStrategy, ...(!spec.startImmediately ? { start_time: spec.start } : {}), ...(!spec.noEndDate ? { end_time: spec.end } : {}),
        ...(spec.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP' ? { bid_amount: budgetUnits(spec.maxBid!, spec.currency, false) } : {}),
        ...(conversion ? { destination_type: 'WEBSITE', promoted_object: { pixel_id: spec.pixelId, custom_event_type: spec.objective === 'OUTCOME_SALES' ? 'PURCHASE' : 'LEAD' } } : {}),
        ...(app ? { promoted_object: { application_id: spec.applicationId, object_store_url: spec.objectStoreUrl } } : {}),
        ...(spec.objective === 'OUTCOME_ENGAGEMENT' ? { destination_type: 'ON_AD' } : {}),
        targeting: { geo_locations: { countries: spec.countries }, ...(spec.placements === 'FACEBOOK_FEED' ? { publisher_platforms: ['facebook'], facebook_positions: ['feed'] } : {}) } } },
      { edge: 'adcreatives', body: { name: `${name} · Creative`, object_story_spec: { page_id: spec.pageId || '$authorizedPage', link_data: {
        image_hash: spec.providerImageHash || '$uploadedImageHash', link: spec.destinationUrl, name: spec.headlines[0], message: spec.descriptions[0], call_to_action: { type: app ? 'INSTALL_MOBILE_APP' : 'LEARN_MORE', value: { link: spec.destinationUrl } } } } } },
      { edge: 'ads', body: { name: `${name} · Ad`, adset_id: '$adset.id', creative: { creative_id: '$creative.id' }, status: 'PAUSED' } },
    ] };
  }
}
