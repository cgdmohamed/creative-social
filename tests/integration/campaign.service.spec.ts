import { CampaignManagerService } from '../../apps/backend/src/advertising/campaign-manager.service';
import { advertisingDatabase } from './advertising.fixture';
import { campaignAccount, campaignBody, campaignSpecification } from './campaign.fixture';
let fixture: ReturnType<typeof advertisingDatabase>, service: CampaignManagerService, role: string, providerRead: jest.Mock;
beforeEach(async () => {
  fixture = advertisingDatabase(['adCampaignDraft', 'adCampaignReview', 'adCampaignAudit', 'media']); role = 'SUPERADMIN';
  fixture.db.userOrganization.findFirst.mockImplementation(async ({ where }: any) => {
    if (!((where.organizationId === 'a' && where.userId === 'alice') || (where.organizationId === 'b' && where.userId === 'bob'))) return null;
    if (typeof where.role === 'string' && role !== where.role || where.role?.in && !where.role.in.includes(role)) return null;
    return { id: 'member' };
  });
  await fixture.db.adReportingAccount.create({ data: campaignAccount });
  await fixture.db.adReportingAccount.create({ data: { ...campaignAccount, id: 'account-b', organizationId: 'b' } });
  await fixture.db.advertisingConnection.create({ data: { id: 'connection-a', organizationId: 'a', revision: 0, status: 'CONNECTED' } });
  providerRead = jest.fn(); service = new CampaignManagerService(fixture.db, { readForReporting: providerRead } as any);
});
const saved = () => service.save('a', 'alice', campaignBody());
test('stable creation key is idempotent, mismatched content is rejected and no provider is called', async () => {
  const draft = await saved(); expect((await saved()).id).toBe(draft.id);
  await expect(service.save('a', 'alice', { ...campaignBody(), name: 'Different' })).rejects.toThrow('Creation key');
  expect(fixture.rows('adCampaignDraft')).toHaveLength(1); expect(fixture.rows('adCampaignAudit')).toHaveLength(1); expect(providerRead).not.toHaveBeenCalled();
});
test('edit requires current revision and invalidates an earlier approval', async () => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  await service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation);
  const edited = await service.save('a', 'alice', { ...campaignBody(), name: 'Edited', revision: 0 }, draft.id);
  expect(edited.revision).toBe(1); expect(edited.status).toBe('DRAFT');
  await expect(service.save('a', 'alice', { ...campaignBody(), revision: 0 }, draft.id)).rejects.toThrow('Draft changed');
  await expect(service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow('Review is stale');
  expect(fixture.rows('adCampaignReview')[0].status).toBe('INVALIDATED');
});
test('duplicate produces a distinct CREATE draft with no existing provider ID or approval', async () => {
  const draft = await saved(), duplicate = await service.duplicate('a', 'alice', draft.id, 'duplicate-key-12345');
  expect(duplicate.id).not.toBe(draft.id); expect(duplicate.status).toBe('DRAFT'); expect((duplicate.spec as any).operation).toBe('CREATE'); expect(fixture.rows('adCampaignReview')).toHaveLength(0);
});
test.each(['USER', 'ADMIN'])('%s cannot approve; read-only USER cannot create', async (memberRole) => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0); role = memberRole;
  await expect(service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow('permission');
  if (role === 'USER') await expect(saved()).rejects.toThrow('permission'); else expect((await saved()).id).toBe(draft.id);
  expect((await service.catalog('a', 'alice')).drafts).toHaveLength(1);
});
test('workspace account, draft, review and media IDOR attempts are rejected', async () => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  await expect(service.save('a', 'alice', { ...campaignBody(), accountId: 'account-b' })).rejects.toThrow('workspace');
  await expect(service.duplicate('b', 'bob', draft.id, 'duplicate-key-12345')).rejects.toThrow('workspace');
  await expect(service.approve('b', 'bob', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow('workspace');
  await fixture.db.media.create({ data: { id: 'foreign-media', organizationId: 'b', status: 'ready', type: 'image' } });
  await expect(service.save('a', 'alice', { ...campaignBody(), spec: { ...campaignSpecification(), mediaId: 'foreign-media' } })).rejects.toThrow('workspace');
  expect((await service.catalog('b', 'bob')).drafts).toEqual([]); expect((await service.catalog('b', 'bob')).reviews).toEqual([]);
});
test('audit failure rolls back draft creation atomically', async () => {
  fixture.db.adCampaignAudit.create.mockRejectedValueOnce(new Error('database failed'));
  await expect(saved()).rejects.toThrow('database failed'); expect(fixture.rows('adCampaignDraft')).toHaveLength(0);
});
test('approval requires exact account/budget/currency/schedule confirmation and unchanged digest', async () => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  await expect(service.approve('a', 'alice', review.id, review.digest, 'yes')).rejects.toThrow('confirmation');
  await expect(service.approve('a', 'alice', review.id, '0'.repeat(64), (review.snapshot as any).confirmation)).rejects.toThrow('confirmation');
  expect((await service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation))?.status).toBe('APPROVED_BLOCKED');
  await service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation);
  expect(fixture.rows('adCampaignAudit').filter((r) => r.action === 'INTENT_APPROVED_NO_PROVIDER_WRITE')).toHaveLength(1);
  for (let attempt = 0; attempt < 2; attempt++) await expect(service.submit('a', 'alice', review.id)).rejects.toMatchObject({ status: 423 });
  expect(providerRead).not.toHaveBeenCalled();
});
test.each(['expiry', 'currency', 'connection'])('approval rejects changed %s', async (change) => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  if (change === 'expiry') await fixture.db.adCampaignReview.updateMany({ where: { id: review.id }, data: { expiresAt: new Date(0) } });
  if (change === 'currency') await fixture.db.adReportingAccount.updateMany({ where: { id: campaignAccount.id }, data: { currency: 'EUR' } });
  if (change === 'connection') await fixture.db.advertisingConnection.updateMany({ where: { id: 'connection-a' }, data: { revision: 1 } });
  await expect(service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow();
  expect(fixture.rows('adCampaignDraft')[0].status).toBe('IN_REVIEW');
});
test('review is immutable and idempotent per revision', async () => {
  const draft = await saved(), first = await service.review('a', 'alice', draft.id, 0), second = await service.review('a', 'alice', draft.id, 0);
  expect(second.id).toBe(first.id); expect(fixture.rows('adCampaignReview')).toHaveLength(1);
});
test('review rejection is audited and cannot later be approved', async () => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  expect((await service.reject('a', 'alice', review.id, 'Budget needs client approval'))?.status).toBe('REJECTED');
  await expect(service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow('no longer pending');
  expect(fixture.rows('adCampaignAudit').some((r) => r.action === 'REVIEW_REJECTED')).toBe(true);
});
test('approval and audit commit atomically', async () => {
  const draft = await saved(), review = await service.review('a', 'alice', draft.id, 0);
  fixture.db.adCampaignAudit.create.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(service.approve('a', 'alice', review.id, review.digest, (review.snapshot as any).confirmation)).rejects.toThrow('audit unavailable');
  expect(fixture.rows('adCampaignReview')[0].status).toBe('PENDING'); expect(fixture.rows('adCampaignDraft')[0].status).toBe('IN_REVIEW');
});
test('existing campaign must be observed in scoped provider list; failures never produce approval', async () => {
  const body = campaignBody(); body.spec = { ...body.spec, operation: 'RESUME', campaignId: '999' };
  const draft = await service.save('a', 'alice', body);
  const spy = jest.spyOn(service, 'list').mockResolvedValue({ accountId: campaignAccount.id, level: 'CAMPAIGN', rows: [], fetchedAt: '', liveWritesEnabled: false });
  await expect(service.review('a', 'alice', draft.id, 0)).rejects.toThrow('not owned');
  spy.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(service.review('a', 'alice', draft.id, 0)).rejects.toThrow('provider unavailable'); expect(fixture.rows('adCampaignReview')).toHaveLength(0);
});
test('quota is checked under workspace lock and a repeated creation key does not consume quota', async () => {
  const draft = await saved(); fixture.db.adCampaignDraft.count.mockResolvedValue(100);
  expect((await saved()).id).toBe(draft.id);
  await expect(service.save('a', 'alice', { ...campaignBody(), key: 'another-stable-key-123' })).rejects.toThrow('limit'); expect(fixture.db.$queryRaw).toHaveBeenCalled();
});
