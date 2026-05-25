const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { listMcpTools } = require('../src/mcp/mcpTools');
const zeusApi = require('../src/api/zeusApi');

test('mcp tool surface does not expose knowledge-lab or legacy knowledge tools', () => {
  const tools = listMcpTools();
  const names = tools.map((tool) => String(tool && tool.name ? tool.name : ''));

  assert.equal(names.includes('zeus.knowledge'), false);
  assert.equal(names.some((name) => /knowledge-lab|local-ai-classifier/i.test(name)), false);
});

test('zeus api exports no internal knowledge-lab runtime surface', () => {
  const exportNames = Object.keys(zeusApi);
  assert.equal(exportNames.some((name) => /knowledge-lab|local-ai-classifier/i.test(name)), false);
});

test('public knowledge-claims guard passes', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'check-public-knowledge-claims.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout || 'guard script failed');
});
