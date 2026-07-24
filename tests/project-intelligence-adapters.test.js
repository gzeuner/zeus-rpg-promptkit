'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  discoverProjectIntelligenceCapabilities,
  executeProjectIntelligenceOperation,
  listProjectKnowledgeMcpTools,
  isProjectKnowledgeMcpTool,
  executeProjectKnowledgeMcpTool,
  COMMERCIAL_CAPABILITY_IDS,
  PUBLIC_OPERATIONS,
  MODULE_ID,
  PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS,
} = require('../src/projectIntelligence/adapters');
const { createZeus } = require('../src/api/zeusApi');
const { createCapabilityRegistry } = require('../src/core/capabilityRegistry');
const { listMcpTools } = require('../src/mcp/mcpTools');
const { listMcpResources, readMcpResource } = require('../src/mcp/mcpResources');
const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('../src/mcp/mcpPolicy');
const { runProjectKnowledge } = require('../src/cli/commands/projectKnowledgeCommand');
const { REASON_CODES } = require('../src/projectIntelligence/constants');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

test('adapter catalog exposes public commercial capability ids without paid code', () => {
  assert.equal(MODULE_ID, 'zeus-pro.project-intelligence');
  assert.ok(PUBLIC_OPERATIONS.length >= 10);
  assert.equal(COMMERCIAL_CAPABILITY_IDS.FULL_INDEX, 'zeus-pro.project-intelligence.full-index');
  // No commercial package require paths in adapter sources
  const adapterDir = path.join(ROOT, 'src', 'projectIntelligence', 'adapters');
  for (const file of fs.readdirSync(adapterDir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(adapterDir, file), 'utf8');
    assert.doesNotMatch(src, /zeus-rpg-promptkit-commercial/);
    assert.doesNotMatch(src, /@zeus-pro\/module-sdk/);
    assert.doesNotMatch(src, /require\(['"][^'"]*commercial/);
  }
});

test('discovery reports all operations absent on fresh Community Zeus', () => {
  const zeus = createZeus();
  const discovery = discoverProjectIntelligenceCapabilities(zeus.capabilities);
  assert.equal(discovery.present, false);
  assert.equal(discovery.presentCount, 0);
  assert.equal(discovery.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(discovery.communityEnginesAvailable, true);
  assert.ok(discovery.operations.every(op => op.present === false));
});

test('execute fails closed when commercial capability is absent', async () => {
  const zeus = createZeus();
  const outcome = await executeProjectIntelligenceOperation({
    capabilities: zeus.capabilities,
    operation: 'full-index',
    input: {
      knowledgeRoot: path.resolve(ROOT),
      projectId: 'x',
      trustedRoots: [{ rootId: 'r', path: ROOT }],
    },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(outcome.capabilityId, COMMERCIAL_CAPABILITY_IDS.FULL_INDEX);
  assert.match(outcome.message, /not registered/i);
});

test('execute dispatches when capability is registered (mock present path)', async () => {
  const caps = createCapabilityRegistry();
  caps.register({
    id: COMMERCIAL_CAPABILITY_IDS.STATUS,
    version: 1,
    title: 'mock status',
    description: 'mock',
    category: 'commercial-project-intelligence',
    safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
    availability: { api: true, cli: true, mcp: true },
    execute: async () => ({
      ok: true,
      commercial: true,
      operationsAvailable: true,
      mock: true,
    }),
  });

  const discovery = discoverProjectIntelligenceCapabilities(caps);
  assert.equal(discovery.present, true);
  assert.equal(discovery.presentCount, 1);

  const outcome = await executeProjectIntelligenceOperation({
    capabilities: caps,
    operation: 'status',
    input: {},
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.mock, true);
  assert.equal(outcome.capabilityId, COMMERCIAL_CAPABILITY_IDS.STATUS);
});

test('MCP tool catalog includes project-knowledge tools and safe defaults', () => {
  const tools = listMcpTools();
  const names = new Set(tools.map(t => t.name));
  assert.ok(names.has('zeus.project-knowledge.discover'));
  assert.ok(names.has('zeus.project-knowledge.full-index'));
  assert.ok(names.has('zeus.project-knowledge.query'));
  assert.ok(DEFAULT_MCP_SAFE_TOOL_NAMES.includes('zeus.project-knowledge.discover'));
  assert.ok(DEFAULT_MCP_SAFE_TOOL_NAMES.includes('zeus.project-knowledge.status'));
  assert.equal(DEFAULT_MCP_SAFE_TOOL_NAMES.includes('zeus.project-knowledge.full-index'), false);
  for (const name of PROJECT_KNOWLEDGE_SAFE_MCP_TOOLS) {
    assert.ok(DEFAULT_MCP_SAFE_TOOL_NAMES.includes(name));
  }
  assert.ok(isProjectKnowledgeMcpTool('zeus.project-knowledge.query'));
  assert.equal(isProjectKnowledgeMcpTool('zeus.analyze'), false);
  assert.ok(listProjectKnowledgeMcpTools().length >= 11);
});

test('MCP discover tool reports absent without commercial module', async () => {
  const zeus = createZeus();
  const result = await executeProjectKnowledgeMcpTool(
    'zeus.project-knowledge.discover',
    {},
    { capabilities: zeus.capabilities }
  );
  assert.equal(result.ok, true);
  assert.equal(result.discovery.present, false);

  const query = await executeProjectKnowledgeMcpTool(
    'zeus.project-knowledge.query',
    { query: 'x' },
    { capabilities: zeus.capabilities }
  );
  assert.equal(query.ok, false);
  assert.equal(query.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);
});

test('MCP resource exposes project-intelligence discovery catalog', () => {
  const resources = listMcpResources();
  assert.ok(resources.some(r => r.uri === 'zeus://metadata/project-intelligence.json'));
  const body = readMcpResource('zeus://metadata/project-intelligence.json', {
    capabilities: createZeus().capabilities,
  });
  const parsed = JSON.parse(body.contents[0].text);
  assert.equal(parsed.moduleId, MODULE_ID);
  assert.equal(parsed.discovery.present, false);
  assert.ok(Array.isArray(parsed.publicOperations));
  assert.ok(parsed.publicOperations.some(o => o.operation === 'full-index'));
});

test('CLI project-knowledge discover works and help is available', async () => {
  const help = spawnSync(process.execPath, [CLI, 'project-knowledge', 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /Project Knowledge/);
  assert.match(help.stdout, /discover/);

  const top = spawnSync(process.execPath, [CLI, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(top.status, 0);
  assert.match(top.stdout, /project-knowledge/);

  const caps = createCapabilityRegistry();
  const outcome = await runProjectKnowledge(
    { _: ['discover'], json: true },
    { capabilities: caps }
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.present, false);
});

test('CLI fails closed for absent full-index without loading commercial code', async () => {
  const caps = createCapabilityRegistry();
  const previousExit = process.exitCode;
  process.exitCode = 0;
  try {
    const outcome = await runProjectKnowledge(
      {
        _: ['full-index'],
        'knowledge-root': path.resolve(ROOT),
        'project-id': 'demo',
        'trusted-roots': JSON.stringify([{ rootId: 'r', path: ROOT }]),
        json: true,
      },
      { capabilities: caps }
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reasonCode, REASON_CODES.CAPABILITY_UNAVAILABLE);
    assert.equal(process.exitCode, 3);
  } finally {
    process.exitCode = previousExit;
  }
});
