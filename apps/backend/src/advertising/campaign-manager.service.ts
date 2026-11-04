import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AdvertisingService } from './advertising.service';
import { Prisma } from '@prisma/client';
import { MetaCampaignAdapter } from '@gitroom/nestjs-libraries/advertising/campaigns/meta.campaign.adapter';
import { GoogleCampaignAdapter } from '@gitroom/nestjs-libraries/advertising/campaigns/google.campaign.adapter';
import { campaignBidStrategies, campaignConfirmation, campaignDigest, campaignName, campaignObjectives, campaignSpec } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.specification';
import { advertisingWritesEnabled, CampaignExecutionService } from './campaign-execution.service';

export const campaignLiveWrites = advertisingWritesEnabled;
const accountSelect = { id: true, externalAccountId: true, name: true, provider: true, currency: true, timezone: true, enabled: true, providerStatus: true } as const;
@Injectable()
export class CampaignManagerService {
  constructor(private db: PrismaService, private advertising: AdvertisingService, private execution: CampaignExecutionService) {}
  async member(org: string, user: string, permission: 'read' | 'write' | 'approve' = 'read', db: any = this.db) {
    const found = await db.userOrganization.findFirst({ where: { organizationId: org, userId: user, disabled: false,
      organization: { deletedAt: null }, user: { deletedAt: null, activated: true },
      ...(permission === 'approve' ? { role: 'SUPERADMIN' } : permission === 'write' ? { role: { in: ['ADMIN', 'SUPERADMIN'] } } : {}) }, select: { id: true } });
    if (!found) throw new ForbiddenException('Campaign workspace permission required');
  }
  private adapter(provider: string) { return provider === 'META_ADS' ? new MetaCampaignAdapter() : new GoogleCampaignAdapter(); }
  private async account(org: string, id: string, db: any = this.db) {
    const account = await db.adReportingAccount.findFirst({ where: { id, organizationId: org, organization: { deletedAt: null } } });
    if (!account) throw new ForbiddenException('Advertising account unavailable in this workspace');
    return account;
  }
  private async draft(org: string, id: string, db: any = this.db) {
    const draft = await db.adCampaignDraft.findFirst({ where: { id, organizationId: org } });
    if (!draft) throw new ForbiddenException('Campaign draft unavailable in this workspace');
    return draft;
  }
  private async media(org: string, id?: string, db: any = this.db) {
    if (!id) return;
    const media = await db.media.findFirst({ where: { id, organizationId: org, deletedAt: null, status: 'ready' }, select: { id: true, type: true } });
    if (!media || !['image', 'video'].includes(media.type)) throw new ForbiddenException('Creative media unavailable in this workspace');
  }
  private async advertisingAsset(org: string, accountId: string, id?: string, db: any = this.db) {
    if (id && !await db.advertisingAsset.findFirst({ where: { id, organizationId: org, accountId }, select: { id: true } })) throw new ForbiddenException('Advertising creative is outside selected workspace/account');
  }
  private audit(db: any, org: string, actor: string, action: string, draftId?: string, reviewId?: string, details: any = {}) {
    return db.adCampaignAudit.create({ data: { organizationId: org, actorId: actor, action, draftId, reviewId, details } });
  }
  async catalog(org: string, user: string) {
    await this.member(org, user);
    const [accounts, drafts, reviews, history, media, executions] = await Promise.all([
      this.db.adReportingAccount.findMany({ where: { organizationId: org }, select: accountSelect, orderBy: { name: 'asc' }, take: 100 }),
      this.db.adCampaignDraft.findMany({ where: { organizationId: org }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      this.db.adCampaignReview.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.adCampaignAudit.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.db.media.findMany({ where: { organizationId: org, deletedAt: null, status: 'ready', type: { in: ['image', 'video'] } }, select: { id: true, name: true, type: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.adCampaignExecution.findMany({ where: { organizationId: org }, include: { steps: { orderBy: { position: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return { accounts, drafts, reviews, history, media, executions, objectives: campaignObjectives, bidStrategies: campaignBidStrategies, liveWritesEnabled: campaignLiveWrites(),
      limits: { drafts: 100, history: 200, media: 100 }, notice: 'Saving and approving drafts never executes a provider request. Explicit final submission is required.' };
  }
  async list(org: string, user: string, accountId: string, level: string) {
    await this.member(org, user);
    if (!['CAMPAIGN', 'AD_GROUP', 'AD'].includes(level)) throw new BadRequestException('Invalid advertising resource level');
    await this.account(org, accountId);
    const result = await this.advertising.readForReporting(org, accountId, (account, token, signal) => this.adapter(account.provider).list(account, token, level, signal));
    // Disconnection/account switching during the request invalidates its results.
    await this.member(org, user);
    const current = await this.account(org, accountId);
    const connection = await this.db.advertisingConnection.findFirst({ where: { id: result.connectionId, organizationId: org, revision: result.connectionRevision, status: 'CONNECTED' }, select: { id: true } });
    if (!connection || !current.enabled || current.connectionId !== result.connectionId) throw new HttpException('Advertising connection changed; retry', 409);
    return { accountId, level, rows: result.value, fetchedAt: new Date().toISOString(), liveWritesEnabled: advertisingWritesEnabled() };
  }
  async save(org: string, user: string, body: { accountId: string; name: string; spec: unknown; key: string; revision?: number }, id?: string) {
    await this.member(org, user, 'write');
    if (!/^[\w-]{16,80}$/.test(body.key || '')) throw new BadRequestException('A stable 16–80 character creation key is required');
    const name = campaignName(body.name), account = await this.account(org, body.accountId), spec = campaignSpec(body.spec, account);
    await this.media(org, spec.mediaId);
    await this.advertisingAsset(org, account.id, spec.advertisingAssetId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      await this.member(org, user, 'write', tx);
      const currentAccount = await this.account(org, body.accountId, tx);
      campaignSpec(spec, currentAccount); await this.media(org, spec.mediaId, tx);
      await this.advertisingAsset(org, currentAccount.id, spec.advertisingAssetId, tx);
      if (!id) {
        const existing = await tx.adCampaignDraft.findUnique({ where: { organizationId_creationKey: { organizationId: org, creationKey: body.key } } });
        if (existing) {
          if (existing.accountId !== body.accountId || existing.name !== name || campaignDigest(existing.spec) !== campaignDigest(spec)) throw new HttpException('Creation key already used for another draft', 409);
          return existing;
        }
        if (await tx.adCampaignDraft.count({ where: { organizationId: org } }) >= 100) throw new BadRequestException('Workspace campaign draft limit reached (100)');
        const created = await tx.adCampaignDraft.create({ data: { organizationId: org, accountId: account.id, createdBy: user, name, spec, creationKey: body.key } });
        await this.audit(tx, org, user, 'DRAFT_CREATED', created.id); return created;
      }
      const previous = await this.draft(org, id, tx);
      const previousReviews = await tx.adCampaignReview.findMany({ where: { draftId: id, organizationId: org }, select: { id: true } });
      if (await tx.adCampaignExecution.findFirst({ where: { organizationId: org, reviewId: { in: previousReviews.map((row) => row.id) } } })) throw new HttpException('This draft has a provider execution; recover it or create a separate change draft instead of editing its immutable source', 409);
      if (previous.accountId !== body.accountId) throw new BadRequestException('Draft account cannot be changed; duplicate into a new draft');
      if (body.revision === undefined) throw new HttpException('Draft revision is required', 409);
      const updated = await tx.adCampaignDraft.updateMany({ where: { id, organizationId: org, revision: body.revision }, data: { name, spec, revision: { increment: 1 }, status: 'DRAFT' } });
      if (!updated.count) throw new HttpException('Draft changed; reload before editing', 409);
      await tx.adCampaignReview.updateMany({ where: { draftId: id, organizationId: org }, data: { status: 'INVALIDATED' } });
      await this.audit(tx, org, user, 'DRAFT_EDITED', id, undefined, { revision: body.revision + 1 });
      return this.draft(org, id, tx);
    });
  }
  async duplicate(org: string, user: string, id: string, key: string) {
    await this.member(org, user, 'write'); const previous = await this.draft(org, id);
    const spec = { ...(previous.spec as any) };
    return this.save(org, user, { accountId: previous.accountId, name: campaignName(previous.name.slice(0, 90) + ' · Copy'), key, spec });
  }
  async review(org: string, user: string, id: string, revision: number) {
    await this.member(org, user, 'write');
    const draft = await this.draft(org, id), account = await this.account(org, draft.accountId), spec = campaignSpec(draft.spec, account);
    if (draft.revision !== revision) throw new HttpException('Draft changed; reload', 409);
    if (spec.operation === 'CREATE' && !spec.startImmediately && spec.resourceType !== 'AD' && (account.provider === 'META_ADS' || (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN')) {
      if (account.provider === 'META_ADS' ? Date.parse(spec.start) <= Date.now() : spec.start.length === 10 && spec.start < new Intl.DateTimeFormat('en-CA', { timeZone: account.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) throw new BadRequestException('Choose a current/future provider schedule or immediate start');
    }
    await this.media(org, spec.mediaId);
    await this.advertisingAsset(org, account.id, spec.advertisingAssetId);
    let source: any = null;
    const rootCreate = spec.operation === 'CREATE' && (spec.resourceType || 'CAMPAIGN') === 'CAMPAIGN';
    if (!rootCreate) {
      const level = spec.resourceType || 'CAMPAIGN';
      const listingLevel = spec.operation === 'CREATE' ? level === 'AD_GROUP' ? 'CAMPAIGN' : 'AD_GROUP' : level;
      const listing = await this.list(org, user, account.id, listingLevel);
      source = listing.rows.find((row: any) => row.id === (spec.operation === 'CREATE' && level === 'AD_GROUP' || level === 'CAMPAIGN' ? spec.campaignId : spec.resourceId) && row.campaignId === spec.campaignId);
      if (!source) throw new ForbiddenException('Campaign is not owned by the selected advertising account');
    }
    const connection = account.connectionId ? await this.db.advertisingConnection.findFirst({ where: { id: account.connectionId, organizationId: org, status: 'CONNECTED' }, select: { id: true, revision: true, authorizationRevision: true } }) : null;
    const financial = !rootCreate ? await this.advertising.withManagement(org, account.id, (api) => api.financialContext(spec)) : [];
    const totals: Record<string, Prisma.Decimal> = {};
    for (const budget of financial) { const key = `${budget.period} ${budget.currency}`; totals[key] = (totals[key] || new Prisma.Decimal(0)).plus(budget.amount); }
    const financialSummary = Object.entries(totals).map(([unit, amount]) => `${unit} ${amount.toFixed()}`).join('; ');
    const confirmation = `${campaignConfirmation(account, spec)}${financial.length ? ` EXISTING ${financialSummary} [${campaignDigest(financial).slice(0, 16)}]` : ''}`;
    const snapshot = { account: { id: account.id, externalAccountId: account.externalAccountId, name: account.name, provider: account.provider, currency: account.currency, timezone: account.timezone },
      connection, spec, source, financial, financialSummary, name: draft.name, plan: this.adapter(account.provider).plan(account, draft.name, spec), confirmation,
      warnings: [...(!advertisingWritesEnabled() ? ['OPERATOR_EXECUTION_NOT_ENABLED'] : []), ...(!connection || !account.enabled ? ['ACCOUNT_NOT_CONNECTED_OR_SELECTED'] : []),
        ...(spec.operation === 'RESUME' ? ['RESUME_REQUIRES_FRESH_CAMPAIGN_AND_CHILD_BUDGET_RECONCILIATION'] : []),
        'Budgets are daily amounts, not total spend caps; provider overdelivery rules apply.', 'Provider minima, policy review, asset ownership and targeting need provider validation.'], liveWritesEnabled: advertisingWritesEnabled() };
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      await this.member(org, user, 'write', tx);
      const current = await this.draft(org, id, tx);
      if (current.revision !== revision) throw new HttpException('Draft changed; review again', 409);
      const old = await tx.adCampaignReview.findUnique({ where: { draftId_revision: { draftId: id, revision } } });
      // One immutable review per revision, including expired reviews. Edit to re-review.
      if (old) return old;
      const row = await tx.adCampaignReview.create({ data: { organizationId: org, draftId: id, revision, requestedBy: user, snapshot, digest: campaignDigest(snapshot), expiresAt: new Date(Date.now() + 15 * 60000) } });
      await tx.adCampaignDraft.updateMany({ where: { id, organizationId: org, revision }, data: { status: 'IN_REVIEW' } });
      await this.audit(tx, org, user, 'REVIEW_REQUESTED', id, row.id, { digest: row.digest }); return row;
    });
  }
  async approve(org: string, user: string, id: string, digest: string, confirmation: string) {
    await this.member(org, user, 'approve');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      await this.member(org, user, 'approve', tx);
      const row = await tx.adCampaignReview.findFirst({ where: { id, organizationId: org } });
      if (!row) throw new ForbiddenException('Review unavailable in this workspace');
      const draft = await this.draft(org, row.draftId, tx), snapshot = row.snapshot as any, account = await this.account(org, draft.accountId, tx);
      if (row.revision !== draft.revision || row.digest !== digest || row.digest !== campaignDigest(snapshot) || row.expiresAt <= new Date() || confirmation !== snapshot.confirmation) throw new HttpException('Review is stale or confirmation does not match', 409);
      campaignSpec(draft.spec, account); await this.media(org, (draft.spec as any).mediaId, tx);
      await this.advertisingAsset(org, account.id, (draft.spec as any).advertisingAssetId, tx);
      if (account.currency !== snapshot.account.currency || account.timezone !== snapshot.account.timezone || account.externalAccountId !== snapshot.account.externalAccountId) throw new HttpException('Account changed; edit and review again', 409);
      if (snapshot.connection) {
        const connection = await tx.advertisingConnection.findFirst({ where: { id: snapshot.connection.id, organizationId: org, authorizationRevision: snapshot.connection.authorizationRevision, status: 'CONNECTED' }, select: { id: true } });
        if (!connection || !account.enabled || account.connectionId !== snapshot.connection.id) throw new HttpException('Connection changed; edit and review again', 409);
      }
      if (row.status === 'APPROVED') return row;
      if (row.status !== 'PENDING') throw new HttpException('Review is no longer pending', 409);
      await tx.adCampaignReview.updateMany({ where: { id, organizationId: org, status: 'PENDING' }, data: { status: 'APPROVED', approvedBy: user, approvedAt: new Date() } });
      await tx.adCampaignDraft.updateMany({ where: { id: draft.id, organizationId: org, revision: row.revision }, data: { status: 'APPROVED' } });
      await this.audit(tx, org, user, 'CAMPAIGN_CHANGE_APPROVED', draft.id, row.id, { digest });
      return tx.adCampaignReview.findFirst({ where: { id, organizationId: org } });
    });
  }
  async submit(org: string, user: string, id: string, body: { digest: string; confirmation: string }) {
    await this.member(org, user, 'approve');
    const review = await this.db.adCampaignReview.findFirst({ where: { id, organizationId: org } });
    if (!review) throw new ForbiddenException('Review unavailable in this workspace');
    if (!advertisingWritesEnabled()) throw new ForbiddenException('Operator must enable ADVERTISING_WRITES_ENABLED before explicit submission');
    return this.execution.submit(org, user, id, body.digest, body.confirmation);
  }
  reconcile(org: string, user: string, id: string, evidence?: Record<string, string>) { return this.execution.reconcile(org, user, id, evidence); }
  validate(org: string, user: string, id: string) { return this.execution.validate(org, user, id); }
  abandon(org: string, user: string, id: string, confirmation: string) { return this.execution.abandon(org, user, id, confirmation); }
  async reject(org: string, user: string, id: string, reason: string) {
    await this.member(org, user, 'approve'); const text = campaignName(reason);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      await this.member(org, user, 'approve', tx);
      const review = await tx.adCampaignReview.findFirst({ where: { id, organizationId: org } });
      if (!review) throw new ForbiddenException('Review unavailable in this workspace');
      if (review.status === 'REJECTED') return review;
      if (review.status !== 'PENDING') throw new HttpException('Review is no longer pending', 409);
      await tx.adCampaignReview.updateMany({ where: { id, organizationId: org, status: 'PENDING' }, data: { status: 'REJECTED' } });
      await tx.adCampaignDraft.updateMany({ where: { id: review.draftId, organizationId: org, revision: review.revision }, data: { status: 'DRAFT' } });
      await this.audit(tx, org, user, 'REVIEW_REJECTED', review.draftId, id, { reason: text });
      return tx.adCampaignReview.findFirst({ where: { id, organizationId: org } });
    });
  }
}
