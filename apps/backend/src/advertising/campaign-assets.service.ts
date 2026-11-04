import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AdvertisingService } from './advertising.service';
import { advertisingWritesEnabled } from './campaign-execution.service';
import { CampaignMutationError } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.transport';
import { creativePreviewUrl } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.preview';
import { readAdvertisingMedia } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.media';

export function advertisingMime(bytes: Buffer) {
  if (bytes.length > 50 * 1024 * 1024 || bytes.length < 12) throw new BadRequestException('Advertising files must be 12 bytes–50 MiB');
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
  throw new BadRequestException('Choose a JPEG, PNG, WebP image or MP4 video');
}
@Injectable()
export class CampaignAssetsService {
  constructor(private db: PrismaService, private advertising: AdvertisingService) {}
  private async member(org: string, user: string, write = false, db: any = this.db) {
    if (!await db.userOrganization.findFirst({ where: { organizationId: org, userId: user, disabled: false,
      ...(write ? { role: 'SUPERADMIN' } : {}), organization: { deletedAt: null }, user: { activated: true, deletedAt: null } }, select: { id: true } })) throw new ForbiddenException('Workspace advertising asset permission required');
  }
  async fromMedia(org: string, user: string, accountId: string, mediaId: string, key: string) {
    await this.member(org, user, true);
    if (!advertisingWritesEnabled()) throw new ForbiddenException('Operator must enable advertising writes before provider upload');
    const media = await this.db.media.findFirst({ where: { id: mediaId, organizationId: org, deletedAt: null, status: 'ready', type: { in: ['image', 'video'] } } });
    if (!media) throw new ForbiddenException('Media unavailable in this workspace');
    const bytes = await readAdvertisingMedia(media.path);
    return this.upload(org, user, accountId, key, media.name.slice(0, 100), bytes);
  }
  async importAsset(org: string, user: string, accountId: string, providerId: string, kind: string, key: string) {
    await this.member(org, user, true);
    if (!/^[\w-]{16,80}$/.test(key || '') || !['IMAGE', 'VIDEO'].includes(kind)) throw new BadRequestException('Valid asset kind and stable import key required');
    const account = await this.db.adReportingAccount.findFirst({ where: { id: accountId, organizationId: org, enabled: true } });
    if (!account) throw new ForbiddenException('Advertising account unavailable');
    const checksum = createHash('sha256').update(`${account.provider}:${kind}:${providerId}`).digest('hex');
    const previous = await this.db.advertisingAsset.findUnique({ where: { organizationId_creationKey: { organizationId: org, creationKey: key } } });
    if (previous) { if (previous.accountId !== accountId || previous.checksum !== checksum) throw new HttpException('Import key already used', 409); return previous; }
    return this.advertising.withManagement(org, accountId, async (api) => {
      let metadata: any;
      if (account.provider === 'META_ADS') {
        if (kind === 'IMAGE') {
          if (!/^[a-f0-9]{32}$/i.test(providerId)) throw new BadRequestException('Invalid Meta image hash');
          const rows = await api.metaRead(`${account.externalAccountId}/adimages`, { fields: 'hash,name,url', hashes: JSON.stringify([providerId]) });
          const matches = rows.data?.filter((row: any) => row.hash === providerId);
          if (matches?.length !== 1) throw new ForbiddenException('Image is not owned by selected advertising account');
          metadata = { providerId, imageHash: providerId, thumbnailUrl: creativePreviewUrl(matches[0].url), name: String(matches[0].name || providerId).slice(0, 100), status: 'READY' };
        } else {
          if (!/^\d{1,30}$/.test(providerId)) throw new BadRequestException('Invalid Meta video ID');
          const matches = (await api.metaCollection(`${account.externalAccountId}/advideos`, 'id,title')).filter((row) => row.id === providerId);
          if (matches.length !== 1) throw new ForbiddenException('Video is not owned by selected advertising account');
          metadata = { providerId, name: String(matches[0].title || providerId).slice(0, 100), status: 'PROCESSING' };
        }
      } else {
        const match = new RegExp(`^customers/${account.externalAccountId}/assets/(\\d{1,30})$`).exec(providerId);
        if (!match) throw new BadRequestException('Google asset must belong to the selected account');
        const rows = await api.googleSearch(`SELECT asset.resource_name, asset.name, asset.type, asset.image_asset.full_size.url FROM asset WHERE asset.id = ${match[1]}`);
        if (rows.length !== 1 || rows[0].asset?.resourceName !== providerId || rows[0].asset.type !== (kind === 'IMAGE' ? 'IMAGE' : 'YOUTUBE_VIDEO')) throw new ForbiddenException('Asset unavailable in selected account');
        metadata = { providerId, name: String(rows[0].asset.name || match[1]).slice(0, 100), thumbnailUrl: creativePreviewUrl(rows[0].asset.imageAsset?.fullSize?.url), status: 'READY' };
      }
      return this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
        const existing = await tx.advertisingAsset.findUnique({ where: { organizationId_creationKey: { organizationId: org, creationKey: key } } });
        if (existing) { if (existing.accountId !== accountId || existing.checksum !== checksum) throw new HttpException('Import key already used', 409); return existing; }
        const row = await tx.advertisingAsset.create({ data: { organizationId: org, accountId, createdBy: user, creationKey: key, kind, checksum, ...metadata } });
        await tx.adCampaignAudit.create({ data: { organizationId: org, actorId: user, action: 'PROVIDER_ASSET_IMPORTED', details: { assetId: row.id, providerId, accountId } } }); return row;
      });
    });
  }
  async library(org: string, user: string, accountId: string, discover = false) {
    await this.member(org, user);
    const account = await this.db.adReportingAccount.findFirst({ where: { id: accountId, organizationId: org } });
    if (!account) throw new ForbiddenException('Advertising account unavailable');
    const assets = await this.db.advertisingAsset.findMany({ where: { organizationId: org, accountId }, orderBy: { createdAt: 'desc' }, take: 100 });
    if (!discover) return { assets };
    return this.advertising.withManagement(org, accountId, async (api, current) => {
      if (current.provider === 'META_ADS') {
        const [images, videos, pages, creatives] = await Promise.all([
          api.metaCollection(`${current.externalAccountId}/adimages`, 'hash,name,width,height'),
          api.metaCollection(`${current.externalAccountId}/advideos`, 'id,title'),
          api.metaCollection(`${current.externalAccountId}/promote_pages`, 'id,name'),
          api.metaCollection(`${current.externalAccountId}/adcreatives`, 'id,name,status'),
        ]);
        const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 500) : '';
        return { assets, images: images.map((row) => ({ hash: text(row.hash), name: text(row.name) })), videos: videos.map((row) => ({ id: text(row.id), name: text(row.title) })),
          pages: pages.map((row) => ({ id: text(row.id), name: text(row.name) })), creatives: creatives.map((row) => ({ id: text(row.id), name: text(row.name), status: text(row.status) })) };
      }
      const rows = await api.googleSearch("SELECT asset.resource_name, asset.name, asset.type FROM asset WHERE asset.type IN ('IMAGE', 'TEXT', 'YOUTUBE_VIDEO')");
      const [campaignLinks, groupLinks] = await Promise.all([
        api.googleSearch("SELECT campaign_asset.resource_name, campaign_asset.asset, campaign_asset.campaign, campaign_asset.field_type, campaign_asset.status FROM campaign_asset WHERE campaign_asset.status != 'REMOVED'"),
        api.googleSearch("SELECT ad_group_asset.resource_name, ad_group_asset.asset, ad_group_asset.ad_group, ad_group_asset.field_type, ad_group_asset.status FROM ad_group_asset WHERE ad_group_asset.status != 'REMOVED'"),
      ]);
      const links = [...campaignLinks.map((row) => row.campaignAsset), ...groupLinks.map((row) => row.adGroupAsset)].filter(Boolean).map((row) => Object.fromEntries(['resourceName', 'asset', 'campaign', 'adGroup', 'fieldType', 'status'].filter((key) => typeof row[key] === 'string').map((key) => [key, row[key].slice(0, 200)])));
      return { assets, associations: links, providerAssets: rows.map((row) => ({ resourceName: String(row.asset?.resourceName || '').slice(0, 150), name: String(row.asset?.name || '').slice(0, 500), type: String(row.asset?.type || '').slice(0, 40) })) };
    });
  }
  async upload(org: string, user: string, accountId: string, key: string, name: string, bytes: Buffer) {
    await this.member(org, user, true);
    if (!advertisingWritesEnabled()) throw new ForbiddenException('Operator must enable advertising writes before uploading a provider asset');
    if (!/^[\w-]{16,80}$/.test(key || '') || typeof name !== 'string' || !name.trim() || name.length > 100 || /[\u0000-\u001f<>]/u.test(name)) throw new BadRequestException('Valid asset name and stable creation key required');
    const mime = advertisingMime(bytes), checksum = createHash('sha256').update(bytes).digest('hex');
    const account = await this.db.adReportingAccount.findFirst({ where: { id: accountId, organizationId: org, enabled: true } });
    if (!account) throw new ForbiddenException('Advertising account unavailable in this workspace');
    if (account.provider === 'GOOGLE_ADS' && (mime === 'video/mp4' || bytes.length > 5 * 1024 * 1024)) throw new BadRequestException('Google Search assets support images up to 5 MiB; Google video uses YouTube references');
    let row = await this.db.advertisingAsset.findUnique({ where: { organizationId_creationKey: { organizationId: org, creationKey: key } } });
    if (row) {
      if (row.accountId !== accountId || row.checksum !== checksum) throw new HttpException('Asset creation key already used', 409);
      return row; // UNKNOWN/SENDING uploads cannot be blindly replayed.
    }
    return this.advertising.withManagement(org, accountId, async (api) => {
      await api.permissions();
      await api.verifyAccount();
      const id = randomUUID();
      row = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
        await this.member(org, user, true, tx);
        const current = await tx.adReportingAccount.findFirst({ where: { id: accountId, organizationId: org, enabled: true, connectionId: account.connectionId } });
        const grant = current && await tx.advertisingConnection.findFirst({ where: { id: current.connectionId, organizationId: org, status: 'CONNECTED', managementAuthorized: true, authorizationRevision: api.account.authorizationRevision } });
        if (!grant) throw new ForbiddenException('Advertising authorization changed before upload');
        const existing = await tx.advertisingAsset.findUnique({ where: { organizationId_creationKey: { organizationId: org, creationKey: key } } });
        if (existing) {
          if (existing.accountId !== accountId || existing.checksum !== checksum) throw new HttpException('Asset creation key already used', 409);
          return existing;
        }
        const created = await tx.advertisingAsset.create({ data: { id, organizationId: org, accountId, createdBy: user, creationKey: key, name: name.trim(), kind: mime === 'video/mp4' ? 'VIDEO' : 'IMAGE', checksum } });
        await tx.adCampaignAudit.create({ data: { organizationId: org, actorId: user, action: 'ASSET_UPLOAD_SENDING', details: { assetId: id, accountId, checksum, size: bytes.length } } });
        return created;
      });
      if (row.id !== id) return row;
      try {
        const result = await api.uploadAsset(bytes, mime, `CS-ASSET-${id}`);
        return await this.db.$transaction(async (tx) => {
          const updated = await tx.advertisingAsset.update({ where: { id }, data: result });
          await tx.adCampaignAudit.create({ data: { organizationId: org, actorId: user, action: 'ASSET_UPLOAD_CONFIRMED', details: { assetId: id, ...result } } });
          return updated;
        });
      } catch (error) {
        const failure = error instanceof CampaignMutationError ? error : new CampaignMutationError('UNKNOWN', 'ASSET_OUTCOME_OR_STORAGE_UNKNOWN');
        await this.advertising.noteManagementFailure(org, accountId, api.account.authorizationRevision, failure.code, failure.retryAfter);
        return this.db.$transaction(async (tx) => {
          const updated = await tx.advertisingAsset.update({ where: { id }, data: { status: failure.outcome, error: { code: failure.code, issues: failure.issues }, requestId: failure.requestId } });
          await tx.adCampaignAudit.create({ data: { organizationId: org, actorId: user, action: `ASSET_UPLOAD_${failure.outcome}`, details: { assetId: id, code: failure.code, issues: failure.issues } } }); return updated;
        });
      }
    });
  }
  async refresh(org: string, user: string, id: string) {
    await this.member(org, user);
    const asset = await this.db.advertisingAsset.findFirst({ where: { id, organizationId: org } });
    if (!asset) throw new ForbiddenException('Asset unavailable in this workspace');
    return this.advertising.withManagement(org, asset.accountId, async (api, account) => {
      if (asset.kind === 'VIDEO' && asset.providerId && account.provider === 'META_ADS') {
        const result = await api.metaRead(asset.providerId, { fields: 'id,status,thumbnails' });
        const status = result.status?.video_status;
        const thumbnail = result.thumbnails?.data?.find((item: any) => item.is_preferred)?.uri || result.thumbnails?.data?.[0]?.uri;
        const url = creativePreviewUrl(thumbnail);
        return this.db.advertisingAsset.update({ where: { id }, data: { status: status === 'ready' && url ? 'READY' : status === 'error' ? 'REJECTED' : 'PROCESSING', thumbnailUrl: url } });
      }
      if (['UNKNOWN', 'SENDING'].includes(asset.status) && account.provider === 'META_ADS') {
        const rows = await api.metaCollection(`${account.externalAccountId}/${asset.kind === 'VIDEO' ? 'advideos' : 'adimages'}`, asset.kind === 'VIDEO' ? 'id,title' : 'hash,name');
        const matches = rows.filter((item: any) => (item.title || item.name)?.startsWith(`CS-ASSET-${asset.id}`));
        if (matches.length === 1) {
          const providerId = asset.kind === 'VIDEO' ? matches[0].id : matches[0].hash;
          if (typeof providerId !== 'string' || !/^[a-f0-9]{1,32}$/i.test(providerId)) throw new BadRequestException('Invalid asset reconciliation result');
          return this.db.advertisingAsset.update({ where: { id }, data: { providerId, imageHash: asset.kind === 'IMAGE' ? providerId : null, status: asset.kind === 'VIDEO' ? 'PROCESSING' : 'READY' } });
        }
      }
      if (['UNKNOWN', 'SENDING'].includes(asset.status) && account.provider === 'GOOGLE_ADS') {
        const rows = await api.googleSearch(`SELECT asset.resource_name FROM asset WHERE asset.name = 'CS-ASSET-${asset.id}'`);
        if (rows.length === 1 && /^customers\/\d+\/assets\/\d+$/.test(rows[0].asset?.resourceName || '')) return this.db.advertisingAsset.update({ where: { id }, data: { providerId: rows[0].asset.resourceName, status: 'READY' } });
      }
      return asset;
    });
  }
}
