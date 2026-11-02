import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { validateProductionEnv } from '../../deploy/coolify/production/validate-env.cjs';
import {
  guardedBootstrapSql,
  postgresEnvironment,
} from '../../deploy/coolify/production/database.cjs';
import { ensureNamespace } from '../../deploy/coolify/production/namespace.cjs';

const revision = '1234567890abcdef1234567890abcdef12345678';
const info = { publicUrl: 'https://social.example.com', revision };
const env = () => ({
  PUBLIC_URL: info.publicUrl,
  CREATIVE_REVISION: revision,
  JWT_SECRET: 'jwt-synthetic-fixture-'.repeat(5),
  DATABASE_URL: `postgresql://creative:${'a'.repeat(64)}@postgres/creative`,
  REDIS_URL: `redis://:${'b'.repeat(64)}@redis:6379`,
  TEMPORAL_ADDRESS: 'temporal:7233',
  TEMPORAL_NAMESPACE: 'creative-production',
});

test('runtime accepts a matched image/origin and rejects stale public builds', () => {
  expect(() => validateProductionEnv('backend', env(), info)).not.toThrow();
  expect(() =>
    validateProductionEnv(
      'backend',
      { ...env(), PUBLIC_URL: 'https://other.example.com' },
      info
    )
  ).toThrow(/rebuild/);
});
test.each([
  ['PUBLIC_URL', 'http://social.example.com'],
  ['PUBLIC_URL', 'https://social.example.com/'],
  ['PUBLIC_URL', 'https://social.example.invalid'],
  ['JWT_SECRET', 'CHANGE_ME'],
  ['NOT_SECURED', 'false'],
  ['CREATIVE_REVISION', 'main'],
  ['INBOX_COLLECTION_ENABLED', 'yes'],
])('fails closed on invalid production setting %s', (key, value) => {
  expect(() =>
    validateProductionEnv('backend', { ...env(), [key]: value }, info)
  ).toThrow();
});
test('frontend works without backend credentials and refuses accidental secret injection', () => {
  const frontend = { PUBLIC_URL: info.publicUrl, CREATIVE_REVISION: revision };
  expect(() => validateProductionEnv('frontend', frontend, info)).not.toThrow();
  expect(() =>
    validateProductionEnv(
      'frontend',
      { ...frontend, JWT_SECRET: env().JWT_SECRET },
      info
    )
  ).toThrow(/credentials/);
});
test('PostgreSQL tools receive passwords through environment, not command arguments', () => {
  const config = postgresEnvironment(env().DATABASE_URL, { PATH: 'synthetic' });
  expect(config.PGPASSWORD).toBe('a'.repeat(64));
  expect(config.PGDATABASE).toBe('creative');
  expect(config.PGHOST).toBe('postgres');
});

test('empty database bootstrap is transactional and cannot overwrite an existing schema', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      'BEGIN; ' +
        guardedBootstrapSql(
          'CREATE TABLE retained (id integer); INSERT INTO retained VALUES (42);'
        ) +
        ' COMMIT;'
    );
    await expect(
      pg.exec(
        'BEGIN; ' +
          guardedBootstrapSql('CREATE TABLE should_not_exist(id integer);') +
          ' COMMIT;'
      )
    ).rejects.toThrow(/not empty/);
    await pg.exec('ROLLBACK');
    expect((await pg.query('SELECT id FROM retained')).rows).toEqual([
      { id: 42 },
    ]);
    expect(
      (await pg.query("SELECT to_regclass('should_not_exist') AS name")).rows
    ).toEqual([{ name: null }]);
  } finally {
    await pg.close();
  }
}, 30000);

function connection(
  found = true,
  attributes: Record<string, number> = { organizationId: 1, postId: 1 }
) {
  let present = found;
  return {
    workflowService: {
      describeNamespace: jest.fn(async () => {
        if (!present) throw { code: 5 };
        return { namespaceInfo: { state: 1 } };
      }),
      registerNamespace: jest.fn(async () => {
        present = true;
      }),
    },
    operatorService: {
      listSearchAttributes: jest.fn(async () => ({
        customAttributes: attributes,
      })),
      addSearchAttributes: jest.fn(async () => ({})),
    },
  };
}
test('existing Temporal namespace passes without mutation', async () => {
  const client = connection();
  await ensureNamespace(client, env());
  expect(client.workflowService.registerNamespace).not.toHaveBeenCalled();
  expect(client.operatorService.addSearchAttributes).not.toHaveBeenCalled();
});
test('namespace creation requires explicit approval and does not swallow connectivity errors', async () => {
  const client = connection(false);
  await expect(ensureNamespace(client, env())).rejects.toThrow(/explicit/);
  expect(client.workflowService.registerNamespace).not.toHaveBeenCalled();
  client.workflowService.describeNamespace.mockRejectedValueOnce({ code: 14 });
  await expect(
    ensureNamespace(client, { ...env(), INITIALIZE_TEMPORAL_NAMESPACE: 'true' })
  ).rejects.toThrow();
  expect(client.workflowService.registerNamespace).not.toHaveBeenCalled();
});
test('approved new namespace adds only required missing attributes', async () => {
  const client = connection(false, { organizationId: 1 });
  await ensureNamespace(client, {
    ...env(),
    INITIALIZE_TEMPORAL_NAMESPACE: 'true',
  });
  expect(client.workflowService.registerNamespace).toHaveBeenCalledTimes(1);
  expect(client.operatorService.addSearchAttributes).toHaveBeenCalledWith({
    namespace: 'creative-production',
    searchAttributes: { postId: 1 },
  });
});
test('a wrong existing search attribute type is never silently overwritten', async () => {
  const client = connection(true, { organizationId: 2, postId: 1 });
  await expect(
    ensureNamespace(client, { ...env(), INITIALIZE_TEMPORAL_NAMESPACE: 'true' })
  ).rejects.toThrow(/type mismatch/);
  expect(client.operatorService.addSearchAttributes).not.toHaveBeenCalled();
});

test('resolved Compose keeps data private, builds repository code and gates applications on schema/Temporal readiness', () => {
  // Only synthetic template values are resolved; no Docker daemon or server action.
  // Preserve Docker plugin-discovery variables on Windows/Linux, while every
  // interpolated application variable is replaced by the synthetic template.
  const configEnv = { ...process.env };
  for (const line of readFileSync('.env.production.example', 'utf8').split(
    /\r?\n/
  )) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) configEnv[match[1]] = match[2];
  }
  const output = execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.production.example',
      '-f',
      'docker-compose.production.yaml',
      'config',
      '--format',
      'json',
    ],
    {
      encoding: 'utf8',
      env: configEnv,
    }
  );
  const compose = JSON.parse(output);
  for (const [name, service] of Object.entries<any>(compose.services)) {
    expect(service.ports || []).toHaveLength(0);
    expect(service.container_name).toBeUndefined();
    expect(service.image || '').not.toMatch(/postiz-app|:latest/);
    if (name !== 'gateway')
      expect(Object.keys(service.networks || {})).not.toContain('default');
  }
  expect(compose.services.backend.build.context).toBe(resolve('.'));
  expect(compose.services.backend.build.dockerfile).toBe(
    'Dockerfile.production'
  );
  expect(compose.services.backend.depends_on['app-schema'].condition).toBe(
    'service_completed_successfully'
  );
  expect(
    compose.services.temporal.depends_on['temporal-schema'].condition
  ).toBe('service_completed_successfully');
  expect(
    compose.services.backend.depends_on['temporal-namespace'].condition
  ).toBe('service_completed_successfully');
  expect(compose.services.frontend.environment.JWT_SECRET).toBeUndefined();
  expect(compose.services.frontend.environment.DATABASE_URL).toBeUndefined();
  expect(compose.services.backend.environment.INBOX_COLLECTION_ENABLED).toBe(
    'false'
  );
  expect(
    compose.services['app-schema'].environment.INITIALIZE_EMPTY_DATABASE
  ).toBe('false');
  expect(
    compose.services['temporal-schema'].environment
      .INITIALIZE_EMPTY_TEMPORAL_DATABASES
  ).toBe('false');
  expect(
    compose.services['temporal-namespace'].environment
      .INITIALIZE_TEMPORAL_NAMESPACE
  ).toBe('false');
  expect(Object.keys(compose.volumes)).toEqual(
    expect.arrayContaining([
      'app-postgres',
      'app-redis',
      'temporal-postgres',
      'app-uploads',
    ])
  );
  expect(compose.services.gateway.volumes[0].read_only).toBe(true);
  const maintenance = JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        '--profile',
        'maintenance',
        '--env-file',
        '.env.production.example',
        '-f',
        'docker-compose.production.yaml',
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: configEnv }
    )
  );
  expect(maintenance.services['temporal-maintenance'].profiles).toContain(
    'maintenance'
  );
  expect(maintenance.services['temporal-maintenance'].command).toEqual([
    'upgrade',
  ]);
});

test('production build context excludes secrets but preserves source/license and native probes', () => {
  const ignore = readFileSync('Dockerfile.production.dockerignore', 'utf8');
  expect(ignore).toContain('**/.env.*');
  expect(ignore).toContain('**/*.p8');
  expect(ignore).not.toContain('**/reports');
  expect(ignore).not.toMatch(/^\*\*\/LICENSE$/m);
  const dockerfile = readFileSync('Dockerfile.production', 'utf8');
  expect(dockerfile).toContain('npm --prefix node_modules/canvas run install');
  expect(dockerfile).toContain("require('@temporalio/core-bridge')");
  expect(dockerfile).toContain('USER node');
  expect(dockerfile).not.toMatch(/--no-sandbox|prisma-db-push|pnpm run pm2/);
});

test('maintenance upgrade refuses to contact a database without its explicit approval argument', () => {
  const shell =
    process.platform === 'win32'
      ? 'C:/Program Files/Git/bin/bash.exe'
      : '/bin/sh';
  let result: any;
  try {
    execFileSync(
      shell,
      ['deploy/coolify/production/temporal-schema.sh', 'upgrade'],
      {
        env: {
          ...process.env,
          POSTGRES_SEEDS: 'never-contact.invalid',
          POSTGRES_USER: 'synthetic',
          POSTGRES_PWD: 'synthetic',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (error) {
    result = error;
  }
  expect(result?.status).toBe(1);
  expect(String(result?.stderr)).toContain('--approve-schema-upgrade');
  expect(String(result?.stderr)).not.toContain('synthetic');
});
