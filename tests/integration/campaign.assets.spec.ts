import { CampaignAssetsService, advertisingMime } from '../../apps/backend/src/advertising/campaign-assets.service';
import { CampaignMutationError } from '../../libraries/nestjs-libraries/src/advertising/campaigns/campaign.transport';
import { advertisingDatabase } from './advertising.fixture';
import { campaignAccount } from './campaign.fixture';
let fixture: ReturnType<typeof advertisingDatabase>, service: CampaignAssetsService, api: any;
const flag = process.env.ADVERTISING_WRITES_ENABLED;
const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(20)]);
beforeEach(async () => {
  process.env.ADVERTISING_WRITES_ENABLED = 'true'; fixture = advertisingDatabase(['media', 'adCampaignAudit', 'advertisingAsset']);
  await fixture.db.adReportingAccount.create({ data: campaignAccount });
  await fixture.db.advertisingConnection.create({ data: { id: campaignAccount.connectionId, organizationId: 'a', status: 'CONNECTED', managementAuthorized: true } });
  api = { account: { authorizationRevision: 0 }, permissions: jest.fn(), verifyAccount: jest.fn(), uploadAsset: jest.fn(async () => ({ status: 'READY', providerId: 'a'.repeat(32), imageHash: 'a'.repeat(32) })) };
  service = new CampaignAssetsService(fixture.db, { withManagement: async (_o: string, _a: string, run: any) => run(api, campaignAccount), noteManagementFailure: jest.fn() } as any);
});
afterEach(() => { if (flag === undefined) delete process.env.ADVERTISING_WRITES_ENABLED; else process.env.ADVERTISING_WRITES_ENABLED = flag; });
const upload = (key = 'stable-asset-key-1234') => service.upload('a', 'alice', campaignAccount.id, key, 'Creative', image);
test('asset creation records audit and provider evidence with idempotent upload', async () => {
  const asset = await upload(); expect(asset.status).toBe('READY'); expect((await upload()).id).toBe(asset.id);
  expect(api.uploadAsset).toHaveBeenCalledTimes(1); expect(fixture.rows('adCampaignAudit').map((row) => row.action)).toEqual(['ASSET_UPLOAD_SENDING', 'ASSET_UPLOAD_CONFIRMED']);
});
test('ambiguous asset uploads never retry and do not become successful', async () => {
  api.uploadAsset.mockRejectedValueOnce(new CampaignMutationError('UNKNOWN', 'TRANSPORT_OUTCOME_UNKNOWN'));
  expect((await upload()).status).toBe('UNKNOWN'); expect((await upload()).status).toBe('UNKNOWN'); expect(api.uploadAsset).toHaveBeenCalledTimes(1);
});
test('cross-workspace media and accounts are denied before provider use', async () => {
  await expect(service.upload('b', 'bob', campaignAccount.id, 'stable-asset-key-1234', 'Creative', image)).rejects.toThrow('workspace');
  await fixture.db.media.create({ data: { id: 'private', organizationId: 'b', status: 'ready', type: 'image' } });
  await expect(service.fromMedia('a', 'alice', campaignAccount.id, 'private', 'stable-asset-key-1234')).rejects.toThrow('workspace'); expect(api.uploadAsset).not.toHaveBeenCalled();
});
test('permission revocation during provider validation prevents sending', async () => {
  api.verifyAccount.mockImplementationOnce(() => fixture.deny());
  await expect(upload()).rejects.toThrow('permission'); expect(api.uploadAsset).not.toHaveBeenCalled(); expect(fixture.rows('advertisingAsset')).toHaveLength(0);
});
test('asset audit failure prevents any provider write', async () => {
  fixture.db.adCampaignAudit.create.mockRejectedValueOnce(new Error('audit failed'));
  await expect(upload()).rejects.toThrow('audit failed'); expect(api.uploadAsset).not.toHaveBeenCalled(); expect(fixture.rows('advertisingAsset')).toHaveLength(0);
});
test('binary inspection rejects unsupported formats and ignores caller MIME claims', () => {
  expect(advertisingMime(image)).toBe('image/png'); expect(() => advertisingMime(Buffer.from('<script>alert(1)</script>'))).toThrow('Choose');
});
