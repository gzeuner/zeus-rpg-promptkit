'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

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

test('CLI agent bootstrap exposes the canonical CLI contract', () => {
  const payload = readJson(runCli(['agent', 'bootstrap', '--json']));

  assert.equal(payload.ok, true);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.transport, 'cli');
  assert.equal(payload.canonicalSurface, 'cli');
  assert.equal(payload.mcpOptional, true);
  assert.ok(payload.startHere.includes('node cli/zeus.js tools list --json'));
  assert.ok(payload.startHere.includes('node cli/zeus.js agent log list --json'));
  assert.ok(payload.intentMap.some(entry => entry.commands.includes('impact')));
  assert.ok(payload.failurePlaybook);
  assert.ok(Array.isArray(payload.failurePlaybook.entries));
  assert.equal(payload.experienceLog.storage, '.zeus/agent-experience.jsonl');
  assert.match(payload.experienceLog.record, /agent log --outcome/);
});

test('CLI agent preflight gives a goal-based local orientation without executing work', () => {
  const payload = readJson(
    runCli(['agent', 'preflight', '--goal', 'Understand a local ORDERPGM program', '--json'])
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.operation, 'preflight');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.executionStarted, false);
  assert.equal(payload.goal, 'Understand a local ORDERPGM program');
  assert.ok(payload.context);
  assert.ok(payload.profileInventory);
  assert.ok(payload.experience.summary);
  assert.ok(payload.suggestion);
  assert.ok(payload.nextCommands.some(command => command.includes('agent prompt')));
  assert.equal(payload.safety.level, 'S0');
  assert.doesNotMatch(JSON.stringify(payload), /password\s*[:=]\s*[^()\s,}]+/i);
});

test('CLI agent prompt creates a copy-ready prompt from preflight metadata', () => {
  const payload = readJson(
    runCli([
      'agent',
      'prompt',
      '--goal',
      'Review dependencies for ORDERPGM',
      '--environment',
      'local-test',
      '--json',
    ])
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.operation, 'prompt');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.executionStarted, false);
  assert.match(payload.prompt, /Review dependencies for ORDERPGM/);
  assert.match(payload.prompt, /Preflight status:/);
  assert.match(payload.prompt, /Recommended next command:/);
  assert.doesNotMatch(payload.prompt, /\[INSERT USER GOAL HERE\]/);
  assert.ok(payload.metadata.nextCommands.length > 0);
});

test('CLI agent prompt requires an explicit goal', () => {
  const result = runCli(['agent', 'prompt', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /goal/i);
});

test('CLI agent suggestion maps MCP planning metadata to executable CLI commands', () => {
  const payload = readJson(
    runCli([
      'agent',
      'suggest',
      '--goal',
      'Assess dependency risk for ORDERPGM',
      '--profile',
      'dev',
      '--program',
      'ORDERPGM',
      '--source',
      './rpg_sources',
      '--out',
      './output',
      '--json',
    ])
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.transport, 'cli');
  assert.equal(payload.plan, 'risk-review');
  assert.ok(payload.steps.length >= 5);
  assert.ok(payload.steps.every(step => step.command.startsWith('node cli/zeus.js')));
  assert.ok(payload.steps.some(step => /analyze/.test(step.command)));
  assert.ok(payload.steps.some(step => /impact/.test(step.command)));
  assert.ok(payload.steps.every(step => !/^node cli\/zeus\.js .*zeus\./.test(step.command)));
});

test('CLI agent suggestion requires an explicit goal', () => {
  const result = runCli(['agent', 'suggest', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /goal/i);
});

test('CLI agent suggestion keeps a local goal free of profile-only steps', () => {
  const result = spawnSync(
    process.execPath,
    [CLI, 'agent', 'suggest', '--goal', 'understand a local program', '--json'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const commands = payload.steps.map(step => step.command);
  assert.ok(commands.some(command => command.includes('analyze')));
  assert.ok(commands.every(command => !command.includes(' doctor ')));
  assert.ok(commands.every(command => !command.includes(' resources ')));
  assert.match(payload.notes.join(' '), /profile-dependent remote steps were omitted/i);
});
