import { CampaignManagementApi } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.management-api';
import { campaignMutation } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.transport';
import { executionPlan } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.execution-plan';
import { campaignSpec } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.specification';
import { campaignMetadata } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.response';
import { creativePreviewUrl } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.preview';
import { campaignAccount, campaignSpecification } from './campaign.fixture';
const originalFetch = global.fetch;
const token = 'test-private-bearer-token';
const reply = (body: any, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
let api: CampaignManagementApi, mockFetch: jest.Mock;
beforeEach(() => {
  process.env.META_ADS_API_VERSION = 'v25.0'; process.env.META_ADS_APP_SECRET = 'test-secret'; process.env.GOOGLE_ADS_API_VERSION = 'v26';
  api = new CampaignManagementApi({ ...campaignAccount, managementAuthorized: true }, token);
  mockFetch = jest.fn(async (url: string) => {
    if (url.includes('/me/permissions')) return reply({ data: [{ permission: 'ads_management', status: 'granted' }] });
    if (url.includes('/promote_pages')) return reply({ data: [{ id: '123' }] });
    if (url.includes('/adspixels')) return reply({ data: [{ id: '456' }] });
    if (url.includes('/adimages')) return reply({ data: [{ hash: 'a'.repeat(32) }] });
    return reply({ id: 'act_123', currency: 'USD', timezone_name: campaignAccount.timezone, account_status: 1 });
  }); global.fetch = mockFetch;
});
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
test.each([
  ['OUTCOME_TRAFFIC', 'LINK_CLICKS'], ['OUTCOME_AWARENESS', 'REACH'], ['OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT'],
  ['OUTCOME_LEADS', 'OFFSITE_CONVERSIONS'], ['OUTCOME_SALES', 'OFFSITE_CONVERSIONS'], ['OUTCOME_APP_PROMOTION', 'APP_INSTALLS'],
])('Meta %s produces its native objective/optimization contract and paused hierarchy', async (objective, goal) => {
  const input = { ...campaignSpecification(), objective, pageId: '123', providerImageHash: 'a'.repeat(32),
    ...(['OUTCOME_SALES', 'OUTCOME_LEADS'].includes(objective) ? { pixelId: '456' } : {}),
    ...(objective === 'OUTCOME_APP_PROMOTION' ? { applicationId: '789', objectStoreUrl: 'https://play.google.com/store/apps/details?id=test.app', destinationUrl: 'https://play.google.com/store/apps/details?id=test.app' } : {}) };
  const spec = campaignSpec(input, campaignAccount);
  const plan = await executionPlan(api, campaignAccount, 'Campaign', spec, 'execution-marker-1234');
  expect(plan.map((step) => step.name)).toEqual(['campaign', 'adset', 'creative', 'ad']);
  expect(plan[0].body).toMatchObject({ objective, status: 'PAUSED' }); expect(plan[1].body).toMatchObject({ optimization_goal: goal, status: 'PAUSED', daily_budget: '1234' }); expect(plan[3].body.status).toBe('PAUSED');
  if (objective === 'OUTCOME_SALES') expect(plan[1].body.promoted_object).toEqual({ pixel_id: '456', custom_event_type: 'PURCHASE' });
  if (objective === 'OUTCOME_LEADS') expect(plan[1].body.promoted_object.custom_event_type).toBe('LEAD');
  if (objective === 'OUTCOME_APP_PROMOTION') expect(plan[1].body.promoted_object.application_id).toBe('789');
});
test('management permission is workspace-specific, not inferred from a broad inherited token scope', async () => {
  const readonly = new CampaignManagementApi({ ...campaignAccount, managementAuthorized: false }, token);
  await expect(readonly.permissions()).rejects.toThrow('explicitly'); expect(mockFetch).not.toHaveBeenCalled();
  await api.permissions(); await api.verifyAccount(); expect(mockFetch).toHaveBeenCalledTimes(2);
});
test('Meta writes use authenticated form bodies, validate-only is explicit, tokens never enter URLs', async () => {
  mockFetch.mockImplementation(async (_url, options) => reply((options.body as URLSearchParams).has('execution_options') ? { success: true } : { id: '12345' }, 200, { 'x-fb-trace-id': 'safe-trace' }));
  const step: any = { name: 'campaign', edge: 'act_123/campaigns', body: { name: 'Paused', status: 'PAUSED' }, response: 'META_ID' };
  await api.send(step, true); const response = await api.send(step);
  expect(api.confirmed(step, response.body)).toEqual({ id: '12345' }); expect(response.requestId).toBe('safe-trace');
  expect((mockFetch.mock.calls[0][1].body as URLSearchParams).get('execution_options')).toBe('["validate_only"]');
  expect(mockFetch.mock.calls[1][0]).not.toContain(token); expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`);
});
test('network failures and 5xx responses remain unknown and are never retried by the transport', async () => {
  mockFetch.mockRejectedValueOnce(new Error('socket closed'));
  await expect(campaignMutation('https://graph.facebook.com/v25.0/act_123/campaigns', { method: 'POST' })).rejects.toMatchObject({ outcome: 'UNKNOWN' });
  expect(mockFetch).toHaveBeenCalledTimes(1); mockFetch.mockResolvedValueOnce(reply({ error: { code: 2 } }, 503));
  await expect(campaignMutation('https://graph.facebook.com/v25.0/act_123/campaigns', { method: 'POST' })).rejects.toMatchObject({ outcome: 'UNKNOWN' });
});

test.each([
  [{ error: { code: 4 } }, 'RATE_LIMITED'],
  [{ error: { status: 'RESOURCE_EXHAUSTED' } }, 'RATE_LIMITED'],
  [{ error: { details: [{ errors: [{ errorCode: { authenticationError: 'OAUTH_TOKEN_EXPIRED' } }] }] } }, 'REAUTH_REQUIRED'],
])('provider-specific rate/auth errors are recognized without write retries', async (body, code) => {
  mockFetch.mockResolvedValueOnce(reply(body, 400, { 'retry-after': '90' }));
  await expect(campaignMutation('https://googleads.googleapis.com/v26/customers/123/googleAds:mutate', { method: 'POST' })).rejects.toMatchObject({ outcome: 'REJECTED', code, retryAfter: 90 }); expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('native Meta copies verify paused children and retain provider IDs instead of assuming copy success', async () => {
  const step: any = { name: 'provider-copy', response: 'META_COPY', reconcile: { edge: 'act_123/campaigns', suffix: ' · CS-test', expectedGroups: 1, expectedAds: 1 } };
  jest.spyOn(api, 'metaRead').mockResolvedValue({ id: '10', account_id: '123', status: 'PAUSED' });
  jest.spyOn(api, 'metaCollection').mockImplementation(async (edge) => edge.endsWith('/adsets') ? [{ id: '20', status: 'PAUSED' }] : [{ id: '30', status: 'PAUSED', creative: { id: '40' } }]);
  const result = await api.confirmCopy(step, '10'); expect(JSON.stringify(result)).toContain('20'); expect(JSON.stringify(result)).toContain('30');
  (api.metaCollection as jest.Mock).mockResolvedValueOnce([{ id: '20', status: 'ACTIVE' }]);
  await expect(api.confirmCopy(step, '10')).rejects.toMatchObject({ outcome: 'UNKNOWN' });
});
test('definite rejection exposes bounded fields/codes and redacts credential echoes', async () => {
  mockFetch.mockResolvedValueOnce(reply({ error: { code: 100, error_subcode: 900, error_user_msg: `Bad ${token} access_token=another-secret`, message: 'raw-server-secret' } }, 400));
  const error: any = await campaignMutation('https://graph.facebook.com/v25.0/act_123/campaigns', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch((failure) => failure);
  expect(error.outcome).toBe('REJECTED'); expect(JSON.stringify(error)).not.toMatch(/test-private|another-secret|raw-server-secret/); expect(error.issues.some((issue: any) => issue.message?.includes('[redacted]'))).toBe(true);
});
test('Google Search resolves official country constants, omits deprecated language criteria and validates atomically', async () => {
  const account = { ...campaignAccount, provider: 'GOOGLE_ADS', externalAccountId: '123', loginCustomerId: '999', managementAuthorized: true };
  const google = new CampaignManagementApi(account, token);
  mockFetch.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.query?.includes('FROM geo_target_constant')) return reply({ results: [{ geoTargetConstant: { countryCode: 'US', resourceName: 'geoTargetConstants/2840' } }] });
    if (body.query?.includes('FROM language_constant')) return reply({ results: [{ languageConstant: { code: 'en', resourceName: 'languageConstants/1000' } }] });
    return reply(body.validateOnly ? {} : { mutateOperationResponses: body.mutateOperations.map((operation: any, i: number) => ({ result: { resourceName: `customers/123/${Object.keys(operation)[0] === 'campaignOperation' ? 'campaigns' : 'assets'}/${100 + i}` } })) });
  });
  const plan = await executionPlan(google, account, 'Search', campaignSpec(campaignSpecification(true), account), 'search-execution-123');
  const operations = plan[0].body.mutateOperations;
  expect(operations.some((item: any) => item.campaignCriterionOperation?.create.location?.geoTargetConstant === 'geoTargetConstants/2840')).toBe(true);
  expect(operations.some((item: any) => item.campaignCriterionOperation?.create.language)).toBe(false);
  await google.send(plan[0], true); const result = await google.send(plan[0]); expect(google.confirmed(plan[0], result.body).resources).toHaveLength(operations.length);
  const mutations = mockFetch.mock.calls.filter(([url]) => url.endsWith('googleAds:mutate'));
  expect(JSON.parse(mutations[0][1].body)).toMatchObject({ validateOnly: true, partialFailure: false }); expect(JSON.parse(mutations[1][1].body).validateOnly).toBe(false);
  expect(mutations[1][1].headers['login-customer-id']).toBe('999');
});
test('Meta targeting reconciliation compares actual values instead of generic object strings', async () => {
  mockFetch.mockResolvedValue(reply({ id: '777', account_id: '123', targeting: { geo_locations: { countries: ['CA'] } } }));
  expect(await api.reconcile({ name: 'group', edge: '777', response: 'META_SUCCESS', body: { targeting: { geo_locations: { countries: ['US'] } } } })).toBeNull();
});
test('creative metadata and previews do not carry nested credentials or arbitrary executable URLs', () => {
  expect(campaignMetadata({ targeting: { countries: ['US'] }, access_token: token, nested: { client_secret: 'private' } })).toEqual({ targeting: { countries: ['US'] }, nested: {} });
  expect(creativePreviewUrl('https://scontent.example.fbcdn.net/image.jpg')).toContain('fbcdn.net');
  expect(creativePreviewUrl('https://evil.example/image.jpg')).toBeNull(); expect(creativePreviewUrl('https://fbcdn.net/image.jpg?access_token=private')).toBeNull();
});
