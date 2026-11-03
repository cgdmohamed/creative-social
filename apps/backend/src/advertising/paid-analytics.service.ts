import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { paidContext, definitionVersion, PaidLevel, PaidQuery } from '@gitroom/nestjs-libraries/advertising/paid.types';
import { accountYesterday, attributionFingerprint, covered, dateOnly, dateText, metrics, previousPeriod, compare, validatePaidQuery } from '@gitroom/nestjs-libraries/advertising/paid.math';
const day = 86400000;
@Injectable()
export class PaidAnalyticsService {
  constructor(public db: PrismaService) {}
  async member(org: string, user: string, manage = false, db: Pick<PrismaService, 'userOrganization'> = this.db) {
    const record = await db.userOrganization.findFirst({ where: { organizationId: org, userId: user, disabled: false,
      user: { activated: true, deletedAt: null }, organization: { deletedAt: null }, ...(manage ? { role: { in: ['ADMIN', 'SUPERADMIN'] } } : {}) }, select: { id: true } });
    if (!record) throw new ForbiddenException('Workspace access denied');
  }
  async client(org: string, id?: string) {
    if (!id) return undefined;
    const client = await this.db.customer.findFirst({ where: { id, orgId: org, deletedAt: null }, select: { id: true, name: true } });
    if (!client) throw new ForbiddenException('Client is unavailable in this workspace');
    return client;
  }
  async catalog(org: string, user: string) {
    await this.member(org, user);
    const [accounts, clients, jobs] = await Promise.all([
      this.db.adReportingAccount.findMany({ where: { organizationId: org }, select: { id: true, name: true, provider: true,
        externalAccountId: true, currency: true, timezone: true, customerId: true, enabled: true, valueTrackingVerified: true } }),
      this.db.customer.findMany({ where: { orgId: org, deletedAt: null }, select: { id: true, name: true } }),
      this.db.paidSyncJob.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 30,
        select: { id: true, accountId: true, level: true, kind: true, status: true, errorCode: true, completedAt: true, fromDate: true, toDate: true } }),
    ]);
    return { accounts, clients, jobs, collectionEnabled: process.env.PAID_ANALYTICS_SYNC_ENABLED === 'true', schedulesEnabled: process.env.PAID_REPORT_SCHEDULES_ENABLED === 'true' };
  }
  async configure(org: string, user: string, id: string, customerId: string | null, verified: boolean) {
    await this.member(org, user, true); await this.client(org, customerId || undefined);
    const updated = await this.db.adReportingAccount.updateMany({ where: { id, organizationId: org }, data: {
      customerId, valueTrackingVerified: verified, reportingRevision: { increment: 1 },
    } });
    if (!updated.count) throw new ForbiddenException('Advertising account unavailable');
    return { updated: true };
  }
  async enqueueAccount(account: any, from: string, to: string, level: PaidLevel, key: string, requestedById?: string) {
    const create = async (start: string, end: string, kind: string) => this.db.paidSyncJob.upsert({
      where: { dedupeKey: `${key}:${account.id}:${account.reportingRevision}:${paidContext(account)}:${level}:${kind}:${start}:${end}` }, update: {},
      create: { organizationId: account.organizationId, accountId: account.id, reportingRevision: account.reportingRevision,
        requestedById, level, kind, fromDate: dateOnly(start), toDate: dateOnly(end), attributionWindow: paidContext(account),
        dedupeKey: `${key}:${account.id}:${account.reportingRevision}:${paidContext(account)}:${level}:${kind}:${start}:${end}` }, select: { id: true },
    });
    const ids: string[] = [];
    for (let cursor = dateOnly(from).getTime(); cursor <= dateOnly(to).getTime(); cursor += 31 * day) {
      const end = dateText(new Date(Math.min(cursor + 30 * day, dateOnly(to).getTime())));
      ids.push((await create(dateText(new Date(cursor)), end, 'DAILY')).id);
    }
    if (account.provider === 'META_ADS') ids.push((await create(from, to, 'REACH')).id);
    return ids;
  }
  async requestSync(org: string, user: string, query: PaidQuery) {
    await this.member(org, user, true); validatePaidQuery(query); await this.client(org, query.customerId);
    if (process.env.PAID_ANALYTICS_SYNC_ENABLED !== 'true') throw new HttpException('Paid collection is disabled by the operator', 503);
    const accounts = await this.db.adReportingAccount.findMany({ where: { organizationId: org, enabled: true,
      ...(query.accountId ? { id: query.accountId } : {}), ...(query.provider ? { provider: query.provider } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}) }, take: 11 });
    if (!accounts.length || accounts.length > 10) throw new BadRequestException('Select 1–10 connected advertising accounts for synchronization');
    if (accounts.some((account) => query.to > accountYesterday(account.timezone))) throw new BadRequestException('Synchronize completed days in the account timezone, not today/future dates');
    const previous = previousPeriod(query);
    const ids: string[] = [];
    for (const account of accounts) {
      const key = `manual:${Math.floor(Date.now() / 60000)}`;
      ids.push(...await this.enqueueAccount(account, previous.from, previous.to, query.level, key, user));
      ids.push(...await this.enqueueAccount(account, query.from, query.to, query.level, key, user));
    }
    return { queued: ids.length, ids };
  }
  async report(org: string, user: string, input: PaidQuery) {
    await this.member(org, user); const query = validatePaidQuery(input); const client = await this.client(org, query.customerId);
    const previous = previousPeriod(query);
    const accountWhere = { organizationId: org, ...(query.accountId ? { id: query.accountId } : {}), ...(query.provider ? { provider: query.provider } : {}) };
    const accounts = await this.db.adReportingAccount.findMany({ where: accountWhere, select: { id: true, provider: true, name: true, externalAccountId: true,
      currency: true, timezone: true, customerId: true, valueTrackingVerified: true, enabled: true, connection: { select: { status: true, lastError: true } } }, take: 101 });
    if (accounts.length > 100) throw new BadRequestException('Filter the report to at most 100 accounts');
    if (query.accountId && !accounts.length) throw new ForbiddenException('Account is unavailable in this workspace');
    const rows = await this.db.adReportingDailyMetric.findMany({ where: { account: accountWhere, definitionVersion,
      level: query.level, date: { gte: dateOnly(previous.from), lte: dateOnly(query.to) },
      ...(query.customerId ? { customerId: query.customerId } : {}), ...(query.campaignId ? { externalCampaignId: query.campaignId } : {}) }, take: 20001, orderBy: { date: 'asc' } });
    if (rows.length > 20000) throw new BadRequestException('Report is too large. Narrow accounts, dates or campaign');
    const reaches = await this.db.paidReachSnapshot.findMany({ where: { account: accountWhere, level: query.level,
      ...(query.customerId ? { customerId: query.customerId } : {}), OR: [
        { fromDate: dateOnly(query.from), toDate: dateOnly(query.to) }, { fromDate: dateOnly(previous.from), toDate: dateOnly(previous.to) },
      ] }, take: 20001 });
    const jobs = await this.db.paidSyncJob.findMany({ where: { organizationId: org, accountId: { in: accounts.map((a) => a.id) }, level: query.level,
      kind: 'DAILY', status: 'COMPLETE', fromDate: { lte: dateOnly(query.to) }, toDate: { gte: dateOnly(previous.from) } }, take: 10000 });
    const groups: any[] = [];
    for (const account of accounts) {
      const accountRows = rows.filter((r) => r.accountId === account.id).map((r) => ({ ...r, valueTrackingVerified: r.valueTrackingVerified && account.valueTrackingVerified }));
      // Historical currency/timezone/definition groups never share totals.
      const keys = [...new Set(accountRows.map((r) => `${r.currency}|${r.timezone}|${r.attributionWindow}|${r.attributionFingerprint || attributionFingerprint({})}`))];
      if (!keys.length && (!query.customerId || account.customerId === query.customerId)) keys.push(`${account.currency}|${account.timezone}|${paidContext(account)}|${attributionFingerprint({})}`);
      for (const key of keys) {
        const [currency, timezone, window, fingerprint] = key.split('|');
        const scoped = accountRows.filter((r) => r.currency === currency && r.timezone === timezone && r.attributionWindow === window && (r.attributionFingerprint || attributionFingerprint({})) === fingerprint);
        const current = scoped.filter((r) => dateText(r.date) >= query.from), before = scoped.filter((r) => dateText(r.date) <= previous.to);
        const accountJobs = jobs.filter((j) => j.accountId === account.id && j.attributionWindow === window && (j.attributionFingerprint === fingerprint || j.attributionFingerprint === null));
        const complete = covered(accountJobs, query.from, query.to), previousComplete = covered(accountJobs, previous.from, previous.to);
        const periodReach = (records: any[], from: string, to: string) => {
          const entities = [...new Set(records.map((r) => r.externalEntityId))];
          if (entities.length !== 1) return null; // Never add distinct people across campaigns/ad sets/ads.
          const reach = reaches.find((r) => r.accountId === account.id && r.externalEntityId === entities[0] && r.attributionWindow === window && dateText(r.fromDate) === from && dateText(r.toDate) === to);
          return reach ? reach.reach.toString() : from === to && records.length === 1 ? records[0].reach?.toString() ?? null : null;
        };
        const total = metrics(current, periodReach(current, query.from, query.to)), old = metrics(before, periodReach(before, previous.from, previous.to));
        const lastSync = scoped.length ? new Date(Math.max(...scoped.map((r) => r.collectedAt.getTime()))).toISOString() : null;
        const entities = [...new Set(scoped.map((r) => r.externalEntityId))].map((id) => {
          const now = current.filter((r) => r.externalEntityId === id), prior = before.filter((r) => r.externalEntityId === id);
          const values = metrics(now, periodReach(now, query.from, query.to));
          return { id, name: (now[0] || prior[0]).entityName || id, campaignId: (now[0] || prior[0]).externalCampaignId,
            current: values, previous: metrics(prior, periodReach(prior, previous.from, previous.to)) };
        });
        groups.push({ accountId: account.id, accountName: account.name, provider: account.provider, currency, timezone,
          attribution: window, attributionFingerprint: fingerprint, attributionDetails: accountJobs.find((j) => j.attributionFingerprint === fingerprint)?.attributionDetails || {}, connection: account.connection, enabled: account.enabled, complete, previousComplete, lastSync,
          fresh: complete && account.enabled && account.connection?.status === 'CONNECTED' && !account.connection.lastError && !!lastSync && Date.now() - new Date(lastSync).getTime() < 48 * 3600000,
          current: total, previous: old, changes: Object.fromEntries((Object.keys(total) as (keyof typeof total)[]).map((metric) => [metric, compare(total[metric], old[metric])])), entities,
          trends: Array.from({ length: Math.round((dateOnly(query.to).getTime() - dateOnly(query.from).getTime()) / day) + 1 }, (_, index) => {
            const date = dateText(new Date(dateOnly(query.from).getTime() + index * day)); return { date, ...metrics(current.filter((r) => dateText(r.date) === date)) };
          }) });
      }
    }
    return { name: 'Paid advertising performance', traffic: 'PAID', from: query.from, to: query.to, previous, level: query.level,
      customerId: query.customerId || null, customerName: client?.name || 'All workspace clients', generatedAt: new Date().toISOString(), groups,
      definitions: { conversions: 'Meta: omni_purchase only. Google: primary conversions only; provider definitions differ.',
        leads: 'Meta lead action only; Google primary SUBMIT_LEAD_FORM category. Counts are not unique people.',
        conversionRate: 'Conversions / clicks × 100; not Google interaction-based conversion rate.',
        roas: 'Purchase-category value / spend, only when value tracking is verified.',
        reach: 'Exact provider period reach or a single daily row; never summed across days/entities.',
        totals: 'One reporting level per query. No totals combined across accounts, providers, currencies or attribution contexts.' } };
  }
}
