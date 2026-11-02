import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { MetricPoint, Scope, Kind } from './reporting.types';
import { normalizeMetric, METRIC_REGISTRY } from './metric.registry';

export const REPORTING_PROVIDERS = [
  'facebook',
  'instagram',
  'instagram-standalone',
  'youtube',
];
const INSTAGRAM_TOTALS = [
  'Likes',
  'Views',
  'Comments',
  'Shares',
  'Saves',
  'Replies',
];
export function normalizeProviderMetrics(
  provider: string,
  scope: Scope,
  data: AnalyticsData[],
  integrationId: string,
  entityId: string,
  now: Date
): Array<MetricPoint & { sourceLabel: string }> {
  if (!REPORTING_PROVIDERS.includes(provider)) return [];
  const today = now.toISOString().slice(0, 10);
  const result: Array<MetricPoint & { sourceLabel: string }> = [];
  for (const entry of data || []) {
    // Current Instagram channel totals span the requested rolling window. They
    // are NOT daily data and must not be filed under today's date or summed.
    if (
      scope === 'CHANNEL' &&
      provider.startsWith('instagram') &&
      INSTAGRAM_TOTALS.includes(entry.label)
    )
      continue;
    let metric = normalizeMetric(provider, entry.label);
    let kind: Kind = scope === 'POST' ? 'LEVEL' : 'FLOW';
    let unit = 'count';
    if (scope === 'CHANNEL' && provider === 'facebook') {
      metric = (
        {
          'Page Impressions': 'daily_media_reach',
          'Media views': 'media_views',
          'Posts Engagement': 'engagement',
          'Page followers': 'new_followers',
        } as Record<string, string>
      )[entry.label];
    }
    // follower_count is daily new followers in the current Instagram adapter.
    if (
      scope === 'CHANNEL' &&
      provider.startsWith('instagram') &&
      entry.label === 'Follower Count'
    )
      metric = 'new_followers';
    if (typeof metric !== 'string' || !metric) continue;
    if (
      scope === 'CHANNEL' &&
      METRIC_REGISTRY[metric]?.kind === 'stock' &&
      metric !== 'new_followers'
    )
      kind = 'STOCK';
    if (entry.label === 'Average View Duration') {
      kind = 'AVERAGE';
      unit = 'seconds';
    }
    if (entry.label === 'Average View Percentage') {
      kind = 'AVERAGE';
      unit = 'percent';
    }
    if (entry.label === 'Estimated Minutes Watched') unit = 'minutes';
    // Audited post adapters return one lifetime reading. Multiple points cannot
    // safely be reinterpreted as lifetime history from this contract.
    if (scope === 'POST' && entry.data?.length !== 1) continue;
    for (const point of entry.data || []) {
      if (
        point.total === null ||
        point.total === undefined ||
        String(point.total).trim() === ''
      )
        continue;
      const value = Number(point.total);
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
        continue;
      let day = scope === 'POST' ? today : String(point.date).slice(0, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        continue;
      if (
        scope === 'CHANNEL' &&
        (provider === 'facebook' || provider.startsWith('instagram'))
      ) {
        // Meta daily insights are labelled by exclusive end_time in current providers.
        day = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
      }
      if (day > today) continue;
      result.push({
        integrationId,
        entityId,
        metric,
        kind,
        unit,
        value,
        date: new Date(day + 'T00:00:00Z'),
        sourceLabel: entry.label,
      });
    }
  }
  return result;
}
