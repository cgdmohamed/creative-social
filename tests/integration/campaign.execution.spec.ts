import { CampaignExecutionService } from '../../apps/backend/src/advertising/campaign-execution.service';
import { CampaignManagementApi } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.management-api';
import { CampaignMutationError } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.transport';
import { campaignDigest, campaignConfirmation } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.specification';
import { advertisingDatabase } from './advertising.fixture';
import { campaignAccount, campaignSpecification } from './campaign.fixture';
let fixture: ReturnType<typeof advertisingDatabase>, service: CampaignExecutionService, api: any, review: any, confirmation: string;
const originalEnabled = process.env.ADVERTISING_WRITES_ENABLED;
beforeEach(async () => {
  process.env.ADVERTISING_WRITES_ENABLED = 'true';
  fixture = advertisingDatabase(['adCampaignDraft', 'adCampaignReview', 'adCampaignAudit']);
  const account = { ...campaignAccount, authorizationRevision: 0 };
  await fixture.db.adReportingAccount.create({ data: account });
  await fixture.db.advertisingConnection.create({ data: { id: 'connection-a', organizationId: 'a', status: 'CONNECTED', authorizationRevision: 0 } });
  const spec = { ...campaignSpecification(), pageId: '123', providerImageHash: 'a'.repeat(32) };
  const draft = await fixture.db.adCampaignDraft.create({ data: { organizationId: 'a', accountId: account.id, revision: 0, name: 'Client campaign', spec } });
  confirmation = campaignConfirmation(account, spec);
  const snapshot = { name: draft.name, account, connection: { id: 'connection-a', authorizationRevision: 0 }, spec, confirmation };
  review = await fixture.db.adCampaignReview.create({ data: { organizationId: 'a', draftId: draft.id, revision: 0, status: 'APPROVED', digest: campaignDigest(snapshot), snapshot, expiresAt: new Date(Date.now() + 600000) } });
  let sequence = 100;
  api = { account, permissions: jest.fn(async () => {}), verifyAccount: jest.fn(async () => {}), metaCollection: jest.fn(async () => [{ id: '123' }]), metaRead: jest.fn(async () => ({ data: [{ hash: 'a'.repeat(32) }] })), mutate: jest.fn(async () => ({ body: { id: String(++sequence) }, requestId: 'request-safe' })),
    confirmed: jest.fn((_step, body) => ({ id: body.id })), reconcile: jest.fn(async () => null) };
  api.send = jest.fn((step, validateOnly) => validateOnly ? Promise.resolve({ body: { success: true } }) : api.mutate(step));
  service = new CampaignExecutionService(fixture.db, { noteManagementFailure: jest.fn(async () => {}), withManagement: async (_org: string, _id: string, run: any) => run(api, account) } as any);
});
afterAll(() => { if (originalEnabled === undefined) delete process.env.ADVERTISING_WRITES_ENABLED; else process.env.ADVERTISING_WRITES_ENABLED = originalEnabled; });
const submit = (phrase = confirmation) => service.submit('a', 'alice', review.id, review.digest, phrase);

test('Google Search executor validates then submits one atomic batch and records every resource ID without replay', async () => {
  const account = { ...campaignAccount, provider: 'GOOGLE_ADS', externalAccountId: '123', authorizationRevision: 0 };
  const spec = campaignSpecification(true), name = 'Client campaign';
  await fixture.db.adReportingAccount.update({ where: { id: account.id }, data: account });
  await fixture.db.adCampaignDraft.update({ where: { id: review.draftId }, data: { spec } });
  confirmation = campaignConfirmation(account, spec);
  const snapshot = { name, account, connection: { id: 'connection-a', authorizationRevision: 0 }, spec, confirmation };
  review = await fixture.db.adCampaignReview.update({ where: { id: review.id }, data: { snapshot, digest: campaignDigest(snapshot) } });
  const actual = new CampaignManagementApi(account, 'not-used');
  const google: any = { account, permissions: jest.fn(), verifyAccount: jest.fn(), googleTargeting: jest.fn(async () => ({ locationResources: ['geoTargetConstants/2840'], languageResources: [] })), confirmed: actual.confirmed.bind(actual) };
  google.send = jest.fn(async (step, validateOnly) => ({ body: validateOnly ? {} : { mutateOperationResponses: step.body.mutateOperations.map((_operation: any, index: number) => ({ result: { resourceName: `customers/123/assets/${index + 100}` } })) } }));
  service = new CampaignExecutionService(fixture.db, { withManagement: async (_org: string, _id: string, run: any) => run(google, account) } as any);
  const result: any = await submit(); expect(result.status).toBe('CONFIRMED');
  expect(google.send).toHaveBeenCalledTimes(2); expect(google.send.mock.calls[0][1]).toBe(true); expect(google.send.mock.calls[1][1]).toBeUndefined();
  expect(result.resources['google-hierarchy'].resources.length).toBeGreaterThan(5);
  await submit(); expect(google.send).toHaveBeenCalledTimes(2);
});
test('real execution path creates paused hierarchy, persists IDs and returns confirmed evidence only', async () => {
  const run: any = await submit(); expect(run.status).toBe('CONFIRMED'); expect(api.mutate).toHaveBeenCalledTimes(4);
  const steps = api.mutate.mock.calls.map(([step]: any) => step);
  expect(steps[0].body.status).toBe('PAUSED'); expect(steps[1].body).toMatchObject({ campaign_id: '101', status: 'PAUSED' });
  expect(steps[3].body).toMatchObject({ adset_id: '102', creative: { creative_id: '103' }, status: 'PAUSED' });
  expect(fixture.rows('adCampaignExecutionStep').every((row) => row.status === 'CONFIRMED')).toBe(true);
  expect(fixture.rows('adCampaignAudit').filter((row) => row.action === 'PROVIDER_MUTATION_CONFIRMED')).toHaveLength(4);
  const duplicate: any = await submit(); expect(duplicate.id).toBe(run.id); expect(api.mutate).toHaveBeenCalledTimes(4);
});
test('ambiguous create is never replayed, including repeated requests and explicit recovery', async () => {
  api.mutate.mockRejectedValueOnce(new CampaignMutationError('UNKNOWN', 'TRANSPORT_OUTCOME_UNKNOWN'));
  const run: any = await submit(); expect(run.status).toBe('UNKNOWN'); await submit(); expect(api.mutate).toHaveBeenCalledTimes(1);
  await expect(submit(`${confirmation} RECOVER ${run.id}`)).rejects.toThrow('Reconcile'); expect(api.mutate).toHaveBeenCalledTimes(1);
});
test('explicit reconciliation can recover a created parent and continue without duplicating it', async () => {
  api.mutate.mockResolvedValueOnce({ body: { id: '101' } }).mockRejectedValueOnce(new CampaignMutationError('UNKNOWN', 'TRANSPORT_OUTCOME_UNKNOWN'));
  const run: any = await submit(); expect(run.status).toBe('UNKNOWN'); expect(fixture.rows('adCampaignExecutionStep')[0].status).toBe('CONFIRMED');
  api.reconcile.mockResolvedValueOnce({ id: 'provider-adset-recovered' });
  // Provider IDs must remain numeric before being used as parent IDs.
  api.reconcile.mockReset().mockResolvedValueOnce({ id: '555' });
  await service.reconcile('a', 'alice', run.id);
  expect(fixture.rows('adCampaignExecutionStep')[1].status).toBe('CONFIRMED');
  await submit(`${confirmation} RECOVER ${run.id}`);
  expect(api.mutate).toHaveBeenCalledTimes(4); expect(api.mutate.mock.calls[2][0].name).toBe('creative'); expect(api.mutate.mock.calls[3][0].body.adset_id).toBe('555');
});
test('definite rejection permits explicitly authorized recovery with confirmed parent IDs retained', async () => {
  api.mutate.mockResolvedValueOnce({ body: { id: '101' } }).mockRejectedValueOnce(new CampaignMutationError('REJECTED', 'PROVIDER_VALIDATION'));
  const run: any = await submit(); expect(run.status).toBe('REJECTED'); await submit(); expect(api.mutate).toHaveBeenCalledTimes(2);
  const recovered: any = await submit(`${confirmation} RECOVER ${run.id}`); expect(recovered.status).toBe('CONFIRMED'); expect(api.mutate).toHaveBeenCalledTimes(5);
  expect(api.mutate.mock.calls[2][0].body.campaign_id).toBe('101');
});
test('operator enablement, exact confirmation, workspace permission and changed authorization are enforced', async () => {
  delete process.env.ADVERTISING_WRITES_ENABLED; await expect(submit()).rejects.toThrow('Operator');
  process.env.ADVERTISING_WRITES_ENABLED = 'true'; await expect(submit('yes')).rejects.toThrow('Exact final');
  await expect(service.submit('b', 'bob', review.id, review.digest, confirmation)).rejects.toThrow('workspace');
  await fixture.db.advertisingConnection.updateMany({ where: { id: 'connection-a' }, data: { authorizationRevision: 1 } });
  await expect(submit()).rejects.toThrow('authorization'); expect(api.mutate).not.toHaveBeenCalled();
});
test('rate limit cooldown prevents immediate retries and no automatic retry occurs', async () => {
  api.mutate.mockRejectedValueOnce(new CampaignMutationError('REJECTED', 'RATE_LIMITED', [], 60));
  const run: any = await submit(); await expect(submit(`${confirmation} RECOVER ${run.id}`)).rejects.toThrow('cooldown'); expect(api.mutate).toHaveBeenCalledTimes(1);
});
