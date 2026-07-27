'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { buildCommandHelpEntry } = require('../src/cli/commandHelp');
const { createMcpServer } = require('../src/mcp/mcpServer');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function readJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function pickHelpFields(help) {
  return {
    command: help.command,
    cliName: help.cliName,
    mcpName: help.mcpName,
    safety: help.safety,
    scope: help.scope,
    example: help.example,
    examples: Array.isArray(help.examples) ? [...help.examples] : [],
    recommendedNextCommands: Array.isArray(help.recommendedNextCommands)
      ? [...help.recommendedNextCommands]
      : [],
  };
}

test('CLI tools list --json exposes canonical help records', () => {
  const payload = readJson(runCli(['tools', 'list', '--json']));

  assert.equal(payload.ok, true);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.mode, 'list');
  assert.ok(Array.isArray(payload.commands));

  const doctor = payload.commands.find(entry => entry.command === 'doctor');
  assert.ok(doctor);
  assert.equal(doctor.cliName, 'doctor');
  assert.equal(doctor.mcpName, 'zeus.doctor');
  assert.ok(doctor.examples.includes('node cli/zeus.js doctor --profile default --show-resolved'));

  const projectKnowledge = payload.commands.find(entry => entry.command === 'project-knowledge');
  assert.ok(projectKnowledge);
  assert.equal(projectKnowledge.mcpName, 'zeus.project-knowledge.discover');
  assert.ok(projectKnowledge.mcpNames.includes('zeus.project-knowledge.status'));
});

test('CLI tools describe doctor matches MCP zeus.help on stable fields', async () => {
  const cli = readJson(runCli(['tools', 'describe', 'doctor', '--json']));
  const server = createMcpServer({ cwd: ROOT });
  const mcp = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'zeus.help', arguments: { command: 'doctor' } },
  });

  assert.equal(mcp.result.isError, false);
  assert.deepEqual(pickHelpFields(cli.help), pickHelpFields(mcp.result.structuredContent.help));
});

test('buildCommandHelpEntry exposes family MCP names for project-knowledge', () => {
  const help = buildCommandHelpEntry('project-knowledge');

  assert.equal(help.command, 'project-knowledge');
  assert.equal(help.mcpName, 'zeus.project-knowledge.discover');
  assert.ok(help.mcpNames.includes('zeus.project-knowledge.status'));
  assert.ok(help.recommendedNextCommands.includes('project-knowledge discover'));
});
