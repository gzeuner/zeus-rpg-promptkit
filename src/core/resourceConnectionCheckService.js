'use strict';

const { resolveProfile } = require('../config/runtimeConfig');
const { resolveResourceValue, validateResourceCatalog } = require('../config/resourceAccessPlan');
const { runReadOnlyDb2Query } = require('../db2/readOnlyQueryService');
const {
  runReadOnlyJdbcQuery,
  validateJdbcConnectionConfig,
} = require('../jdbc/readOnlyJdbcQueryService');

function resourceConnection(profile, entry, env) {
  const kind = entry.system ? 'db2' : 'jdbc';
  const target = entry.system || entry.connection;
  const raw = entry.system ? profile.systems?.[target] : profile.jdbcConnections?.[target];
  const required = [...JSON.stringify(raw || {}).matchAll(/\$\{env:([A-Z0-9_]+)\}/gi)];
  if (!raw || required.some(match => !env[match[1]])) throw new Error('Missing configuration');
  const config = resolveResourceValue(raw, env);
  if (!config.user || !config.password || (kind === 'db2' && !config.host))
    throw new Error('Incomplete connection');
  if (kind === 'jdbc') validateJdbcConnectionConfig(config);
  return { kind, target, config, resources: [] };
}

function connectionPlan(profiles, profileName, env) {
  const profile = resolveProfile(profiles, profileName, { env, expandEnvPlaceholders: false });
  const catalog = resolveResourceValue(profile.resourceCatalog, env);
  validateResourceCatalog(catalog);
  const entries = Object.entries(catalog).filter(([, entry]) => entry.enabled !== false);
  if (!entries.length || entries.length > 64) throw new Error('Invalid connection scope');
  const connections = new Map();
  for (const [ref, entry] of entries) {
    const key = entry.system ? `db2:${entry.system}` : `jdbc:${entry.connection}`;
    if (!connections.has(key)) connections.set(key, resourceConnection(profile, entry, env));
    connections.get(key).resources.push(ref);
  }
  if (connections.size > 8) throw new Error('Connection limit exceeded');
  return [...connections.values()];
}

function probeSql(connection) {
  if (connection.kind === 'db2' || /^jdbc:(as400|db2):/i.test(connection.config.url || ''))
    return 'SELECT 1 AS HEALTHCHECK FROM SYSIBM.SYSDUMMY1';
  if (/^jdbc:oracle:/i.test(connection.config.url || ''))
    return 'SELECT 1 AS HEALTHCHECK FROM DUAL';
  return 'SELECT 1 AS HEALTHCHECK';
}

async function checkConnection(connection, profileName, env, db2Query, jdbcQuery) {
  let status = 'PASS';
  let details =
    'Read-only login and constant query succeeded. Resource data and authority were not checked.';
  try {
    const query = probeSql(connection);
    const result = await (connection.kind === 'db2' ? db2Query : jdbcQuery)({
      [connection.kind === 'db2' ? 'dbConfig' : 'jdbcConfig']: {
        ...connection.config,
        probeSql: query,
      },
      query,
      maxRows: 1,
      runtime: { env, timeoutMs: 5000, scopeLabel: 'GUI selected resource connection check' },
    });
    if (result?.rowCount !== 1) throw new Error('Unverified response');
  } catch {
    status = 'FAIL';
    details =
      'Connection check failed or timed out. Review the local configuration and connection diagnostics.';
  }
  return {
    check: { name: connection.target, status, details },
    probeRow: {
      system: connection.target,
      profile: profileName,
      functionName: connection.kind,
      resources: connection.resources,
      status: status === 'PASS' ? 'OK' : 'FAIL',
      details,
    },
  };
}

async function checkResourceConnections(
  { profiles, profileName, env },
  { db2Query = runReadOnlyDb2Query, jdbcQuery = runReadOnlyJdbcQuery } = {}
) {
  let connections;
  try {
    connections = connectionPlan(profiles, profileName, env);
  } catch {
    return {
      hasCriticalFailure: true,
      checks: [
        {
          name: 'Connection scope',
          status: 'FAIL',
          details: 'Review the selected resource configuration before testing connections.',
        },
      ],
      probeRows: [],
    };
  }
  const results = await Promise.all(
    connections.map(connection =>
      checkConnection(connection, profileName, env, db2Query, jdbcQuery)
    )
  );
  const checks = results.map(result => result.check);
  const probeRows = results.map(result => result.probeRow);
  return { hasCriticalFailure: checks.some(check => check.status === 'FAIL'), checks, probeRows };
}

module.exports = { checkResourceConnections };
