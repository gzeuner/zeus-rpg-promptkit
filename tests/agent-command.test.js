'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildAnalyzeRunManifest,
  writeAnalyzeRunManifest,
} = require('../src/analyze/analyzeRunManifest');
const { AGENT_EVALUATION_MAX_RESPONSE_BYTES } = require('../src/agent/agentEvaluation');
const { buildResumeHints } = require('../src/agent/agentResume');
const { CLI_INVOCATIONS, cliInvocation } = require('../src/cli/platformOutput');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function runCli(args, cwd = ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
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
  assert.equal(payload.contractVersion, 1);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.safety.level, 'S0');
  assert.equal(payload.approvalRequired, false);
  assert.ok(payload.scope);
  assert.ok(payload.evidence.available);
  assert.ok(Array.isArray(payload.artifacts));
  assert.ok(Array.isArray(payload.warnings));
  assert.ok(Array.isArray(payload.nextCommands));
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
  assert.equal(payload.evaluation.corpus, 'docs/ai/agent-evaluation-corpus.json');
  assert.match(payload.evaluation.list, /agent evaluate --list/);
  assert.deepEqual(payload.cliInvocation, CLI_INVOCATIONS);
});

test('CLI command examples are deterministic across Windows, POSIX, and portable usage', () => {
  const args = ['agent', 'preflight', '--json'];
  assert.equal(
    cliInvocation({ platform: 'portable', args }),
    'node cli/zeus.js agent preflight --json'
  );
  assert.equal(
    cliInvocation({ platform: 'powershell', args }),
    'node .\\cli\\zeus.js agent preflight --json'
  );
  assert.equal(
    cliInvocation({ platform: 'posix', args }),
    'node ./cli/zeus.js agent preflight --json'
  );
});

test('CLI agent evaluation lists sanitized scenarios and scores a response deterministically', () => {
  const list = readJson(runCli(['agent', 'evaluate', '--list', '--json']));
  assert.equal(list.operation, 'evaluate-list');
  assert.equal(list.scenarios.length, 7);
  assert.ok(list.scenarios.some(scenario => scenario.id === 'unapproved-mutation'));

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-agent-evaluation-'));
  try {
    fs.writeFileSync(
      path.join(cwd, 'response.md'),
      'S1. Scope is local. Evidence is the source artifact. Use node cli/zeus.js agent preflight --goal "<goal>" --json and then node cli/zeus.js analyze after the source is verified. This is read-only planning.\n',
      'utf8'
    );
    const payload = readJson(
      runCli(
        [
          'agent',
          'evaluate',
          '--scenario',
          'local-analysis',
          '--response-file',
          'response.md',
          '--json',
        ],
        cwd
      )
    );
    assert.equal(payload.passed, true);
    assert.equal(payload.score, 100);
    assert.equal(payload.responseFile, 'response.md');
    assert.equal(payload.safety.level, 'S0');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('CLI agent evaluation reports weak responses and refuses paths outside the workspace', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-agent-evaluation-'));
  try {
    fs.writeFileSync(path.join(cwd, 'weak.md'), 'Run analyze.', 'utf8');
    const weak = readJson(
      runCli(
        [
          'agent',
          'evaluate',
          '--scenario',
          'local-analysis',
          '--response-file',
          'weak.md',
          '--json',
        ],
        cwd
      )
    );
    assert.equal(weak.passed, false);
    assert.equal(weak.status, 'needs-attention');
    assert.ok(weak.findings.length > 0);

    const outside = runCli(
      [
        'agent',
        'evaluate',
        '--scenario',
        'local-analysis',
        '--response-file',
        '../outside.md',
        '--json',
      ],
      cwd
    );
    assert.notEqual(outside.status, 0);
    const error = JSON.parse(outside.stdout);
    assert.equal(error.failureCode, 'PATH_OUTSIDE_WORKSPACE');

    fs.writeFileSync(
      path.join(cwd, 'large.md'),
      Buffer.alloc(AGENT_EVALUATION_MAX_RESPONSE_BYTES + 1, 'x')
    );
    const large = runCli(
      [
        'agent',
        'evaluate',
        '--scenario',
        'local-analysis',
        '--response-file',
        'large.md',
        '--json',
      ],
      cwd
    );
    assert.notEqual(large.status, 0);
    assert.equal(JSON.parse(large.stdout).failureCode, 'AGENT_RESPONSE_TOO_LARGE');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('legacy vocabulary makes spoolfile inputs explicit and resume hints stay workspace-relative', () => {
  const suggestion = readJson(
    runCli([
      'agent',
      'suggest',
      '--goal',
      'Read one existing IBM i spoolfile as evidence',
      '--json',
    ])
  );
  assert.equal(suggestion.plan, 'spool-evidence');
  assert.ok(suggestion.legacyConcepts.some(concept => concept.id === 'spoolfile'));
  assert.ok(suggestion.inputRequirements.missingInputs.some(input => input.name === 'job-number'));
  assert.ok(suggestion.inputRequirements.missingInputs.some(input => input.name === 'profile'));

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-agent-resume-'));
  try {
    const sourceRoot = path.join(cwd, 'src');
    const outputProgramDir = path.join(cwd, 'output', 'ORDERPGM');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(outputProgramDir, { recursive: true });
    const manifest = buildAnalyzeRunManifest({
      status: 'succeeded',
      context: {
        program: 'ORDERPGM',
        sourceRoot,
        outputRoot: path.join(cwd, 'output'),
        outputProgramDir,
        cwd,
        startedAt: '2026-09-06T00:00:00.000Z',
        completedAt: '2026-09-06T00:00:01.000Z',
        durationMs: 1000,
      },
      result: { sourceFiles: [], stageReports: [], generatedFiles: [] },
    });
    writeAnalyzeRunManifest(outputProgramDir, manifest);
    const resume = buildResumeHints({ cwd, out: 'output', program: 'ORDERPGM' });
    assert.equal(resume.available, true);
    assert.equal(resume.manifestPath, 'output/ORDERPGM/analyze-run-manifest.json');
    assert.ok(resume.commands[0].includes('investigate'));
    assert.ok(!resume.commands.some(command => command.includes(cwd)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
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
  assert.equal(payload.contractVersion, 1);
  assert.ok(payload.scope);
  assert.ok(payload.evidence.sources.includes('working context'));
  assert.ok(Array.isArray(payload.artifacts));
  assert.equal(payload.approvalRequired, false);
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
  assert.equal(payload.contractVersion, 1);
  assert.ok(payload.scope);
  assert.ok(payload.evidence.sources.includes('preflight metadata'));
  assert.equal(payload.approvalRequired, false);
  assert.match(payload.prompt, /Review dependencies for ORDERPGM/);
  assert.match(payload.prompt, /Preflight status:/);
  assert.match(payload.prompt, /Recommended next command:/);
  assert.doesNotMatch(payload.prompt, /\[INSERT USER GOAL HERE\]/);
  assert.ok(payload.metadata.nextCommands.length > 0);
});

test('CLI agent prompt requires an explicit goal', () => {
  const result = runCli(['agent', 'prompt', '--json']);
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'failed');
  assert.equal(payload.failureCode, 'TOOL_INVALID_ARGUMENTS');
  assert.equal(payload.safety.level, 'S0');
  assert.equal(payload.approvalRequired, false);
  assert.match(payload.error.message, /goal/i);
  assert.ok(payload.nextSafeStep);
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
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.failureCode, 'TOOL_INVALID_ARGUMENTS');
  assert.match(payload.error.message, /goal/i);
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
