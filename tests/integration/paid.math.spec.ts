import { metrics, previousPeriod, validatePaidQuery, accountYesterday, compare, decimal, integer, covered } from '../../libraries/nestjs-libraries/src/advertising/paid.math';
import { metaPoint, googlePoint, paidInsights } from '../../libraries/nestjs-libraries/src/advertising/paid.providers';
const point = { spend: '10.000001', impressions: '1000', clicks: '20', conversions: '2.5', leads: '1.5', purchaseConversionValue: '30', valueTrackingVerified: true };
test('calculations preserve exact monetary values and fractional conversions', () => {
  const result = metrics([point]);
  expect(result.spend).toBe('10.000001'); expect(result.ctr).toBe('2'); expect(result.conversionRate).toBe('12.5');
  expect(result.cpa).toBe('4'); expect(result.cpl).toBe('6.666667'); expect(result.roas).toBe('3');
  expect(metrics([{ ...point, spend: '0.1' }, { ...point, spend: '0.2' }]).spend).toBe('0.3');
});
test('missing values are unavailable, explicit zero stays zero, denominator zero never yields infinity', () => {
  expect(metrics([]).spend).toBeNull();
  expect(metrics([point, { ...point, clicks: null }]).clicks).toBeNull();
  expect(metrics([{ ...point, conversions: '0', clicks: '0', purchaseConversionValue: '0' }])).toMatchObject({ conversions: '0', cpc: null, cpa: null, roas: '0' });
  expect(metrics([{ ...point, valueTrackingVerified: false }]).roas).toBeNull();
  expect(metrics([point, point]).reach).toBeNull();
});
test('derived rates use aggregate numerators/denominators, not an average of row percentages', () => {
  expect(metrics([{ ...point, clicks: '1', impressions: '10' }, { ...point, clicks: '10', impressions: '1000' }]).ctr).toBe('1.089109');
  expect(googlePoint({ segments: { date: '2026-01-01' }, metrics: { costMicros: null, clicks: '0' } }, 'ACCOUNT', '123').spend).toBeNull();
});
test('previous period is equal-length and inclusive across leap days', () => {
  expect(previousPeriod({ from: '2024-03-01', to: '2024-03-07', level: 'ACCOUNT' })).toEqual({ from: '2024-02-23', to: '2024-02-29' });
  expect(compare('10', '0')).toEqual({ delta: '10', percent: null }); expect(compare('0', '10')).toEqual({ delta: '-10', percent: '-100' });
});
test('account-local yesterday handles date boundaries and DST without assuming server UTC', () => {
  const now = new Date('2026-03-09T01:00:00Z');
  expect(accountYesterday('America/Los_Angeles', now)).toBe('2026-03-07');
  expect(accountYesterday('Asia/Riyadh', now)).toBe('2026-03-08');
});
test.each([
  { from: '2026-02-30', to: '2026-03-01', level: 'ACCOUNT' },
  { from: '2026-01-01', to: '2026-12-31', level: 'ACCOUNT' },
  { from: '2026-01-02', to: '2026-01-01', level: 'ACCOUNT' },
  { from: '2026-01-01', to: '2026-01-02', level: 'ALL' },
  { from: '2026-01-01', to: '2026-01-02', level: 'ACCOUNT', campaignId: '123' },
])('rejects incompatible reporting request %j', (query) => { expect(() => validatePaidQuery(query as any)).toThrow(); });
test('coverage requires every day and invalid numbers cannot become false zeros', () => {
  const job = { fromDate: new Date('2026-01-01'), toDate: new Date('2026-01-02') };
  expect(covered([job], '2026-01-01', '2026-01-02')).toBe(true); expect(covered([job], '2026-01-01', '2026-01-03')).toBe(false);
  expect(decimal(undefined)).toBeNull(); expect(decimal('0')).toBe('0'); expect(() => decimal('NaN')).toThrow(); expect(() => integer('1.5')).toThrow();
});
test('Meta normalization selects canonical actions without adding duplicate purchase aliases or attribution windows', () => {
  const row = metaPoint({ date_start: '2026-01-01', spend: '10.12', impressions: '100', clicks: '0', reach: '80',
    actions: [{ action_type: 'omni_purchase', value: '2', '7d_click': '2' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }, { action_type: 'lead', value: '0' }],
    action_values: [{ action_type: 'omni_purchase', value: '30' }] }, 'ACCOUNT', 'act_123');
  expect(row).toMatchObject({ conversions: '2', leads: '0', purchaseConversionValue: '30', clicks: '0', reach: '80' });
  expect(metaPoint({ date_start: '2026-01-01' }, 'ACCOUNT', 'act_123').conversions).toBeNull();
});
test('Google micro-currency normalization avoids floating error and ad IDs include ad group identity', () => {
  const row = googlePoint({ segments: { date: '2026-01-01' }, campaign: { id: '1' }, adGroup: { id: '2' }, adGroupAd: { ad: { id: '3' } },
    metrics: { costMicros: '1234567', conversions: 1.5, clicks: '0', impressions: '100' } }, 'AD', '123');
  expect(row).toMatchObject({ externalEntityId: '2~3', spend: '1.234567', conversions: '1.5', clicks: '0', reach: null });
});
test('Google conversion category reads cannot multiply spend or sum purchase and total conversions', async () => {
  const previousFetch = global.fetch, previousVersion = process.env.GOOGLE_ADS_API_VERSION;
  process.env.GOOGLE_ADS_API_VERSION = 'v26';
  const response = (body: any) => new Response(JSON.stringify(body));
  const fetch = jest.fn().mockResolvedValueOnce(response({ results: [{ customer: { currencyCode: 'USD', timeZone: 'UTC' } }] }))
    .mockResolvedValueOnce(response({ results: [{ conversionAction: { id: '999', category: 'PURCHASE', clickThroughLookbackWindowDays: '30', countingType: 'MANY_PER_CLICK', valueSettings: { alwaysUseDefaultValue: false } } }] }))
    .mockResolvedValueOnce(response({ results: [{ segments: { date: '2026-01-01' }, metrics: { costMicros: '10000000', impressions: '100', clicks: '10', conversions: 3, conversionsValue: 50 } }] }))
    .mockResolvedValueOnce(response({ results: [
      { segments: { date: '2026-01-01', conversionActionCategory: 'PURCHASE' }, metrics: { conversions: 1, conversionsValue: 40 } },
      { segments: { date: '2026-01-01', conversionActionCategory: 'SUBMIT_LEAD_FORM' }, metrics: { conversions: 2, conversionsValue: 10 } },
    ] }));
  global.fetch = fetch;
  try {
    const result = await paidInsights({ provider: 'GOOGLE_ADS', externalAccountId: '123', currency: 'USD', timezone: 'UTC' }, 'PRIVATE', '2026-01-01', '2026-01-01', 'ACCOUNT', 'DAILY', AbortSignal.timeout(60000));
    expect(result[0]).toMatchObject({ spend: '10', conversions: '3', leads: '2', purchaseConversionValue: '40', conversionValue: '50' });
    expect(JSON.parse(fetch.mock.calls[3][1].body).query).not.toContain('cost_micros');
    expect(result[0].attributionDetails?.actions[0].clickDays).toBe('30');
    expect(fetch.mock.calls.every(([url]) => !url.includes('PRIVATE') && !url.includes('mutate'))).toBe(true);
  } finally { global.fetch = previousFetch; if (previousVersion === undefined) delete process.env.GOOGLE_ADS_API_VERSION; else process.env.GOOGLE_ADS_API_VERSION = previousVersion; }
});
test('Meta daily insight requests use explicit attribution and safe level fields/cursor paging', async () => {
  const previousFetch = global.fetch, version = process.env.META_ADS_API_VERSION, secret = process.env.META_ADS_APP_SECRET;
  process.env.META_ADS_API_VERSION = 'v25.0'; process.env.META_ADS_APP_SECRET = 'synthetic-secret';
  const response = (value: any) => new Response(JSON.stringify(value));
  const row = { campaign_id: '123', campaign_name: 'Campaign', date_start: '2026-01-01', date_stop: '2026-01-01', spend: '10', impressions: '100', clicks: '10', reach: '80' };
  const fetch = jest.fn().mockResolvedValueOnce(response({ currency: 'USD', timezone_name: 'UTC' }))
    .mockResolvedValueOnce(response({ data: [row], paging: { next: 'https://evil.invalid?access_token=PRIVATE', cursors: { after: 'cursor' } } }))
    .mockResolvedValueOnce(response({ data: [{ ...row, campaign_id: '456' }] }));
  global.fetch = fetch;
  try {
    const points = await paidInsights({ provider: 'META_ADS', externalAccountId: 'act_123', currency: 'USD', timezone: 'UTC' }, 'PRIVATE', '2026-01-01', '2026-01-02', 'CAMPAIGN', 'DAILY', AbortSignal.timeout(60000));
    expect(points).toHaveLength(2);
    const query = new URL(fetch.mock.calls[1][0]).searchParams;
    expect(query.get('action_attribution_windows')).toBe('["7d_click","1d_view"]');
    expect(query.get('action_report_time')).toBe('impression'); expect(query.get('fields')).not.toContain('ad_id');
    expect(fetch.mock.calls[2][0]).toContain('after=cursor'); expect(fetch.mock.calls.every(([url]) => !url.includes('PRIVATE') && !url.includes('evil.invalid'))).toBe(true);
  } finally { global.fetch = previousFetch; if (version === undefined) delete process.env.META_ADS_API_VERSION; else process.env.META_ADS_API_VERSION = version;
    if (secret === undefined) delete process.env.META_ADS_APP_SECRET; else process.env.META_ADS_APP_SECRET = secret; }
});
