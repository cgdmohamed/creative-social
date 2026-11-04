// Prisma-shaped unit-test storage. Real SQL constraints/migration preservation
// are verified separately in advertising.database.spec.ts using PGlite.
export function advertisingDatabase(extraTables: string[] = []) {
  let store: Record<string, any[]> = { advertisingConnection: [], advertisingOAuthState: [], adReportingAccount: [] };
  for (const table of extraTables) store[table] = [];
  let allowed = true;
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, value]: any) => {
    if (key === 'OR') return value.some((condition: any) => matches(row, condition));
    if (key === 'AND') return value.every((condition: any) => matches(row, condition));
    if (key === 'organization') return matches({ deletedAt: null }, value);
    if (key === 'account') { const account = store.adReportingAccount.find((item) => item.id === row.accountId); return !!account && matches(account, value); }
    if (key === 'dailyMetrics' || key === 'reachSnapshots') {
      const table = key === 'dailyMetrics' ? 'adReportingDailyMetric' : 'paidReachSnapshot';
      return !!value?.some && (store[table] || []).some((item) => item.accountId === row.id && matches(item, value.some));
    }
    if (key === 'connection') { const connection = store.advertisingConnection.find((item) => item.id === row.connectionId); return !!connection && matches(connection, value); }
    if (key.includes('_') && typeof value === 'object' && !(key in row)) return matches(row, value);
    if (value && typeof value.getTime === 'function') return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      if ('lt' in value) return row[key] < value.lt;
      if ('gte' in value || 'lte' in value) return (!('gte' in value) || row[key] >= value.gte) && (!('lte' in value) || row[key] <= value.lte);
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
      findMany: jest.fn(async ({ where, select, take, orderBy }) => {
        let rows = store[table].filter((row) => matches(row, where));
        if (orderBy) { const [key, direction] = Object.entries<any>(orderBy)[0]; rows = [...rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === 'desc' ? -1 : 1)); }
        return rows.slice(0, take).map((row) => project(row, select));
      }),
      count: jest.fn(async ({ where }) => store[table].filter((row) => matches(row, where)).length),
      create: jest.fn(async ({ data, select }) => {
        const row = { id: `record-${++sequence}`, status: 'DISCONNECTED', revision: 0, credentialCiphertext: null,
          refreshLeaseUntil: null, retryAfter: null, expiresAt: null, usedAt: null, enabled: false,
          ...(table.startsWith('paid') || table === 'adReportingDailyMetric' ? { status: table === 'paidSyncJob' ? 'PENDING' : 'GENERATING',
            createdAt: new Date(), collectedAt: new Date(), attempts: 0, nextAttemptAt: new Date(0), leaseToken: null, leaseUntil: null,
            deliveryStatus: 'NOT_REQUESTED', artifact: null, definitionVersion: 'legacy', enabled: true, revision: 0 } : {}), ...data };
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
