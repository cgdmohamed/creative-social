import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { OrganizationRepository } from '../../libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository';
import { OrganizationService } from '../../libraries/nestjs-libraries/src/database/prisma/organizations/organization.service';
import { assertWorkspaceManager, assertWorkspaceOrigin, workspaceLimit, workspaceName } from '../../libraries/nestjs-libraries/src/database/prisma/organizations/workspace.policy';
import { MediaRepository } from '../../libraries/nestjs-libraries/src/database/prisma/media/media.repository';
import { resolveWorkspaceMedia } from '../../libraries/nestjs-libraries/src/database/prisma/posts/resolve.workspace.media';
import { IntegrationRepository } from '../../libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository';
import { PostsRepository } from '../../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';

jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { fixedEncryption: (value: string) => `encrypted:${value}` },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: () => ({}) } }));

let pg: PGlite;
let repository: OrganizationRepository;
let failMembership = false;
let locks: number;
const previousLimit = process.env.MAX_WORKSPACES_PER_USER;
const previousFrontend = process.env.FRONTEND_URL;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "User" (id text PRIMARY KEY, activated boolean NOT NULL DEFAULT true, "deletedAt" timestamptz);
    CREATE TABLE "Organization" (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, name text NOT NULL,
      "apiKey" text UNIQUE, "allowTrial" boolean NOT NULL, "isTrailing" boolean NOT NULL);
    CREATE TABLE "UserOrganization" ("userId" text REFERENCES "User"(id), "organizationId" text REFERENCES "Organization"(id),
      role text NOT NULL, disabled boolean DEFAULT false, PRIMARY KEY ("userId", "organizationId"));
  `);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  process.env.MAX_WORKSPACES_PER_USER = '2';
  process.env.FRONTEND_URL = 'https://social.example.com';
  failMembership = false;
  locks = 0;
  await pg.exec('TRUNCATE "UserOrganization", "Organization", "User" CASCADE');
  await pg.query('INSERT INTO "User" (id) VALUES ($1)', ['alice']);
  // Small SQL adapter executes the repository transaction against a real
  // ephemeral PostgreSQL engine, including FK constraints and rollback.
  const transaction = {
    model: { $transaction: (work: any) => pg.transaction(async (sql) => work({
      $queryRaw: async (_template: TemplateStringsArray, id: string) => {
        locks++;
        return (await sql.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [id])).rows;
      },
      user: { findFirst: async ({ where }: any) => (await sql.query(
        'SELECT id FROM "User" WHERE id=$1 AND activated=true AND "deletedAt" IS NULL', [where.id]
      )).rows[0] },
      userOrganization: { count: async ({ where }: any) => Number((await sql.query(
        'SELECT count(*) AS count FROM "UserOrganization" WHERE "userId"=$1 AND role=$2', [where.userId, where.role]
      )).rows[0].count) },
      organization: { create: async ({ data }: any) => {
        const org: any = (await sql.query(
          'INSERT INTO "Organization" (name,"apiKey","allowTrial","isTrailing") VALUES ($1,$2,$3,$4) RETURNING id,name',
          [data.name, data.apiKey, data.allowTrial, data.isTrailing]
        )).rows[0];
        await sql.query('INSERT INTO "UserOrganization" ("userId","organizationId",role) VALUES ($1,$2,$3)',
          [failMembership ? 'missing-user' : data.users.create.userId, org.id, data.users.create.role]);
        return org;
      } },
    })) },
  };
  repository = new OrganizationRepository({} as any, {} as any, {} as any, transaction as any);
});
afterEach(() => {
  if (previousLimit === undefined) delete process.env.MAX_WORKSPACES_PER_USER;
  else process.env.MAX_WORKSPACES_PER_USER = previousLimit;
  if (previousFrontend === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = previousFrontend;
});

test('one account creates independent workspaces with owner memberships and unique credentials', async () => {
  const a = await repository.createWorkspace('alice', ' Client A ');
  const b = await repository.createWorkspace('alice', 'Client B');
  expect(a.name).toBe('Client A');
  expect(a.id).not.toBe(b.id);
  expect(locks).toBe(2);
  const rows: any[] = (await pg.query('SELECT * FROM "UserOrganization"')).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.userId === 'alice' && row.role === 'SUPERADMIN' && !row.disabled)).toBe(true);
  const orgs: any[] = (await pg.query('SELECT * FROM "Organization"')).rows;
  expect(new Set(orgs.map((org) => org.apiKey)).size).toBe(2);
  expect(orgs.every((org) => !org.allowTrial && !org.isTrailing)).toBe(true);
  expect((await pg.query('SELECT * FROM "User"')).rows).toHaveLength(1);
});

test('quota rejects excess creation without changing existing workspaces', async () => {
  await repository.createWorkspace('alice', 'A');
  await repository.createWorkspace('alice', 'B');
  await expect(repository.createWorkspace('alice', 'C')).rejects.toMatchObject({ status: 403 });
  expect((await pg.query('SELECT * FROM "Organization"')).rows).toHaveLength(2);
});

test('concurrent creation is serialized at the account quota', async () => {
  process.env.MAX_WORKSPACES_PER_USER = '1';
  const results = await Promise.allSettled([
    repository.createWorkspace('alice', 'A'), repository.createWorkspace('alice', 'B'),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await pg.query('SELECT * FROM "Organization"')).rows).toHaveLength(1);
});

test('failed membership creation rolls back the new organization', async () => {
  await repository.createWorkspace('alice', 'Existing');
  failMembership = true;
  await expect(repository.createWorkspace('alice', 'Rollback')).rejects.toThrow();
  expect((await pg.query('SELECT name FROM "Organization"')).rows).toEqual([{ name: 'Existing' }]);
  expect((await pg.query('SELECT * FROM "UserOrganization"')).rows).toHaveLength(1);
});

test.each(['missing', 'inactive', 'deleted'])('rejects %s account inside the transaction', async (id) => {
  if (id !== 'missing') await pg.query('INSERT INTO "User" (id,activated,"deletedAt") VALUES ($1,$2,$3)',
    [id, id !== 'inactive', id === 'deleted' ? new Date() : null]);
  await expect(repository.createWorkspace(id, 'Denied')).rejects.toMatchObject({ status: 403 });
  expect((await pg.query('SELECT * FROM "Organization"')).rows).toHaveLength(0);
});

test.each([null, '', '   ', 'a'.repeat(81), '<script>', 'bad\nname', 42])('invalid workspace name: %j', (name) => {
  expect(() => workspaceName(name)).toThrow();
});
test('supports trimmed Unicode names and fail-closed quotas', () => {
  expect(workspaceName('  فريق الإبداع  ')).toBe('فريق الإبداع');
  process.env.MAX_WORKSPACES_PER_USER = 'invalid';
  expect(() => workspaceLimit()).toThrow();
  process.env.MAX_WORKSPACES_PER_USER = '0';
  expect(workspaceLimit()).toBe(0);
});

test.each(['USER', 'ADMIN', 'SUPERADMIN'])('workspace management permission: %s', (role) => {
  const check = () => assertWorkspaceManager({ users: [{ role }] });
  if (role === 'USER') expect(check).toThrow(); else expect(check).not.toThrow();
  expect(() => assertWorkspaceManager({ users: [{ role, disabled: true }] })).toThrow();
});

test('switch validation rejects foreign, disabled and malformed organizations', async () => {
  const service = new OrganizationService({ getOrgsByUserId: async () => [
    { id: 'a', users: [{ disabled: false }] }, { id: 'b', users: [{ disabled: true }] },
  ] } as any, {} as any);
  await expect(service.requireMembership('alice', 'a')).resolves.toBeUndefined();
  for (const id of ['foreign', 'b', '', null, ['a']]) {
    await expect(service.requireMembership('alice', id)).rejects.toMatchObject({ status: 403 });
  }
});

test('browser writes require frontend origin; explicit API auth permits originless clients', () => {
  expect(() => assertWorkspaceOrigin({ origin: 'https://social.example.com' })).not.toThrow();
  expect(() => assertWorkspaceOrigin({ auth: 'token' })).not.toThrow();
  for (const origin of [undefined, 'null', 'https://evil.example.com']) {
    expect(() => assertWorkspaceOrigin({ origin })).toThrow();
  }
});

test('rename constrains target and active administrative membership in its write', async () => {
  const updateMany = jest.fn(async () => ({ count: 1 }));
  const repo = new OrganizationRepository({ model: { organization: { updateMany } } } as any, {} as any, {} as any, {} as any);
  await expect(repo.renameWorkspace('alice', 'a', ' New ')).resolves.toEqual({ id: 'a', name: 'New' });
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    id: 'a', deletedAt: null,
    users: { some: { userId: 'alice', disabled: false, role: { in: ['ADMIN', 'SUPERADMIN'] } } },
  } }));
  updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(repo.renameWorkspace('outsider', 'a', 'Hijack')).rejects.toMatchObject({ status: 403 });
});

test('self-hosted ordinary members cannot invite or remove members; owners cannot be removed', async () => {
  const repo = { getOrgsByUserId: jest.fn(async () => [{ id: 'a', users: [{ role: 'SUPERADMIN' }] }]), deleteTeamMember: jest.fn() };
  const service = new OrganizationService(repo as any, {} as any);
  await expect(service.inviteTeamMember({ users: [{ role: 'USER' }] } as any, {} as any, {} as any)).rejects.toMatchObject({ status: 403 });
  await expect(service.deleteTeamMember({ users: [{ role: 'USER' }] } as any, 'owner')).rejects.toMatchObject({ status: 403 });
  await expect(service.deleteTeamMember({ id: 'a', users: [{ role: 'SUPERADMIN' }] } as any, 'owner')).rejects.toThrow();
  expect(repo.deleteTeamMember).not.toHaveBeenCalled();
});

test('post-facing media reads carry the tenant and exclude deleted records', async () => {
  const findUnique = jest.fn(async () => null);
  const media = new MediaRepository({ model: { media: { findUnique } } } as any);
  await expect(media.getMediaById('foreign-media', 'a')).resolves.toBeNull();
  expect(findUnique).toHaveBeenCalledWith({ where: { id: 'foreign-media', organizationId: 'a', deletedAt: null } });
});

test('post editor cannot resolve another workspace media ID even with a supplied public path', async () => {
  const load = jest.fn(async (id: string, org: string) => org === 'a' && id === 'own'
    ? { name: 'normalized.mp4', path: '/own.mp4', status: 'ready' } : null);
  const changed = jest.fn();
  const media = await resolveWorkspaceMedia([
    { id: 'foreign', path: '/known-public-path.jpg' },
    { id: 'foreign-no-path' }, { id: 'own', path: '/old.mov' },
  ], 'a', load, changed);
  expect(media).toEqual([null, null, { id: 'own', name: 'normalized.mp4', path: '/own.mp4' }]);
  expect(load.mock.calls.every(([, org]) => org === 'a')).toBe(true);
  expect(changed).toHaveBeenCalledTimes(3);
});

test('media lookup failure propagates instead of accepting client metadata', async () => {
  await expect(resolveWorkspaceMedia([{ id: 'foreign', path: '/supplied.jpg' }], 'a',
    async () => { throw new Error('database unavailable'); }, jest.fn())).rejects.toThrow();
});

test('social credentials and scheduled content lookups remain workspace scoped after switching', async () => {
  const channels = [{ id: 'channel-a', organizationId: 'a', token: 'secret-a' },
    { id: 'channel-b', organizationId: 'b', token: 'secret-b' }];
  const findFirst = jest.fn(async ({ where }) => channels.find((channel) =>
    channel.id === where.id && channel.organizationId === where.organizationId));
  const integrations = new IntegrationRepository({ model: { integration: { findFirst } } } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any);
  expect(await integrations.getIntegrationById('a', 'channel-a')).toMatchObject({ token: 'secret-a' });
  expect(await integrations.getIntegrationById('b', 'channel-a')).toBeUndefined();
  expect(await integrations.getIntegrationById('b', 'channel-b')).toMatchObject({ token: 'secret-b' });
  const rows = [{ group: 'same-group', organizationId: 'a', state: 'QUEUE' },
    { group: 'same-group', organizationId: 'b', state: 'QUEUE' }];
  const findMany = jest.fn(async ({ where }) => rows.filter((post) => post.group === where.group && post.organizationId === where.organizationId));
  const posts = new PostsRepository({ model: { post: { findMany } } } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any);
  expect(await posts.getPostsByGroup('a', 'same-group')).toEqual([rows[0]]);
  expect(await posts.getPostsByGroup('b', 'same-group')).toEqual([rows[1]]);
});
