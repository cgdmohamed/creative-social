import { providerJson } from '../providers/advertising.http';
import { AdsProviderError } from '../advertising.types';
import { CampaignSpec, budgetUnits, campaignId } from './campaign.specification';
import { campaignBudget, campaignMetadata, campaignText } from './campaign.response';
import { googleBidding } from './campaign.bidding';

export class GoogleCampaignAdapter {
  async list(account: any, token: string, level: string, signal?: AbortSignal) {
    if (!/^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '')) throw new AdsProviderError('NOT_CONFIGURED');
    campaignId(account.externalAccountId);
    const resource = { CAMPAIGN: 'campaign', AD_GROUP: 'ad_group', AD: 'ad_group_ad' }[level];
    if (!resource) throw new AdsProviderError('INVALID_RESPONSE');
    const fields = level === 'CAMPAIGN' ? 'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros' : level === 'AD_GROUP'
      ? 'campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros' : 'campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries';
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
          name: campaignText(item?.name || item?.ad?.name, id), status: campaignText(item?.status, 'UNKNOWN', 40),
          approval: campaignText(item?.policySummary?.approvalStatus, 'UNAVAILABLE', 40), reviewStatus: campaignText(item?.policySummary?.reviewStatus, 'UNAVAILABLE', 40), validationErrors: [],
          objective: campaignText(row.campaign?.advertisingChannelType, null, 80), dailyBudgetMicros: campaignBudget(row.campaignBudget?.amountMicros), start: campaignText(row.campaign?.startDate, null, 100), end: campaignText(row.campaign?.endDate, null, 100),
          cpcBidMicros: campaignBudget(row.adGroup?.cpcBidMicros), creative: campaignMetadata(row.adGroupAd?.ad), policy: campaignMetadata(item?.policySummary?.policyTopicEntries) });
      }
      if (!body.nextPageToken) return rows;
      if (typeof body.nextPageToken !== 'string' || body.nextPageToken.length > 2048) throw new AdsProviderError('INVALID_RESPONSE');
      pageToken = body.nextPageToken;
    }
    throw new AdsProviderError('INVALID_RESPONSE');
  }
  plan(account: any, name: string, spec: CampaignSpec): any {
    const prefix = `customers/${campaignId(account.externalAccountId)}`;
    if (spec.operation !== 'CREATE') return { provider: 'GOOGLE_ADS', supported: true, blockers: [], review: { operation: spec.operation, resourceType: spec.resourceType || 'CAMPAIGN', resourceId: spec.resourceId || spec.campaignId,
      updateFields: spec.updateFields || [], intendedStatus: spec.operation === 'PAUSE' ? 'PAUSED' : spec.operation === 'RESUME' ? 'ENABLED' : 'UNCHANGED', providerValidation: 'Submission rechecks resource ownership, rejects shared budget edits and validates the atomic mutations before applying them.' } };
    const localDate = (value: string) => value.length === 10 ? value.replace(/-/g, '') : new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replace(/-/g, '');
    // Country criteria need provider-owned geoTargetConstant IDs, not guessed numeric mappings.
    return { provider: 'GOOGLE_ADS', supported: true, blockers: [], validationNotes: ['Submission resolves official country constants before Google validate-only. Search language targeting is automatic; manual language criteria were removed by Google in September 2026. Google campaign dates use account-local calendar days, not exact intraday start/stop times.'],
      proposedCountryCodes: spec.countries, dateSemantics: { requested: { start: spec.startImmediately ? 'IMMEDIATE' : spec.start, end: spec.noEndDate ? 'ONGOING / PROVIDER LIMIT' : spec.end }, timezone: account.timezone, startDate: spec.startImmediately ? 'SUBMISSION DAY' : localDate(spec.start), endDate: spec.noEndDate ? 'PROVIDER DEFAULT END LIMIT' : localDate(spec.end) }, request: {
      partialFailure: false, validateOnly: true, mutateOperations: [
        { campaignBudgetOperation: { create: { resourceName: `${prefix}/campaignBudgets/-1`, name: `${name} · Budget`, amountMicros: budgetUnits(spec.dailyBudget, spec.currency, true), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
        { campaignOperation: { create: { resourceName: `${prefix}/campaigns/-2`, name, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: `${prefix}/campaignBudgets/-1`, ...googleBidding(spec),
          ...(!spec.startImmediately ? { startDate: localDate(spec.start) } : {}), ...(!spec.noEndDate ? { endDate: localDate(spec.end) } : {}),
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false }, containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING' } } },
        { adGroupOperation: { create: { resourceName: `${prefix}/adGroups/-3`, name: `${name} · Ad group`, campaign: `${prefix}/campaigns/-2`, status: 'PAUSED', type: 'SEARCH_STANDARD', ...(spec.bidStrategy === 'MANUAL_CPC' ? { cpcBidMicros: budgetUnits(spec.maxCpc!, spec.currency, true) } : {}) } } },
        ...spec.keywords.map((keyword) => ({ adGroupCriterionOperation: { create: { adGroup: `${prefix}/adGroups/-3`, status: 'ENABLED', keyword: { text: keyword, matchType: spec.keywordMatchType || 'EXACT' } } } })),
        ...(spec.negativeKeywords || []).map((keyword) => ({ adGroupCriterionOperation: { create: { adGroup: `${prefix}/adGroups/-3`, negative: true, keyword: { text: keyword, matchType: spec.negativeMatchType || 'PHRASE' } } } })),
        { adGroupAdOperation: { create: { adGroup: `${prefix}/adGroups/-3`, status: 'PAUSED', ad: { finalUrls: [spec.destinationUrl], responsiveSearchAd: {
          headlines: spec.headlines.map((text) => ({ text })), descriptions: spec.descriptions.map((text) => ({ text })) } } } } },
      ],
    } };
  }
}
