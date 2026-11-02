import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { ReportingRepository } from '../../libraries/nestjs-libraries/src/reporting/reporting.repository';
let pg: PGlite;
let repo: ReportingRepository;
const date = (value: Date) => value.toISOString().slice(0, 10);
const findRows = async ({ where }: any) =>
  (
    await pg.query(
      `SELECT * FROM "ReportMetricSnapshot" WHERE "organizationId"=$1 AND "integrationId"=ANY($2::text[]) AND scope=$3::"ReportScope" AND date >= $4::date AND date <= $5::date ${
        where.customerId !== undefined
          ? 'AND "customerId" IS NOT DISTINCT FROM $6'
          : ''
      } ORDER BY date`,
      [
        where.organizationId,
        where.integrationId.in,
        where.scope,
        date(where.date.gte),
        date(where.date.lte),
        ...(where.customerId !== undefined ? [where.customerId] : []),
      ]
    )
  ).rows;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    'CREATE TABLE "Organization" (id TEXT PRIMARY KEY); CREATE TABLE "Integration" (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL); CREATE TABLE "Post" (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL);'
  );
  await pg.exec(
    readFileSync(
      'docs/creative-social/migrations/002-analytics-reports.sql',
      'utf8'
    )
  );
  await pg.exec(
    `INSERT INTO "Organization" VALUES ('org-a'),('org-b'); INSERT INTO "Integration" VALUES ('c-a','org-a'),('c-b','org-b'); INSERT INTO "Post" VALUES ('p-a','org-a'),('p-b','org-b');`
  );
  const adapter = (client: any) => ({
    reportMetricSnapshot: {
      createMany: async ({ data }: any) => {
        for (const p of data)
          await client.query(
            `INSERT INTO "ReportMetricSnapshot" (id,"organizationId","integrationId","customerId",scope,"entityId",metric,"sourceLabel","channelName",kind,unit,value,date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date) ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              p.organizationId,
              p.integrationId,
              p.customerId,
              p.scope,
              p.entityId,
              p.metric,
              p.sourceLabel,
              p.channelName,
              p.kind,
              p.unit,
              p.value,
              date(p.date),
            ]
          );
      },
      updateMany: async ({ where: p, data }: any) =>
        client.query(
          `UPDATE "ReportMetricSnapshot" SET value=$1,"channelName"=$2 WHERE "organizationId"=$3 AND "customerId" IS NOT DISTINCT FROM $4 AND "integrationId"=$5 AND scope=$6 AND "entityId"=$7 AND metric=$8 AND date=$9::date`,
          [
            data.value,
            data.channelName,
            p.organizationId,
            p.customerId,
            p.integrationId,
            p.scope,
            p.entityId,
            p.metric,
            date(p.date),
          ]
        ),
      findMany: findRows,
    },
  });
  repo = new ReportingRepository({
    ...adapter(pg),
    $transaction: (fn: any) => pg.transaction((tx) => fn(adapter(tx))),
    $queryRaw: async (query: any) =>
      (
        await pg.query(
          query.text,
          query.values.map((v: any) =>
            v instanceof Date ? v.toISOString() : v
          )
        )
      ).rows,
  } as any);
}, 30000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    'TRUNCATE "ReportMetricSnapshot", "ReportCampaign", "AdReportingAccount" CASCADE'
  );
});
const sample = (value: number, day = '2026-10-01') => [
  {
    integrationId: 'c-a',
    entityId: '',
    metric: 'likes',
    sourceLabel: 'Likes',
    kind: 'FLOW' as const,
    unit: 'count',
    value,
    date: new Date(day),
  },
];
test('migration and repository preserve idempotence and first daily client attribution', async () => {
  await repo.save('org-a', 'client-a', 'CHANNEL', sample(10), 'Original name');
  await repo.save('org-a', 'client-a', 'CHANNEL', sample(12), 'Original name');
  await repo.save(
    'org-a',
    'client-b',
    'CHANNEL',
    sample(100),
    'New client name'
  );
  const result = await pg.query<any>('SELECT * FROM "ReportMetricSnapshot"');
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    customerId: 'client-a',
    value: 12,
    channelName: 'Original name',
  });
});
test('composite foreign keys reject cross-organization channel and campaign membership', async () => {
  await expect(
    repo.save('org-b', 'client-b', 'CHANNEL', sample(10), 'Wrong org')
  ).rejects.toThrow();
  await pg.exec(
    `INSERT INTO "ReportCampaign" (id,"organizationId",name,"from","to") VALUES ('campaign','org-a','Campaign','2026-10-01','2026-10-31');`
  );
  await expect(
    pg.exec(
      `INSERT INTO "ReportCampaignPost" ("organizationId","campaignId","postId") VALUES ('org-a','campaign','p-b')`
    )
  ).rejects.toThrow();
});
test('tenant-scoped baseline query returns the latest pre-window sample, not fabricated zeros', async () => {
  await repo.save(
    'org-a',
    'client-a',
    'CHANNEL',
    sample(3, '2026-09-01'),
    'Name'
  );
  await repo.save(
    'org-a',
    'client-a',
    'CHANNEL',
    sample(4, '2026-09-30'),
    'Name'
  );
  await repo.save(
    'org-a',
    'client-a',
    'CHANNEL',
    sample(7, '2026-10-01'),
    'Name'
  );
  const result = await repo.snapshots(
    'org-a',
    ['c-a'],
    'CHANNEL',
    new Date('2026-10-01'),
    new Date('2026-10-02'),
    'client-a'
  );
  expect(result.map((p) => p.value)).toEqual([4, 7]);
  expect(
    await repo.snapshots(
      'org-b',
      ['c-a'],
      'CHANNEL',
      new Date('2026-10-01'),
      new Date('2026-10-02'),
      undefined
    )
  ).toEqual([]);
  expect(
    await repo.snapshots(
      'org-a',
      ['c-a'],
      'CHANNEL',
      new Date('2026-10-01'),
      new Date('2026-10-02'),
      'client-b'
    )
  ).toEqual([]);
});
test('Ads models preserve currency, decimal precision, large counters and attribution grain', async () => {
  await pg.exec(
    `INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone) VALUES ('ads','org-a','GOOGLE_ADS','remote','Ads','SAR','Asia/Riyadh'); INSERT INTO "AdReportingDailyMetric" (id,"accountId",date,level,"externalEntityId","attributionWindow",impressions,spend,conversions) VALUES ('daily','ads','2026-10-01','CAMPAIGN','campaign','7d_click',1234567890123456789,0.123456,1.500000);`
  );
  const row = (await pg.query<any>('SELECT * FROM "AdReportingDailyMetric"'))
    .rows[0];
  expect(String(row.impressions)).toBe('1234567890123456789');
  expect(String(row.spend)).toBe('0.123456');
  expect(
    (await pg.query<any>('SELECT enabled FROM "AdReportingAccount"')).rows[0]
      .enabled
  ).toBe(false);
  await expect(
    pg.exec(
      `INSERT INTO "AdReportingDailyMetric" (id,"accountId",date,level,"externalEntityId","attributionWindow") VALUES ('dup','ads','2026-10-01','CAMPAIGN','campaign','7d_click')`
    )
  ).rejects.toThrow();
  await pg.exec(`DELETE FROM "AdReportingAccount" WHERE id='ads'`);
  expect(
    (
      await pg.query<any>(
        'SELECT count(*)::int AS count FROM "AdReportingDailyMetric"'
      )
    ).rows[0].count
  ).toBe(0);
});
