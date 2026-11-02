import { Injectable } from '@nestjs/common';
import { Prisma, ReportScope } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { MetricPoint } from './reporting.types';
@Injectable()
export class ReportingRepository {
  constructor(private db: PrismaService) {}
  customer(org: string, id: string) {
    return this.db.customer.findFirst({
      where: { id, orgId: org, deletedAt: null },
    });
  }
  clients(org: string) {
    return this.db.customer.findMany({
      where: { orgId: org, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
  channels(
    org: string,
    customerId?: string,
    ids?: string[],
    historical = false
  ) {
    const owner = customerId === '__unassigned' ? null : customerId;
    const clientFilter = customerId
      ? historical
        ? {
            OR: [
              { customerId: owner },
              {
                reportSnapshots: {
                  some: { organizationId: org, customerId: owner },
                },
              },
            ],
          }
        : { customerId: owner }
      : {};
    return this.db.integration.findMany({
      where: {
        organizationId: org,
        type: 'social',
        deletedAt: null,
        ...(historical ? {} : { disabled: false, inBetweenSteps: false }),
        ...clientFilter,
        ...(ids ? { id: { in: ids } } : {}),
      },
      orderBy: { id: 'asc' },
    });
  }

  posts(org: string, ids: string[], postIds?: string[]) {
    return this.db.post.findMany({
      where: {
        organizationId: org,
        integrationId: { in: ids },
        deletedAt: null,
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: { not: null },
        ...(postIds ? { id: { in: postIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 501,
      select: {
        id: true,
        integrationId: true,
        title: true,
        content: true,
        publishDate: true,
        releaseId: true,
      },
    });
  }
  collectPosts(org: string, integrationId: string, cursor?: string | null) {
    return this.db.post.findMany({
      where: {
        organizationId: org,
        integrationId,
        deletedAt: null,
        parentPostId: null,
        state: 'PUBLISHED',
        releaseId: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
        OR: [
          { publishDate: { gte: new Date(Date.now() - 180 * 86400000) } },
          {
            reportCampaignPosts: {
              some: { campaign: { organizationId: org, archived: false } },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 20,
    });
  }
  campaigns(org: string, customerId?: string) {
    return this.db.reportCampaign.findMany({
      where: {
        organizationId: org,
        archived: false,
        ...(customerId
          ? { customerId: customerId === '__unassigned' ? null : customerId }
          : {}),
      },
      select: { id: true, name: true, customerId: true, from: true, to: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
  campaign(org: string, id: string) {
    return this.db.reportCampaign.findFirst({
      where: { organizationId: org, id, archived: false },
      include: { posts: true },
    });
  }
  createCampaign(
    org: string,
    input: {
      name: string;
      customerId?: string;
      from: Date;
      to: Date;
      postIds: string[];
    }
  ) {
    return this.db.reportCampaign.create({
      data: {
        organizationId: org,
        name: input.name,
        customerId: input.customerId,
        from: input.from,
        to: input.to,
        posts: {
          create: input.postIds.map(
            (
              postId
            ): Prisma.ReportCampaignPostUncheckedCreateWithoutCampaignInput => ({
              postId,
            })
          ),
        },
      },
    });
  }
  request(
    org: string,
    integrationId: string,
    requestedFor: string | undefined,
    requestKey: string
  ) {
    const data = {
      status: 'queued',
      requestedAt: new Date(),
      requestKey,
      requestedFor: requestedFor || null,
    };
    return this.db.reportCollectionState.upsert({
      where: { integrationId },
      create: { organizationId: org, integrationId, ...data },
      update: data,
    });
  }
  pendingRequests() {
    return this.db.reportCollectionState.findMany({
      where: { requestedAt: { not: null } },
      orderBy: { requestedAt: 'asc' },
      take: 25,
      select: {
        organizationId: true,
        integrationId: true,
        requestedFor: true,
        requestKey: true,
      },
    });
  }
  acknowledge(org: string, integrationId: string, requestKey: string) {
    return this.db.reportCollectionState.updateMany({
      where: { organizationId: org, integrationId, requestKey },
      data: { requestedAt: null, requestKey: null, requestedFor: null },
    });
  }
  states(org: string) {
    return this.db.reportCollectionState.findMany({
      where: { organizationId: org },
      select: {
        integrationId: true,
        status: true,
        lastSuccessAt: true,
        detail: true,
        postCursor: true,
      },
    });
  }
  state(
    org: string,
    integrationId: string,
    status: string,
    detail?: string,
    cursor?: string | null
  ) {
    const data = {
      status,
      detail: detail || null,
      lastAttemptAt: new Date(),
      ...(status === 'ok' ? { lastSuccessAt: new Date() } : {}),
      ...(cursor !== undefined ? { postCursor: cursor } : {}),
    };
    return this.db.reportCollectionState.upsert({
      where: { integrationId },
      create: { organizationId: org, integrationId, ...data },
      update: data,
    });
  }
  async save(
    org: string,
    customerId: string | null,
    scope: ReportScope,
    points: Array<MetricPoint & { sourceLabel: string }>,
    channelName: string
  ) {
    for (const point of points) {
      const key = {
        integrationId: point.integrationId,
        scope,
        entityId: point.entityId,
        metric: point.metric,
        date: point.date,
      };
      const data = {
        channelName,
        value: point.value,
        kind: point.kind,
        unit: point.unit,
        sourceLabel: point.sourceLabel,
        collectedAt: new Date(),
      };
      // Preserve the client who owned the channel on its first daily reading.
      // The transaction's conditional update also prevents a concurrent reassignment overwrite.
      await this.db.$transaction(async (tx) => {
        await tx.reportMetricSnapshot.createMany({
          data: [{ ...key, organizationId: org, customerId, ...data }],
          skipDuplicates: true,
        });
        await tx.reportMetricSnapshot.updateMany({
          where: { ...key, organizationId: org, customerId },
          data,
        });
      });
    }
  }
  async snapshots(
    org: string,
    ids: string[],
    scope: ReportScope,
    from: Date,
    to: Date,
    customerId: string | null | undefined,
    postIds?: string[]
  ): Promise<MetricPoint[]> {
    if (!ids.length || postIds?.length === 0) return [];
    const customerClause =
      customerId === undefined
        ? Prisma.empty
        : customerId === null
        ? Prisma.sql`AND "customerId" IS NULL`
        : Prisma.sql`AND "customerId" = ${customerId}`;
    const postClause = postIds
      ? Prisma.sql`AND "entityId" IN (${Prisma.join(postIds)})`
      : Prisma.empty;
    // Both queries are tenant-scoped, bounded, and parameterized. DISTINCT ON
    // selects real pre-window baselines without loading an entire history.
    const baselines = await this.db.$queryRaw<MetricPoint[]>(Prisma.sql`
      SELECT DISTINCT ON ("integrationId", "entityId", "metric") * FROM "ReportMetricSnapshot"
      WHERE "organizationId" = ${org} AND "integrationId" IN (${Prisma.join(
      ids
    )}) AND "scope" = ${scope}::"ReportScope"
      AND "date" < ${from} ${customerClause} ${postClause}
      ORDER BY "integrationId", "entityId", "metric", "date" DESC LIMIT 10001`);
    const rows = await this.db.reportMetricSnapshot.findMany({
      where: {
        organizationId: org,
        integrationId: { in: ids },
        scope,
        date: { gte: from, lte: to },
        ...(customerId !== undefined ? { customerId } : {}),
        ...(postIds ? { entityId: { in: postIds } } : {}),
      },
      orderBy: { date: 'asc' },
      take: 100001,
    });
    if (rows.length > 100000 || baselines.length > 10000)
      throw new Error('REPORT_TOO_LARGE');
    return [...baselines, ...rows];
  }
}
