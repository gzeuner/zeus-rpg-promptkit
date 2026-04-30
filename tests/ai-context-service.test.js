const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateAiContextBundle,
  resolveLatestWorkflowRunRoot,
} = require('../src/agent/aiContextService');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('resolveLatestWorkflowRunRoot finds most recent workflow run', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ai-root-'));
  try {
    const outputRoot = path.join(tempRoot, 'analysis', 'runs');
    const oldRun = path.join(outputRoot, '2026-01-01T00-00-00Z');
    const newRun = path.join(outputRoot, '2026-01-02T00-00-00Z');
    fs.mkdirSync(oldRun, { recursive: true });
    fs.mkdirSync(newRun, { recursive: true });
    writeJson(path.join(oldRun, 'context.json'), { runId: 'old' });
    writeJson(path.join(newRun, 'context.json'), { runId: 'new' });

    const latest = resolveLatestWorkflowRunRoot({
      workspaceRoot: tempRoot,
      outputRoot: 'analysis',
    });
    assert.equal(latest, newRun);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generateAiContextBundle creates required files and sanitizes secrets', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ai-bundle-'));
  try {
    const sourceFile = path.join(tempRoot, 'src', 'ORDERPGM.rpgle');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, '** FREE\n', 'utf8');

    const runRoot = path.join(tempRoot, 'analysis', 'runs', '2026-01-01T00-00-00Z');
    fs.mkdirSync(path.join(runRoot, 'db'), { recursive: true });
    fs.writeFileSync(path.join(runRoot, 'report.md'), 'password=super-secret\n', 'utf8');
    writeJson(path.join(runRoot, 'context.json'), {
      runId: 'run-1',
      profile: 'PROJECT-X-TEST',
      db: {
        password: 'leaked',
      },
    });
    writeJson(path.join(runRoot, 'db', 'CUSTOMERS.json'), {
      columns: [{ column: 'ID' }],
      auth: 'should-not-leak',
    });

    const bundle = generateAiContextBundle({
      workspaceRoot: tempRoot,
      outputRoot: 'analysis',
      runRoot,
      activeProfile: 'PROJECT-X-TEST',
      taskContext: 'Ticket-42',
      selectedPaths: [sourceFile, 'C:/outside/path'],
      timestamp: new Date('2026-04-30T00:00:00.000Z'),
    });

    assert.equal(fs.existsSync(bundle.files.aiPrompt), true);
    assert.equal(fs.existsSync(bundle.files.context), true);
    assert.equal(fs.existsSync(bundle.files.report), true);
    assert.equal(fs.existsSync(bundle.files.relevantSources), true);
    assert.equal(fs.existsSync(bundle.files.safetyRules), true);
    assert.equal(fs.existsSync(bundle.files.dbMetadata), true);

    const contextPayload = JSON.parse(fs.readFileSync(bundle.files.context, 'utf8'));
    assert.equal(contextPayload.runContext.db.password, '[REDACTED]');
    assert.deepEqual(contextPayload.selectedPaths, ['src/ORDERPGM.rpgle']);

    const reportPayload = fs.readFileSync(bundle.files.report, 'utf8');
    assert.doesNotMatch(reportPayload, /super-secret/);
    assert.match(reportPayload, /\[REDACTED\]/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

