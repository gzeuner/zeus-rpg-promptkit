'use strict';

/**
 * Stable, agent-facing failure recovery codes for Zeus MCP.
 * Codes are intentional and must not churn without a schemaVersion bump.
 */

const FAILURE_ENTRIES = Object.freeze([
  Object.freeze({
    code: 'POLICY_REFUSED',
    summary: 'Tool is not on the current MCP allowlist or policy denied the call.',
    do: [
      'Call tools/list or zeus.help to see the live allowlist.',
      'Ask the operator to allowlist the tool if it is required and justified.',
      'Prefer a default-allowlisted alternative (analyze, search-source, impact, doctor).',
    ],
    dont: [
      'Do not invent tool names or call tools outside the allowlist.',
      'Do not retry the same denied tool in a loop.',
    ],
    nextTools: ['zeus.help', 'zeus.agent.bootstrap', 'zeus.doctor'],
  }),
  Object.freeze({
    code: 'MISSING_PROFILE',
    summary: 'A required runtime profile is missing or empty.',
    do: [
      'Call zeus.profiles to list available profiles.',
      'Ask the operator which profile to use.',
      'Pass profile explicitly on subsequent calls.',
    ],
    dont: [
      'Do not guess profile names.',
      'Do not proceed with remote or analysis tools without a profile when required.',
    ],
    nextTools: ['zeus.profiles', 'zeus.doctor', 'zeus.onboarding'],
  }),
  Object.freeze({
    code: 'ANALYZE_REQUIRED',
    summary: 'Downstream tool needs existing canonical-analysis artifacts that are absent.',
    do: [
      'Run zeus.analyze (with source when a full run is needed) for the target program.',
      'Confirm artifacts exist via zeus.analyses or the analyze output directory.',
      'Retry the dependent tool (impact, assess-risk, investigation.*, generate-test).',
    ],
    dont: [
      'Do not invent analysis results.',
      'Do not skip analyze when the dependent tool requires graph/artifacts.',
    ],
    nextTools: ['zeus.analyze', 'zeus.analyses', 'zeus.workflow.suggest'],
  }),
  Object.freeze({
    code: 'UNRESOLVED_REFS',
    summary: 'Symbols, bindings, or references could not be resolved from evidence.',
    do: [
      'Search local source (zeus.search-source / field-search) for the unresolved name.',
      'Widen or re-run analyze with the correct source root.',
      'Report unresolved items explicitly; do not invent resolutions.',
    ],
    dont: [
      'Do not invent call targets, tables, or procedure names.',
      'Do not treat unresolved refs as confirmed dependencies.',
    ],
    nextTools: ['zeus.search-source', 'zeus.field-search', 'zeus.analyze', 'zeus.impact'],
  }),
  Object.freeze({
    code: 'PI_ABSENT',
    summary: 'Commercial Project Intelligence module is not present or not allowlisted.',
    do: [
      'Call zeus.project-knowledge.discover / status once to confirm absence.',
      'Fall back to Community tools: analyze, search-source, field-search, impact, bundle.',
      'Do not thrash missing project-knowledge index/query/write ops.',
    ],
    dont: [
      'Do not retry project-knowledge query/index/write in a loop when absent.',
      'Do not claim commercial PI capabilities when discovery says absent.',
    ],
    nextTools: [
      'zeus.project-knowledge.discover',
      'zeus.analyze',
      'zeus.search-source',
      'zeus.impact',
    ],
  }),
  Object.freeze({
    code: 'INVALID_ARGS',
    summary: 'Tool arguments failed schema validation (required, type, enum, length).',
    do: [
      'Re-read the tool inputSchema from tools/list.',
      'Fix missing required fields, types, and enums; use examples when provided.',
      'Retry once with corrected arguments.',
    ],
    dont: [
      'Do not send additionalProperties outside the schema.',
      'Do not retry with the same invalid payload.',
    ],
    nextTools: ['zeus.help', 'zeus.agent.bootstrap'],
  }),
  Object.freeze({
    code: 'RUNTIME_BACKEND',
    summary: 'Underlying runtime, DB2, or process backend failed (connection, timeout, crash).',
    do: [
      'Run zeus.doctor for the profile to surface connection/env issues.',
      'Report the backend error to the operator; do not mask it.',
      'Prefer local-only tools until the backend is healthy.',
    ],
    dont: [
      'Do not hammer remote tools after repeated backend failures.',
      'Do not invent successful remote results.',
    ],
    nextTools: ['zeus.doctor', 'zeus.profiles', 'zeus.resources'],
  }),
  Object.freeze({
    code: 'PATH_OUTSIDE_WORKSPACE',
    summary: 'Requested path is outside the allowed workspace containment boundary.',
    do: [
      'Use paths under the configured workspace / source roots only.',
      'Ask the operator for an in-workspace path if needed.',
      'Re-run with a contained path.',
    ],
    dont: [
      'Do not attempt path traversal or absolute paths outside policy.',
      'Do not disable containment checks.',
    ],
    nextTools: ['zeus.resources', 'zeus.doctor'],
  }),
  Object.freeze({
    code: 'APPROVAL_REQUIRED',
    summary: 'Tool or step requires explicit operator approval (S3/S4, mutations, PI query).',
    do: [
      'Show the exact tool name and arguments to the operator.',
      'Wait for explicit approval before calling.',
      'Use a lower-safety alternative when approval is not given.',
    ],
    dont: [
      'Do not call approvalRequired steps without confirmation.',
      'Do not treat silence as approval.',
    ],
    nextTools: ['zeus.workflow.suggest', 'zeus.help', 'zeus.agent.bootstrap'],
  }),
  Object.freeze({
    code: 'TOOL_NOT_ALLOWED',
    summary: 'Named tool is unknown or not registered on the current MCP server surface.',
    do: [
      'Use tools/list or zeus.help; never invent names.',
      'Map the intent to a known default-allowlisted tool via workflow.suggest.',
    ],
    dont: [
      'Do not guess tool names from docs alone when tools/list is available.',
      'Do not retry unknown tool names.',
    ],
    nextTools: ['zeus.help', 'zeus.workflow.suggest', 'zeus.agent.bootstrap'],
  }),
]);

const CODE_SET = Object.freeze(new Set(FAILURE_ENTRIES.map(e => e.code)));

function listFailureCodes() {
  return FAILURE_ENTRIES.map(e => e.code);
}

/**
 * @param {{ compact?: boolean }} [options]
 * @returns {object}
 */
function buildAgentFailurePlaybook(options = {}) {
  const compact = Boolean(options && options.compact);
  const entries = FAILURE_ENTRIES.map(entry => {
    if (compact) {
      return {
        code: entry.code,
        summary: entry.summary,
        nextTools: [...entry.nextTools],
      };
    }
    return {
      code: entry.code,
      summary: entry.summary,
      do: [...entry.do],
      dont: [...entry.dont],
      nextTools: [...entry.nextTools],
    };
  });

  return {
    schemaVersion: 1,
    kind: 'zeus.agent-failure-playbook',
    codes: listFailureCodes(),
    entries,
    resource: 'zeus://metadata/agent-failure-playbook.json',
    markdown: 'zeus://docs/ai/agent-failure-playbook.md',
  };
}

function getFailureEntry(code) {
  const normalized = String(code || '')
    .trim()
    .toUpperCase();
  return FAILURE_ENTRIES.find(e => e.code === normalized) || null;
}

function isKnownFailureCode(code) {
  return CODE_SET.has(
    String(code || '')
      .trim()
      .toUpperCase()
  );
}

module.exports = {
  FAILURE_ENTRIES,
  listFailureCodes,
  buildAgentFailurePlaybook,
  getFailureEntry,
  isKnownFailureCode,
};
