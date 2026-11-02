// Percentage-change semantics selectively adapted from Postmill AI's
// analytics-aggregation.ts, 564569110b267562a21bc662a8d30ea77786ea6e (AGPL-3.0).
// Missing baselines and missing observations remain unknown rather than zero.
import { BadRequestException } from '@nestjs/common';
import { MetricPoint, MetricResult, Kind } from './reporting.types';
import { METRIC_REGISTRY } from './metric.registry';
const DAY = 86400000;
export const dayKey = (date: Date) => date.toISOString().slice(0, 10);
export function parseDay(value: string): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || '') ||
    !Number.isFinite(Date.parse(value)) ||
    dayKey(new Date(value)) !== value
  )
    throw new BadRequestException(
      'Dates must be real YYYY-MM-DD calendar days'
    );
  return new Date(value + 'T00:00:00Z');
}
export function reportWindow(from: string, to: string) {
  const start = parseDay(from),
    end = parseDay(to);
  const days = (end.getTime() - start.getTime()) / DAY + 1;
  if (days < 1 || days > 400)
    throw new BadRequestException(
      'Reporting windows must contain 1 to 400 days'
    );
  return {
    start,
    end,
    days,
    previousStart: new Date(start.getTime() - days * DAY),
    previousEnd: new Date(start.getTime() - DAY),
  };
}
export function computePercentageChange(
  current: number | null,
  previous: number | null,
  format: string
): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  if (format === 'percent') return current - previous;
  return ((current - previous) / Math.abs(previous)) * 100;
}
export interface ReportEntity {
  integrationId: string;
  entityId: string;
  publishedAt?: Date;
}
const entityKey = (entity: ReportEntity) =>
  entity.integrationId + ':' + entity.entityId;
function summarize(
  grouped: Map<string, MetricPoint[]>,
  entities: ReportEntity[],
  kind: Kind,
  from: Date,
  to: Date
) {
  const eligible = entities.filter(
    (e) => !e.publishedAt || e.publishedAt <= new Date(to.getTime() + DAY - 1)
  );
  const values: number[] = [];
  let observed = 0;
  const days = (to.getTime() - from.getTime()) / DAY + 1;
  const expected =
    kind === 'FLOW' || kind === 'AVERAGE'
      ? eligible.length * days
      : eligible.length;
  for (const entity of eligible) {
    const own = grouped.get(entityKey(entity)) || [];
    const inside = own.filter((r) => r.date >= from && r.date <= to);
    if (!inside.length) continue;
    if (kind === 'FLOW' || kind === 'AVERAGE') {
      values.push(...inside.map((r) => r.value));
      observed += new Set(inside.map((r) => dayKey(r.date))).size;
    } else {
      const last = inside[inside.length - 1];
      if (kind === 'STOCK') values.push(last.value);
      else {
        const baseline = own.filter((r) => r.date < from).pop();
        const newPost =
          entity.publishedAt && dayKey(entity.publishedAt) >= dayKey(from);
        const boundaryKnown =
          baseline && baseline.date.getTime() === from.getTime() - DAY;
        if (!boundaryKnown && !newPost) continue;
        // Keep signed corrections (unlikes/deletions); do not manufacture growth.
        values.push(last.value - (boundaryKnown ? baseline!.value : 0));
      }
      if (dayKey(last.date) === dayKey(to)) observed++;
    }
  }
  const total = values.length
    ? values.reduce((a, v) => a + v, 0) /
      (kind === 'AVERAGE' ? values.length : 1)
    : null;
  return {
    total,
    observed,
    expected,
    complete: expected > 0 && observed === expected,
  };
}
export function buildMetrics(
  input: MetricPoint[],
  entities: ReportEntity[],
  from: string,
  to: string
): MetricResult[] {
  const window = reportWindow(from, to);
  const rows = [...input].sort((a, b) => a.date.getTime() - b.date.getTime());
  const results: MetricResult[] = [];
  for (const metric of [...new Set(rows.map((r) => r.metric))].sort()) {
    const own = rows.filter((r) => r.metric === metric);
    const kind = own[0].kind,
      unit = own[0].unit;
    if (own.some((r) => r.kind !== kind || r.unit !== unit))
      throw new BadRequestException(
        'Conflicting metric semantics; re-collect with a compatible adapter'
      );
    const grouped = new Map<string, MetricPoint[]>();
    for (const point of own) {
      const key = entityKey(point);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(point);
    }
    const current = summarize(
      grouped,
      entities,
      kind,
      window.start,
      window.end
    );
    const previous = summarize(
      grouped,
      entities,
      kind,
      window.previousStart,
      window.previousEnd
    );
    const perDay = new Map<string, number[]>();
    for (const entity of entities) {
      const values = grouped.get(entityKey(entity)) || [];
      const before = values.filter((v) => v.date < window.start).pop();
      let baseline = before?.value;
      let baselineDate = before?.date.getTime();
      if (
        baseline === undefined &&
        entity.publishedAt &&
        dayKey(entity.publishedAt) >= from
      ) {
        baseline = 0;
        baselineDate = Date.parse(dayKey(entity.publishedAt!)) - DAY;
      }
      for (const point of values) {
        if (point.date < window.start || point.date > window.end) continue;
        const value =
          kind === 'LEVEL'
            ? baseline === undefined ||
              baselineDate !== point.date.getTime() - DAY
              ? null
              : point.value - baseline
            : point.value;
        baseline = point.value;
        baselineDate = point.date.getTime();
        if (value === null) continue;
        const day = dayKey(point.date);
        if (!perDay.has(day)) perDay.set(day, []);
        perDay.get(day)!.push(value);
      }
    }
    const series: MetricResult['series'] = [];
    for (
      let stamp = window.start.getTime();
      stamp <= window.end.getTime();
      stamp += DAY
    ) {
      const date = new Date(stamp);
      const values = perDay.get(dayKey(date)) || [];
      series.push({
        date: dayKey(date),
        value: values.length
          ? values.reduce((a, v) => a + v, 0) /
            (kind === 'AVERAGE' ? values.length : 1)
          : null,
      });
    }
    const label =
      (
        {
          daily_media_reach: 'Daily media reach (sum, not unique)',
          media_views: 'Media views',
          new_followers: 'New followers',
          reach: 'Daily reach (sum, not unique)',
        } as Record<string, string>
      )[metric] ||
      METRIC_REGISTRY[metric]?.label ||
      metric;
    results.push({
      metric,
      label,
      unit,
      kind,
      current: current.total,
      previous: previous.total,
      change:
        current.complete && previous.complete
          ? computePercentageChange(current.total, previous.total, unit)
          : null,
      complete: current.complete && previous.complete,
      observed: current.observed,
      expected: current.expected,
      series,
    });
  }
  return results;
}
