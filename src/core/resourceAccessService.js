'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  approveResourceJob,
  resourceBindingFingerprint,
  safeOutput,
  loadResourceJob,
} = require('../config/resourceAccessPlan');
const { runReadOnlyDb2Query, escapeSqlLiteral } = require('../db2/readOnlyQueryService');
const { runReadOnlyJdbcQuery } = require('../jdbc/readOnlyJdbcQueryService');
const { buildFetchMemberPlan, executeReadOnlyMemberFetch } = require('../fetch/fetchMemberService');
const { IMPORT_MANIFEST_FILE } = require('../fetch/importManifest');

function deny(code) {
  throw Object.assign(new Error(code), { code });
}

async function executeResourceJob({ plan, approve, services = {}, loadPlan }) {
  const binding = approveResourceJob(plan, approve);
  if (plan.jobFileHash && typeof loadPlan !== 'function')
    deny('RESOURCE_INPUT_REVALIDATION_REQUIRED');
  const inputFingerprint = resourceBindingFingerprint(plan);
  const verifyCurrentInputs = () => {
    if (typeof loadPlan !== 'function') return;
    let current;
    try {
      current = loadPlan();
    } catch {
      deny('RESOURCE_INPUT_REVALIDATION_FAILED');
    }
    current = current?.plan || current;
    if (!current || current.planHash !== plan.planHash) deny('RESOURCE_PLAN_CHANGED');
    let currentFingerprint;
    try {
      currentFingerprint = resourceBindingFingerprint(current);
    } catch {
      deny('RESOURCE_PLAN_CHANGED');
    }
    if (currentFingerprint !== inputFingerprint) deny('RESOURCE_PLAN_CHANGED');
  };
  const fetchPlans = new Map();
  const destinations = new Set();
  for (const [index, operation] of plan.operations.entries()) {
    if (operation.kind !== 'sourceCode') continue;
    const config = binding.entries[index].config;
    const scope = operation.scope;
    if (!config.host) deny('RESOURCE_CONNECTION_INCOMPLETE');
    safeOutput(binding.cwd, scope.outputRoot);
    const planned = scope.sourceFiles.map(sourceFile =>
      buildFetchMemberPlan({
        cwd: binding.cwd,
        profile: plan.profile,
        host: config.host,
        sourceLib: scope.library,
        sourceFile,
        members: scope.members,
        outputRoot: scope.outputRoot,
      })
    );
    for (const fetchPlan of planned) {
      for (const file of fetchPlan.output.files) {
        safeOutput(binding.cwd, file);
        if (destinations.has(file) || fs.existsSync(path.join(binding.cwd, file)))
          deny('RESOURCE_OUTPUT_EXISTS');
        destinations.add(file);
      }
      const manifestFile = path.join(
        scope.outputRoot,
        fetchPlan.scope.sourceFile,
        IMPORT_MANIFEST_FILE
      );
      safeOutput(binding.cwd, manifestFile);
      if (destinations.has(manifestFile) || fs.existsSync(path.join(binding.cwd, manifestFile)))
        deny('RESOURCE_OUTPUT_EXISTS');
      destinations.add(manifestFile);
    }
    fetchPlans.set(index, planned);
  }
  const evidence = [];
  for (const [index, operation] of plan.operations.entries()) {
    const config = binding.entries[index].config;
    const origin = {
      ref: operation.ref,
      kind: operation.kind,
      system: operation.system,
      connection: operation.connection,
      targetFingerprint: operation.targetFingerprint,
      scope: operation.scope,
      capturedAt: new Date().toISOString(),
    };
    const scope = operation.scope;
    try {
      if (operation.kind === 'sourceCode') {
        for (const fetchPlan of fetchPlans.get(index)) {
          for (const file of fetchPlan.output.files) safeOutput(binding.cwd, file);
          verifyCurrentInputs();
          const result = executeReadOnlyMemberFetch({
            cwd: binding.cwd,
            plan: fetchPlan,
            host: config.host,
            user: config.user,
            password: config.password,
            confirmPlanId: fetchPlan.planId,
            manifestSubdirectory: fetchPlan.scope.sourceFile,
            ...(services.exporter ? { exporter: services.exporter } : {}),
          });
          if (result.failures.length) deny('RESOURCE_SOURCE_FETCH_FAILED');
          evidence.push({
            ...origin,
            sourceFile: fetchPlan.scope.sourceFile,
            fetched: result.fetched,
          });
        }
        continue;
      }
      const query =
        services.query ||
        (operation.connection
          ? ({ query, maxRows }) =>
              runReadOnlyJdbcQuery({
                jdbcConfig: { ...config, probeSql: 'SELECT 1 AS HEALTHCHECK' },
                query,
                maxRows,
              })
          : ({ query, maxRows }) =>
              runReadOnlyDb2Query({
                dbConfig: config,
                query,
                maxRows,
                runtime: { timeoutMs: 30000 },
              }));
      const queries = [];
      if (operation.kind === 'objects') {
        for (const library of scope.libraries)
          for (const type of scope.objectTypes)
            for (const object of scope.objects)
              queries.push(
                `SELECT OBJNAME, OBJLIB, OBJTYPE FROM TABLE(QSYS2.OBJECT_STATISTICS(${escapeSqlLiteral(library)}, ${escapeSqlLiteral(type)}, ${escapeSqlLiteral(object)})) AS X`
              );
      } else {
        for (const schema of scope.schemas)
          for (const table of scope.tables) {
            if (operation.kind === 'metadata')
              queries.push(
                `SELECT COLUMN_NAME, DATA_TYPE, ${operation.connection ? 'CHARACTER_MAXIMUM_LENGTH AS LENGTH' : 'LENGTH'}, NUMERIC_SCALE, ORDINAL_POSITION FROM ${operation.connection ? 'INFORMATION_SCHEMA.COLUMNS' : 'QSYS2.SYSCOLUMNS'} WHERE TABLE_SCHEMA = ${escapeSqlLiteral(schema)} AND TABLE_NAME = ${escapeSqlLiteral(table)} ORDER BY ORDINAL_POSITION`
              );
            else
              queries.push(
                `SELECT ${scope.columns.map(column => `"${column}"`).join(', ')} FROM "${schema}"."${table}"`
              );
          }
      }
      for (const sql of queries) {
        verifyCurrentInputs();
        const result = await query({ query: sql, maxRows: scope.maxRows, config, operation });
        const rows = (result.rows || [])
          .slice(0, scope.maxRows)
          .map(row =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                scope.maskColumns?.some(column => column.toUpperCase() === key.toUpperCase())
                  ? '[MASKED]'
                  : value,
              ])
            )
          );
        const sensitive = [config.user, config.password, config.url].filter(Boolean);
        const output = {
          ...origin,
          rows,
          columns: result.columns || [],
          rowCount: rows.length,
          truncated: (result.rows || []).length >= scope.maxRows,
        };
        if (sensitive.some(value => JSON.stringify(output).includes(value)))
          deny('RESOURCE_RESULT_DISCLOSURE_DENIED');
        evidence.push(output);
      }
    } catch (error) {
      deny(error.code?.startsWith('RESOURCE_') ? error.code : 'RESOURCE_ACCESS_FAILED');
    }
  }
  return {
    schemaVersion: 1,
    kind: 'resource-job-result',
    planHash: plan.planHash,
    status: 'completed',
    remoteMutation: false,
    localArtifactWrite: plan.localArtifactWrite,
    evidence,
  };
}

async function confirmAndExecuteResourceJob({
  args,
  confirm,
  services = {},
  loader = loadResourceJob,
}) {
  if (typeof confirm !== 'function') deny('RESOURCE_PLAN_APPROVAL_REQUIRED');
  const reviewed = loader(args);
  const reviewedFingerprint = resourceBindingFingerprint(reviewed.plan);
  if ((await confirm(reviewed.plan)) !== true) deny('RESOURCE_PLAN_APPROVAL_DECLINED');
  const current = loader(args);
  if (
    current.plan.planHash !== reviewed.plan.planHash ||
    resourceBindingFingerprint(current.plan) !== reviewedFingerprint
  )
    deny('RESOURCE_PLAN_APPROVAL_REQUIRED');
  return executeResourceJob({
    plan: current.plan,
    approve: reviewed.plan.planHash,
    services,
    loadPlan: () => loader(args).plan,
  });
}

module.exports = { loadResourceJob, executeResourceJob, confirmAndExecuteResourceJob };
