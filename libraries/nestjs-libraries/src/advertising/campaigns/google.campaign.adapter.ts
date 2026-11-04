import { providerJson } from '../providers/advertising.http';
import { AdsProviderError } from '../advertising.types';
import { CampaignSpec, budgetUnits, campaignId } from './campaign.specification';

export class GoogleCampaignAdapter {
  async list(account: any, token: string, level: string, signal?: AbortSignal) {
    if (!/^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '')) throw new AdsProviderError('NOT_CONFIGURED');
    campaignId(account.externalAccountId);
    const resource = { CAMPAIGN: 'campaign', AD_GROUP: 'ad_group', AD: 'ad_group_ad' }[level];
    if (!resource) throw new AdsProviderError('INVALID_RESPONSE');
    const fields = level === 'CAMPAIGN' ? 'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros' : level === 'AD_GROUP'
      ? 'campaign.id, ad_group.id, ad_group.name, ad_group.status' : 'campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status';
    const query = `SELECT ${fields} FROM ${resource} WHERE ${resource}.status != 'REMOVED'`;
    const rows: any[] = []; let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const body = await providerJson(`https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION}/customers/${account.externalAccountId}/googleAds:search`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(account.loginCustomerId ? { 'login-customer-id': campaignId(account.loginCustomerId) } : {}) },
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }), signal });
      if (!body || body.results !== undefined && !Array.isArray(body.results) || (body.results?.length || 0) + rows.length > 20000) throw new AdsProviderError('INVALID_RESPONSE');
      for (const row of body.results || []) {
        const item = level === 'CAMPAIGN' ? row.campaign : level === 'AD_GROUP' ? row.adGroup : row.adGroupAd;
        const id = campaignId(level === 'AD' ? item?.ad?.id : item?.id);
        rows.push({ id: level === 'AD' ? `${campaignId(row.adGroup?.id)}~${id}` : id, campaignId: campaignId(row.campaign?.id), adGroupId: row.adGroup ? campaignId(row.adGroup.id) : null,
          name: String(item?.name || item?.ad?.name || id).slice(0, 500), status: String(item?.status || 'UNKNOWN').slice(0, 40),
          approval: item?.policySummary?.approvalStatus || 'UNAVAILABLE', reviewStatus: item?.policySummary?.reviewStatus || 'UNAVAILABLE', validationErrors: [],
          objective: row.campaign?.advertisingChannelType || null, dailyBudgetMicros: row.campaignBudget?.amountMicros || null, start: row.campaign?.startDate || null, end: row.campaign?.endDate || null });
      }
      if (!body.nextPageToken) return rows;
      if (typeof body.nextPageToken !== 'string' || body.nextPageToken.length > 2048) throw new AdsProviderError('INVALID_RESPONSE');
      pageToken = body.nextPageToken;
    }
    throw new AdsProviderError('INVALID_RESPONSE');
  }
  plan(account: any, name: string, spec: CampaignSpec) {
    const prefix = `customers/${campaignId(account.externalAccountId)}`;
    if (spec.operation !== 'CREATE') return { provider: 'GOOGLE_ADS', supported: spec.operation !== 'UPDATE', blockers: spec.operation === 'UPDATE' ? ['Existing shared budgets/date edits are not supported in this release.'] : [],
      request: { partialFailure: false, validateOnly: true, mutateOperations: [{ campaignOperation: { update: { resourceName: `${prefix}/campaigns/${spec.campaignId}`, status: spec.operation === 'PAUSE' ? 'PAUSED' : 'ENABLED' }, updateMask: 'status' } }] } };
    const localDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replace(/-/g, '');
    // Country criteria need provider-owned geoTargetConstant IDs, not guessed numeric mappings.
    return { provider: 'GOOGLE_ADS', supported: false, blockers: ['Resolve and validate country geoTargetConstants before provider submission. Google campaign dates use account-local calendar days, not exact intraday start/stop times.'],
      proposedCountryCodes: spec.countries, dateSemantics: { requestedUtc: { start: spec.start, end: spec.end }, timezone: account.timezone, startDate: localDate(spec.start), endDate: localDate(spec.end) }, request: {
      partialFailure: false, validateOnly: true, mutateOperations: [
        { campaignBudgetOperation: { create: { resourceName: `${prefix}/campaignBudgets/-1`, name: `${name} · Budget`, amountMicros: budgetUnits(spec.dailyBudget, spec.currency, true), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
        { campaignOperation: { create: { resourceName: `${prefix}/campaigns/-2`, name, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: `${prefix}/campaignBudgets/-1`, manualCpc: {},
          startDate: localDate(spec.start), endDate: localDate(spec.end),
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false }, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' } } },
        { adGroupOperation: { create: { resourceName: `${prefix}/adGroups/-3`, name: `${name} · Ad group`, campaign: `${prefix}/campaigns/-2`, status: 'PAUSED', type: 'SEARCH_STANDARD', cpcBidMicros: budgetUnits(spec.maxCpc!, spec.currency, true) } } },
        ...spec.keywords.map((keyword) => ({ adGroupCriterionOperation: { create: { adGroup: `${prefix}/adGroups/-3`, status: 'ENABLED', keyword: { text: keyword, matchType: 'EXACT' } } } })),
        { adGroupAdOperation: { create: { adGroup: `${prefix}/adGroups/-3`, status: 'PAUSED', ad: { finalUrls: [spec.destinationUrl], responsiveSearchAd: {
          headlines: spec.headlines.map((text) => ({ text })), descriptions: spec.descriptions.map((text) => ({ text })) } } } } },
      ],
    } };
  }
}
