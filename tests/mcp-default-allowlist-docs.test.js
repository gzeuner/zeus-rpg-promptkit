'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

const {
  DEFAULT_MCP_SAFE_TOOL_NAMES,
  formatDefaultMcpAllowToolsCsv,
} = require('../src/mcp/mcpPolicy');

const ROOT = path.resolve(__dirname, '..');
const OPERATOR_GUIDE = path.join(ROOT, 'docs', 'mcp', 'operator-guide.md');
const SESSION_PROMPT = path.join(ROOT, 'docs', 'ai', 'session-prompt.md');
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
});
