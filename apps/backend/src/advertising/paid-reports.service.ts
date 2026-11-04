import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { WorkflowIdReusePolicy } from '@temporalio/common';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { ReportingPdf } from '@gitroom/nestjs-libraries/reporting/reporting.pdf';
import { escapeHtml } from '@gitroom/nestjs-libraries/reporting/reporting.export';
import { paidCsv, paidHtml } from '@gitroom/nestjs-libraries/advertising/paid.export';
import { dateOnly, dateText, accountYesterday, validatePaidQuery } from '@gitroom/nestjs-libraries/advertising/paid.math';
import { frontendOrigin } from '@gitroom/nestjs-libraries/advertising/providers/advertising.http';
import { PaidQuery } from '@gitroom/nestjs-libraries/advertising/paid.types';
import { PaidAnalyticsService } from './paid-analytics.service';

export type PaidScheduleInput = { name: string; query: PaidQuery; rollingDays: number; cadenceDays: number;
  format: 'CSV' | 'PDF'; delivery: 'ARCHIVE' | 'EMAIL'; recipient?: string; requireFresh: boolean; nextRunAt: string };
@Injectable()
export class PaidReportsService {
  constructor(private analytics: PaidAnalyticsService, private pdf: ReportingPdf, private email: EmailService, private temporal: TemporalService) {}
  async artifact(report: any, format: string) {
    const bytes = format === 'CSV' ? Buffer.from(paidCsv(report), 'utf8') : await this.pdf.renderHtml(paidHtml(report));
    if (bytes.length > 10 * 1024 * 1024) throw new BadRequestException('Export exceeds 10 MiB; narrow the report');
    return bytes;
  }
  async recipient(org: string, address: string) {
    if (!this.email.hasProvider()) throw new HttpException('Email delivery is not configured', 503);
    const member = await this.analytics.db.userOrganization.findFirst({ where: { organizationId: org, disabled: false,
      user: { email: { equals: address, mode: 'insensitive' }, activated: true, deletedAt: null } }, select: { id: true } });
    if (!member) throw new BadRequestException('Email report links can only be sent to active workspace members');
  }
  async save(org: string, user: string, body: PaidScheduleInput, id?: string) {
    await this.analytics.member(org, user, true); validatePaidQuery(body.query); await this.analytics.client(org, body.query.customerId);
    if (!body.name.trim() || body.name.length > 100 || ![1, 7, 30].includes(body.cadenceDays) || body.rollingDays < 1 || body.rollingDays > 93 ||
      !['CSV', 'PDF'].includes(body.format) || !['ARCHIVE', 'EMAIL'].includes(body.delivery)) throw new BadRequestException('Invalid report schedule');
    const nextRunAt = new Date(body.nextRunAt);
    if (!Number.isFinite(nextRunAt.getTime()) || nextRunAt.getTime() < Date.now() - 60000) throw new BadRequestException('Choose a future first run');
    if (body.query.accountId && !await this.analytics.db.adReportingAccount.findFirst({ where: { id: body.query.accountId, organizationId: org }, select: { id: true } })) throw new ForbiddenException('Account unavailable');
    if (body.delivery === 'EMAIL') await this.recipient(org, body.recipient || '');
    const query = Object.fromEntries((['level', 'customerId', 'provider', 'accountId', 'campaignId'] as const).filter((key) => body.query[key] !== undefined).map((key) => [key, body.query[key]])) as Prisma.InputJsonValue;
    const data = { createdById: user, name: body.name.trim(), query, rollingDays: body.rollingDays, cadenceDays: body.cadenceDays,
      format: body.format, delivery: body.delivery, recipient: body.delivery === 'EMAIL' ? body.recipient!.trim().toLowerCase() : null,
      requireFresh: body.requireFresh, nextRunAt, leaseUntil: null as Date | null };
    if (id) {
      const result = await this.analytics.db.paidReportSchedule.updateMany({ where: { id, organizationId: org }, data: { ...data, revision: { increment: 1 } } });
      if (!result.count) throw new ForbiddenException('Schedule unavailable');
      return { id };
    }
    return this.analytics.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR UPDATE`;
      if (await tx.paidReportSchedule.count({ where: { organizationId: org } }) >= 20) throw new BadRequestException('Workspace schedule limit is 20');
      return tx.paidReportSchedule.create({ data: { organizationId: org, ...data }, select: { id: true } });
    });
  }
  async list(org: string, user: string) {
    await this.analytics.member(org, user, true);
    const [schedules, runs] = await Promise.all([
      this.analytics.db.paidReportSchedule.findMany({ where: { organizationId: org }, orderBy: { nextRunAt: 'asc' } }),
      this.analytics.db.paidReportRun.findMany({ where: { organizationId: org }, take: 30, orderBy: { createdAt: 'desc' },
        select: { id: true, scheduleId: true, format: true, status: true, deliveryStatus: true, errorCode: true, completedAt: true } }),
    ]);
    return { schedules, runs };
  }
  async toggle(org: string, user: string, id: string, enabled: boolean) {
    await this.analytics.member(org, user, true);
    const result = await this.analytics.db.paidReportSchedule.updateMany({ where: { id, organizationId: org },
      data: { enabled, createdById: user, revision: { increment: 1 }, leaseUntil: null } });
    if (!result.count) throw new ForbiddenException('Schedule unavailable');
    return { updated: true };
  }
  async download(org: string, user: string, id: string) {
    await this.analytics.member(org, user);
    const run = await this.analytics.db.paidReportRun.findFirst({ where: { id, organizationId: org, status: 'READY' }, select: { format: true, artifact: true } });
    if (!run?.artifact) throw new ForbiddenException('Report unavailable');
    return { format: run.format, bytes: Buffer.from(run.artifact) };
  }
  @Cron('*/30 * * * * *', { waitForCompletion: true, timeZone: 'UTC' })
  async tick() {
    if (process.env.PAID_REPORT_SCHEDULES_ENABLED !== 'true') return;
    const schedules = await this.analytics.db.paidReportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() },
      organization: { deletedAt: null }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { nextRunAt: 'asc' }, take: 2 });
    for (const schedule of schedules) await this.generate(schedule);
  }
  async generate(schedule: any) {
    const db = this.analytics.db, lease = new Date(Date.now() + 180000);
    const claim = await db.paidReportSchedule.updateMany({ where: { id: schedule.id, revision: schedule.revision, enabled: true,
      nextRunAt: schedule.nextRunAt, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseUntil: lease } });
    if (!claim.count) return;
    const periodKey = `${schedule.id}:${schedule.revision}:${schedule.nextRunAt.toISOString()}`;
    const run = await db.paidReportRun.upsert({ where: { periodKey }, update: {}, create: { organizationId: schedule.organizationId,
      scheduleId: schedule.id, periodKey, format: schedule.format } });
    try {
      await this.analytics.member(schedule.organizationId, schedule.createdById, true);
      if (run.status !== 'READY') {
        const filters = schedule.query as any;
        const accounts = await db.adReportingAccount.findMany({ where: { organizationId: schedule.organizationId,
          ...(filters.accountId ? { id: filters.accountId } : {}), ...(filters.provider ? { provider: filters.provider } : {}) }, select: { timezone: true }, take: 101 });
        if (accounts.length > 100) throw new Error('REPORT_TOO_LARGE');
        const ends = accounts.map((account) => accountYesterday(account.timezone));
        const to = ends.length ? ends.sort()[0] : accountYesterday('UTC');
        const from = dateText(new Date(dateOnly(to).getTime() - (schedule.rollingDays - 1) * 86400000));
        const report = await this.analytics.report(schedule.organizationId, schedule.createdById, { ...(schedule.query as any), from, to });
        if (!report.groups.length || (schedule.requireFresh && report.groups.some((g) => !g.fresh || !g.previousComplete))) throw new Error('INCOMPLETE_DATA');
        const artifact = await this.artifact(report, schedule.format);
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "PaidReportSchedule" WHERE id=${schedule.id} FOR UPDATE`;
          const current = await tx.paidReportSchedule.findFirst({ where: { id: schedule.id, organizationId: schedule.organizationId,
            enabled: true, revision: schedule.revision, leaseUntil: lease } });
          if (!current || lease.getTime() <= Date.now()) throw new Error('SCHEDULE_CHANGED');
          await this.analytics.member(schedule.organizationId, schedule.createdById, true, tx);
          await tx.paidReportRun.update({ where: { id: run.id }, data: { artifact, status: 'READY', completedAt: new Date(), errorCode: null } });
        });
      }
      if (schedule.delivery === 'EMAIL' && run.deliveryStatus !== 'QUEUED') {
        await this.analytics.member(schedule.organizationId, schedule.createdById, true);
        await this.recipient(schedule.organizationId, schedule.recipient);
        const current = await db.paidReportSchedule.findFirst({ where: { id: schedule.id, enabled: true, revision: schedule.revision, leaseUntil: lease } });
        if (!current || lease.getTime() <= Date.now()) throw new Error('SCHEDULE_CHANGED');
        const client = this.temporal.client.getRawClient();
        if (!client) throw new Error('DELIVERY_UNAVAILABLE');
        const link = `${frontendOrigin()}/api/paid-analytics/runs/${run.id}/download`;
        try {
          await client.workflow.start('sendSingleEmailWorkflow', { taskQueue: 'main', workflowId: `paid-report-email-${run.id}`,
            workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
            args: [{ to: schedule.recipient, subject: 'Your advertising report is ready', html: `<p>Your report is ready. Sign in to your workspace to <a href="${escapeHtml(link)}">download it</a>.</p>`, addTo: 'bottom' }] });
        } catch (error: any) { if (error?.name !== 'WorkflowExecutionAlreadyStartedError') throw new Error('DELIVERY_UNAVAILABLE'); }
        await db.paidReportRun.update({ where: { id: run.id }, data: { deliveryStatus: 'QUEUED' } });
      }
    } catch {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PaidReportSchedule" WHERE id=${schedule.id} FOR UPDATE`;
        const owner = await tx.paidReportSchedule.findFirst({ where: { id: schedule.id, revision: schedule.revision, leaseUntil: lease } });
        if (!owner) return;
        const current = await tx.paidReportRun.findUnique({ where: { id: run.id }, select: { status: true } });
        await tx.paidReportRun.update({ where: { id: run.id }, data: { status: current?.status === 'READY' ? 'READY' : 'FAILED',
          errorCode: 'GENERATION_OR_DELIVERY_FAILED', deliveryStatus: schedule.delivery === 'EMAIL' ? 'UNCONFIRMED' : 'NOT_REQUESTED', completedAt: new Date() } });
      });
    } finally {
      await db.paidReportSchedule.updateMany({ where: { id: schedule.id, revision: schedule.revision, leaseUntil: lease },
        data: { leaseUntil: null, nextRunAt: new Date(Date.now() + schedule.cadenceDays * 86400000) } });
    }
  }
}
