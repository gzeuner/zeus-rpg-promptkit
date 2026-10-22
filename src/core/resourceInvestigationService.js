'use strict';

const crypto = require('node:crypto');
const { approveResourceJob, resourceBindingFingerprint } = require('../config/resourceAccessPlan');
const {
  runReadOnlyDb2Query,
  validateReadOnlySql,
  escapeSqlLiteral,
} = require('../db2/readOnlyQueryService');
const { runReadOnlyJdbcQuery } = require('../jdbc/readOnlyJdbcQueryService');
const { runJavaHelper } = require('../fetch/jt400CommandRunner');

const reviews = new WeakMap();
const POLICY = 'resource-structured-select/v1';

function deny(code) {
  throw Object.assign(new Error(code), { code });
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function closed(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !fields.includes(key))
  )
    deny('INVESTIGATION_REQUEST_DENIED');
}

function planResourceInvestigation({
  plan,
  sessionId,
  operatorId,
  limits,
  selectionHash = null,
  now = Date.now,
}) {
  approveResourceJob(plan, plan.planHash);
  if (
    plan.dataAccess !== 'samples' ||
    plan.operations.some(operation => operation.kind !== 'data') ||
    new Set(plan.operations.map(operation => operation.ref)).size !== plan.operations.length
  )
    deny('INVESTIGATION_SCOPE_DENIED');
  for (const value of [sessionId, operatorId])
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(value))
      deny('INVESTIGATION_IDENTITY_REQUIRED');
  if (selectionHash !== null && !/^[a-f0-9]{64}$/.test(selectionHash))
    deny('INVESTIGATION_INPUT_INVALID');
  closed(limits, ['queries', 'rows', 'bytes', 'durationMs']);
  for (const [key, maximum] of Object.entries({
    queries: 100,
    rows: 5000,
    bytes: 32 * 1024 * 1024,
    durationMs: 900000,
  }))
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum)
      deny('INVESTIGATION_LIMIT_INVALID');
  const reviewed = {
    schemaVersion: 'resource-investigation/v1',
    policy: POLICY,
    sessionId,
    operatorId,
    planHash: plan.planHash,
    selectionHash,
    purpose: plan.goal,
    workspace: plan.workspace,
    operations: plan.operations,
    dataAccess: plan.dataAccess,
    output: 'stdout-masked',
    limits: { ...limits },
    expiresAt: now() + limits.durationMs,
    approvalRequired: true,
    remoteMutation: false,
  };
  const serialized = JSON.stringify(reviewed);
  const binding = approveResourceJob(plan, plan.planHash);
  if (
    binding.entries.some(entry =>
      [entry.config.password, entry.config.url]
        .filter(value => typeof value === 'string' && value.length > 2)
        .some(value => serialized.includes(value))
    )
  )
    deny('INVESTIGATION_REVIEW_DISCLOSURE_DENIED');
  reviewed.approvalHash = crypto.createHash('sha256').update(serialized).digest('hex');
  reviews.set(reviewed, {
    plan,
    fingerprint: resourceBindingFingerprint(plan),
    selectionHash,
  });
  return freeze(reviewed);
}

function buildSelect(request, operation) {
  closed(request, ['ref', 'schema', 'table', 'columns', 'where', 'maxRows']);
  const scope = operation.scope;
  if (
    !scope.schemas.includes(request.schema) ||
    !scope.tables.includes(request.table) ||
    !Array.isArray(request.columns) ||
    !request.columns.length ||
    request.columns.length > 50 ||
    new Set(request.columns).size !== request.columns.length ||
    request.columns.some(column => !scope.columns.includes(column)) ||
    !Number.isSafeInteger(request.maxRows) ||
    request.maxRows < 1 ||
    request.maxRows > scope.maxRows
  )
    deny('INVESTIGATION_SCOPE_DENIED');
  const conditions = request.where === undefined ? [] : request.where;
  if (!Array.isArray(conditions) || conditions.length > 20) deny('INVESTIGATION_REQUEST_DENIED');
  const predicates = conditions.map(condition => {
    closed(condition, ['column', 'equals']);
    if (!scope.columns.includes(condition.column) || !Object.hasOwn(condition, 'equals'))
      deny('INVESTIGATION_SCOPE_DENIED');
    const value = condition.equals;
    if (value === null) return `"${condition.column}" IS NULL`;
    if (typeof value === 'number' && Number.isFinite(value))
      return `"${condition.column}" = ${value}`;
    if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f]/.test(value))
      deny('INVESTIGATION_REQUEST_DENIED');
    return `"${condition.column}" = ${escapeSqlLiteral(value)}`;
  });
  const columns = request.columns.map(column => `"${column}"`).join(', ');
  const where = predicates.length ? ` WHERE ${predicates.join(' AND ')}` : '';
  const query = `SELECT ${columns} FROM "${request.schema}"."${request.table}"${where}`;
  try {
    validateReadOnlySql(query);
  } catch {
    deny('INVESTIGATION_REQUEST_DENIED');
  }
  return query;
}

function investigationTransport(config, operation, current, reviewed, now) {
  const timeoutMs = Math.max(1, Math.min(30000, reviewed.expiresAt - now()));
  const runtime = {
    timeoutMs,
    runJavaHelper: (className, args, options) => {
      current();
      const remaining = reviewed.expiresAt - now();
      if (remaining <= 0) deny('INVESTIGATION_EXPIRED');
      return runJavaHelper(className, args, { ...options, timeout: Math.min(30000, remaining) });
    },
  };
  return operation.connection
    ? args =>
        runReadOnlyJdbcQuery({
          jdbcConfig: { ...config, probeSql: 'SELECT 1 AS HEALTHCHECK' },
          ...args,
          runtime,
        })
    : args => runReadOnlyDb2Query({ dbConfig: config, ...args, runtime });
}

function maskedInvestigationResult(result, request, operation, config, now) {
  if (!Array.isArray(result.rows) || result.rows.length > request.maxRows)
    deny('INVESTIGATION_RESULT_DENIED');
  const rows = result.rows.map(row =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (!request.columns.some(column => column.toUpperCase() === key.toUpperCase()))
          deny('INVESTIGATION_RESULT_DENIED');
        return [
          key,
          operation.scope.maskColumns.some(column => column.toUpperCase() === key.toUpperCase())
            ? '[MASKED]'
            : value,
        ];
      })
    )
  );
  const output = {
    schemaVersion: 1,
    ref: operation.ref,
    system: operation.system,
    connection: operation.connection,
    targetFingerprint: operation.targetFingerprint,
    capturedAt: new Date(now()).toISOString(),
    scope: {
      schema: request.schema,
      table: request.table,
      columns: request.columns,
      maxRows: request.maxRows,
    },
    columns: request.columns,
    rows,
    rowCount: rows.length,
    truncated: rows.length === request.maxRows,
    remoteMutation: false,
  };
  const serialized = JSON.stringify(output);
  if (
    [config.password, config.user, config.url]
      .filter(Boolean)
      .some(value => serialized.includes(value))
  )
    deny('INVESTIGATION_RESULT_DENIED');
  return { output, bytes: Buffer.byteLength(serialized) };
}

function recordInvestigationAudit(audit, event) {
  if (audit(event)?.then) deny('INVESTIGATION_AUDIT_ASYNC_DENIED');
}

/** @param {{reviewed: ReturnType<typeof planResourceInvestigation>, approve: string, loadPlan: Function, audit: Function, services?: {query?: Function}, now?: () => number}} options */
function openResourceInvestigation({
  reviewed,
  approve,
  loadPlan,
  loadSelection,
  audit,
  services = {},
  now = Date.now,
}) {
  const review = reviews.get(reviewed);
  if (!review) deny('INVESTIGATION_REVIEW_INVALID');
  if (approve !== reviewed.approvalHash) deny('INVESTIGATION_APPROVAL_REQUIRED');
  if (typeof loadPlan !== 'function' || typeof audit !== 'function')
    deny('INVESTIGATION_BOUNDARY_REQUIRED');
  let revoked = false;
  let busy = false;
  const used = { queries: 0, rows: 0, bytes: 0 };
  function current() {
    if (revoked) deny('INVESTIGATION_REVOKED');
    if (now() >= reviewed.expiresAt) {
      revoked = true;
      deny('INVESTIGATION_EXPIRED');
    }
    let plan;
    let fingerprint;
    try {
      plan = loadPlan();
      fingerprint = resourceBindingFingerprint(plan);
    } catch {
      revoked = true;
      deny('INVESTIGATION_INPUT_CHANGED');
    }
    if (fingerprint !== review.fingerprint) {
      revoked = true;
      deny('INVESTIGATION_INPUT_CHANGED');
    }
    if (review.selectionHash !== null) {
      let currentSelectionHash;
      try {
        if (typeof loadSelection !== 'function') deny('INVESTIGATION_INPUT_CHANGED');
        currentSelectionHash = loadSelection();
      } catch {
        revoked = true;
        deny('INVESTIGATION_INPUT_CHANGED');
      }
      if (currentSelectionHash !== review.selectionHash) {
        revoked = true;
        deny('INVESTIGATION_INPUT_CHANGED');
      }
    }
    return plan;
  }
  current();
  return Object.freeze({
    revoke() {
      revoked = true;
    },
    summary() {
      return {
        schemaVersion: 'resource-investigation-result/v1',
        sessionId: reviewed.sessionId,
        approvalCount: 1,
        used: { ...used },
        revoked,
      };
    },
    async select(supplied) {
      if (busy) deny('INVESTIGATION_CONCURRENT_ACCESS_DENIED');
      const request = structuredClone(supplied);
      const plan = current();
      const index = plan.operations.findIndex(operation => operation.ref === request.ref);
      if (index < 0) deny('INVESTIGATION_SCOPE_DENIED');
      const operation = plan.operations[index];
      const query = buildSelect(request, operation);
      if (
        used.queries >= reviewed.limits.queries ||
        used.rows + request.maxRows > reviewed.limits.rows ||
        used.bytes >= reviewed.limits.bytes
      )
        deny('INVESTIGATION_BUDGET_EXHAUSTED');
      const config = approveResourceJob(plan, plan.planHash).entries[index].config;
      const event = {
        schemaVersion: 1,
        policy: POLICY,
        sessionId: reviewed.sessionId,
        ref: operation.ref,
        requestHash: crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'),
        queryNumber: used.queries + 1,
      };
      busy = true;
      try {
        recordInvestigationAudit(audit, { ...event, status: 'started' });
        current();
        used.queries++;
        used.rows += request.maxRows;
        const timeoutMs = Math.max(1, Math.min(30000, reviewed.expiresAt - now()));
        const transport =
          services.query || investigationTransport(config, operation, current, reviewed, now);
        const result = await transport({
          query,
          maxRows: request.maxRows,
          config,
          operation,
          timeoutMs,
        });
        current();
        const { output, bytes } = maskedInvestigationResult(
          result,
          request,
          operation,
          config,
          now
        );
        used.bytes += bytes;
        if (used.bytes > reviewed.limits.bytes) deny('INVESTIGATION_BUDGET_EXHAUSTED');
        recordInvestigationAudit(audit, {
          ...event,
          status: 'completed',
          rowCount: output.rowCount,
          bytes,
        });
        return output;
      } catch (error) {
        revoked = true;
        try {
          audit({ ...event, status: 'failed' });
        } catch {
          revoked = true;
        }
        deny(error.code?.startsWith('INVESTIGATION_') ? error.code : 'INVESTIGATION_ACCESS_FAILED');
      } finally {
        busy = false;
      }
    },
  });
}

module.exports = { planResourceInvestigation, openResourceInvestigation, buildSelect };
