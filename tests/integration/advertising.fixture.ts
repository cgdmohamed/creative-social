// Prisma-shaped unit-test storage. Real SQL constraints/migration preservation
// are verified separately in advertising.database.spec.ts using PGlite.
export function advertisingDatabase() {
  let store: Record<string, any[]> = { advertisingConnection: [], advertisingOAuthState: [], adReportingAccount: [] };
  let allowed = true;
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, value]: any) => {
    if (key === 'OR') return value.some((condition: any) => matches(row, condition));
    if (key.includes('_') && typeof value === 'object' && !(key in row)) return matches(row, value);
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      if ('lt' in value) return row[key] < value.lt;
    }
    return row[key] === value;
  });
  const project = (row: any, select: any): any => {
    if (!row) return null;
    const full = { ...row, accounts: store.adReportingAccount.filter((a) => a.connectionId === row.id) };
    if (!select) return structuredClone(row);
    return Object.fromEntries(Object.entries(select).map(([key, value]: any) => [key,
      value === true ? full[key] : Array.isArray(full[key]) ? full[key].map((item: any) => project(item, value.select)) : project(full[key], value.select)]));
  };
  const update = (row: any, data: any) => {
    for (const [key, value] of Object.entries<any>(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
    return row;
  };
  const db: any = { userOrganization: { findFirst: jest.fn(async ({ where }) => allowed &&
    ((where.organizationId === 'a' && where.userId === 'alice') || (where.organizationId === 'b' && where.userId === 'bob')) ? { id: 'member' } : null) },
    $queryRaw: jest.fn(async () => []),
  };
  let sequence = 0;
  for (const table of Object.keys(store)) {
    const find = ({ where, select }: any) => project(store[table].find((row) => matches(row, where)), select);
    db[table] = {
      findFirst: jest.fn(async (query) => find(query)),
      findUnique: jest.fn(async (query) => find(query)),
      findUniqueOrThrow: jest.fn(async (query) => { const row = find(query); if (!row) throw new Error('Missing fixture row'); return row; }),
      findMany: jest.fn(async ({ where, select }) => store[table].filter((row) => matches(row, where)).map((row) => project(row, select))),
      create: jest.fn(async ({ data, select }) => {
        const row = { id: `record-${++sequence}`, status: 'DISCONNECTED', revision: 0, credentialCiphertext: null,
          refreshLeaseUntil: null, retryAfter: null, expiresAt: null, usedAt: null, enabled: false, ...data };
        store[table].push(row); return project(row, select);
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = store[table].filter((row) => matches(row, where)); rows.forEach((row) => update(row, data)); return { count: rows.length };
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = store[table].find((item) => matches(item, where));
        if (!row) throw new Error('Missing fixture row'); return structuredClone(update(row, data));
      }),
      deleteMany: jest.fn(async ({ where }) => { store[table] = store[table].filter((row) => !matches(row, where)); }),
      upsert: jest.fn(async ({ where, create, update: changes }) => {
        const row = store[table].find((item) => matches(item, where));
        if (row) return structuredClone(update(row, changes));
        return db[table].create({ data: create });
      }),
    };
  }
  db.$transaction = async (work: any) => {
    const snapshot = structuredClone(store);
    try { return await work(db); } catch (error) { store = snapshot; throw error; }
  };
  return { db, rows: (table: string) => store[table], deny: () => { allowed = false; } };
}
