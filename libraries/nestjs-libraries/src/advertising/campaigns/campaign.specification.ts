import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export type CampaignSpec = {
  operation: 'CREATE' | 'PAUSE' | 'RESUME' | 'UPDATE';
  campaignId?: string;
  objective: string;
  currency: string;
  dailyBudget: string;
  maxCpc?: string;
  start: string;
  end: string;
  bidStrategy: string;
  countries: string[];
  placements: 'AUTOMATIC' | 'FACEBOOK_FEED';
  pageId?: string;
  mediaId?: string;
  providerImageHash?: string;
  headlines: string[];
  descriptions: string[];
  destinationUrl: string;
  keywords: string[];
};
export const campaignObjectives: Record<string, string[]> = {
  META_ADS: ['OUTCOME_TRAFFIC'], GOOGLE_ADS: ['SEARCH'],
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
export function campaignSpec(value: unknown, account: { provider: string; currency: string }): CampaignSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Campaign specification required');
  const input = value as Record<string, any>;
  const keys = ['operation', 'campaignId', 'objective', 'currency', 'dailyBudget', 'maxCpc', 'start', 'end', 'bidStrategy', 'countries', 'placements', 'pageId', 'mediaId', 'providerImageHash', 'headlines', 'descriptions', 'destinationUrl', 'keywords'];
  if (Object.keys(input).some((key) => !keys.includes(key))) fail('Unsupported campaign field');
  if (!['CREATE', 'PAUSE', 'RESUME', 'UPDATE'].includes(input.operation)) fail('Unsupported campaign operation');
  if (input.operation !== 'CREATE') campaignId(input.campaignId);
  else if (input.campaignId) fail('Create cannot reference an existing campaign');
  if (!campaignObjectives[account.provider]?.includes(input.objective)) fail('Unsupported provider objective');
  if (input.currency !== account.currency) fail('Budget currency must match advertising account currency');
  budgetUnits(input.dailyBudget, input.currency, account.provider === 'GOOGLE_ADS');
  for (const key of ['start', 'end']) {
    if (typeof input[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])) || new Date(input[key]).toISOString() !== input[key].replace('Z', '.000Z')) fail('Schedule requires valid UTC minute timestamps');
  }
  if (Date.parse(input.end) <= Date.parse(input.start) || Date.parse(input.end) - Date.parse(input.start) > 366 * 86400000) fail('Schedule must span at most 366 days and end after its start');
  const google = account.provider === 'GOOGLE_ADS';
  if (input.bidStrategy !== (google ? 'MANUAL_CPC' : 'LOWEST_COST_WITHOUT_CAP')) fail('Unsupported bid strategy');
  if (google) {
    budgetUnits(input.maxCpc, input.currency, true);
    if (new Prisma.Decimal(input.maxCpc).gt(input.dailyBudget)) fail('Maximum CPC cannot exceed daily budget');
  } else if (input.maxCpc !== undefined) fail('Maximum CPC is not supported for the Meta lowest-cost workflow');
  if (google && input.placements !== 'AUTOMATIC' || !['AUTOMATIC', 'FACEBOOK_FEED'].includes(input.placements)) fail('Unsupported placements');
  if (!Array.isArray(input.countries) || !input.countries.length || input.countries.length > 10 || input.countries.some((c: unknown) => typeof c !== 'string' || !/^[A-Z]{2}$/.test(c)) || new Set(input.countries).size !== input.countries.length) fail('Choose 1–10 distinct ISO country codes');
  // No fetch is performed for destination URLs. Disallow credentials, local hosts and non-HTTPS schemes.
  let url: URL;
  try { url = new URL(input.destinationUrl); } catch { return fail('Invalid destination URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) fail('Destination requires a public HTTPS hostname');
  if (!google && input.pageId) campaignId(input.pageId);
  if (input.mediaId !== undefined && (typeof input.mediaId !== 'string' || !/^[\w-]{1,100}$/.test(input.mediaId))) fail('Invalid workspace media');
  if (input.providerImageHash !== undefined && (typeof input.providerImageHash !== 'string' || !/^[a-fA-F0-9]{32}$/.test(input.providerImageHash))) fail('Invalid Meta image hash');
  const result: CampaignSpec = { operation: input.operation, objective: input.objective, currency: input.currency, dailyBudget: new Prisma.Decimal(input.dailyBudget).toFixed(),
    start: input.start, end: input.end, bidStrategy: input.bidStrategy, countries: [...input.countries].sort(), placements: input.placements,
    headlines: texts(input.headlines, google ? 3 : 1, google ? 15 : 1, google ? 30 : 40, 'headlines'),
    descriptions: texts(input.descriptions, google ? 2 : 1, google ? 4 : 1, google ? 90 : 500, 'descriptions'), destinationUrl: url.href,
    keywords: texts(input.keywords, google ? 1 : 0, google ? 20 : 0, 80, 'exact-match search keywords') };
  for (const key of ['campaignId', 'pageId', 'mediaId', 'providerImageHash'] as const) if (input[key]) result[key] = input[key];
  if (google) result.maxCpc = new Prisma.Decimal(input.maxCpc).toFixed();
  if (google && (result.pageId || result.providerImageHash)) fail('Meta creative fields cannot be used for Google Search');
  return result;
}

export function campaignConfirmation(account: any, spec: CampaignSpec) {
  return `${spec.operation} ${account.externalAccountId} ${spec.currency} ${spec.dailyBudget}/day ${spec.start} to ${spec.end}`;
}
