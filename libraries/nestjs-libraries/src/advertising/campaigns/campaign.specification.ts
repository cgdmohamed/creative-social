import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export type CampaignSpec = {
  operation: 'CREATE' | 'PAUSE' | 'RESUME' | 'UPDATE' | 'DUPLICATE';
  campaignId?: string;
  resourceType?: 'CAMPAIGN' | 'AD_GROUP' | 'AD';
  resourceId?: string;
  updateFields?: string[];
  allowSharedBudgetChange?: boolean;
  objective: string;
  currency: string;
  dailyBudget: string;
  maxCpc?: string;
  maxBid?: string;
  targetCpa?: string;
  targetRoas?: string;
  start: string;
  end: string;
  startImmediately?: boolean;
  noEndDate?: boolean;
  bidStrategy: string;
  countries: string[];
  languages?: string[];
  placements: 'AUTOMATIC' | 'FACEBOOK_FEED';
  pageId?: string;
  mediaId?: string;
  advertisingAssetId?: string;
  providerImageHash?: string;
  pixelId?: string;
  applicationId?: string;
  objectStoreUrl?: string;
  headlines: string[];
  descriptions: string[];
  destinationUrl: string;
  keywords: string[];
  keywordMatchType?: 'EXACT' | 'PHRASE' | 'BROAD';
  negativeKeywords?: string[];
  negativeMatchType?: 'EXACT' | 'PHRASE' | 'BROAD';
};
export const campaignObjectives: Record<string, string[]> = {
  META_ADS: ['OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_APP_PROMOTION'], GOOGLE_ADS: ['SEARCH'],
};
export const campaignBidStrategies: Record<string, string[]> = {
  META_ADS: ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'],
  GOOGLE_ADS: ['MANUAL_CPC', 'MAXIMIZE_CLICKS', 'MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS'],
};
const fail = (message: string): never => { throw new BadRequestException(message); };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
// PostgreSQL JSONB changes object key order. Review integrity and idempotency must
// survive a database round trip while preserving ordered creative text arrays.
export const campaignDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function campaignName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\u0000-\u001f<>]/u.test(value)) fail('Name must contain 1–100 plain text characters');
  return (value as string).trim();
}
export function campaignId(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) fail('Invalid provider campaign ID');
  return value as string;
}
export function budgetUnits(amount: string, currency: string, google: boolean) {
  let digits: number;
  try { digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!; }
  catch { return fail('Unsupported currency'); }
  if (typeof amount !== 'string' || !/^[A-Z]{3}$/.test(currency) || !/^\d{1,9}(\.\d{1,6})?$/.test(amount)) fail('Budget must be a positive decimal in account currency');
  const decimal = new Prisma.Decimal(amount);
  if (decimal.lte(0) || decimal.decimalPlaces() > digits) fail(`Budget supports ${digits} decimal places for ${currency}`);
  return decimal.mul(new Prisma.Decimal(10).pow(google ? 6 : digits)).toFixed(0);
}
function texts(input: unknown, min: number, max: number, length: number, field: string) {
  if (!Array.isArray(input) || input.length < min || input.length > max || input.some((text) => typeof text !== 'string' || !text.trim() || [...text].length > length || /[\u0000-\u001f<>]/u.test(text))) fail(`Invalid ${field}`);
  return (input as string[]).map((text) => text.trim());
}
// Whitelist and canonicalize JSON: provider payloads are never accepted from clients.
export function campaignSpec(value: unknown, account: { provider: string; currency: string; timezone?: string }): CampaignSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Campaign specification required');
  const input = value as Record<string, any>;
  const keys = ['operation', 'campaignId', 'resourceType', 'resourceId', 'updateFields', 'allowSharedBudgetChange', 'objective', 'currency', 'dailyBudget', 'maxCpc', 'maxBid', 'targetCpa', 'targetRoas', 'start', 'end', 'startImmediately', 'noEndDate', 'bidStrategy', 'countries', 'languages', 'placements', 'pageId', 'mediaId', 'advertisingAssetId', 'providerImageHash', 'pixelId', 'applicationId', 'objectStoreUrl', 'headlines', 'descriptions', 'destinationUrl', 'keywords', 'keywordMatchType', 'negativeKeywords', 'negativeMatchType'];
  if (Object.keys(input).some((key) => !keys.includes(key))) fail('Unsupported campaign field');
  if (!['CREATE', 'PAUSE', 'RESUME', 'UPDATE', 'DUPLICATE'].includes(input.operation)) fail('Unsupported campaign operation');
  const resourceType = input.resourceType || 'CAMPAIGN';
  if (!['CAMPAIGN', 'AD_GROUP', 'AD'].includes(resourceType)) fail('Invalid advertising resource type');
  if (input.operation !== 'CREATE' || resourceType !== 'CAMPAIGN') campaignId(input.campaignId);
  else if (input.campaignId) fail('A new root campaign cannot reference another campaign');
  if (input.operation === 'CREATE' && resourceType === 'AD') campaignId(input.resourceId);
  if (input.operation !== 'CREATE' && resourceType !== 'CAMPAIGN') {
    if (typeof input.resourceId !== 'string' || !(account.provider === 'GOOGLE_ADS' && resourceType === 'AD' ? /^\d{1,30}~\d{1,30}$/ : /^\d{1,30}$/).test(input.resourceId)) fail('Invalid child resource ID');
  }
  if (input.operation === 'DUPLICATE' && account.provider !== 'META_ADS') fail('Google duplication creates a new Search draft from its reviewed specification; provider deep copy is not exposed');
  if (!campaignObjectives[account.provider]?.includes(input.objective)) fail('Unsupported provider objective');
  if (input.currency !== account.currency) fail('Budget currency must match advertising account currency');
  budgetUnits(input.dailyBudget, input.currency, account.provider === 'GOOGLE_ADS');
  for (const key of ['startImmediately', 'noEndDate']) if (input[key] !== undefined && (typeof input[key] !== 'boolean' || input[key] && (input.operation !== 'CREATE' || resourceType === 'AD' || account.provider === 'GOOGLE_ADS' && resourceType !== 'CAMPAIGN'))) fail('Immediate/ongoing scheduling applies only to new resources with their own schedules');
  for (const key of ['start', 'end']) {
    if (key === 'start' && input.startImmediately || key === 'end' && input.noEndDate) continue;
    if (account.provider === 'GOOGLE_ADS' && typeof input[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input[key])) {
      const date = new Date(input[key] + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input[key]) fail('Invalid account-local calendar date');
      continue;
    }
    if (typeof input[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])) || new Date(input[key]).toISOString() !== input[key].replace('Z', '.000Z')) fail('Schedule requires valid UTC minute timestamps');
  }
  const start = input.startImmediately ? Date.now() : Date.parse(input.start), end = Date.parse(input.end);
  if (!input.noEndDate) {
    if (account.provider === 'GOOGLE_ADS') {
      const local = (text: string, time: number) => text?.length === 10 ? text : new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
      if (local(input.end, end) < local(input.startImmediately ? '' : input.start, start)) fail('Google end calendar date must be on or after its start date');
    } else if (end <= start) fail('Schedule must end after its start');
  }
  const google = account.provider === 'GOOGLE_ADS';
  if (!campaignBidStrategies[account.provider]?.includes(input.bidStrategy)) fail('Unsupported bid strategy');
  if (google && ['MANUAL_CPC', 'MAXIMIZE_CLICKS'].includes(input.bidStrategy)) {
    budgetUnits(input.maxCpc, input.currency, true);
    if (new Prisma.Decimal(input.maxCpc).gt(input.dailyBudget)) fail('Maximum CPC cannot exceed daily budget');
  } else if (input.maxCpc !== undefined) fail('Maximum CPC applies only to manual CPC / maximize clicks workflows');
  if (!google && input.bidStrategy !== 'LOWEST_COST_WITHOUT_CAP') budgetUnits(input.maxBid, input.currency, false);
  else if (input.maxBid !== undefined) fail('Meta bid/cost cap is not applicable to selected strategy');
  if (input.bidStrategy === 'TARGET_CPA') budgetUnits(input.targetCpa, input.currency, true); else if (input.targetCpa !== undefined) fail('Target CPA is not applicable to selected strategy');
  if (input.bidStrategy === 'TARGET_ROAS') {
    if (typeof input.targetRoas !== 'string' || !/^\d{1,4}(\.\d{1,6})?$/.test(input.targetRoas) || new Prisma.Decimal(input.targetRoas).lt('0.01') || new Prisma.Decimal(input.targetRoas).gt(1000)) fail('Target ROAS must be a multiple between 0.01 and 1000');
  } else if (input.targetRoas !== undefined) fail('Target ROAS is not applicable to selected strategy');
  if (google && input.placements !== 'AUTOMATIC' || !['AUTOMATIC', 'FACEBOOK_FEED'].includes(input.placements)) fail('Unsupported placements');
  if (!Array.isArray(input.countries) || !input.countries.length || input.countries.length > 10 || input.countries.some((c: unknown) => typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)) || new Set(input.countries).size !== input.countries.length) fail('Choose 1–10 distinct ISO country codes');
  // No fetch is performed for destination URLs. Disallow credentials, local hosts and non-HTTPS schemes.
  let url: URL;
  try { url = new URL(input.destinationUrl); } catch { return fail('Invalid destination URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) fail('Destination requires a public HTTPS hostname');
  if (!google && input.pageId) campaignId(input.pageId);
  if (input.mediaId !== undefined && (typeof input.mediaId !== 'string' || !/^[\w-]{1,100}$/.test(input.mediaId))) fail('Invalid workspace media');
  if (input.advertisingAssetId !== undefined && (typeof input.advertisingAssetId !== 'string' || !/^[\w-]{1,100}$/.test(input.advertisingAssetId))) fail('Invalid advertising asset');
  if (input.providerImageHash !== undefined && (typeof input.providerImageHash !== 'string' || !/^[a-fA-F0-9]{32}$/.test(input.providerImageHash))) fail('Invalid Meta image hash');
  if (google && (input.pixelId || input.applicationId || input.objectStoreUrl || input.advertisingAssetId)) fail('Google Search uses responsive text creatives; Meta tracking/app fields and binary creative references are not Search ad fields');
  const createsCreative = input.operation === 'CREATE' || input.operation === 'UPDATE' && input.updateFields?.includes('creative');
  if (!google && createsCreative && ['OUTCOME_LEADS', 'OUTCOME_SALES'].includes(input.objective)) campaignId(input.pixelId);
  if (!google && createsCreative && input.objective === 'OUTCOME_APP_PROMOTION') {
    campaignId(input.applicationId);
    let store: URL; try { store = new URL(input.objectStoreUrl); } catch { return fail('App promotion requires its official app store URL'); }
    if (store.protocol !== 'https:' || store.username || store.password || store.port || !['apps.apple.com', 'itunes.apple.com', 'play.google.com'].includes(store.hostname) || store.href !== url.href) fail('App promotion destination must match its official Apple/Google app store URL');
  }
  const result: CampaignSpec = { operation: input.operation, objective: input.objective, currency: input.currency, dailyBudget: new Prisma.Decimal(input.dailyBudget).toFixed(),
    start: input.startImmediately ? '' : input.start, end: input.noEndDate ? '' : input.end, bidStrategy: input.bidStrategy, countries: [...input.countries].sort(), placements: input.placements,
    headlines: texts(input.headlines, google ? 3 : 1, google ? 15 : 1, google ? 30 : 40, 'headlines'),
    descriptions: texts(input.descriptions, google ? 2 : 1, google ? 4 : 1, google ? 90 : 500, 'descriptions'), destinationUrl: url.href,
    keywords: texts(input.keywords, google && !(input.operation === 'CREATE' && resourceType === 'AD') ? 1 : 0, google ? 20 : 0, 80, 'exact-match search keywords') };
  for (const key of ['campaignId', 'pageId', 'mediaId', 'advertisingAssetId', 'providerImageHash', 'pixelId', 'applicationId', 'objectStoreUrl'] as const) if (input[key]) result[key] = input[key];
  for (const key of ['maxCpc', 'maxBid', 'targetCpa', 'targetRoas'] as const) if (input[key] !== undefined) result[key] = new Prisma.Decimal(input[key]).toFixed();
  if (input.startImmediately !== undefined) result.startImmediately = input.startImmediately;
  if (input.noEndDate !== undefined) result.noEndDate = input.noEndDate;
  for (const key of ['keywordMatchType', 'negativeMatchType'] as const) if (input[key] !== undefined) {
    if (!google || !['EXACT', 'PHRASE', 'BROAD'].includes(input[key])) fail('Invalid Google keyword match type'); result[key] = input[key];
  }
  if (input.negativeKeywords !== undefined) {
    if (!google) fail('Negative Search keywords are Google-specific'); result.negativeKeywords = texts(input.negativeKeywords, 0, 20, 80, 'negative keywords');
  }
  for (const keywords of [result.keywords, result.negativeKeywords || []]) if (new Set(keywords.map((word) => word.toLowerCase().replace(/\s+/g, ' '))).size !== keywords.length) fail('Duplicate keyword text is not allowed');
  if (input.resourceType) result.resourceType = resourceType;
  if (input.resourceId) result.resourceId = input.resourceId;
  if (input.updateFields !== undefined) {
    if (input.operation !== 'UPDATE' || !Array.isArray(input.updateFields) || !input.updateFields.length || input.updateFields.length > 6 || new Set(input.updateFields).size !== input.updateFields.length || input.updateFields.some((field: any) => !['name', 'budget', 'end', 'targeting', 'bid', 'creative', 'keywords', 'negativeKeywords'].includes(field))) fail('Select supported update fields explicitly');
    const allowed = resourceType === 'CAMPAIGN' ? account.provider === 'META_ADS' ? ['name', 'budget'] : ['name', 'budget', 'end', 'bid', 'targeting'] : resourceType === 'AD_GROUP' ? account.provider === 'META_ADS' ? ['name', 'budget', 'end', 'targeting', 'bid'] : ['name', 'bid', 'keywords', 'negativeKeywords'] : account.provider === 'META_ADS' ? ['name', 'creative'] : ['creative'];
    if (input.updateFields.some((field: string) => !allowed.includes(field))) fail('An update field is not supported for this provider/resource');
    result.updateFields = [...input.updateFields].sort();
  } else if (input.operation === 'UPDATE') fail('Select update fields explicitly');
  if (input.allowSharedBudgetChange !== undefined) {
    if (typeof input.allowSharedBudgetChange !== 'boolean' || !google || input.operation !== 'UPDATE' || resourceType !== 'CAMPAIGN' || !result.updateFields?.includes('budget')) fail('Shared-budget confirmation only applies to Google campaign budget changes');
    result.allowSharedBudgetChange = input.allowSharedBudgetChange;
  }
  if (input.languages !== undefined) {
    if (!google || !Array.isArray(input.languages) || input.languages.length) fail('Manual language targeting is no longer supported for Google Search. Remove legacy language selections and review the ad language.');
  }
  if (google && (result.pageId || result.providerImageHash)) fail('Meta creative fields cannot be used for Google Search');
  return result;
}

export function campaignConfirmation(account: any, spec: CampaignSpec) {
  const local = (value: string) => value.length === 10 ? value : new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const changesBudget = spec.operation === 'CREATE' && ((spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN' || account.provider === 'META_ADS' && spec.resourceType === 'AD_GROUP') || spec.operation === 'UPDATE' && spec.updateFields?.includes('budget');
  return `${spec.operation} ${spec.resourceType || 'CAMPAIGN'} ${spec.resourceId || spec.campaignId || 'NEW'} ${account.externalAccountId} ${changesBudget ? `${spec.currency} ${spec.dailyBudget}/day proposed` : 'existing budgets unchanged'} ${spec.startImmediately ? 'IMMEDIATE ON SUBMISSION' : spec.start} to ${spec.noEndDate ? 'ONGOING UNTIL PAUSED/PROVIDER END LIMIT' : spec.end}${account.provider === 'GOOGLE_ADS' ? `; ${account.timezone} calendar dates ${spec.startImmediately ? 'submission day' : local(spec.start)} to ${spec.noEndDate ? 'provider default end limit' : local(spec.end)} inclusive` : ''}`;
}
