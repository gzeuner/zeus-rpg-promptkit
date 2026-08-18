'use strict';

const { createJsonOutput } = require('../helpers/jsonOutput');
const {
  executeProjectIntelligenceOperation,
  discoverProjectIntelligenceCapabilities,
  PUBLIC_OPERATIONS,
} = require('../../projectIntelligence/adapters');
const { createKnowledgeFirstService } = require('../../projectIntelligence/knowledgeFirst');

function printHelp() {
  console.log('Project Knowledge (Project Intelligence) commands:');
  console.log(
    '  zeus project-knowledge discover|list|help [--json]  # capability present/absent discovery'
  );
  console.log(
    '  zeus project-knowledge status [--json]              # commercial module status (if registered)'
  );
  console.log('  zeus project-knowledge inspect-policy --trusted-roots <json> [--json]');
  console.log(
    '  zeus project-knowledge create-project --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--display-name <name>] [--json]'
  );
  console.log(
    '  zeus project-knowledge full-index --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--json]'
  );
  console.log(
    '  zeus project-knowledge incremental-update --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--json]'
  );
  console.log(
    '  zeus project-knowledge query --knowledge-root <abs> --project-id <id> --trusted-roots <json> --query <text> [--limit <n>] [--json]'
  );
  console.log(
    '  zeus project-knowledge impact-analysis --knowledge-root <abs> --project-id <id> --trusted-roots <json> --query <text> [--expand-hops <n>] [--json]'
  );
  console.log(
    '  zeus project-knowledge build-context-package --knowledge-root <abs> --project-id <id> --trusted-roots <json> --query <text> [--token-budget <n>] [--json]'
  );
  console.log(
    '  zeus project-knowledge inspect-snapshot --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--snapshot-id <id>] [--json]'
  );
  console.log(
    '  zeus project-knowledge verify-integrity --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--json]'
  );
  console.log(
    '  zeus project-knowledge check --knowledge-root <abs> --project-id <id> [--trusted-roots <json>] [--json]  # Community-neutral, read-only'
  );
  console.log(
    '  zeus project-knowledge sync --knowledge-root <abs> --project-id <id> --trusted-roots <json> [--mode full|incremental] [--json]  # explicit write'
  );
  console.log(
    '  zeus project-knowledge lookup --knowledge-root <abs> --project-id <id> --query <text> [--trusted-roots <json>] [--limit <n>] [--json]  # Community-neutral, read-only'
  );
  console.log(
    '  zeus project-knowledge locate --knowledge-root <abs> --project-id <id> [--source-unit-id <id>] [--trusted-root-id <id>] [--relative-path <path>] [--system-alias <name>] [--source-lib <lib>] [--source-file <file>] [--member <member>] [--member-path <path>] [--json]  # Community-neutral, read-only'
  );
  console.log('');
  console.log('Notes:');
  console.log(
    '  - Thin Community adapter: operations execute only when the integrated module is explicitly registered.'
  );
  console.log(
    '  - Module load is explicit: --built-in-modules <list|professional|enterprise> uses the unified package; --commercial-module remains an external extension hook.'
  );
  console.log(
    '  - Entitlement files (commercial package): ZEUS_LICENSE_* env or profile.commercial.licenseDocumentPath / publicKeyPath.'
  );
  console.log(
    '  - --trusted-roots is JSON array of {rootId, path} with absolute directory paths only.'
  );
  console.log(
    '  - No implicit workspace harvest. Community engines remain usable via API without commercial ops.'
  );
  console.log(`  - Canonical operations: ${PUBLIC_OPERATIONS.map(o => o.operation).join(', ')}`);
}

function parseTrustedRoots(raw) {
  if (raw === undefined || raw === null || raw === true) return undefined;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    throw new Error('--trusted-roots must be valid JSON array of {rootId, path}.');
  }
}

function buildInputFromArgs(args) {
  const input = {};
  if (args['knowledge-root'] != null && args['knowledge-root'] !== true) {
    input.knowledgeRoot = String(args['knowledge-root']);
  }
  if (args['project-id'] != null && args['project-id'] !== true) {
    input.projectId = String(args['project-id']);
  }
  if (args['display-name'] != null && args['display-name'] !== true) {
    input.displayName = String(args['display-name']);
  }
  if (args.query != null && args.query !== true) {
    input.query = String(args.query);
  }
  if (args.limit != null && args.limit !== true) {
    input.limit = Number(args.limit);
  }
  if (args['token-budget'] != null && args['token-budget'] !== true) {
    input.tokenBudget = Number(args['token-budget']);
  }
  if (args['snapshot-id'] != null && args['snapshot-id'] !== true) {
    input.snapshotId = String(args['snapshot-id']);
  }
  if (args.mode != null && args.mode !== true) input.mode = String(args.mode);
  if (args['expand-hops'] != null && args['expand-hops'] !== true) {
    input.expandHops = Number(args['expand-hops']);
  }
  const locateArgs = Object.freeze({
    'source-unit-id': 'sourceUnitId',
    'trusted-root-id': 'trustedRootId',
    'relative-path': 'relativePath',
    'system-alias': 'systemAlias',
    'source-lib': 'sourceLib',
    'source-file': 'sourceFile',
    member: 'member',
    'member-path': 'memberPath',
    'source-type': 'sourceType',
  });
  for (const [argument, property] of Object.entries(locateArgs)) {
    if (args[argument] != null && args[argument] !== true) input[property] = String(args[argument]);
  }
  if (args['include-bodies'] != null) {
    input.includeBodies = !(
      args['include-bodies'] === false || String(args['include-bodies']).toLowerCase() === 'false'
    );
  }
  const roots = parseTrustedRoots(args['trusted-roots']);
  if (roots !== undefined) input.trustedRoots = roots;
  return input;
}

async function resolveHost(args = {}, dependencies = {}) {
  if (dependencies.capabilities || (dependencies.zeus && dependencies.zeus.capabilities)) {
    return {
      capabilities: dependencies.capabilities || dependencies.zeus.capabilities,
      zeus: dependencies.zeus || null,
      commercial: dependencies.commercial || { ok: true, loaded: false },
    };
  }
  if (dependencies.createHostZeus) {
    return dependencies.createHostZeus({ args, env: dependencies.env });
  }
  const { createHostZeus } = require('../../modules/commercialModuleLoader');
  const host = await createHostZeus({ args, env: dependencies.env || process.env });
  return {
    capabilities: host.zeus.capabilities,
    zeus: host.zeus,
    commercial: host.commercial,
  };
}

function printHuman(outcome) {
  if (outcome.operation === 'discover' && outcome.ok) {
    const d = outcome.result;
    console.log(`Module: ${d.moduleId}`);
    console.log(`Present: ${d.present ? 'yes' : 'no'} (${d.presentCount}/${d.totalOperations})`);
    console.log(d.message);
    for (const op of d.operations) {
      console.log(`  - ${op.operation}: ${op.present ? 'present' : 'absent'} (${op.capabilityId})`);
    }
    return;
  }
  if (!outcome.ok) {
    console.error(`[${outcome.reasonCode || 'ERROR'}] ${outcome.message || 'operation failed'}`);
    if (outcome.capabilityId) console.error(`capability: ${outcome.capabilityId}`);
    return;
  }
  console.log(JSON.stringify(outcome.result, null, 2));
}

/**
 * @param {object} args parsed CLI args
 * @param {object} [dependencies] inject capabilities/zeus for tests
 */
async function runProjectKnowledge(args = {}, dependencies = {}) {
  const positional = Array.isArray(args._) ? args._ : [];
  const operation = String(positional[0] || 'help')
    .trim()
    .toLowerCase();

  if (!operation || operation === 'help' || args.help === true || args.h === true) {
    printHelp();
    return { ok: true, operation: 'help' };
  }

  const json = createJsonOutput(args);

  if (
    operation === 'check' ||
    operation === 'sync' ||
    operation === 'lookup' ||
    operation === 'locate'
  ) {
    let input;
    try {
      input = buildInputFromArgs(args);
      const service = createKnowledgeFirstService(input);
      const outcome =
        operation === 'check'
          ? service.check()
          : operation === 'sync'
            ? service.sync({ mode: input.mode })
            : operation === 'lookup'
              ? service.lookup({ query: input.query, limit: input.limit })
              : service.locate(input);
      if (json.isJsonMode) json.print(outcome);
      else printHuman(outcome);
      if (!outcome.ok) process.exitCode = 2;
      return outcome;
    } catch (err) {
      const outcome = {
        ok: false,
        operation,
        service: 'zeus.community.knowledge-first',
        reasonCode: (err && err.reasonCode) || 'ZPI.INTERNAL_ERROR',
        message: 'Knowledge-First operation failed',
      };
      if (json.isJsonMode) json.print(outcome);
      else printHuman(outcome);
      process.exitCode = 2;
      return outcome;
    }
  }

  const host = await resolveHost(args, dependencies);
  const capabilities = host.capabilities;

  if (operation === 'discover' || operation === 'list') {
    const discovery = discoverProjectIntelligenceCapabilities(capabilities);
    const outcome = {
      ok: true,
      operation: 'discover',
      commercial: true,
      result: discovery,
      commercialLoader: {
        loaded: Boolean(host.commercial && host.commercial.loaded),
        ok: host.commercial ? host.commercial.ok !== false : true,
        reasonCode: (host.commercial && host.commercial.reasonCode) || null,
      },
    };
    if (json.isJsonMode) {
      json.print(outcome);
    } else {
      printHuman(outcome);
    }
    // discover always exits 0; present/absent is data
    return outcome;
  }

  let input;
  try {
    input = buildInputFromArgs(args);
  } catch (err) {
    const outcome = {
      ok: false,
      operation,
      commercial: true,
      reasonCode: 'POLICY_DENIED',
      message: err.message || String(err),
    };
    if (json.isJsonMode) {
      json.print(outcome);
    } else {
      printHuman(outcome);
    }
    process.exitCode = 2;
    return outcome;
  }

  const outcome = await executeProjectIntelligenceOperation({
    capabilities,
    operation,
    input,
    context: dependencies.context || {},
  });

  if (json.isJsonMode) {
    json.print(outcome);
  } else {
    printHuman(outcome);
  }

  if (!outcome.ok) {
    // 3 = capability absent / entitlement; 2 = usage/policy
    const code = String(outcome.reasonCode || '');
    process.exitCode =
      code.includes('CAPABILITY_UNAVAILABLE') ||
      code.includes('ENTITLEMENT_REQUIRED') ||
      code.includes('ENTITLEMENT_EXPIRED') ||
      code.includes('OPERATION_UNAVAILABLE')
        ? 3
        : 2;
  }
  return outcome;
}

module.exports = {
  runProjectKnowledge,
  printHelp,
  buildInputFromArgs,
  parseTrustedRoots,
  resolveHost,
};
