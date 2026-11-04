import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException, HttpException } from '@nestjs/common';
import { providerJson } from '../providers/advertising.http';
import { budgetUnits, campaignDigest, campaignId, CampaignSpec } from './campaign.specification';
import { campaignMutation, CampaignMutationError } from './campaign.transport';
import { creativePreviewUrl } from './campaign.preview';
import { keywordKey } from './campaign.targeting';

export type CampaignStep = { name: string; edge: string; body: Record<string, any>; response: 'META_ID' | 'META_SUCCESS' | 'GOOGLE_MUTATE' | 'META_COPY'; verification?: { keywords?: { groupId: string; positive: boolean; negative: boolean; keys: string[] }; targeting?: { campaignId: string; keys: string[] } }; reconcile?: { edge: string; suffix: string; parentCampaignId?: string; expectedGroups?: number; expectedAds?: number } };
export class CampaignManagementApi {
  constructor(readonly account: any, private token: string, private signal?: AbortSignal) {}
  private metaBase() {
    if (!/^v\d+\.0$/.test(process.env.META_ADS_API_VERSION || '') || !process.env.META_ADS_APP_SECRET) throw new BadRequestException('Configure Meta API version and app secret');
    return `https://graph.facebook.com/${process.env.META_ADS_API_VERSION}`;
  }
  private googleBase() {
    if (!/^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '')) throw new BadRequestException('Configure Google Ads API version');
    return `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION}`;
  }
  private headers() { return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
    ...(this.account.loginCustomerId ? { 'login-customer-id': campaignId(this.account.loginCustomerId) } : {}) }; }
  private proof() { return createHmac('sha256', process.env.META_ADS_APP_SECRET!).update(this.token).digest('hex'); }
  async metaRead(edge: string, parameters: Record<string, string>) {
    if (!/^(?:act_)?\d{1,30}(?:\/(campaigns|adsets|ads|adcreatives|adimages|advideos|previews|promote_pages|adspixels))?$/.test(edge) && edge !== 'me/permissions') throw new BadRequestException('Invalid Meta resource');
    const base = this.metaBase();
    const params = new URLSearchParams({ ...parameters, appsecret_proof: this.proof() });
    return providerJson(`${base}/${edge}?${params}`, { headers: { Authorization: `Bearer ${this.token}` }, signal: this.signal });
  }
  async googleSearch(query: string) {
    const results: any[] = []; let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const body = await providerJson(`${this.googleBase()}/customers/${campaignId(this.account.externalAccountId)}/googleAds:search`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }), signal: this.signal });
      if (!body || body.results !== undefined && !Array.isArray(body.results) || results.length + (body.results?.length || 0) > 20000) throw new BadRequestException('Provider list exceeded supported bounds');
      results.push(...body.results || []); if (!body.nextPageToken) return results;
      if (typeof body.nextPageToken !== 'string' || body.nextPageToken.length > 2048) throw new BadRequestException('Invalid provider cursor'); pageToken = body.nextPageToken;
    }
    throw new BadRequestException('Provider list exceeded supported bounds');
  }
  async permissions() {
    if (!this.account.managementAuthorized) throw new BadRequestException('Authorize campaign management explicitly for this workspace in Advertising Accounts settings');
    if (this.account.provider !== 'META_ADS') return;
    const body = await this.metaRead('me/permissions', {});
    if (!body.data?.some((p: any) => p.permission === 'ads_management' && p.status === 'granted')) throw new HttpException({ message: 'Reconnect Meta with explicit advertising management permission', code: 'MANAGEMENT_SCOPE_MISSING' }, 409);
  }
  async verifyAccount() {
    if (this.account.provider === 'META_ADS') {
      const row = await this.metaRead(this.account.externalAccountId, { fields: 'id,currency,timezone_name,account_status' });
      if (row.id !== this.account.externalAccountId || row.currency !== this.account.currency || row.timezone_name !== this.account.timezone || Number(row.account_status) !== 1) throw new BadRequestException('Meta account is unavailable or its currency/timezone changed; rediscover and review');
    } else {
      const rows = await this.googleSearch('SELECT customer.id, customer.currency_code, customer.time_zone, customer.status, customer.manager FROM customer');
      const customer = rows[0]?.customer;
      if (rows.length !== 1 || String(customer?.id) !== this.account.externalAccountId || customer.currencyCode !== this.account.currency || customer.timeZone !== this.account.timezone || customer.status !== 'ENABLED' || customer.manager === true) throw new BadRequestException('Google advertising account is unavailable or its currency/timezone changed; rediscover and review');
    }
  }
  async financialContext(spec: CampaignSpec) {
    if (spec.operation === 'CREATE' && (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN') return [];
    if (this.account.provider === 'GOOGLE_ADS') {
      const rows = await this.googleSearch(`SELECT campaign.id, campaign.start_date, campaign.end_date, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.period, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaignId(spec.campaignId)}`);
      if (rows.length !== 1 || !/^\d+$/.test(String(rows[0].campaignBudget?.amountMicros))) throw new BadRequestException('Existing campaign budget cannot be verified');
      const row = rows[0];
      const shared = row.campaignBudget.explicitlyShared === true;
      let affectedCampaigns: { id: string; name: string }[] = [];
      if (shared) {
        const resource = row.campaignBudget.resourceName;
        if (typeof resource !== 'string' || !new RegExp(`^customers/${campaignId(this.account.externalAccountId)}/campaignBudgets/\\d+$`).test(resource)) throw new BadRequestException('Invalid shared budget ownership');
        const affected = await this.googleSearch(`SELECT campaign.id, campaign.name FROM campaign WHERE campaign.campaign_budget = '${resource}' AND campaign.status != 'REMOVED'`);
        if (!affected.length || affected.length > 1000) throw new BadRequestException('Shared budget review requires 1–1000 affected campaigns');
        affectedCampaigns = affected.map((item) => ({ id: campaignId(item.campaign?.id), name: typeof item.campaign?.name === 'string' ? item.campaign.name.slice(0, 500) : '' })).sort((a, b) => a.id.localeCompare(b.id));
      }
      const context: any = { owner: row.campaignBudget.resourceName, period: row.campaignBudget.period || 'DAILY', amount: new Prisma.Decimal(row.campaignBudget.amountMicros).div(1000000).toFixed(), currency: this.account.currency,
        shared, affectedCampaigns, start: row.campaign.startDate || null, end: row.campaign.endDate || null };
      if (spec.updateFields?.includes('targeting') && (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN') context.existingTargeting = await this.googleSearch(`SELECT campaign_criterion.resource_name, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id = ${spec.campaignId} AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE') AND campaign_criterion.status != 'REMOVED'`);
      if (spec.resourceType === 'AD_GROUP' && (spec.updateFields?.includes('keywords') || spec.updateFields?.includes('negativeKeywords'))) context.existingKeywords = await this.googleSearch(`SELECT ad_group_criterion.resource_name, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group.id = ${campaignId(spec.resourceId)} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`);
      return [context];
    }
    const campaign = await this.metaRead(campaignId(spec.campaignId), { fields: 'id,account_id,daily_budget,lifetime_budget,start_time,stop_time' });
    if (String(campaign.account_id) !== this.account.externalAccountId.replace(/^act_/, '')) throw new BadRequestException('Campaign budget is not owned by selected account');
    let owners = [campaign];
    if (!(Number(campaign.daily_budget) > 0) && !(Number(campaign.lifetime_budget) > 0)) {
      if ((spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN' || spec.operation === 'CREATE' && spec.resourceType === 'AD_GROUP') owners = await this.metaCollection(`${spec.campaignId}/adsets`, 'id,daily_budget,lifetime_budget,start_time,end_time');
      else {
        const groupId = spec.resourceType === 'AD' && spec.operation !== 'CREATE' ? (await this.metaRead(campaignId(spec.resourceId), { fields: 'id,account_id,campaign_id,adset_id' })).adset_id : spec.resourceId;
        owners = [await this.metaRead(campaignId(groupId), { fields: 'id,account_id,campaign_id,daily_budget,lifetime_budget,start_time,end_time' })];
        if (owners[0].campaign_id !== spec.campaignId || String(owners[0].account_id) !== this.account.externalAccountId.replace(/^act_/, '')) throw new BadRequestException('Budget owner is outside selected campaign/account');
      }
    }
    if (!owners.length) return [];
    if (owners.length > 2000) throw new BadRequestException('Review campaign budget owners individually (maximum 2000 per review)');
    const unit = budgetUnits('1', this.account.currency, false);
    return owners.map((owner) => {
      const lifetime = Number(owner.lifetime_budget) > 0, amount = lifetime ? owner.lifetime_budget : owner.daily_budget;
      if (typeof amount !== 'string' || !/^\d+$/.test(amount)) throw new BadRequestException('Existing budget amount is unavailable');
      return { owner: campaignId(owner.id), period: lifetime ? 'LIFETIME' : 'DAILY', amount: new Prisma.Decimal(amount).div(unit).toFixed(), currency: this.account.currency,
        shared: false, start: owner.start_time || null, end: owner.end_time || owner.stop_time || null };
    }).sort((a, b) => a.owner.localeCompare(b.owner));
  }
  async metaCollection(edge: string, fields: string) {
    const rows: any[] = []; let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await this.metaRead(edge, { fields, limit: '100', ...(after ? { after } : {}) });
      if (!Array.isArray(response.data) || response.data.length > 100) throw new BadRequestException('Invalid Meta collection response');
      rows.push(...response.data);
      if (!response.paging?.next) return rows;
      after = response.paging?.cursors?.after;
      if (!after || typeof after !== 'string' || after.length > 2048) throw new BadRequestException('Invalid Meta cursor');
    }
    throw new BadRequestException('Meta collection exceeds supported bounds');
  }
  async reconcile(step: CampaignStep, evidenceId?: string): Promise<Record<string, any> | null> {
    if (this.account.provider === 'META_ADS') {
      if (evidenceId && (step.response === 'META_ID' || step.response === 'META_COPY')) {
        const edge = step.reconcile?.edge || step.edge;
        const fields = /\/ads$/.test(edge) ? 'id,account_id,name,campaign_id,adset_id' : /\/adsets$/.test(edge) ? 'id,account_id,name,campaign_id' : 'id,account_id,name';
        const row = await this.metaRead(campaignId(evidenceId), { fields });
        const nameMatches = step.response === 'META_COPY' ? typeof row.name === 'string' && row.name.endsWith(step.reconcile?.suffix || '') : row.name === step.body.name;
        if (String(row.account_id) !== this.account.externalAccountId.replace(/^act_/, '') || !nameMatches || step.body.campaign_id && row.campaign_id !== step.body.campaign_id || step.body.adset_id && row.adset_id !== step.body.adset_id) throw new BadRequestException('Provider evidence does not match the execution account, marker and parents');
        return step.response === 'META_COPY' ? this.confirmCopy(step, row.id) : this.confirmed(step, row);
      }
      if (step.response === 'META_COPY' && step.reconcile) {
        const rows = await this.metaCollection(step.reconcile.edge, step.reconcile.parentCampaignId ? 'id,name,campaign_id' : 'id,name');
        const matches = rows.filter((row) => typeof row.name === 'string' && row.name.endsWith(step.reconcile!.suffix) && (!step.reconcile!.parentCampaignId || row.campaign_id === step.reconcile!.parentCampaignId));
        return matches.length === 1 ? this.confirmCopy(step, matches[0].id) : null;
      }
      if (step.response === 'META_ID') {
        const edge = step.edge.split('/')[1];
        const fields = edge === 'adsets' ? 'id,name,campaign_id' : edge === 'ads' ? 'id,name,adset_id,campaign_id' : 'id,name';
        const rows = await this.metaCollection(step.edge, fields);
        const matches = rows.filter((row) => row.name === step.body.name && (!step.body.campaign_id || row.campaign_id === step.body.campaign_id) && (!step.body.adset_id || row.adset_id === step.body.adset_id));
        return matches.length === 1 ? this.confirmed(step, matches[0]) : null;
      }
      if (step.response === 'META_SUCCESS') {
        const fields = ['id', 'account_id', ...Object.keys(step.body)].join(',');
        const row = await this.metaRead(step.edge, { fields });
        if (String(row.account_id) !== this.account.externalAccountId.replace(/^act_/, '')) return null;
        const matches = (actual: any, expected: any): boolean => Array.isArray(expected) ? Array.isArray(actual) && campaignDigest([...actual].sort()) === campaignDigest([...expected].sort())
          : expected && typeof expected === 'object' ? !!actual && Object.entries(expected).every(([key, value]) => matches(actual[key], value)) : String(actual) === String(expected);
        return Object.entries(step.body).every(([key, value]) => key === 'creative' ? row.creative?.id === value.creative_id : key === 'end_time' ? Date.parse(row[key]) === Date.parse(value) : matches(row[key], value)) ? { success: true } : null;
      }
      return null;
    }
    const operations: any[] = step.body.mutateOperations;
    const verifiedResources: string[] = [];
    if (step.verification?.keywords) {
      const expected = step.verification.keywords;
      const rows = await this.googleSearch(`SELECT ad_group_criterion.resource_name, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group.id = ${campaignId(expected.groupId)} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`);
      const selected = rows.filter((row) => row.adGroupCriterion?.negative === true ? expected.negative : expected.positive);
      if (selected.some((row) => typeof row.adGroupCriterion?.keyword?.text !== 'string')) return null;
      const keys = selected.map((row) => keywordKey(row.adGroupCriterion.keyword.text, row.adGroupCriterion.keyword.matchType, row.adGroupCriterion.negative === true)).sort();
      if (campaignDigest(keys) !== campaignDigest(expected.keys)) return null;
      verifiedResources.push(...selected.map((row) => row.adGroupCriterion.resourceName));
    }
    if (step.verification?.targeting) {
      const expected = step.verification.targeting;
      const rows = await this.googleSearch(`SELECT campaign_criterion.resource_name, campaign_criterion.negative, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id = ${campaignId(expected.campaignId)} AND campaign_criterion.type IN ('LOCATION', 'LANGUAGE') AND campaign_criterion.status != 'REMOVED'`);
      const selected = rows.filter((row) => row.campaignCriterion?.negative !== true && row.campaignCriterion?.location?.geoTargetConstant);
      const keys = selected.map((row) => row.campaignCriterion.location?.geoTargetConstant || row.campaignCriterion.language?.languageConstant).sort();
      if (campaignDigest(keys) !== campaignDigest(expected.keys)) return null;
      verifiedResources.push(...selected.map((row) => row.campaignCriterion.resourceName));
    }
    const campaignCreate = operations.find((item) => item.campaignOperation?.create)?.campaignOperation.create;
    if (!campaignCreate) {
      const groupCreate = operations.find((item) => item.adGroupOperation?.create)?.adGroupOperation.create;
      if (groupCreate) {
        const literal = groupCreate.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const campaign = campaignId(groupCreate.campaign.split('/').pop());
        const groups = await this.googleSearch(`SELECT ad_group.id, ad_group.resource_name FROM ad_group WHERE campaign.id = ${campaign} AND ad_group.name = '${literal}' AND ad_group.status != 'REMOVED'`);
        if (groups.length !== 1) return null;
        const group = groups[0].adGroup, id = campaignId(group.id);
        const ads = await this.googleSearch(`SELECT ad_group_ad.resource_name FROM ad_group_ad WHERE ad_group.id = ${id} AND ad_group_ad.status != 'REMOVED'`);
        const keywords = await this.googleSearch(`SELECT ad_group_criterion.resource_name FROM ad_group_criterion WHERE ad_group.id = ${id} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`);
        if (ads.length !== 1 || keywords.length !== operations.filter((item) => item.adGroupCriterionOperation).length) return null;
        return { resources: [group.resourceName, ads[0].adGroupAd.resourceName, ...keywords.map((row) => row.adGroupCriterion.resourceName)] };
      }
      const labelCreate = operations.find((item) => item.labelOperation?.create)?.labelOperation.create;
      if (labelCreate) {
        if (!/^CS-[\w-]{1,100}$/.test(labelCreate.name)) return null;
        const labels = await this.googleSearch(`SELECT label.resource_name FROM label WHERE label.name = '${labelCreate.name}'`);
        if (labels.length !== 1 || !/^customers\/\d+\/labels\/\d+$/.test(labels[0].label?.resourceName || '')) return null;
        const resource = labels[0].label.resourceName;
        const ads = await this.googleSearch(`SELECT ad_group_ad.resource_name FROM ad_group_ad WHERE ad_group_ad.labels CONTAINS ANY ('${resource}') AND ad_group_ad.status != 'REMOVED'`);
        return ads.length === 1 ? { resources: [resource, ads[0].adGroupAd.resourceName] } : null;
      }
      const group = operations.find((item) => item.adGroupOperation?.update)?.adGroupOperation.update;
      if (group) {
        const id = campaignId(group.resourceName.split('/').pop());
        const rows = await this.googleSearch(`SELECT ad_group.resource_name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE ad_group.id = ${id}`);
        if (rows.length !== 1 || !Object.entries(group).every(([key, value]) => String(rows[0].adGroup?.[key]) === String(value))) return null;
        return { resources: [group.resourceName, ...verifiedResources] };
      }
      const groupAd = operations.find((item) => item.adGroupAdOperation?.update)?.adGroupAdOperation.update;
      if (groupAd) {
        const [groupId, adId] = groupAd.resourceName.split('/').pop().split('~');
        const rows = await this.googleSearch(`SELECT ad_group_ad.resource_name, ad_group_ad.status FROM ad_group_ad WHERE ad_group.id = ${campaignId(groupId)} AND ad_group_ad.ad.id = ${campaignId(adId)}`);
        return rows.length === 1 && rows[0].adGroupAd?.status === groupAd.status ? { resources: [groupAd.resourceName] } : null;
      }
      const ad = operations.find((item) => item.adOperation?.update)?.adOperation.update;
      if (ad) {
        const id = campaignId(ad.resourceName.split('/').pop());
        const rows = await this.googleSearch(`SELECT ad_group_ad.ad.resource_name, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ad_group_ad.ad.id = ${id} AND ad_group_ad.status != 'REMOVED'`);
        const actual = rows[0]?.adGroupAd?.ad;
        if (!actual) return null;
        const texts = (values: any[]) => Array.isArray(values) ? values.map((item) => item.text).sort() : [];
        return rows.length === 1 && campaignDigest(actual.finalUrls) === campaignDigest(ad.finalUrls) && campaignDigest(texts(actual.responsiveSearchAd?.headlines)) === campaignDigest(texts(ad.responsiveSearchAd.headlines)) && campaignDigest(texts(actual.responsiveSearchAd?.descriptions)) === campaignDigest(texts(ad.responsiveSearchAd.descriptions)) ? { resources: [ad.resourceName] } : null;
      }
      // Absolute campaign status/budget/name/end-date updates can be reconciled by
      // observing all requested fields. Never interpret absence as write failure.
      const update = operations.find((item) => item.campaignOperation?.update)?.campaignOperation.update;
      if (!update) {
        const budget = operations.find((item) => item.campaignBudgetOperation?.update)?.campaignBudgetOperation.update;
        if (!budget) return step.verification ? { resources: [...verifiedResources, ...operations.map((item) => item.adGroupCriterionOperation?.remove || item.campaignCriterionOperation?.remove).filter(Boolean)], observedState: 'MATCHED' } : null;
        const rows = await this.googleSearch(`SELECT campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign_budget WHERE campaign_budget.id = ${campaignId(budget.resourceName.split('/').pop())}`);
        return rows.length === 1 && String(rows[0].campaignBudget?.amountMicros) === budget.amountMicros ? { resources: [budget.resourceName] } : null;
      }
      const id = campaignId(update.resourceName.split('/').pop());
      const rows = await this.googleSearch(`SELECT campaign.resource_name, campaign.status, campaign.name, campaign.end_date, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.geo_target_type_setting.positive_geo_target_type, campaign.target_spend.cpc_bid_ceiling_micros, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${id}`);
      if (rows.length !== 1) return null;
      const row = rows[0], fields: Record<string, any> = { status: row.campaign?.status, name: row.campaign?.name, endDate: row.campaign?.endDate?.replace(/-/g, '') };
      const biddingMatches = (key: string, value: any) => {
        const campaign = row.campaign;
        if (key === 'manualCpc') return campaign.biddingStrategyType === 'MANUAL_CPC';
        if (key === 'targetSpend') return campaign.biddingStrategyType === 'TARGET_SPEND' && String(campaign.targetSpend?.cpcBidCeilingMicros) === value.cpcBidCeilingMicros;
        if (key === 'maximizeConversions') return campaign.biddingStrategyType === 'MAXIMIZE_CONVERSIONS' && String(campaign.maximizeConversions?.targetCpaMicros || '0') === (value.targetCpaMicros || '0');
        if (key === 'maximizeConversionValue') return campaign.biddingStrategyType === 'MAXIMIZE_CONVERSION_VALUE' && Number(campaign.maximizeConversionValue?.targetRoas || 0) === (value.targetRoas || 0);
        if (key === 'geoTargetTypeSetting') return campaign.geoTargetTypeSetting?.positiveGeoTargetType === value.positiveGeoTargetType;
        return String(fields[key]) === String(value);
      };
      if (!Object.entries(update).every(([key, value]) => key === 'resourceName' || biddingMatches(key, value))) return null;
      const budget = operations.find((item) => item.campaignBudgetOperation?.update)?.campaignBudgetOperation.update;
      if (budget && (row.campaign.campaignBudget !== budget.resourceName || String(row.campaignBudget?.amountMicros) !== budget.amountMicros)) return null;
      return { resources: [row.campaign.resourceName, ...(budget ? [budget.resourceName] : []), ...verifiedResources] };
    }
    const literal = campaignCreate.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const campaigns = await this.googleSearch(`SELECT campaign.id, campaign.resource_name, campaign.campaign_budget FROM campaign WHERE campaign.name = '${literal}'`);
    if (campaigns.length !== 1) return null;
    const campaign = campaigns[0].campaign, id = campaignId(campaign.id);
    const groups = await this.googleSearch(`SELECT ad_group.resource_name FROM ad_group WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED'`);
    const ads = await this.googleSearch(`SELECT ad_group_ad.resource_name FROM ad_group_ad WHERE campaign.id = ${id} AND ad_group_ad.status != 'REMOVED'`);
    const keywords = await this.googleSearch(`SELECT ad_group_criterion.resource_name FROM ad_group_criterion WHERE campaign.id = ${id} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`);
    const criteria = await this.googleSearch(`SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign.id = ${id} AND campaign_criterion.status != 'REMOVED'`);
    if (groups.length !== 1 || ads.length !== 1 || keywords.length !== operations.filter((item) => item.adGroupCriterionOperation).length || criteria.length !== operations.filter((item) => item.campaignCriterionOperation).length) return null;
    const resources = [campaign.resourceName, campaign.campaignBudget, ...groups.map((row) => row.adGroup?.resourceName), ...ads.map((row) => row.adGroupAd?.resourceName), ...keywords.map((row) => row.adGroupCriterion?.resourceName), ...criteria.map((row) => row.campaignCriterion?.resourceName)];
    if (resources.some((resource) => typeof resource !== 'string' || !resource.startsWith(`customers/${this.account.externalAccountId}/`))) return null;
    return { resources };
  }
  async confirmCopy(step: CampaignStep, id: string): Promise<Record<string, any>> {
    const row = await this.metaRead(campaignId(id), { fields: 'id,account_id,status' });
    if (String(row.account_id) !== this.account.externalAccountId.replace(/^act_/, '') || row.status !== 'PAUSED') throw new CampaignMutationError('UNKNOWN', 'COPIED_RESOURCE_STATE_NOT_CONFIRMED');
    const campaign = step.reconcile?.edge.endsWith('/campaigns'), group = step.reconcile?.edge.endsWith('/adsets');
    const groups = campaign ? await this.metaCollection(`${id}/adsets`, 'id,status') : [];
    const ads = campaign || group ? await this.metaCollection(`${id}/ads`, 'id,status,creative{id}') : [];
    if (groups.length !== (step.reconcile?.expectedGroups || 0) || ads.length !== (step.reconcile?.expectedAds || 0) || groups.some((item) => item.status !== 'PAUSED') || ads.some((item) => item.status !== 'PAUSED')) throw new CampaignMutationError('UNKNOWN', 'COPY_CHILDREN_NOT_CONFIRMED');
    return { id: campaignId(id), groups: groups.map((item) => campaignId(item.id)), ads: ads.map((item) => ({ id: campaignId(item.id), creativeId: item.creative?.id ? campaignId(item.creative.id) : null })) };
  }
  async googleTargeting(spec: CampaignSpec) {
    const countryList = spec.countries.map((code) => `'${code}'`).join(','); // canonical ISO codes only
    const locations = await this.googleSearch(`SELECT geo_target_constant.resource_name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED' AND geo_target_constant.country_code IN (${countryList})`);
    const locationResources = spec.countries.map((country) => {
      const matches = locations.filter((row) => row.geoTargetConstant?.countryCode === country);
      if (matches.length !== 1 || !/^geoTargetConstants\/\d+$/.test(matches[0].geoTargetConstant.resourceName)) throw new BadRequestException(`Country not available: ${country}`);
      return matches[0].geoTargetConstant.resourceName;
    });
    if (spec.languages?.length) throw new BadRequestException('Google Search no longer accepts manual language targeting');
    return { locationResources, languageResources: [] as string[] };
  }
  async send(step: CampaignStep, validateOnly = false) {
    if (this.account.provider === 'GOOGLE_ADS') {
      if (step.edge !== 'googleAds:mutate') throw new BadRequestException('Invalid Google mutation service');
      return campaignMutation(`${this.googleBase()}/customers/${campaignId(this.account.externalAccountId)}/googleAds:mutate`, {
        method: 'POST', headers: this.headers(), signal: this.signal, body: JSON.stringify({ ...step.body, validateOnly, partialFailure: false }) });
    }
    if (!/^(?:act_\d{1,20}\/(campaigns|adsets|adcreatives|ads|adimages|advideos)|\d{1,30}(?:\/copies)?)$/.test(step.edge)) throw new BadRequestException('Invalid Meta mutation resource');
    const form = new URLSearchParams({ appsecret_proof: this.proof(), ...Object.fromEntries(Object.entries(step.body).filter(([, value]) => value !== undefined).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])),
      ...(validateOnly ? { execution_options: JSON.stringify(['validate_only']) } : {}) });
    try { return await campaignMutation(`${this.metaBase()}/${step.edge}`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, signal: this.signal, body: form }); }
    catch (failure) {
      // A native deep copy can contain several provider-side creations. Even an
      // error response must be reconciled rather than blindly copying again.
      if (!validateOnly && step.response === 'META_COPY' && failure instanceof CampaignMutationError) throw new CampaignMutationError('UNKNOWN', failure.code, failure.issues, failure.retryAfter, failure.requestId);
      throw failure;
    }
  }
  async uploadAsset(bytes: Buffer, mime: string, marker: string) {
    if (this.account.provider === 'GOOGLE_ADS') {
      if (mime === 'video/mp4') throw new BadRequestException('Google video assets require a YouTube video ID; binary video upload is not exposed by Google Ads');
      const step: CampaignStep = { name: 'image-asset', edge: 'googleAds:mutate', response: 'GOOGLE_MUTATE', body: { mutateOperations: [{ assetOperation: { create: {
        name: marker, imageAsset: { data: bytes.toString('base64') } } } }] } };
      const response = await this.send(step);
      const confirmed = this.confirmed(step, response.body);
      return { providerId: confirmed.resources[0] as string, status: 'READY', requestId: response.requestId };
    }
    const base = this.metaBase();
    if (!/^act_\d{1,20}$/.test(this.account.externalAccountId)) throw new BadRequestException('Invalid Meta advertising account');
    const video = mime === 'video/mp4';
    const form = new FormData();
    form.set('appsecret_proof', this.proof()); form.set('name', marker);
    if (video) form.set('title', marker);
    form.set(video ? 'source' : 'filename', new Blob([new Uint8Array(bytes)], { type: mime }), `${marker}.${video ? 'mp4' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`);
    const response = await campaignMutation(`${base}/${this.account.externalAccountId}/${video ? 'advideos' : 'adimages'}`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: form, signal: this.signal });
    if (video) {
      if (typeof response.body.id !== 'string' || !/^\d{1,30}$/.test(response.body.id)) throw new CampaignMutationError('UNKNOWN', 'VIDEO_ID_NOT_CONFIRMED');
      return { providerId: response.body.id, status: 'PROCESSING', requestId: response.requestId };
    }
    const images: any[] = response.body.images && typeof response.body.images === 'object' ? Object.values(response.body.images) : [];
    if (images.length !== 1 || typeof images[0].hash !== 'string' || !/^[a-f0-9]{32}$/i.test(images[0].hash)) throw new CampaignMutationError('UNKNOWN', 'IMAGE_HASH_NOT_CONFIRMED');
    return { providerId: images[0].hash as string, imageHash: images[0].hash as string, thumbnailUrl: creativePreviewUrl(images[0].url), status: 'READY', requestId: response.requestId };
  }
  confirmed(step: CampaignStep, body: any): Record<string, any> {
    if (step.response === 'META_SUCCESS') {
      if (body.success !== true) throw new CampaignMutationError('UNKNOWN', 'MUTATION_NOT_CONFIRMED');
      return { success: true };
    }
    if (step.response === 'META_ID' || step.response === 'META_COPY') {
      const id = body.id || body.copied_campaign_id || body.copied_adset_id || body.copied_ad_id;
      if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw new CampaignMutationError('UNKNOWN', 'CREATED_ID_NOT_CONFIRMED');
      return { id };
    }
    const operations = step.body?.mutateOperations;
    if (!Array.isArray(operations) || !Array.isArray(body.mutateOperationResponses) || !operations.length || body.mutateOperationResponses.length !== operations.length) throw new CampaignMutationError('UNKNOWN', 'CREATED_IDS_NOT_CONFIRMED');
    const collections: Record<string, string> = { campaignBudgetOperation: 'campaignBudgets', campaignOperation: 'campaigns', adGroupOperation: 'adGroups', adGroupCriterionOperation: 'adGroupCriteria', adGroupAdOperation: 'adGroupAds', campaignCriterionOperation: 'campaignCriteria', adOperation: 'ads', assetOperation: 'assets', labelOperation: 'labels' };
    const resources = body.mutateOperationResponses.map((entry: any, index: number) => {
      const keys = Object.keys(operations[index]), key = keys[0], collection = collections[key];
      const name = entry?.[key?.replace(/Operation$/, 'Result')]?.resourceName;
      if (keys.length !== 1 || !collection || typeof name !== 'string' || !new RegExp(`^customers/${campaignId(this.account.externalAccountId)}/${collection}/[0-9]+(?:~[0-9]+)*$`).test(name)) throw new CampaignMutationError('UNKNOWN', 'CREATED_IDS_NOT_CONFIRMED');
      return name;
    });
    return { resources };
  }
}
