import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { providerJson } from './providers/advertising.http';
import { AdsProviderError } from './advertising.types';
import { dateOnly, decimal, integer } from './paid.math';
import { PaidLevel, PaidPoint } from './paid.types';

const id = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new AdsProviderError('INVALID_RESPONSE');
  return value;
};
function action(rows: any, type: string) {
  if (!Array.isArray(rows)) return null;
  const values = rows.filter((row) => row.action_type === type);
  if (values.length > 1) throw new AdsProviderError('INVALID_RESPONSE');
  return values.length ? decimal(values[0].value) : null;
}
const blank: Omit<PaidPoint, 'date' | 'externalEntityId' | 'entityName' | 'externalCampaignId' | 'externalAdGroupId'> = { spend: null, impressions: null, clicks: null, conversions: null, conversionValue: null, leads: null, purchaseConversionValue: null, reach: null };
export function metaPoint(row: any, level: PaidLevel, accountId: string): PaidPoint {
  const entity = level === 'ACCOUNT' ? accountId : id(level === 'CAMPAIGN' ? row.campaign_id : level === 'AD_GROUP' ? row.adset_id : row.ad_id);
  dateOnly(row.date_start);
  return { ...blank, date: row.date_start, externalEntityId: entity,
    attributionDetails: { windows: ['7d_click', '1d_view'], reportTime: 'impression', conversions: 'omni_purchase', leads: 'lead' },
    entityName: String(level === 'ACCOUNT' ? row.account_name || accountId : level === 'CAMPAIGN' ? row.campaign_name || entity : level === 'AD_GROUP' ? row.adset_name || entity : row.ad_name || entity).slice(0, 500),
    externalCampaignId: level === 'ACCOUNT' ? null : id(row.campaign_id),
    externalAdGroupId: level === 'AD_GROUP' || level === 'AD' ? id(row.adset_id) : null,
    spend: decimal(row.spend), impressions: integer(row.impressions), clicks: integer(row.clicks), reach: integer(row.reach),
    conversions: action(row.actions, 'omni_purchase'), leads: action(row.actions, 'lead'),
    conversionValue: action(row.action_values, 'omni_purchase'), purchaseConversionValue: action(row.action_values, 'omni_purchase') };
}
export function googlePoint(row: any, level: PaidLevel, accountId: string): PaidPoint {
  const entity = level === 'ACCOUNT' ? accountId : level === 'AD'
    ? `${id(String(row.adGroup?.id))}~${id(String(row.adGroupAd?.ad?.id))}`
    : id(String(level === 'CAMPAIGN' ? row.campaign?.id : row.adGroup?.id));
  dateOnly(row.segments?.date);
  return { ...blank, date: row.segments.date, externalEntityId: entity,
    entityName: String(level === 'ACCOUNT' ? row.customer?.descriptiveName || accountId : level === 'CAMPAIGN' ? row.campaign?.name || entity : level === 'AD_GROUP' ? row.adGroup?.name || entity : row.adGroupAd?.ad?.name || entity).slice(0, 500),
    externalCampaignId: level === 'ACCOUNT' ? null : id(String(row.campaign?.id)),
    externalAdGroupId: level === 'AD_GROUP' || level === 'AD' ? id(String(row.adGroup?.id)) : null,
    spend: row.metrics?.costMicros == null ? null : new Prisma.Decimal(decimal(row.metrics.costMicros)!).div(1000000).toFixed(),
    impressions: integer(row.metrics?.impressions), clicks: integer(row.metrics?.clicks),
    conversions: decimal(row.metrics?.conversions), conversionValue: decimal(row.metrics?.conversionsValue) };
}

export async function paidInsights(account: any, token: string, from: string, to: string, level: PaidLevel, kind: string, signal: AbortSignal): Promise<PaidPoint[]> {
  dateOnly(from); dateOnly(to);
  if (account.provider === 'META_ADS') {
    if (!/^act_\d{1,20}$/.test(account.externalAccountId) || !process.env.META_ADS_APP_SECRET || !/^v\d+\.0$/.test(process.env.META_ADS_API_VERSION || '')) throw new AdsProviderError('NOT_CONFIGURED');
    const base = `https://graph.facebook.com/${process.env.META_ADS_API_VERSION}/${account.externalAccountId}`;
    const headers = { Authorization: `Bearer ${token}` };
    const metadata = await providerJson(`${base}?fields=currency,timezone_name`, { headers, signal });
    if (metadata.currency !== account.currency || metadata.timezone_name !== account.timezone) throw new AdsProviderError('INVALID_RESPONSE');
    const identity = ['account_name', ...(level === 'ACCOUNT' ? [] : ['campaign_id', 'campaign_name']),
      ...(['AD_GROUP', 'AD'].includes(level) ? ['adset_id', 'adset_name'] : []), ...(level === 'AD' ? ['ad_id', 'ad_name'] : [])];
    const params = new URLSearchParams({ level: { ACCOUNT: 'account', CAMPAIGN: 'campaign', AD_GROUP: 'adset', AD: 'ad' }[level],
      fields: [...identity, 'date_start', 'date_stop', 'spend', 'impressions', 'clicks', 'reach', 'actions', 'action_values'].join(','),
      time_range: JSON.stringify({ since: from, until: to }), time_increment: kind === 'REACH' ? 'all_days' : '1',
      action_attribution_windows: JSON.stringify(['7d_click', '1d_view']), action_report_time: 'impression', limit: '500',
      appsecret_proof: createHmac('sha256', process.env.META_ADS_APP_SECRET!).update(token).digest('hex') });
    const points: PaidPoint[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      if (cursor) params.set('after', cursor);
      const body = await providerJson(`${base}/insights?${params}`, { headers, signal });
      if (!Array.isArray(body.data)) throw new AdsProviderError('INVALID_RESPONSE');
      for (const row of body.data) {
        if ((kind === 'REACH' && (row.date_start !== from || row.date_stop !== to)) ||
          (kind !== 'REACH' && (row.date_start !== row.date_stop || row.date_start < from || row.date_start > to))) throw new AdsProviderError('INVALID_RESPONSE');
        points.push(metaPoint(row, level, account.externalAccountId));
      }
      if (points.length > 20000) throw new AdsProviderError('UNAVAILABLE');
      if (!body.paging?.next) return points;
      const next = body.paging?.cursors?.after;
      if (typeof next !== 'string' || !next || next === cursor) throw new AdsProviderError('INVALID_RESPONSE');
      cursor = next; // Never follow next URLs with embedded access tokens.
    }
    throw new AdsProviderError('UNAVAILABLE');
  }
  if (kind === 'REACH') return []; // Generic Google unique reach is not supported across these resources.
  if (!/^\d{1,20}$/.test(account.externalAccountId) || !/^v\d+$/.test(process.env.GOOGLE_ADS_API_VERSION || '')) throw new AdsProviderError('NOT_CONFIGURED');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(account.loginCustomerId ? { 'login-customer-id': id(account.loginCustomerId) } : {}) };
  const url = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION}/customers/${account.externalAccountId}/googleAds:search`;
  const search = async (query: string) => {
    const rows: any[] = []; let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = await providerJson(url, { method: 'POST', headers, signal, body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) });
      if (data.results && !Array.isArray(data.results)) throw new AdsProviderError('INVALID_RESPONSE');
      rows.push(...(data.results || []));
      if (rows.length > 20000) throw new AdsProviderError('UNAVAILABLE');
      if (!data.nextPageToken) return rows;
      if (typeof data.nextPageToken !== 'string' || data.nextPageToken === pageToken) throw new AdsProviderError('INVALID_RESPONSE');
      pageToken = data.nextPageToken;
    }
    throw new AdsProviderError('UNAVAILABLE');
  };
  const metadata = (await search('SELECT customer.currency_code, customer.time_zone FROM customer'))[0]?.customer;
  if (metadata?.currencyCode !== account.currency || metadata?.timeZone !== account.timezone) throw new AdsProviderError('INVALID_RESPONSE');
  const actions = (await search('SELECT conversion_action.id, conversion_action.category, conversion_action.primary_for_goal, conversion_action.counting_type, conversion_action.click_through_lookback_window_days, conversion_action.view_through_lookback_window_days, conversion_action.attribution_model_settings.attribution_model, conversion_action.value_settings.always_use_default_value FROM conversion_action'))
    .map((row) => { const action = row.conversionAction;
      if (!action) throw new AdsProviderError('INVALID_RESPONSE');
      return { id: id(String(action.id)), category: action.category || 'UNKNOWN', primaryForGoal: action.primaryForGoal ?? false,
        counting: action.countingType || 'UNKNOWN', clickDays: action.clickThroughLookbackWindowDays || null,
        viewDays: action.viewThroughLookbackWindowDays || null, model: action.attributionModelSettings?.attributionModel || 'UNKNOWN',
        fixedValue: action.valueSettings?.alwaysUseDefaultValue ?? false };
    }).sort((a, b) => a.id.localeCompare(b.id));
  const details = { reportTime: 'interaction', conversions: 'provider primary metrics; custom campaign goals may override primaryForGoal', actions };
  const purchaseActions = actions.filter((action) => action.category === 'PURCHASE');
  const resource = { ACCOUNT: 'customer', CAMPAIGN: 'campaign', AD_GROUP: 'ad_group', AD: 'ad_group_ad' }[level];
  const fields = ['customer.descriptive_name', ...(level === 'ACCOUNT' ? [] : ['campaign.id', 'campaign.name']),
    ...(['AD_GROUP', 'AD'].includes(level) ? ['ad_group.id', 'ad_group.name'] : []), ...(level === 'AD' ? ['ad_group_ad.ad.id', 'ad_group_ad.ad.name'] : [])];
  const where = `FROM ${resource} WHERE segments.date BETWEEN '${from}' AND '${to}'`;
  const raw = await search(`SELECT ${fields.join(',')}, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value ${where}`);
  const points = raw.map((row) => googlePoint(row, level, account.externalAccountId));
  // Conversion-category rows never carry cost/clicks/impressions. Joining them
  // onto base rows avoids multiplying campaign spend by the number of actions.
  const categories = await search(`SELECT ${fields.join(',')}, segments.date, segments.conversion_action_category, metrics.conversions, metrics.conversions_value ${where}`);
  const grouped = new Map<string, { leads: Prisma.Decimal; value: Prisma.Decimal; leadSeen: boolean; purchaseSeen: boolean }>();
  for (const row of categories) {
    const point = googlePoint(row, level, account.externalAccountId);
    const key = point.date + ':' + point.externalEntityId;
    const totals = grouped.get(key) || { leads: new Prisma.Decimal(0), value: new Prisma.Decimal(0), leadSeen: false, purchaseSeen: false };
    if (row.segments.conversionActionCategory === 'SUBMIT_LEAD_FORM' && point.conversions !== null) { totals.leads = totals.leads.plus(point.conversions); totals.leadSeen = true; }
    if (row.segments.conversionActionCategory === 'PURCHASE' && point.conversionValue !== null) { totals.value = totals.value.plus(point.conversionValue); totals.purchaseSeen = true; }
    grouped.set(key, totals);
  }
  return points.map((point) => { const category = grouped.get(point.date + ':' + point.externalEntityId);
    return { ...point, attributionDetails: details, valueReliable: purchaseActions.length > 0 && purchaseActions.every((action) => !action.fixedValue),
      leads: category?.leadSeen ? category.leads.toFixed() : null, purchaseConversionValue: category?.purchaseSeen ? category.value.toFixed() : null }; });
}
