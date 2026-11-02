async function ensureNamespace(connection, env) {
  const namespace = env.TEMPORAL_NAMESPACE;
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(namespace || ''))
    throw new Error('Invalid Temporal namespace');
  const retention = Number(env.TEMPORAL_RETENTION_DAYS || 30);
  if (!Number.isInteger(retention) || retention < 1 || retention > 365)
    throw new Error('Invalid Temporal retention');
  const initialize = env.INITIALIZE_TEMPORAL_NAMESPACE === 'true';
  let description;
  try {
    description = await connection.workflowService.describeNamespace({
      namespace,
    });
  } catch (error) {
    if (error.code !== 5 || !initialize)
      throw new Error(
        'Namespace unavailable; explicit initialization is required for a new namespace'
      );
    await connection.workflowService.registerNamespace({
      namespace,
      workflowExecutionRetentionPeriod: {
        seconds: retention * 86400,
        nanos: 0,
      },
    });
    description = await connection.workflowService.describeNamespace({
      namespace,
    });
  }
  if (description.namespaceInfo?.state !== 1)
    throw new Error('Namespace is not registered');
  const attributes = await connection.operatorService.listSearchAttributes({
    namespace,
  });
  const missing = {};
  for (const name of ['organizationId', 'postId']) {
    const type = attributes.customAttributes?.[name];
    if (type !== undefined && type !== 1)
      throw new Error('Search attribute type mismatch; manual review required');
    if (type === undefined) missing[name] = 1; // IndexedValueType.TEXT, matching Postiz.
  }
  if (Object.keys(missing).length) {
    if (!initialize)
      throw new Error(
        'Missing search attributes; explicit initialization is required'
      );
    await connection.operatorService.addSearchAttributes({
      namespace,
      searchAttributes: missing,
    });
  }
}

module.exports = { ensureNamespace };
if (require.main === module) {
  const { Connection } = require('@temporalio/client');
  (async () => {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS,
    });
    try {
      await ensureNamespace(connection, process.env);
    } finally {
      await connection.close();
    }
  })().catch(() => {
    console.error(
      'Temporal namespace readiness failed; review namespace/init settings and connectivity'
    );
    process.exitCode = 1;
  });
}
