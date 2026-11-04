import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AdvertisingService } from './advertising.service';
import { campaignDigest, campaignSpec } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.specification';
import { executionPlan, materialize } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.execution-plan';
import { CampaignMutationError } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.transport';
import { CampaignManagementApi, CampaignStep } from '@gitroom/nestjs-libraries/advertising/campaigns/campaign.management-api';

export const advertisingWritesEnabled = () => process.env.ADVERTISING_WRITES_ENABLED === 'true';
const json = (value: any) => JSON.parse(JSON.stringify(value));
@Injectable()
export class CampaignExecutionService {
  constructor(private db: PrismaService, private advertising: AdvertisingService) {}
  private async member(db: any, org: string, user: string) {
    if (!await db.userOrganization.findFirst({ where: { organizationId: org, userId: user, disabled: false, role: 'SUPERADMIN',
      organization: { deletedAt: null }, user: { activated: true, deletedAt: null } }, select: { id: true } })) throw new ForbiddenException('Workspace owner approval required');
  }
  private audit(db: any, org: string, user: string, action: string, review: any, details: any) {
    return db.adCampaignAudit.create({ data: { organizationId: org, actorId: user, draftId: review.draftId, reviewId: review.id, action, details: json(details) } });
  }
  async validate(org: string, user: string, reviewId: string) {
    await this.member(this.db, org, user);
    const review = await this.db.adCampaignReview.findFirst({ where: { id: reviewId, organizationId: org } });
    if (!review) throw new ForbiddenException('Review unavailable in this workspace');
    const draft = await this.db.adCampaignDraft.findFirst({ where: { id: review.draftId, organizationId: org, revision: review.revision } });
    if (!draft || campaignDigest(draft.spec) !== campaignDigest((review.snapshot as any).spec)) throw new HttpException('Draft changed; request a fresh review', 409);
    return this.advertising.withManagement(org, draft.accountId, async (api, account) => {
      let validation: any;
      try {
        await api.permissions(); await api.verifyAccount();
        const spec = campaignSpec(draft.spec, account);
        const asset = spec.advertisingAssetId ? await this.db.advertisingAsset.findFirst({ where: { id: spec.advertisingAssetId, organizationId: org, accountId: account.id, status: 'READY' } }) : null;
        if (spec.advertisingAssetId && !asset) throw new BadRequestException('Advertising asset is unavailable or still processing');
        const plan = await executionPlan(api, account, draft.name, spec, randomUUID(), asset || undefined);
        if (plan.length) await api.send(plan[0], true);
        validation = { status: plan.length ? 'PASSED' : 'NO_CHANGE', scope: !plan.length ? 'PROVIDER_STATE_MATCHED' : account.provider === 'GOOGLE_ADS' ? 'FULL_ATOMIC_REQUEST' : 'FIRST_RESOURCE',
          note: account.provider === 'GOOGLE_ADS' ? 'Validated without creating resources.' : 'Child resources are validated after their paused parent IDs exist. Creative creation and policy review are provider operations, not guaranteed by this check.', digest: review.digest };
      } catch (failure) {
        validation = failure instanceof CampaignMutationError ? { status: 'FAILED', code: failure.code, issues: failure.issues, retryAfter: failure.retryAfter, digest: review.digest }
          : { status: 'FAILED', code: 'CONFIGURATION_OR_RESOURCE_VALIDATION', message: failure instanceof HttpException ? String(failure.message).slice(0, 300) : 'Provider validation unavailable', digest: review.digest };
      }
      await this.db.$transaction(async (tx) => {
        await this.member(tx, org, user);
        await tx.adCampaignReview.updateMany({ where: { id: reviewId, organizationId: org, digest: review.digest }, data: { validation, validatedAt: new Date() } });
        await this.audit(tx, org, user, 'PROVIDER_VALIDATION_RESULT', review, validation);
      });
      return validation;
    });
  }
  private async context(org: string, user: string, reviewId: string, digest: string, confirmation: string) {
    await this.member(this.db, org, user);
    const review = await this.db.adCampaignReview.findFirst({ where: { id: reviewId, organizationId: org } });
    if (!review) throw new ForbiddenException('Review unavailable in this workspace');
    const draft = await this.db.adCampaignDraft.findFirst({ where: { id: review.draftId, organizationId: org } });
    const existing = await this.db.adCampaignExecution.findUnique({ where: { reviewId } });
    if (!draft || draft.revision !== review.revision || review.digest !== digest || campaignDigest(review.snapshot) !== digest) throw new HttpException('Review changed; request a fresh approval', 409);
    const snapshot = review.snapshot as any;
    if (campaignDigest(draft.spec) !== campaignDigest(snapshot.spec) || draft.name !== snapshot.name) throw new HttpException('Draft no longer matches the reviewed content', 409);
    const phrase = existing ? `${snapshot.confirmation} RECOVER ${existing.id}` : snapshot.confirmation;
    if (confirmation !== phrase && !(existing && confirmation === snapshot.confirmation)) throw new BadRequestException('Exact final submission/recovery confirmation required');
    if (!['APPROVED', 'APPROVED_BLOCKED', 'SUBMITTED', 'NO_CHANGE'].includes(review.status) || !existing && review.expiresAt <= new Date()) throw new HttpException('Approval expired or is not approved', 409);
    const account = await this.db.adReportingAccount.findFirst({ where: { id: draft.accountId, organizationId: org, enabled: true } });
    if (!account || account.currency !== snapshot.account.currency || account.timezone !== snapshot.account.timezone || account.externalAccountId !== snapshot.account.externalAccountId || account.provider !== snapshot.account.provider) throw new HttpException('Advertising account changed', 409);
    const connection = await this.db.advertisingConnection.findFirst({ where: { id: account.connectionId || '', organizationId: org, status: 'CONNECTED' }, select: { id: true, revision: true, authorizationRevision: true } });
    if (!connection || !snapshot.connection || connection.id !== snapshot.connection.id || connection.authorizationRevision !== snapshot.connection.authorizationRevision && !(existing && confirmation === phrase)) throw new HttpException('Reconnect and review advertising authorization', 409);
    return { review, draft, account, existing, spec: campaignSpec(draft.spec, account), authorizationRevision: connection.authorizationRevision };
  }
  async submit(org: string, user: string, reviewId: string, digest: string, confirmation: string) {
    if (!advertisingWritesEnabled()) throw new ForbiddenException('Operator must explicitly enable ADVERTISING_WRITES_ENABLED after configuring and validating the integration');
    const context = await this.context(org, user, reviewId, digest, confirmation);
    if (context.existing && confirmation === (context.review.snapshot as any).confirmation) return this.db.adCampaignExecution.findFirst({ where: { id: context.existing.id, organizationId: org }, include: { steps: { orderBy: { position: 'asc' } } } });
    if (context.existing?.status === 'CONFIRMED' || context.existing?.status === 'NO_CHANGE') return context.existing;
    if (context.existing?.status === 'ABANDONED') throw new HttpException('Execution was abandoned; use its retained IDs in a new explicitly reviewed child/change draft', 409);
    if (context.existing && ['UNKNOWN', 'RUNNING'].includes(context.existing.status)) throw new HttpException('Reconcile this execution before attempting recovery; unknown creates must not be retried', 409);
    return this.advertising.withManagement(org, context.account.id, async (api, currentAccount) => {
      await api.permissions();
      await api.verifyAccount();
      if (context.spec.operation !== 'CREATE' || (context.spec.resourceType || 'CAMPAIGN') !== 'CAMPAIGN') {
        const currentFinancial = await api.financialContext(context.spec);
        if (campaignDigest(currentFinancial) !== campaignDigest((context.review.snapshot as any).financial)) throw new HttpException('Existing budgets or schedules changed since review; create a fresh change review', 409);
      }
      if (currentAccount.currency !== context.account.currency || currentAccount.timezone !== context.account.timezone) throw new HttpException('Account metadata changed', 409);
      const id = context.existing?.id || randomUUID();
      const asset = context.spec.advertisingAssetId ? await this.db.advertisingAsset.findFirst({ where: { id: context.spec.advertisingAssetId, organizationId: org, accountId: currentAccount.id, status: 'READY' } }) : null;
      if (context.spec.advertisingAssetId && !asset) throw new ForbiddenException('Advertising asset is unavailable in selected workspace/account or is still processing');
      const plan = context.existing ? context.existing.plan as unknown as CampaignStep[] : await executionPlan(api, currentAccount, context.draft.name, context.spec, id, asset || undefined);
      if (context.existing && context.spec.operation !== 'CREATE') {
        const currentPlan = await executionPlan(api, currentAccount, context.draft.name, context.spec, id, asset || undefined);
        if (campaignDigest(currentPlan) !== campaignDigest(plan)) throw new HttpException('Provider resource ownership or budget association changed; create a fresh change review', 409);
      }
      // Google can validate the complete atomic hierarchy without creating it.
      if (currentAccount.provider === 'GOOGLE_ADS' && plan.length) {
        try { await api.send(plan[0], true); }
        catch (failure) {
          if (failure instanceof CampaignMutationError) throw new HttpException({ message: 'Google Ads validation failed', code: failure.code, issues: failure.issues, retryAfter: failure.retryAfter }, failure.code === 'RATE_LIMITED' ? 429 : 400);
          throw failure;
        }
      }
      const lease = randomUUID();
      let duplicateRequest = false;
      const run = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
        await this.member(tx, org, user);
        const draft = await tx.adCampaignDraft.findFirst({ where: { id: context.draft.id, organizationId: org, revision: context.review.revision } });
        if (!draft) throw new HttpException('Draft changed during validation', 409);
        const sibling = await tx.adCampaignExecution.findFirst({ where: { accountId: context.account.id, organizationId: org, status: { in: ['RUNNING', 'UNKNOWN'] } } });
        if (sibling) throw new HttpException('Another execution needs completion or reconciliation for this account', 409);
        let row = await tx.adCampaignExecution.findUnique({ where: { reviewId } });
        if (row && !context.existing) { duplicateRequest = true; return row; }
        if (row && row.status === 'CONFIRMED') return row;
        if (!row) {
          row = await tx.adCampaignExecution.create({ data: { id, organizationId: org, accountId: currentAccount.id, reviewId, actorId: user, plan: json(plan) } });
          for (let position = 0; position < plan.length; position++) await tx.adCampaignExecutionStep.create({ data: {
            organizationId: org, executionId: id, position, name: plan[position].name, requestDigest: campaignDigest(plan[position]) } });
        }
        await tx.adCampaignExecution.update({ where: { id: row.id }, data: { status: 'RUNNING', leaseToken: lease, leaseUntil: new Date(Date.now() + 6 * 60000) } });
        await this.audit(tx, org, user, context.existing ? 'EXECUTION_RECOVERY_AUTHORIZED' : 'EXECUTION_AUTHORIZED', context.review, { executionId: row.id, digest, authorizationRevision: context.authorizationRevision });
        return row;
      });
      if (run.status === 'CONFIRMED' || duplicateRequest) return run;
      try { return await this.perform(api, org, user, context.review, id, lease, plan); }
      catch (failure) {
        await this.db.$transaction(async (tx) => {
          const current = await tx.adCampaignExecution.findFirst({ where: { id, organizationId: org, leaseToken: lease } });
          if (!current) return;
          const sent = await tx.adCampaignExecutionStep.findFirst({ where: { executionId: id, organizationId: org, status: { in: ['SENDING', 'UNKNOWN'] } } });
          await tx.adCampaignExecution.update({ where: { id }, data: { status: sent ? 'UNKNOWN' : 'REJECTED', leaseToken: null, leaseUntil: null } });
          await this.audit(tx, org, user, 'EXECUTION_INTERRUPTED', context.review, { executionId: id, requiresReconciliation: !!sent });
        });
        throw failure;
      }
    });
  }
  async reconcile(org: string, user: string, id: string, evidence: Record<string, string> = {}) {
    await this.member(this.db, org, user);
    const run = await this.db.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
    if (!run) throw new ForbiddenException('Execution unavailable in this workspace');
    if (run.leaseUntil && run.leaseUntil > new Date()) throw new HttpException('Execution is still active; reconciliation must wait for its lease to expire', 409);
    if (run.status === 'CONFIRMED' || run.status === 'ABANDONED' || run.status === 'NO_CHANGE') return run;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).length > 10 || Object.values(evidence).some((value) => typeof value !== 'string' || !/^\d{1,30}$/.test(value))) throw new BadRequestException('Reconciliation evidence must contain numeric provider IDs by step name');
    const review = await this.db.adCampaignReview.findFirst({ where: { id: run.reviewId, organizationId: org } });
    if (!review) throw new ForbiddenException('Review unavailable');
    return this.advertising.withManagement(org, run.accountId, async (api) => {
      let resources = run.resources as any;
      const steps = await this.db.adCampaignExecutionStep.findMany({ where: { executionId: id, organizationId: org }, orderBy: { position: 'asc' } });
      for (const step of steps) {
        if (step.status !== 'UNKNOWN' && step.status !== 'SENDING') continue;
        const latest = await this.db.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
        if (!latest || latest.leaseUntil && latest.leaseUntil > new Date()) throw new HttpException('Execution became active', 409);
        resources = latest.resources as any;
        const plan = materialize((run.plan as unknown as CampaignStep[])[step.position], resources);
        const result = await api.reconcile(plan, evidence[step.name]);
        await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
          await this.member(tx, org, user);
          const current = await tx.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
          if (!current || current.leaseUntil && current.leaseUntil > new Date()) throw new HttpException('Execution became active', 409);
          const marked = await tx.adCampaignExecutionStep.updateMany({ where: { id: step.id, status: { in: ['UNKNOWN', 'SENDING'] } }, data: result ? { status: 'CONFIRMED', result: json(result), completedAt: new Date() } : { status: 'UNKNOWN' } });
          if (!marked.count) { resources = current.resources as any; return; }
          if (result) { resources = { ...(current.resources as any), [step.name]: result }; await tx.adCampaignExecution.update({ where: { id }, data: { resources: json(resources) } }); }
          await this.audit(tx, org, user, result ? 'RECONCILIATION_CONFIRMED' : 'RECONCILIATION_UNRESOLVED', review, { executionId: id, position: step.position, ...(result ? { result } : {}) });
        });
      }
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
        await this.member(tx, org, user);
        const current = await tx.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
        if (!current || current.leaseUntil && current.leaseUntil > new Date()) throw new HttpException('Execution became active', 409);
        const currentSteps = await tx.adCampaignExecutionStep.findMany({ where: { executionId: id, organizationId: org } });
        const status = currentSteps.every((step) => step.status === 'CONFIRMED') ? 'CONFIRMED' : currentSteps.some((step) => ['UNKNOWN', 'SENDING'].includes(step.status)) ? 'UNKNOWN' : 'REJECTED';
        await tx.adCampaignExecution.update({ where: { id }, data: { status, leaseToken: null, leaseUntil: null } });
        if (status === 'CONFIRMED') {
          await tx.adCampaignReview.updateMany({ where: { id: review.id, organizationId: org }, data: { status: 'SUBMITTED' } });
          await tx.adCampaignDraft.updateMany({ where: { id: review.draftId, organizationId: org }, data: { status: 'SUBMITTED' } });
        }
      });
      return this.db.adCampaignExecution.findFirst({ where: { id, organizationId: org }, include: { steps: { orderBy: { position: 'asc' } } } });
    });
  }
  async abandon(org: string, user: string, id: string, confirmation: string) {
    await this.member(this.db, org, user);
    if (confirmation !== `ABANDON ${id}`) throw new BadRequestException('Type the exact abandon confirmation');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      await this.member(tx, org, user);
      const run = await tx.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
      if (!run) throw new ForbiddenException('Execution unavailable in this workspace');
      if (run.status !== 'REJECTED' || run.leaseUntil && run.leaseUntil > new Date()) throw new HttpException('Only a definite rejected/incomplete execution can be abandoned; reconcile unknown requests first', 409);
      const review = await tx.adCampaignReview.findFirst({ where: { id: run.reviewId, organizationId: org } });
      if (!review) throw new ForbiddenException('Review unavailable');
      await tx.adCampaignExecution.update({ where: { id }, data: { status: 'ABANDONED', leaseToken: null, leaseUntil: null } });
      await this.audit(tx, org, user, 'EXECUTION_ABANDONED_WITH_RESOURCES_RETAINED', review, { executionId: id, resources: run.resources });
      return tx.adCampaignExecution.findFirst({ where: { id, organizationId: org } });
    });
  }
  private async perform(api: CampaignManagementApi, org: string, user: string, review: any, id: string, lease: string, plan: CampaignStep[]) {
    for (let position = 0; position < plan.length; position++) {
      const current = await this.db.adCampaignExecution.findFirst({ where: { id, organizationId: org, leaseToken: lease, status: 'RUNNING' } });
      if (!current) throw new HttpException('Execution lease changed', 409);
      const row = await this.db.adCampaignExecutionStep.findUniqueOrThrow({ where: { executionId_position: { executionId: id, position } } });
      if (row.status === 'CONFIRMED') continue;
      if (row.status === 'SENDING' || row.status === 'UNKNOWN') throw new HttpException('Unknown provider outcome requires reconciliation', 409);
      const previousError = row.error as any;
      if (row.status === 'REJECTED' && row.completedAt && previousError?.retryAfter && row.completedAt.getTime() + previousError.retryAfter * 1000 > Date.now()) throw new HttpException('Provider retry cooldown has not elapsed', 429);
      const step = materialize(plan[position], current.resources as any);
      if (api.account.provider === 'META_ADS' && /\/(campaigns|adsets|ads)$/.test(step.edge)) {
        try { await api.send(step, true); }
        catch (failure) {
          if (failure instanceof CampaignMutationError) {
            await this.db.$transaction(async (tx) => {
              await tx.adCampaignExecutionStep.updateMany({ where: { id: row.id, status: { in: ['PREPARED', 'REJECTED'] } }, data: { status: 'REJECTED', error: { code: failure.code, issues: failure.issues, retryAfter: failure.retryAfter }, completedAt: new Date(), requestDigest: campaignDigest(step) } });
              await this.audit(tx, org, user, 'PROVIDER_VALIDATION_REJECTED_BEFORE_MUTATION', review, { executionId: id, position, code: failure.code, issues: failure.issues });
            });
            throw new HttpException({ message: 'Meta resource validation failed before mutation', code: failure.code, issues: failure.issues, retryAfter: failure.retryAfter }, failure.code === 'RATE_LIMITED' ? 429 : 400);
          }
          throw failure;
        }
      }
      await this.db.$transaction(async (tx) => {
        await this.member(tx, org, user);
        const account = await tx.adReportingAccount.findFirst({ where: { id: current.accountId, organizationId: org, enabled: true } });
        if (!account || account.connectionId !== api.account.connectionId) throw new ForbiddenException('Advertising account disconnected');
        const connection = await tx.advertisingConnection.findFirst({ where: { id: account.connectionId, organizationId: org, status: 'CONNECTED', authorizationRevision: api.account.authorizationRevision }, select: { id: true } });
        if (!connection) throw new ForbiddenException('Advertising authorization changed');
        const marked = await tx.adCampaignExecutionStep.updateMany({ where: { id: row.id, status: { in: ['PREPARED', 'REJECTED'] } }, data: { status: 'SENDING', sentAt: new Date(), requestDigest: campaignDigest(step), error: undefined } });
        if (!marked.count) throw new HttpException('Mutation is already in progress', 409);
        await this.audit(tx, org, user, 'PROVIDER_MUTATION_SENDING', review, { executionId: id, position, name: step.name, requestDigest: campaignDigest(step) });
      });
      try {
        const response = await api.send(step);
        let result = api.confirmed(step, response.body);
        if (step.response === 'META_COPY') result = await api.confirmCopy(step, result.id);
        await this.db.$transaction(async (tx) => {
          const marked = await tx.adCampaignExecutionStep.updateMany({ where: { id: row.id, status: 'SENDING' }, data: { status: 'CONFIRMED', result: json(result), requestId: response.requestId, completedAt: new Date() } });
          if (!marked.count) throw new Error('Mutation result storage changed');
          await tx.adCampaignExecution.update({ where: { id }, data: { resources: json({ ...(current.resources as any), [step.name]: result }) } });
          await this.audit(tx, org, user, 'PROVIDER_MUTATION_CONFIRMED', review, { executionId: id, position, result, requestId: response.requestId });
        });
      } catch (error) {
        // Includes failure to persist a successful provider response. Keeping an
        // unknown ledger entry prevents a blind replay after an interrupted write.
        const failure = error instanceof CampaignMutationError ? error : new CampaignMutationError('UNKNOWN', 'OUTCOME_OR_STORAGE_UNKNOWN');
        const safeError = { code: failure.code, issues: failure.issues, retryAfter: failure.retryAfter };
        await this.db.$transaction(async (tx) => {
          await tx.adCampaignExecutionStep.updateMany({ where: { id: row.id, status: 'SENDING' }, data: { status: failure.outcome, error: safeError, requestId: failure.requestId, completedAt: new Date() } });
          await tx.adCampaignExecution.update({ where: { id }, data: { status: failure.outcome, leaseToken: null, leaseUntil: null } });
          await this.audit(tx, org, user, `PROVIDER_MUTATION_${failure.outcome}`, review, { executionId: id, position, ...safeError, requestId: failure.requestId });
        });
        await this.advertising.noteManagementFailure(org, current.accountId, api.account.authorizationRevision, failure.code, failure.retryAfter);
        return this.db.adCampaignExecution.findFirst({ where: { id, organizationId: org }, include: { steps: { orderBy: { position: 'asc' } } } });
      }
    }
    return this.db.$transaction(async (tx) => {
      const finalStatus = plan.length ? 'CONFIRMED' : 'NO_CHANGE';
      const marked = await tx.adCampaignExecution.updateMany({ where: { id, organizationId: org, leaseToken: lease }, data: { status: finalStatus, leaseToken: null, leaseUntil: null } });
      if (!marked.count) throw new HttpException('Execution lease changed', 409);
      await tx.adCampaignReview.updateMany({ where: { id: review.id, organizationId: org }, data: { status: plan.length ? 'SUBMITTED' : 'NO_CHANGE' } });
      await tx.adCampaignDraft.updateMany({ where: { id: review.draftId, organizationId: org }, data: { status: plan.length ? 'SUBMITTED' : 'NO_CHANGE' } });
      await this.audit(tx, org, user, plan.length ? 'EXECUTION_CONFIRMED' : 'PROVIDER_STATE_ALREADY_MATCHED', review, { executionId: id, delivery: plan.length ? 'Provider acknowledged the requested operations. New resources were requested PAUSED. Refresh provider status; this does not establish policy approval or delivery.' : 'Provider reads already matched the requested settings. No mutation was sent.' });
      return tx.adCampaignExecution.findFirst({ where: { id, organizationId: org }, include: { steps: { orderBy: { position: 'asc' } } } });
    });
  }
}
