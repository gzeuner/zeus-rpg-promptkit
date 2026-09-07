'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const {
  DEFAULT_MCP_SAFE_TOOL_NAMES,
  formatDefaultMcpAllowToolsCsv,
} = require('../src/mcp/mcpPolicy');
const { buildAiOrientation } = require('../src/docs/aiOrientation');
const {
  AGENT_RESPONSE_FIELDS,
  AGENT_RESPONSE_CONTRACT_VERSION,
} = require('../src/agent/agentResponseContract');

const ROOT = path.resolve(__dirname, '..');
const OPERATOR_GUIDE = path.join(ROOT, 'docs', 'mcp', 'operator-guide.md');
const SESSION_PROMPT = path.join(ROOT, 'docs', 'ai', 'session-prompt.md');
const AGENT_START_HERE = path.join(ROOT, 'docs', 'ai', 'agent-start-here.md');
const CLI_AGENT_GUIDE = path.join(ROOT, 'docs', 'ai', 'cli-agent-guide.md');
const TOOL_CATALOG = path.join(ROOT, 'docs', 'tool-catalog.md');
const TOOL_CATALOG_JSON = path.join(ROOT, 'docs', 'tool-catalog.json');
const MCP_TOOLS = path.join(ROOT, 'src', 'mcp', 'mcpTools.js');

describe('Track G0: default MCP allowlist docs sync', () => {
  it('formatDefaultMcpAllowToolsCsv matches DEFAULT_MCP_SAFE_TOOL_NAMES', () => {
    assert.equal(formatDefaultMcpAllowToolsCsv(), DEFAULT_MCP_SAFE_TOOL_NAMES.join(','));
    assert.ok(DEFAULT_MCP_SAFE_TOOL_NAMES.length >= 30);
  });

  it('operator-guide recommended --allow-tools includes every default safe tool', () => {
    const text = fs.readFileSync(OPERATOR_GUIDE, 'utf8');
    const csv = formatDefaultMcpAllowToolsCsv();
    assert.ok(
      text.includes(csv),
      'docs/mcp/operator-guide.md must embed the full formatDefaultMcpAllowToolsCsv() string'
    );
    for (const name of DEFAULT_MCP_SAFE_TOOL_NAMES) {
      assert.ok(text.includes(name), `operator-guide missing default tool: ${name}`);
    }
  });

  it('session-prompt makes the CLI-first contract explicit for agents', () => {
    const text = fs.readFileSync(SESSION_PROMPT, 'utf8');
    const requiredSnippets = [
      'The Zeus CLI is the canonical agent surface',
      'node cli/zeus.js agent bootstrap --json',
      'node cli/zeus.js tools list --json',
      'node cli/zeus.js context show --json',
      'discover-environment',
      'Do not invent commands',
      'MCP and the browser/UI are optional',
    ];
    for (const snippet of requiredSnippets) {
      assert.ok(text.includes(snippet), `session-prompt missing: ${snippet}`);
    }
  });

  it('zeus.help overview does not claim S0/S1 local only for the default surface', () => {
    const text = fs.readFileSync(MCP_TOOLS, 'utf8');
    assert.ok(
      !text.includes('S0/S1 local only'),
      'mcpTools.js must not describe default safe surface as S0/S1 local only'
    );
    assert.ok(
      text.includes('selected S2 remote-read'),
      'mcpTools.js help overview should acknowledge default-allowlisted S2 remote-read tools'
    );
  });

  it('shared orientation exposes the stable agent response fields and learning routes', () => {
    const orientation = buildAiOrientation();
    assert.deepEqual(orientation.responseContractFields, AGENT_RESPONSE_FIELDS);
    assert.equal(AGENT_RESPONSE_CONTRACT_VERSION, 1);
    assert.ok(
      orientation.intents
        .find(intent => intent.intent === 'learn')
        .cli.includes('agent log summary --json')
    );
    assert.ok(
      orientation.intents
        .find(intent => intent.intent === 'learn')
        .cli.includes('agent log suggest --goal "<goal>" --json')
    );
    assert.ok(
      orientation.intents
        .find(intent => intent.intent === 'learn')
        .cli.includes('agent evaluate --list --json')
    );
  });

  it('agent contract documentation and generated catalog stay aligned', () => {
    const docs = [
      fs.readFileSync(SESSION_PROMPT, 'utf8'),
      fs.readFileSync(AGENT_START_HERE, 'utf8'),
      fs.readFileSync(CLI_AGENT_GUIDE, 'utf8'),
    ].join('\n');
    for (const field of AGENT_RESPONSE_FIELDS) {
      assert.ok(docs.includes(field), `agent docs missing response field: ${field}`);
    }
    const catalog = fs.readFileSync(TOOL_CATALOG, 'utf8');
    const catalogJson = JSON.parse(fs.readFileSync(TOOL_CATALOG_JSON, 'utf8'));
    const agentRow = catalogJson.commandRows.find(row => row.command === 'agent');
    assert.ok(agentRow, 'generated catalog missing agent command');
    assert.ok(agentRow.subcommands.includes('log summary'));
    assert.ok(agentRow.subcommands.includes('log suggest'));
    assert.ok(agentRow.subcommands.includes('evaluate'));
    assert.ok(agentRow.subcommands.includes('evaluate --list'));
    assert.ok(agentRow.subcommands.includes('feedback'));
    assert.match(catalog, /`agent`/);
    assert.match(catalog, /`log summary`/);
    assert.match(catalog, /`log suggest`/);
    assert.match(catalog, /`agent preflight --goal/);
  });

  it('documented agent entrypoint is CLI-only by default', () => {
    const orientation = buildAiOrientation();
    assert.match(orientation.purpose, /CLI-first/);
    assert.equal(
      orientation.firstPoint.cli,
      'node cli/zeus.js agent preflight --goal "<goal>" --json'
    );
    assert.match(orientation.firstPoint.mcp, /optional adapter/);
    const text = fs.readFileSync(SESSION_PROMPT, 'utf8');
    assert.match(text, /MCP and the browser\/UI are optional/);
    assert.match(text, /node cli\/zeus\.js agent preflight --goal/);
    assert.match(text, /does not require MCP/i);
    assert.doesNotMatch(text, /must (?:use|require) MCP/i);
  });
});
