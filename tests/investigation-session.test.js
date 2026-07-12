const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createOrLoadSession,
  applyFocus,
  recordInvestigationEvent,
  getFocusedContext,
  listSessions,
} = require('../src/investigation/investigationSession');

const {
  focus,
  search,
  generateFocusedPrompt,
  loadBaseArtifacts,
} = require('../src/investigation/investigationActions');

function createTempAnalysisDir() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-inv-session-'));
  const analysisDir = path.join(tempRoot, 'output', 'TESTPGM');
  fs.mkdirSync(analysisDir, { recursive: true });

  // Minimal artifacts
  fs.writeFileSync(
    path.join(analysisDir, 'canonical-analysis.json'),
    JSON.stringify({
      kind: 'canonical-analysis',
      rootProgram: 'TESTPGM',
      summary: { text: 'Test program' },
    }),
    'utf8'
  );

  fs.writeFileSync(
    path.join(analysisDir, 'context.json'),
    JSON.stringify({
      summary: { text: 'Context summary for TESTPGM' },
      sourceFiles: [],
    }),
    'utf8'
  );

  fs.writeFileSync(
    path.join(analysisDir, 'search-results.json'),
    JSON.stringify({
      kind: 'full-text-search-results',
      terms: ['DYNAMIC'],
      summary: { matchCount: 1 },
    }),
    'utf8'
  );

  return { tempRoot, analysisDir };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

test('createOrLoadSession creates a new session with defaults', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const { session } = createOrLoadSession({ outputProgramDir: analysisDir });
    assert.ok(session.id.startsWith('inv-'));
    assert.equal(session.goal, '');
    assert.deepEqual(session.focus, { programs: [], tables: [], searchScopes: [] });
    assert.ok(Array.isArray(session.history));
    assert.equal(session.baseAnalysisDir, analysisDir);
  } finally {
    cleanup(tempRoot);
  }
});

test('createOrLoadSession reuses existing session', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const { session: s1 } = createOrLoadSession({ outputProgramDir: analysisDir, goal: 'first' });
    const { session: s2 } = createOrLoadSession({ outputProgramDir: analysisDir });
    assert.equal(s1.id, s2.id);
    assert.equal(s2.goal, 'first');
  } finally {
    cleanup(tempRoot);
  }
});

test('applyFocus updates focus and records event', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const ctx = createOrLoadSession({ outputProgramDir: analysisDir });
    const updated = applyFocus(ctx, { programs: ['ORDERPGM'], tables: ['CUST'] });
    assert.ok(updated.focus.programs.includes('ORDERPGM'));
    assert.ok(updated.focus.tables.includes('CUST'));
    assert.ok(updated.history.some(h => h.type === 'focus-applied'));
  } finally {
    cleanup(tempRoot);
  }
});

test('recordInvestigationEvent appends to history', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const ctx = createOrLoadSession({ outputProgramDir: analysisDir });
    recordInvestigationEvent(ctx, { type: 'test-event', data: 42 });
    assert.ok(ctx.session.history.some(h => h.type === 'test-event'));
  } finally {
    cleanup(tempRoot);
  }
});

test('getFocusedContext returns safe defaults', () => {
  assert.deepEqual(getFocusedContext(null), { programs: [], tables: [], searchScopes: [] });
  assert.deepEqual(getFocusedContext({}), { programs: [], tables: [], searchScopes: [] });
});

test('listSessions returns empty for no sessions', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const sessions = listSessions(analysisDir);
    assert.equal(sessions.length, 0);
  } finally {
    cleanup(tempRoot);
  }
});

test('focus action updates session via actions module', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    const res = focus({ analysisDir, goal: 'test focus', focus: { searchScopes: ['error'] } });
    assert.ok(res.message.includes('Focus updated'));
    assert.ok(res.session.focus.searchScopes.includes('error'));
  } finally {
    cleanup(tempRoot);
  }
});

test('search action uses focus and records event', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    // Seed a focus
    focus({ analysisDir, focus: { searchScopes: ['DYNAMIC'] } });

    const res = search({ analysisDir, terms: [] }); // should pick from focus
    assert.ok(res.message.includes('Search completed'));
    assert.ok(res.session.history.some(h => h.type === 'search'));
  } finally {
    cleanup(tempRoot);
  }
});

test('generateFocusedPrompt builds prompt from session + artifacts', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    focus({ analysisDir, goal: 'deep dive', focus: { programs: ['TESTPGM'] } });
    const res = generateFocusedPrompt({ analysisDir });
    assert.ok(res.prompt.includes('Investigation Goal: deep dive'));
    assert.ok(res.prompt.includes('Focused Programs: TESTPGM'));
    assert.ok(res.prompt.includes('Base Summary:'));
  } finally {
    cleanup(tempRoot);
  }
});

test('loadBaseArtifacts handles missing files gracefully', () => {
  const { tempRoot, analysisDir } = createTempAnalysisDir();
  try {
    fs.unlinkSync(path.join(analysisDir, 'canonical-analysis.json'));
    const base = loadBaseArtifacts(analysisDir);
    assert.equal(base.canonical, null);
    assert.ok(base.context);
  } finally {
    cleanup(tempRoot);
  }
});

test('investigate CLI command module loads and basic list works', () => {
  const { runInvestigate } = require('../src/cli/commands/investigateCommand');
  assert.equal(typeof runInvestigate, 'function');

  // We can't easily test full CLI without mocking, but module should be importable
});

// --- End-to-end CLI tests (using execFileSync pattern) ---
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');
const fixtureRoot = path.join(__dirname, 'fixtures', 'v1-smoke', 'src');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('investigate CLI creates session and supports focus/search/generate-prompt end-to-end', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-investigate-e2e-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');
  const program = 'ORDERPGM';

  fs.cpSync(fixtureRoot, sourceRoot, { recursive: true });

  try {
    // First, run a minimal analyze to create base artifacts
    runCli(
      ['analyze', '--source', sourceRoot, '--program', program, '--out', outputRoot],
      projectRoot
    );

    const programDir = path.join(outputRoot, program);

    // Run investigate --list (should be empty initially)
    let listOutput = runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--list'],
      projectRoot
    );
    assert.match(listOutput, /No investigation sessions found/);

    // Start session with goal
    runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--goal', 'Focus on error paths'],
      projectRoot
    );

    // List should now show a session
    listOutput = runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--list'],
      projectRoot
    );
    assert.match(listOutput, /inv-/);

    // Use --focus
    runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--focus', 'error paths'],
      projectRoot
    );

    // Use --search
    runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--search', 'DYNAMIC'],
      projectRoot
    );

    // Use --generate-prompt
    const promptOutput = runCli(
      ['investigate', '--program', program, '--out', outputRoot, '--generate-prompt'],
      projectRoot
    );
    assert.match(promptOutput, /Investigation Goal:/);
    assert.match(promptOutput, /Focused Programs:/);

    // Verify session file exists
    const investigationsDir = path.join(programDir, '.investigations');
    assert.ok(fs.existsSync(investigationsDir));
    const sessions = fs.readdirSync(investigationsDir);
    assert.ok(sessions.length >= 1);

    const sessionFile = path.join(investigationsDir, sessions[0], 'session.json');
    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    assert.ok(sessionData.goal.includes('Focus on error paths'));
    assert.ok(sessionData.history.some(h => h.type === 'focus-applied' || h.type === 'search'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
