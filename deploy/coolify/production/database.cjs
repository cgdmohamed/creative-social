const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const schema = 'libraries/nestjs-libraries/src/database/prisma/schema.prisma';

// The advisory lock and empty-schema assertion execute in the same transaction
// as the generated DDL. There is no overwrite/reset path for an existing DB.
function guardedBootstrapSql(ddl) {
  return `SELECT pg_advisory_xact_lock(624081903);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'Refusing initialization: public schema is not empty';
  END IF;
END $$;
${ddl}`;
}

function postgresEnvironment(connectionString, environment) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Expected PostgreSQL URL');
  return {
    ...environment,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
  };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  let empty;
  try {
    const rows = await db.$queryRawUnsafe(
      "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'"
    );
    empty = rows[0].count === 0;
  } finally {
    await db.$disconnect();
  }
  const mode = process.argv[2] || 'check';
  if (!['check', 'initialize-empty'].includes(mode))
    throw new Error('Unknown schema operation');
  const requested =
    mode === 'initialize-empty' ||
    (empty && process.env.INITIALIZE_EMPTY_DATABASE === 'true');
  if (requested) {
    if (!empty)
      throw new Error(
        'Refusing initialization of an existing database; apply reviewed additive upgrades instead'
      );
    if (process.env.INITIALIZE_EMPTY_DATABASE !== 'true')
      throw new Error(
        'Set INITIALIZE_EMPTY_DATABASE=true only for an approved new empty database'
      );
    const ddl = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const result = spawnSync(
      'psql',
      [
        '-X',
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--single-transaction',
      ],
      {
        input: guardedBootstrapSql(ddl),
        env: postgresEnvironment(process.env.DATABASE_URL, process.env),
        stdio: ['pipe', 'inherit', 'inherit'],
        timeout: 120000,
      }
    );
    if (result.error || result.status !== 0)
      throw new Error(
        'Empty database initialization failed; no reset will be attempted'
      );
  }
  if (empty && !requested)
    throw new Error(
      'Database is empty; approve fresh initialization or restore/apply the documented schema'
    );
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'diff',
      '--from-schema-datasource',
      schema,
      '--to-schema-datamodel',
      schema,
      '--exit-code',
    ],
    {
      stdio: 'inherit',
      env: process.env,
      timeout: 120000,
    }
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'Schema readiness failed; review drift and apply approved migrations. Automatic db push is disabled'
    );
}

module.exports = { guardedBootstrapSql, postgresEnvironment };
if (require.main === module)
  main().catch(() => {
    // Database tool errors can include connection strings. Do not echo exceptions.
    console.error(
      'Database readiness failed. Review schema/init flags and private database access; no reset was performed.'
    );
    process.exitCode = 1;
  });
