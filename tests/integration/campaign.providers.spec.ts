import { campaignSpec, campaignDigest, budgetUnits } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.specification';
import { MetaCampaignAdapter } from '../../libraries/nestjs-libraries/src/advertising/campaigns/meta.campaign.adapter';
import { GoogleCampaignAdapter } from '../../libraries/nestjs-libraries/src/advertising/campaigns/google.campaign.adapter';
import { campaignAccount, campaignSpecification } from './campaign.fixture';
const originalFetch = global.fetch;
test('review hashes survive JSONB key reordering but detect changed creative order', () => {
  expect(campaignDigest({ z: { b: 1, a: 2 }, a: ['one', 'two'] })).toBe(campaignDigest({ a: ['one', 'two'], z: { a: 2, b: 1 } }));
  expect(campaignDigest({ a: ['one', 'two'] })).not.toBe(campaignDigest({ a: ['two', 'one'] }));
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
test.each([['USD', '1.23', '123', '1230000'], ['JPY', '12', '12', '12000000'], ['KWD', '1.234', '1234', '1234000']])('budgets respect %s minor units and exact Google micros', (currency, amount, minor, micros) => {
  expect(budgetUnits(amount, currency, false)).toBe(minor); expect(budgetUnits(amount, currency, true)).toBe(micros);
});
test.each(['0', '-1', '1e2', 'NaN', 'Infinity', '1.001'])('invalid USD budget %s is rejected', (amount) => expect(() => budgetUnits(amount, 'USD', false)).toThrow());
test.each([
  { currency: 'EUR' }, { status: 'ACTIVE' }, { access_token: 'secret' }, { objective: 'OUTCOME_SALES' }, { bidStrategy: 'UNKNOWN' }, { destinationUrl: 'javascript:alert(1)' },
  { destinationUrl: 'https://user:secret@example.com' }, { destinationUrl: 'https://127.0.0.1' }, { start: '2027-02-30T00:00:00Z' }, { end: '2026-01-01T00:00:00Z' },
  { countries: ['US', 'US'] }, { headlines: [] }, { dailyBudget: 10 }, { providerImageHash: '../../secret' },
])('rejects invalid or injected specification %j', (override) => expect(() => campaignSpec({ ...campaignSpecification(), ...override }, campaignAccount)).toThrow());
test('Meta create plan has paused campaign/ad-set/ad, canonical targeting and no access tokens', () => {
  const spec = campaignSpec({ ...campaignSpecification(), pageId: '123', providerImageHash: 'a'.repeat(32), placements: 'FACEBOOK_FEED' }, campaignAccount);
  const plan = new MetaCampaignAdapter().plan(campaignAccount, 'A', spec);
  expect(plan.operations.filter((op: any) => op.body?.status).every((op: any) => op.body.status === 'PAUSED')).toBe(true);
  expect((plan.operations[1] as any).body).toMatchObject({ daily_budget: '1234', targeting: { publisher_platforms: ['facebook'], geo_locations: { countries: ['US'] } } });
  expect(JSON.stringify(plan)).not.toMatch(/access_token|Authorization/);
});
test('Google plans isolate operations, use atomic validate-only and create paused resources', () => {
  const account = { ...campaignAccount, provider: 'GOOGLE_ADS', externalAccountId: '123' }, spec = campaignSpec(campaignSpecification(true), account);
  const plan = new GoogleCampaignAdapter().plan(account, 'A', spec);
  expect(plan.request).toMatchObject({ partialFailure: false, validateOnly: true });
  expect(JSON.stringify(plan.request)).toContain('12340000'); expect(JSON.stringify(plan.request)).not.toContain('"status":"ENABLED","ad"');
  expect(plan.blockers.join(' ')).toContain('geoTargetConstants'); expect(plan.supported).toBe(false);
});
test('Meta list uses bounded cursor pagination and returns only sanitized fields', async () => {
  process.env.META_ADS_API_VERSION = 'v25.0'; process.env.META_ADS_APP_SECRET = 'test-secret';
  const mock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: '1', name: 'One', status: 'PAUSED', effective_status: 'DISAPPROVED', secret: 'no' }], paging: { next: 'https://evil.example/?access_token=secret', cursors: { after: 'safe' } } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: '2', name: 'Two', status: 'ACTIVE' }] }) }); global.fetch = mock;
  const rows = await new MetaCampaignAdapter().list(campaignAccount, 'private-token', 'CAMPAIGN');
  expect(rows).toHaveLength(2); expect(rows[0].approval).toBe('DISAPPROVED'); expect(JSON.stringify(rows)).not.toMatch(/secret|private-token/);
  expect(mock.mock.calls[1][0]).toContain('after=safe'); expect(mock.mock.calls[1][0]).not.toContain('evil.example'); expect(mock.mock.calls[0][1].method).toBeUndefined();
});
test('Google ad IDs include ad group identity and queries do not mutate', async () => {
  process.env.GOOGLE_ADS_API_VERSION = 'v25';
  const mock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ campaign: { id: '1' }, adGroup: { id: '2' }, adGroupAd: { ad: { id: '3', name: 'Ad' }, status: 'PAUSED', policySummary: { approvalStatus: 'DISAPPROVED' } } }] }) }); global.fetch = mock;
  const rows = await new GoogleCampaignAdapter().list({ ...campaignAccount, externalAccountId: '123' }, 'private-token', 'AD');
  expect(rows[0]).toMatchObject({ id: '2~3', campaignId: '1', approval: 'DISAPPROVED' }); expect(mock.mock.calls[0][0]).toMatch(/googleAds:search$/); expect(mock.mock.calls[0][0]).not.toContain('private-token');
});
test('provider rate limit and failures are sanitized and never automatically retried', async () => {
  const mock = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'retry-after': '5' }), json: async () => ({ error: { message: 'secret-token' } }) }); global.fetch = mock;
  await expect(new MetaCampaignAdapter().list(campaignAccount, 'private-token', 'CAMPAIGN')).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 5 }); expect(mock).toHaveBeenCalledTimes(1);
});
