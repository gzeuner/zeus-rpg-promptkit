'use strict';

const DEFAULT_MCP_SAFE_TOOL_NAMES = Object.freeze([
  'zeus.health',
  'zeus.version',
  'zeus.profiles',
  'zeus.doctor',
  'zeus.help',
  'zeus.agent.bootstrap',
  'zeus.workflow.suggest',
  'zeus.onboarding',
  'zeus.resources',
  'zeus.discover-environment',
  'zeus.analyze',
  'zeus.workflow',
  'zeus.bundle',
  'zeus.search-source',
  'zeus.field-search',
  'zeus.investigation.start',
  'zeus.investigation.focus',
  'zeus.investigation.search',
  'zeus.investigation.generate-prompt',
  'zeus.resolve-object',
  'zeus.inspect-object',
  'zeus.query-table',
  'zeus.query-sql',
  'zeus.impact',
  'zeus.assess-risk',
  'zeus.generate-test',
  'zeus.generate-checklist',
  'zeus.qa',
  'zeus.validate-rpg-sql',
  'zeus.analyses',
  'zeus.fetch-member',
  'zeus.diff',
  'zeus.copy-to-workspace',
  'zeus.joblog',
  'zeus.docs-generate-catalog',
  'zeus.serve',
  'zeus.test-run',
  // ZPI-11: discovery + status only in safe defaults (write/index ops require explicit allow-tools)
  'zeus.project-knowledge.discover',
  'zeus.project-knowledge.status',
]);

/**
 * Comma-separated default safe tool list for docs and operator examples.
 * Keep operator-guide recommended --allow-tools in sync with this (see tests).
 * @returns {string}
 */
const MCP_TOOL_PACKS = Object.freeze({
  default: DEFAULT_MCP_SAFE_TOOL_NAMES,
  'local-evidence': Object.freeze([
    'zeus.health',
    'zeus.version',
    'zeus.profiles',
    'zeus.doctor',
    'zeus.help',
    'zeus.agent.bootstrap',
    'zeus.workflow.suggest',
    'zeus.onboarding',
    'zeus.resources',
    'zeus.discover-environment',
    'zeus.analyze',
    'zeus.workflow',
    'zeus.bundle',
    'zeus.search-source',
    'zeus.field-search',
    'zeus.investigation.start',
    'zeus.investigation.focus',
    'zeus.investigation.search',
    'zeus.investigation.generate-prompt',
    'zeus.impact',
    'zeus.assess-risk',
    'zeus.generate-test',
    'zeus.generate-checklist',
    'zeus.qa',
    'zeus.validate-rpg-sql',
    'zeus.analyses',
  ]),
  'remote-read': Object.freeze([
    'zeus.health',
    'zeus.version',
    'zeus.profiles',
    'zeus.doctor',
    'zeus.help',
    'zeus.agent.bootstrap',
    'zeus.workflow.suggest',
    'zeus.resolve-object',
    'zeus.inspect-object',
    'zeus.query-table',
    'zeus.query-sql',
    'zeus.joblog',
    'zeus.project-knowledge.discover',
    'zeus.project-knowledge.status',
  ]),
  'pi-status': Object.freeze([
    'zeus.health',
    'zeus.version',
    'zeus.doctor',
    'zeus.help',
    'zeus.agent.bootstrap',
    'zeus.project-knowledge.discover',
    'zeus.project-knowledge.status',
  ]),
});

function normalizeToolPackName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function resolveMcpToolPack(name, knownToolNames = null) {
  const normalized = normalizeToolPackName(name);
  const pack = MCP_TOOL_PACKS[normalized];
  if (!pack) {
    throw new Error(
      'Invalid --tool-pack value: unknown pack "' +
        String(name || '').trim() +
        '". Known packs: ' +
        Object.keys(MCP_TOOL_PACKS).join(', ')
    );
  }
  const known = Array.isArray(knownToolNames) ? new Set(knownToolNames) : null;
  const unknown = known ? pack.filter(toolName => !known.has(toolName)) : [];
  if (unknown.length > 0) {
    throw new Error(
      'Invalid --tool-pack value: pack "' +
        normalized +
        '" references unknown tool name(s): ' +
        unknown.join(', ')
    );
  }
  return [...pack];
}

function listMcpToolPacks() {
  return Object.keys(MCP_TOOL_PACKS);
}

function formatDefaultMcpAllowToolsCsv() {
  return DEFAULT_MCP_SAFE_TOOL_NAMES.join(',');
}
module.exports = {
  DEFAULT_MCP_SAFE_TOOL_NAMES,
  MCP_TOOL_PACKS,
  formatDefaultMcpAllowToolsCsv,
  listMcpToolPacks,
  normalizeToolPackName,
  resolveMcpToolPack,
};
