import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { AdvertisingService } from './advertising.service';
import { PaidAnalyticsService } from './paid-analytics.service';
import { paidInsights } from '@gitroom/nestjs-libraries/advertising/paid.providers';
import { definitionVersion, paidContext, paidLevels, PaidLevel } from '@gitroom/nestjs-libraries/advertising/paid.types';
import { accountYesterday, attributionFingerprint, covered, dateOnly, dateText } from '@gitroom/nestjs-libraries/advertising/paid.math';

@Injectable()
export class PaidSyncService {
  private cursor: string | undefined;
  private logger = new Logger(PaidSyncService.name);
  constructor(private analytics: PaidAnalyticsService, private advertising: AdvertisingService) {}
  @Cron('*/30 * * * * *', { waitForCompletion: true, timeZone: 'UTC' })
  async tick() {
    if (process.env.PAID_ANALYTICS_SYNC_ENABLED !== 'true') return;
    try { await this.daily(); } catch { this.logger.warn('Paid automatic enqueue failed; pending jobs will still be processed'); }
    const db = this.analytics.db;
    await db.paidSyncJob.updateMany({ where: { status: 'RUNNING', attempts: { gte: 3 }, leaseUntil: { lt: new Date() } },
      data: { status: 'FAILED', errorCode: 'LEASE_EXHAUSTED', leaseToken: null, leaseUntil: null } });
    const pending = await db.paidSyncJob.findMany({ where: { attempts: { lt: 3 }, nextAttemptAt: { lte: new Date() },
      OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: 'asc' }, take: 2 });
    for (const job of pending) await this.process(job);
  }
  async daily() {
    const db = this.analytics.db;
    const lookback = Number(process.env.PAID_SYNC_LOOKBACK_DAYS || 30);
    if (!Number.isInteger(lookback) || lookback < 1 || lookback > 93) throw new Error('Invalid paid lookback');
    const accounts = await db.adReportingAccount.findMany({ where: { enabled: true, connection: { status: 'CONNECTED' }, organization: { deletedAt: null },
      ...(this.cursor ? { id: { gt: this.cursor } } : {}) }, orderBy: { id: 'asc' }, take: 20 });
    for (const account of accounts) {
      const to = accountYesterday(account.timezone);
      const latest = await db.paidSyncJob.findFirst({ where: { accountId: account.id, status: 'COMPLETE', kind: 'DAILY' }, select: { id: true } });
      const from = dateText(new Date(dateOnly(to).getTime() - ((latest ? lookback : Math.max(28, lookback)) - 1) * 86400000));
      for (const level of paidLevels) await this.analytics.enqueueAccount(account, from, to, level, `daily:${to}`);
    }
    this.cursor = accounts.length === 20 ? accounts[accounts.length - 1].id : undefined;
  }
  async process(job: any) {
    const db = this.analytics.db, leaseToken = randomUUID();
    const acquired = await db.paidSyncJob.updateMany({ where: { id: job.id, organizationId: job.organizationId, attempts: { lt: 3 },
      OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseUntil: { lt: new Date() } }] }, data: {
      status: 'RUNNING', leaseToken, leaseUntil: new Date(Date.now() + 120000), attempts: { increment: 1 }, errorCode: null,
    } });
    if (!acquired.count) return;
    try {
      if (job.requestedById) await this.analytics.member(job.organizationId, job.requestedById, true);
      if (job.kind === 'REACH') {
        const complete = await db.paidSyncJob.findMany({ where: { accountId: job.accountId, kind: 'DAILY', level: job.level,
          status: 'COMPLETE', attributionWindow: job.attributionWindow, fromDate: { lte: job.toDate }, toDate: { gte: job.fromDate } } });
        if (!covered(complete, dateText(job.fromDate), dateText(job.toDate))) throw new Error('WAITING_FOR_DAILY_ROWS');
      }
      const result = await this.advertising.readForReporting(job.organizationId, job.accountId, (account, token, signal) => {
        if (account.reportingRevision !== job.reportingRevision || !paidLevels.includes(job.level)) throw new Error('ACCOUNT_CHANGED');
        return paidInsights(account, token, dateText(job.fromDate), dateText(job.toDate), job.level as PaidLevel, job.kind, signal);
      });
      const unique = new Set<string>();
      const details = result.value[0]?.attributionDetails || {};
      const fingerprint = attributionFingerprint(details);
      for (const point of result.value) {
        if (point.attributionDetails && point.attributionDetails !== details && attributionFingerprint(point.attributionDetails) !== fingerprint) throw new Error('MIXED_ATTRIBUTION_CONTEXT');
        const key = point.date + ':' + point.externalEntityId;
        if (unique.has(key)) throw new Error('DUPLICATE_PROVIDER_ROWS');
        unique.add(key);
      }
      await db.$transaction(async (tx) => {
        // Match the connection→account lock order used by Phase 2 disconnect.
        await tx.$queryRaw`SELECT id FROM "AdvertisingConnection" WHERE id=${result.connectionId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "AdReportingAccount" WHERE id=${job.accountId} AND "organizationId"=${job.organizationId} FOR UPDATE`;
        if (job.requestedById) await this.analytics.member(job.organizationId, job.requestedById, true, tx);
        const current = await tx.adReportingAccount.findFirst({ where: { id: job.accountId, organizationId: job.organizationId, enabled: true,
          reportingRevision: job.reportingRevision, connectionId: result.connectionId,
          connection: { revision: result.connectionRevision, status: 'CONNECTED' }, organization: { deletedAt: null } } });
        const ownership = await tx.paidSyncJob.findFirst({ where: { id: job.id, status: 'RUNNING', leaseToken, leaseUntil: { gt: new Date() } } });
        if (!current || !ownership || paidContext(current) !== job.attributionWindow) throw new Error('STALE_COLLECTION');
        await tx.advertisingConnection.updateMany({ where: { id: result.connectionId, organizationId: job.organizationId, revision: result.connectionRevision },
          data: { lastError: null, retryAfter: null } });
        // Replace, rather than add, the refreshed slice. Sparse/removed provider
        // rows must not leave old spend behind. Customer attribution is retained
        // on existing rows, including when an account moves to another client.
        if (job.kind === 'REACH') {
          const ownership = await tx.adReportingDailyMetric.findMany({ where: { accountId: current.id, level: job.level, definitionVersion,
            attributionWindow: job.attributionWindow, date: { gte: job.fromDate, lte: job.toDate } }, select: { externalEntityId: true, customerId: true }, take: 20001 });
          if (ownership.length > 20000) throw new Error('REPORT_TOO_LARGE');
          await tx.paidReachSnapshot.deleteMany({ where: { accountId: current.id, level: job.level, fromDate: job.fromDate,
            toDate: job.toDate, attributionWindow: job.attributionWindow, externalEntityId: { notIn: result.value.map((r) => r.externalEntityId) } } });
          for (const point of result.value) {
            if (point.reach === null) continue;
            const key = { accountId: current.id, fromDate: job.fromDate, toDate: job.toDate, level: job.level,
              externalEntityId: point.externalEntityId, attributionWindow: job.attributionWindow };
            const clients = [...new Set(ownership.filter((r) => r.externalEntityId === point.externalEntityId).map((r) => r.customerId))];
            const customerId = clients.length === 1 ? clients[0] : null; // Mixed-client reach is only available in an unfiltered workspace report.
            await tx.paidReachSnapshot.upsert({ where: { accountId_fromDate_toDate_level_externalEntityId_attributionWindow: key },
              create: { ...key, customerId, reach: BigInt(point.reach) }, update: { customerId, reach: BigInt(point.reach), collectedAt: new Date() } });
          }
        } else {
          // Zero out stale rows omitted by a completed refresh using null metrics,
          // not invented zero values. The provider may omit all-zero resources.
          const existing = await tx.adReportingDailyMetric.findMany({ where: { accountId: current.id, level: job.level, definitionVersion,
            attributionWindow: job.attributionWindow, date: { gte: job.fromDate, lte: job.toDate } }, select: { id: true, date: true, externalEntityId: true } });
          for (const old of existing) if (!unique.has(dateText(old.date) + ':' + old.externalEntityId)) await tx.adReportingDailyMetric.update({ where: { id: old.id },
            data: { spend: null, impressions: null, clicks: null, conversions: null, conversionValue: null, leads: null, reach: null, purchaseConversionValue: null, collectedAt: new Date() } });
          for (const point of result.value) {
            const key = { accountId: current.id, date: dateOnly(point.date), level: job.level, externalEntityId: point.externalEntityId, attributionWindow: job.attributionWindow };
            const data = { entityName: point.entityName, externalCampaignId: point.externalCampaignId, externalAdGroupId: point.externalAdGroupId,
              spend: point.spend, impressions: point.impressions === null ? null : BigInt(point.impressions), clicks: point.clicks === null ? null : BigInt(point.clicks),
              conversions: point.conversions, conversionValue: point.conversionValue, leads: point.leads, purchaseConversionValue: point.purchaseConversionValue,
              reach: point.reach === null ? null : BigInt(point.reach), valueTrackingVerified: current.valueTrackingVerified && point.valueReliable !== false, definitionVersion,
              attributionFingerprint: fingerprint,
              currency: current.currency, timezone: current.timezone, collectedAt: new Date() };
            await tx.adReportingDailyMetric.upsert({ where: { accountId_date_level_externalEntityId_attributionWindow: key }, create: { ...key, ...data, customerId: current.customerId }, update: data });
          }
        }
        const complete = await tx.paidSyncJob.updateMany({ where: { id: job.id, leaseToken, status: 'RUNNING', leaseUntil: { gt: new Date() } }, data: {
          attributionFingerprint: result.value.length ? fingerprint : null,
          attributionDetails: details,
          status: 'COMPLETE', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
        if (!complete.count) throw new Error('STALE_COLLECTION');
      }, { timeout: 60000 });
    } catch (failure: any) {
      const response = failure?.getResponse?.();
      const code = ['REAUTH_REQUIRED', 'RATE_LIMITED', 'NOT_CONFIGURED', 'UNAVAILABLE'].includes(response?.code) ? response.code : 'COLLECTION_FAILED';
      const exhausted = job.attempts + 1 >= 3 || failure?.status === 403;
      await db.paidSyncJob.updateMany({ where: { id: job.id, leaseToken }, data: { status: exhausted ? 'FAILED' : 'PENDING', errorCode: code,
        nextAttemptAt: new Date(Date.now() + Math.max(60, Math.min(3600, Number(response?.retryAfter) || 300)) * 1000), leaseToken: null, leaseUntil: null } });
    }
  }
}
