import { PGlite } from '@electric-sql/pglite';
import { OAuthRepository } from '../../libraries/nestjs-libraries/src/database/prisma/oauth/oauth.repository';
let pg: PGlite;
let repo: OAuthRepository;
const adapter = (table: string) => ({
  update: async ({ where, data }: any) => {
    const values: any[] = [data.accessToken, where.id];
    let predicate = 'id=$2';
    if ('authorizationCode' in where) {
      values.push(where.authorizationCode);
      predicate += ` AND "authorizationCode"=$${values.length}`;
    }
    if ('codeExpiresAt' in where) {
      values.push(where.codeExpiresAt.gt.toISOString());
      predicate += ` AND "codeExpiresAt">$${values.length}::timestamp`;
    }
    if ('revokedAt' in where) predicate += ' AND "revokedAt" IS NULL';
    const rows = (
      await pg.query(
        `UPDATE "${table}" SET "accessToken"=$1, "authorizationCode"=NULL,"codeExpiresAt"=NULL WHERE ${predicate} RETURNING id`,
        values
      )
    ).rows;
    if (!rows.length) throw { code: 'P2025' };
    return {
      ...rows[0],
      organizationId: 'org',
      organization: { paymentId: null },
    };
  },
});
beforeAll(async () => {
  pg = new PGlite();
  for (const table of ['OAuthAuthorization', 'OAuthSelfHostedAuthorization'])
    await pg.exec(
      `CREATE TABLE "${table}" (id text PRIMARY KEY, "authorizationCode" text, "accessToken" text, "codeExpiresAt" timestamp, "revokedAt" timestamp)`
    );
  repo = new OAuthRepository(
    {} as any,
    { model: { oAuthAuthorization: adapter('OAuthAuthorization') } } as any,
    {
      model: {
        oAuthSelfHostedAuthorization: adapter('OAuthSelfHostedAuthorization'),
      },
    } as any
  );
}, 30000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec(
    `TRUNCATE "OAuthAuthorization", "OAuthSelfHostedAuthorization"`
  );
  for (const table of ['OAuthAuthorization', 'OAuthSelfHostedAuthorization'])
    await pg.exec(
      `INSERT INTO "${table}" (id,"authorizationCode","codeExpiresAt") VALUES ('grant','encrypted-code',now()+interval '5 minutes')`
    );
});
const variants = [
  [
    'OAuthAuthorization',
    (token: string, code: string) =>
      repo.exchangeCodeForToken('grant', token, code),
  ],
  [
    'OAuthSelfHostedAuthorization',
    (token: string, code: string) =>
      repo.exchangeSelfHostedCodeForToken('grant', token, code),
  ],
] as const;
test.each(variants)(
  '%s authorization code can be consumed only once under concurrent redemption',
  async (table, redeem) => {
    const results = await Promise.allSettled([
      redeem('token-one', 'encrypted-code'),
      redeem('token-two', 'encrypted-code'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    const failed = results.find(
      (result) => result.status === 'rejected'
    ) as PromiseRejectedResult;
    expect(failed.reason.getStatus()).toBe(400);
    expect(failed.reason.getResponse()).toEqual({ error: 'invalid_grant' });
    const row = (
      await pg.query<any>(
        `SELECT "authorizationCode","accessToken" FROM "${table}"`
      )
    ).rows[0];
    expect(row.authorizationCode).toBeNull();
    expect(['token-one', 'token-two']).toContain(row.accessToken);
  }
);
for (const [table, redeem] of variants) {
  test.each(['replaced', 'expired', 'revoked'])(
    `${table} rejects a grant changed after validation: %s`,
    async (change) => {
      if (change === 'replaced')
        await pg.exec(`UPDATE "${table}" SET "authorizationCode"='newer-code'`);
      if (change === 'expired')
        await pg.exec(
          `UPDATE "${table}" SET "codeExpiresAt"=now()-interval '1 second'`
        );
      if (change === 'revoked')
        await pg.exec(`UPDATE "${table}" SET "revokedAt"=now()`);
      await expect(
        redeem('should-not-be-issued', 'encrypted-code')
      ).rejects.toMatchObject({ status: 400 });
      const row = (
        await pg.query<any>(
          `SELECT "authorizationCode","accessToken" FROM "${table}"`
        )
      ).rows[0];
      expect(row.accessToken).toBeNull();
      expect(row.authorizationCode).toBe(
        change === 'replaced' ? 'newer-code' : 'encrypted-code'
      );
    }
  );
}
