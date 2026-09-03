'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  appendAgentExperience,
  listAgentExperience,
  resolveExperienceLogPath,
} = require('../src/agent/agentExperience');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-agent-experience-'));
}

function scrubbedEnv() {
  const env = { ...process.env };
  delete env.ZEUS_CONNECTION_MASTER_KEY;
  return env;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: scrubbedEnv(),
    encoding: 'utf8',
  });
}

test('agent experience records are local, bounded, and redacted before writing', () => {
  const cwd = createTempWorkspace();
  const result = appendAgentExperience(
    {
      eventId: 'evt-001',
      recordedAt: '2026-09-03T00:00:00Z',
      event: 'failure',
      outcome: 'failed',
      command: 'node cli/zeus.js query-sql --password TOPSECRET --sql "SELECT 1"',
      failureCode: 'RUNTIME_BACKEND',
      goal: 'Check a local query',
      symptom: 'jdbc:db2://user:TOPSECRET@host/db failed',
      workaround: 'Use local evidence first',
      lesson: 'Remote credentials never belong in an agent record',
      nextStep: 'node cli/zeus.js doctor --profile <profile>',
      tags: ['backend', 'backend', 'safe learning'],
    },
    { cwd }
  );

  assert.equal(result.ok, true);
  assert.equal(result.path, '.zeus/agent-experience.jsonl');
  assert.equal(result.event.eventId, 'evt-001');
  assert.doesNotMatch(JSON.stringify(result), /TOPSECRET/);

  const file = path.join(cwd, '.zeus', 'agent-experience.jsonl');
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /TOPSECRET/);
  assert.match(raw, /\[REDACTED\]/);

  const listed = listAgentExperience({ cwd });
  assert.equal(listed.eventCount, 1);
  assert.equal(listed.events[0].failureCode, 'RUNTIME_BACKEND');
  assert.deepEqual(listed.events[0].tags, ['backend', 'safe-learning']);
  assert.equal(listed.summary.recurringFailureCodes[0].failureCode, 'RUNTIME_BACKEND');
  assert.equal(
    listed.summary.lessons[0].lesson,
    'Remote credentials never belong in an agent record'
  );
});

test('agent experience log refuses paths outside the local .zeus scope', () => {
  const cwd = createTempWorkspace();

  assert.throws(
    () => resolveExperienceLogPath({ cwd, out: '../agent-experience.jsonl' }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
  assert.throws(
    () => resolveExperienceLogPath({ cwd, out: path.join(cwd, 'outside.jsonl') }),
    error => error.code === 'PATH_OUTSIDE_WORKSPACE'
  );
  assert.throws(
    () => resolveExperienceLogPath({ cwd, out: '.zeus/agent-experience.txt' }),
    error => error.code === 'TOOL_INVALID_ARGUMENTS'
  );
});

test('CLI agent log records and reads a safe local learning loop', () => {
  const cwd = createTempWorkspace();
  const record = runCli(cwd, [
    'agent',
    'log',
    '--outcome',
    'blocked',
    '--command',
    'node cli/zeus.js fetch --token TOPSECRET',
    '--failure-code',
    'APPROVAL_REQUIRED',
    '--symptom',
    'Remote fetch needs operator approval',
    '--lesson',
    'Show the exact fetch command and wait for approval',
    '--next-step',
    'node cli/zeus.js agent suggest --goal "refresh source" --json',
    '--tag',
    'approval',
    '--json',
  ]);

  assert.equal(record.status, 0, record.stderr);
  assert.doesNotMatch(record.stdout, /TOPSECRET/);
  const recordPayload = JSON.parse(record.stdout);
  assert.equal(recordPayload.event.outcome, 'blocked');

  const list = runCli(cwd, ['agent', 'log', 'list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  const listPayload = JSON.parse(list.stdout);
  assert.equal(listPayload.eventCount, 1);
  assert.equal(listPayload.events[0].failureCode, 'APPROVAL_REQUIRED');
  assert.equal(listPayload.summary.lessons.length, 1);
});
