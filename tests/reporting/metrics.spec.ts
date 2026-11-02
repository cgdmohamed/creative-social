import {
  buildMetrics,
  computePercentageChange,
  reportWindow,
} from '../../libraries/nestjs-libraries/src/reporting/reporting.math';
import { normalizeProviderMetrics } from '../../libraries/nestjs-libraries/src/reporting/provider.metrics';
import {
  reportCsv,
  reportHtml,
  sanitizeCsvCell,
} from '../../libraries/nestjs-libraries/src/reporting/reporting.export';
import {
  MetricPoint,
  OrganicReport,
} from '../../libraries/nestjs-libraries/src/reporting/reporting.types';
const point = (
  date: string,
  value: number,
  kind: MetricPoint['kind'] = 'FLOW',
  unit = 'count'
): MetricPoint => ({
  integrationId: 'channel',
  entityId: '',
  metric: 'likes',
  kind,
  unit,
  value,
  date: new Date(date),
});
const entities = [{ integrationId: 'channel', entityId: '' }];
const build = (rows: MetricPoint[], subjects = entities) =>
  buildMetrics(rows, subjects, '2026-10-02', '2026-10-03')[0];
const rows = [
  point('2026-09-30', 10),
  point('2026-10-01', 20),
  point('2026-10-02', 30),
  point('2026-10-03', 40),
];
test('compares equal adjacent UTC windows and sums actual flow observations', () => {
  const result = build(rows);
  expect(result.current).toBe(70);
  expect(result.previous).toBe(30);
  expect(result.change).toBeCloseTo(133.333);
  expect(result.complete).toBe(true);
  const window = reportWindow('2026-10-02', '2026-10-03');
  expect(window.previousStart.toISOString().slice(0, 10)).toBe('2026-09-30');
});
test('does not turn missing days into zero or claim complete comparisons', () => {
  const result = build(rows.slice(0, 3));
  expect(result.current).toBe(30);
  expect(result.complete).toBe(false);
  expect(result.change).toBeNull();
  expect(result.series[1].value).toBeNull();
  expect(buildMetrics([], entities, '2026-10-02', '2026-10-03')).toEqual([]);
});
test('stock uses the last reading, averages never sum, and percentages use points', () => {
  expect(
    build(rows.map((r) => ({ ...r, kind: 'STOCK' as const }))).current
  ).toBe(40);
  const average = build(
    rows.map((r) => ({ ...r, kind: 'AVERAGE' as const, unit: 'percent' }))
  );
  expect(average.current).toBe(35);
  expect(average.previous).toBe(15);
  expect(average.change).toBe(20);
});
test('post lifetime counters use a real baseline and retain negative corrections', () => {
  const values = [
    point('2026-09-29', 100, 'LEVEL'),
    point('2026-09-30', 110, 'LEVEL'),
    point('2026-10-01', 120, 'LEVEL'),
    point('2026-10-02', 140, 'LEVEL'),
    point('2026-10-03', 135, 'LEVEL'),
  ];
  const result = build(values);
  expect(result.current).toBe(15);
  expect(result.previous).toBe(20);
  expect(result.change).toBe(-25);
  expect(result.series.map((p) => p.value)).toEqual([20, -5]);
});
test('old posts without a pre-window reading remain unknown', () => {
  const result = build([
    point('2026-10-02', 100, 'LEVEL'),
    point('2026-10-03', 120, 'LEVEL'),
  ]);
  expect(result.current).toBeNull();
  expect(result.change).toBeNull();
  expect(result.series.map((p) => p.value)).toEqual([null, 20]);
});
test('new posts have a legitimate zero-at-publication baseline', () => {
  const result = build(
    [point('2026-10-02', 100, 'LEVEL'), point('2026-10-03', 120, 'LEVEL')],
    [{ ...entities[0], publishedAt: new Date('2026-10-02') }] as any
  );
  expect(result.current).toBe(120);
  expect(result.series.map((p) => p.value)).toEqual([100, 20]);
});
test('zero and unknown previous periods are distinct', () => {
  expect(computePercentageChange(4, 0, 'count')).toBeNull();
  expect(computePercentageChange(0, 0, 'count')).toBe(0);
  expect(computePercentageChange(0, null, 'count')).toBeNull();
});
test.each([
  ['2026-02-30', '2026-03-01'],
  ['2026-10-03', '2026-10-02'],
  ['2020-01-01', '2026-01-01'],
  ['2026-01-01T10:00:00Z', '2026-01-02'],
])('rejects invalid or unbounded calendar windows %s', (from, to) => {
  expect(() => reportWindow(from, to)).toThrow();
});
const data = (label: string, total: any, date = '2026-10-03') => [
  { label, data: [{ total, date }], percentageChange: 999 },
];
test('current Facebook daily follows are not follower stock and Meta end dates are exclusive', () => {
  expect(
    normalizeProviderMetrics(
      'facebook',
      'CHANNEL',
      data('Page followers', 5),
      'channel',
      '',
      new Date('2026-10-04')
    )[0]
  ).toMatchObject({
    metric: 'new_followers',
    kind: 'FLOW',
    value: 5,
    date: new Date('2026-10-02'),
  });
  expect(
    normalizeProviderMetrics(
      'facebook',
      'CHANNEL',
      data('Page Impressions', 5),
      'channel',
      '',
      new Date('2026-10-04')
    )[0].metric
  ).toBe('daily_media_reach');
});
test('Instagram rolling totals cannot be silently filed as daily observations', () => {
  expect(
    normalizeProviderMetrics(
      'instagram',
      'CHANNEL',
      data('Likes', 700),
      'channel',
      '',
      new Date('2026-10-04')
    )
  ).toEqual([]);
  expect(
    normalizeProviderMetrics(
      'instagram',
      'POST',
      data('Likes', 700),
      'channel',
      'post',
      new Date('2026-10-04')
    )[0]
  ).toMatchObject({ kind: 'LEVEL', date: new Date('2026-10-04') });
});
test.each([NaN, Infinity, '', null, '12abc', '1e999'])(
  'rejects non-finite or ambiguous sample %s',
  (total) => {
    expect(
      normalizeProviderMetrics(
        'youtube',
        'POST',
        data('Likes', total),
        'c',
        'p',
        new Date()
      )
    ).toEqual([]);
  }
);
test('rejects unknown labels, prototype lookups, unaudited providers and malformed dates', () => {
  for (const label of ['__proto__', 'constructor', 'Unknown'])
    expect(
      normalizeProviderMetrics(
        'youtube',
        'CHANNEL',
        data(label, 5),
        'c',
        '',
        new Date()
      )
    ).toEqual([]);
  expect(
    normalizeProviderMetrics(
      'wordpress',
      'CHANNEL',
      data('Likes', 5),
      'c',
      '',
      new Date()
    )
  ).toEqual([]);
  expect(
    normalizeProviderMetrics(
      'youtube',
      'CHANNEL',
      data('Likes', 5, '2026-02-30'),
      'c',
      '',
      new Date()
    )
  ).toEqual([]);
});
export const sampleReport = (): OrganicReport => ({
  name: '<script>client</script> & Campaign',
  customerName: 'Creative Code',
  customerId: 'client',
  generatedAt: '2026-11-02T00:00:00Z',
  from: '2026-10-02',
  to: '2026-10-03',
  previousFrom: '2026-09-30',
  previousTo: '2026-10-01',
  scope: 'CHANNEL',
  campaignId: null,
  traffic: 'PLATFORM_TOTAL',
  metrics: [build(rows)],
  channels: [
    {
      id: 'channel',
      name: '=SUM(1,1)',
      provider: 'youtube',
      metrics: [build(rows)],
    },
  ],
  collection: [],
  warnings: [
    'Missing is not zero. Platform totals can include promoted activity.',
  ],
});
test('CSV neutralizes formulas, including leading whitespace, and HTML escapes campaign names', () => {
  expect(sanitizeCsvCell('  =2+2')).toBe('"\'  =2+2"');
  expect(reportCsv(sampleReport())).toContain("'=SUM(1,1)");
  expect(reportHtml(sampleReport())).not.toContain('<script>client</script>');
  expect(reportHtml(sampleReport())).toContain('&lt;script&gt;');
  expect(reportHtml(sampleReport())).toContain('default-src');
});

test('an old baseline cannot attribute growth across a gap to a short reporting window', () => {
  const result = build([
    point('2026-09-20', 10, 'LEVEL'),
    point('2026-10-03', 110, 'LEVEL'),
  ]);
  expect(result.current).toBeNull();
  expect(result.complete).toBe(false);
  expect(result.series.map((p) => p.value)).toEqual([null, null]);
});
