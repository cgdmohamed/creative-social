const fs = require('node:fs');
const path = require('node:path');

function publicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_URL must be an HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    value.endsWith('/') ||
    url.hostname.endsWith('.invalid')
  ) {
    throw new Error(
      'PUBLIC_URL must be a real HTTPS origin without a trailing slash'
    );
  }
  return value;
}

function revision(value) {
  if (!/^[a-f0-9]{40}$/.test(value || ''))
    throw new Error(
      'CREATIVE_REVISION must be the reviewed full Git commit SHA'
    );
  return value;
}

function secret(name, value, hex = false) {
  if (
    !value ||
    value.length < 64 ||
    /change.me|replace.with/i.test(value) ||
    (hex && !/^[a-f0-9]+$/i.test(value))
  ) {
    throw new Error(
      `${name} must contain at least 64 ${
        hex ? 'hexadecimal' : 'random'
      } characters`
    );
  }
}

function validateProductionEnv(role, env, buildInfo) {
  if (!['backend', 'frontend', 'orchestrator'].includes(role))
    throw new Error('Unknown application role');
  const origin = publicOrigin(env.PUBLIC_URL);
  revision(env.CREATIVE_REVISION);
  if (
    origin !== buildInfo.publicUrl ||
    env.CREATIVE_REVISION !== buildInfo.revision
  ) {
    throw new Error(
      'Runtime URL/revision differs from the image build; rebuild the reviewed commit'
    );
  }
  if (env.NOT_SECURED)
    throw new Error('NOT_SECURED must remain unset for HTTPS cookies');
  for (const name of [
    'DISABLE_REGISTRATION',
    'INBOX_COLLECTION_ENABLED',
    'REPORTING_COLLECTION_ENABLED',
    'PAID_ANALYTICS_SYNC_ENABLED',
    'PAID_REPORT_SCHEDULES_ENABLED',
  ]) {
    if (env[name] !== undefined && !['true', 'false'].includes(env[name]))
      throw new Error(`${name} must be true or false`);
  }
  if (role === 'frontend') {
    if (
      env.JWT_SECRET ||
      env.DATABASE_URL ||
      env.REDIS_URL ||
      env.FACEBOOK_APP_SECRET ||
      env.ADS_ENCRYPTION_KEY ||
      env.META_ADS_APP_SECRET ||
      env.GOOGLE_ADS_CLIENT_SECRET
    ) {
      throw new Error('Frontend must not receive backend credentials');
    }
    return;
  }
  secret('JWT_SECRET', env.JWT_SECRET);
  let db, redis;
  try {
    db = new URL(env.DATABASE_URL);
    redis = new URL(env.REDIS_URL);
  } catch {
    throw new Error('DATABASE_URL and REDIS_URL must be valid connection URLs');
  }
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    !db.username ||
    db.pathname === '/'
  ) {
    throw new Error(
      'DATABASE_URL must identify a PostgreSQL user and database'
    );
  }
  secret('Database password', decodeURIComponent(db.password), true);
  if (!['redis:', 'rediss:'].includes(redis.protocol))
    throw new Error('REDIS_URL must identify Redis');
  secret('Redis password', decodeURIComponent(redis.password), true);
  if (!env.TEMPORAL_ADDRESS || !env.TEMPORAL_NAMESPACE)
    throw new Error('Temporal address and namespace are required');
}

module.exports = { publicOrigin, revision, secret, validateProductionEnv };
if (require.main === module) {
  try {
    const info = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')
    );
    validateProductionEnv(process.argv[2], process.env, info);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
