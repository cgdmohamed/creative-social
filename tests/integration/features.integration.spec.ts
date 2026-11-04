import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { InboxRepository } from '../../libraries/nestjs-libraries/src/database/prisma/integrations/inbox.repository';
import { ReportingRepository } from '../../libraries/nestjs-libraries/src/reporting/reporting.repository';

const schema = 'libraries/nestjs-libraries/src/database/prisma/schema.prisma';
const main = '4d13c6a2a84796ea5000baf08459417ec015ef3d';
let pg: PGlite;
let expected: PGlite;
const ddl = (path: string) =>
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      path,
      '--script',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
      },
    }
  );
const catalog = async (db: PGlite) =>
  (
    await db.query(`
  SELECT table_name AS object, column_name AS name, data_type || ':' || udt_name || ':' || is_nullable || ':' || COALESCE(column_default,'') AS definition
  FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'
  UNION ALL SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  UNION ALL SELECT t.typname, e.enumlabel, e.enumsortorder::text FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
  ORDER BY object, name, definition
`)
  ).rows;

beforeAll(async () => {
  pg = new PGlite();
  expected = new PGlite();
  const baseline = join(
    tmpdir(),
    `creative-social-main-${randomUUID()}.prisma`
  );
  try {
    writeFileSync(baseline, execFileSync('git', ['show', `${main}:${schema}`]));
    await pg.exec(ddl(baseline));
    for (const migration of [
      '001-unified-inbox.sql',
      '002-analytics-reports.sql',
      '003-inbox-tenant-constraints.sql',
      '004-advertising-accounts.sql',
      '005-paid-analytics.sql',
      '006-advertising-campaign-manager.sql',
    ])
    {
      if (migration === '004-advertising-accounts.sql') {
        await pg.exec(`
          INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('ads-legacy','Legacy client',now());
          INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone,"credentialReference")
            VALUES ('legacy-account','ads-legacy','META_ADS','act_999','Existing metadata','USD','UTC','vault:legacy-reference');
          INSERT INTO "AdReportingDailyMetric" (id,"accountId",date,level,"externalEntityId","attributionWindow",impressions)
            VALUES ('legacy-metric','legacy-account','2026-10-01','ACCOUNT','act_999','existing-window',17);
        `);
      }
      await pg.exec(
        readFileSync(`docs/creative-social/migrations/${migration}`, 'utf8')
      );
    }
    await expected.exec(ddl(schema));
  } finally {
    unlinkSync(baseline);
  }
}, 120000);
afterAll(async () => {
  await pg?.close();
  await expected?.close();
});

test('all additive upgrades on the pinned main schema match the merged Prisma catalog', async () => {
  expect(await catalog(pg)).toEqual(await catalog(expected));
});

test('advertising upgrade preserves old account references and metrics without assigning credentials', async () => {
  expect((await pg.query(`SELECT "connectionId","credentialReference",enabled FROM "AdReportingAccount" WHERE id='legacy-account'`)).rows)
    .toEqual([{ connectionId: null, credentialReference: 'vault:legacy-reference', enabled: false }]);
  expect((await pg.query(`SELECT impressions::text FROM "AdReportingDailyMetric" WHERE id='legacy-metric'`)).rows).toEqual([{ impressions: '17' }]);
  expect((await pg.query(`SELECT "definitionVersion",currency,"purchaseConversionValue" FROM "AdReportingDailyMetric" WHERE id='legacy-metric'`)).rows)
    .toEqual([{ definitionVersion: 'legacy', currency: null, purchaseConversionValue: null }]);
});

test('advertising database constraints reject cross-tenant/provider assignments and duplicate accounts', async () => {
  await pg.exec(`
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('ads-a','Ads A',now()),('ads-b','Ads B',now());
    INSERT INTO "AdvertisingConnection" (id,"organizationId",provider,"updatedAt") VALUES ('ads-grant','ads-a','META_ADS',now());
    INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone,"connectionId")
      VALUES ('ads-owned','ads-a','META_ADS','act_123','Owned','USD','UTC','ads-grant');
  `);
  await expect(pg.exec(`INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone,"connectionId")
    VALUES ('ads-foreign','ads-b','META_ADS','act_456','Foreign','USD','UTC','ads-grant')`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone,"connectionId")
    VALUES ('ads-wrong-provider','ads-a','GOOGLE_ADS','456','Wrong provider','USD','UTC','ads-grant')`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone)
    VALUES ('ads-duplicate','ads-a','META_ADS','act_123','Duplicate','USD','UTC')`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "AdvertisingConnection" (id,"organizationId",provider,"updatedAt")
    VALUES ('ads-duplicate-grant','ads-a','META_ADS',now())`)).rejects.toThrow();
});

test('paid jobs and generated reports cannot link another workspace account or schedule', async () => {
  await pg.exec(`
    INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('paid-a','Paid A',now()),('paid-b','Paid B',now());
    INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone)
      VALUES ('paid-account','paid-a','META_ADS','act_789','Account','USD','UTC');
    INSERT INTO "PaidReportSchedule" (id,"organizationId","createdById",name,query,"rollingDays","cadenceDays",format,delivery,"nextRunAt")
      VALUES ('paid-schedule','paid-a','creator','Report','{}',7,7,'CSV','ARCHIVE',now());
  `);
  await expect(pg.exec(`INSERT INTO "PaidSyncJob" (id,"organizationId","accountId","dedupeKey","reportingRevision",level,"fromDate","toDate","attributionWindow")
    VALUES ('bad-paid-job','paid-b','paid-account','bad',0,'ACCOUNT','2026-01-01','2026-01-02','test')`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "PaidReportRun" (id,"organizationId","scheduleId","periodKey",format)
    VALUES ('bad-paid-run','paid-b','paid-schedule','bad-run','CSV')`)).rejects.toThrow();
});

test('campaign draft/review SQL ownership and idempotency constraints reject foreign and duplicate records', async () => {
  await pg.exec(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('campaign-a','A',now()),('campaign-b','B',now());
    INSERT INTO "AdReportingAccount" (id,"organizationId",provider,"externalAccountId",name,currency,timezone)
      VALUES ('campaign-account','campaign-a','META_ADS','act_999','Account','USD','UTC');
    INSERT INTO "AdCampaignDraft" (id,"organizationId","accountId","createdBy",name,spec,"creationKey","updatedAt")
      VALUES ('draft-owned','campaign-a','campaign-account','creator','Draft','{}','stable-key',now());`);
  await expect(pg.exec(`INSERT INTO "AdCampaignDraft" (id,"organizationId","accountId","createdBy",name,spec,"creationKey","updatedAt")
    VALUES ('draft-foreign','campaign-b','campaign-account','creator','Foreign','{}','key',now())`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "AdCampaignDraft" (id,"organizationId","accountId","createdBy",name,spec,"creationKey","updatedAt")
    VALUES ('draft-duplicate','campaign-a','campaign-account','creator','Duplicate','{}','stable-key',now())`)).rejects.toThrow();
  await expect(pg.exec(`INSERT INTO "AdCampaignReview" (id,"organizationId","draftId",revision,"requestedBy",digest,snapshot,"expiresAt")
    VALUES ('review-foreign','campaign-b','draft-owned',0,'creator','hash','{}',now())`)).rejects.toThrow();
  await pg.exec(`INSERT INTO "AdCampaignReview" (id,"organizationId","draftId",revision,"requestedBy",digest,snapshot,"expiresAt")
    VALUES ('review-owned','campaign-a','draft-owned',0,'creator','hash','{}',now())`);
  await expect(pg.exec(`INSERT INTO "AdCampaignReview" (id,"organizationId","draftId",revision,"requestedBy",digest,snapshot,"expiresAt")
    VALUES ('review-duplicate','campaign-a','draft-owned',0,'creator','hash','{}',now())`)).rejects.toThrow();
});

test('Inbox read markers coexist with tenant-scoped reporting snapshots and cascading channel deletion', async () => {
  // Full baseline tables, real PostgreSQL constraints; no network or provider API.
  await pg.exec(
    `INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-a','A',now()),('org-b','B',now());`
  );
  const required = (
    await pg.query<any>(
      `SELECT column_name,udt_name FROM information_schema.columns WHERE table_name='Integration' AND is_nullable='NO' AND column_default IS NULL`
    )
  ).rows;
  const values: Record<string, any> = {
    id: 'channel-a',
    organizationId: 'org-a',
    name: 'Page',
    internalId: 'page',
    providerIdentifier: 'facebook',
    type: 'social',
    token: 'synthetic',
    updatedAt: new Date().toISOString(),
  };
  for (const row of required)
    if (!(row.column_name in values))
      throw new Error(`Seed missing Integration.${row.column_name}`);
  const columns = Object.keys(values);
  await pg.query(
    `INSERT INTO "Integration" (${columns
      .map((c) => `"${c}"`)
      .join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
    Object.values(values)
  );
  await pg.exec(
    `INSERT INTO "InboxItem" (id,"organizationId","integrationId","externalId",kind,content,"happenedAt","updatedAt") VALUES ('item','org-a','channel-a','comment','comment','Synthetic message',now(),now());`
  );
  const adapter = (tx: any) => ({
    reportMetricSnapshot: {
      createMany: async ({ data }: any) => {
        for (const row of data) {
          const record = { id: randomUUID(), ...row };
          const keys = Object.keys(record);
          await tx.query(
            `INSERT INTO "ReportMetricSnapshot" (${keys
              .map((k) => `"${k}"`)
              .join(',')}) VALUES (${keys
              .map((_, i) => `$${i + 1}`)
              .join(',')}) ON CONFLICT DO NOTHING`,
            Object.values(record).map((v) =>
              v instanceof Date ? v.toISOString() : v
            )
          );
        }
      },
      updateMany: async ({ where, data }: any) =>
        tx.query(
          `UPDATE "ReportMetricSnapshot" SET value=$1 WHERE "organizationId"=$2 AND "customerId" IS NOT DISTINCT FROM $3 AND "integrationId"=$4 AND scope=$5::"ReportScope" AND "entityId"=$6 AND metric=$7 AND date=$8::date`,
          [
            data.value,
            where.organizationId,
            where.customerId,
            where.integrationId,
            where.scope,
            where.entityId,
            where.metric,
            where.date.toISOString(),
          ]
        ),
    },
  });
  const reports = new ReportingRepository({
    $transaction: (fn: any) => pg.transaction((tx) => fn(adapter(tx))),
  } as any);
  const inbox = new InboxRepository(
    {
      model: {
        inboxItem: {
          updateMany: async ({ where, data }: any) => ({
            count: (
              await pg.query(
                `UPDATE "InboxItem" SET "isRead"=$1 WHERE "organizationId"=$2 AND "externalId"=ANY($3::text[]) RETURNING id`,
                [data.isRead, where.organizationId, where.externalId.in]
              )
            ).rows.length,
          }),
        },
      },
    } as any,
    {} as any
  );
  const point = {
    integrationId: 'channel-a',
    entityId: '',
    metric: 'likes',
    sourceLabel: 'Likes',
    kind: 'FLOW' as const,
    unit: 'count',
    value: 12,
    date: new Date('2026-10-01'),
  };
  await reports.save('org-a', 'client-a', 'CHANNEL', [point], 'Page');
  expect(await inbox.markRead('org-b', ['comment'], true)).toEqual({
    count: 0,
  });
  expect(await inbox.markRead('org-a', ['comment'], true)).toEqual({
    count: 1,
  });
  await reports.save(
    'org-a',
    'client-b',
    'CHANNEL',
    [{ ...point, value: 999 }],
    'Moved page'
  );
  expect(
    (await pg.query(`SELECT "customerId",value FROM "ReportMetricSnapshot"`))
      .rows
  ).toEqual([{ customerId: 'client-a', value: 12 }]);
  expect((await pg.query(`SELECT "isRead" FROM "InboxItem"`)).rows).toEqual([
    { isRead: true },
  ]);
  await expect(
    pg.exec(
      `INSERT INTO "InboxItem" (id,"organizationId","integrationId","externalId",kind,content,"happenedAt","updatedAt") VALUES ('bad','org-b','channel-a','foreign','comment','Invalid ownership',now(),now())`
    )
  ).rejects.toThrow();
  await expect(
    pg.exec(
      `INSERT INTO "InboxSync" (id,"organizationId","integrationId",kind,"updatedAt") VALUES ('bad-sync','org-b','channel-a','comment',now())`
    )
  ).rejects.toThrow();
  await expect(
    reports.save(
      'org-b',
      null,
      'CHANNEL',
      [{ ...point, date: new Date('2026-10-02') }],
      'Foreign'
    )
  ).rejects.toThrow();
  await pg.exec(`DELETE FROM "Integration" WHERE id='channel-a'`);
  expect((await pg.query(`SELECT id FROM "InboxItem"`)).rows).toEqual([]);
  expect(
    (await pg.query(`SELECT id FROM "ReportMetricSnapshot"`)).rows
  ).toEqual([]);
});
