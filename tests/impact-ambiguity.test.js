const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { copySanitizedFixtureTree } = require('./helpers/fixtureCorpus');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('analyze and impact keep duplicate-member ambiguity explicit instead of silently resolving it', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-impact-ambiguity-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputRoot = path.join(tempRoot, 'output');

  copySanitizedFixtureTree(path.join('source', 'catalog-cross-program-root'), sourceRoot);

  try {
    runCli([
      'analyze',
      '--source',
      sourceRoot,
      '--program',
      'CALLERPGM',
      '--out',
      outputRoot,
      '--skip-test-data',
    ], projectRoot);

    runCli([
      'impact',
      '--program',
      'CALLERPGM',
      '--target',
      'PROGRAM_020',
      '--out',
      outputRoot,
    ], projectRoot);

    const programOutputDir = path.join(outputRoot, 'CALLERPGM');
    const report = fs.readFileSync(path.join(programOutputDir, 'report.md'), 'utf8');
    const graph = readJson(path.join(programOutputDir, 'program-call-tree.json'));
    const impact = readJson(path.join(programOutputDir, 'impact-analysis.json'));

    assert.deepEqual(graph.ambiguousPrograms, ['PROGRAM_020']);
    assert.deepEqual(graph.unresolvedPrograms, ['PROGRAM_020']);
    assert.match(report, /Ambiguous program calls: 1/);
    assert.match(report, /Ambiguous list: PROGRAM_020/);
    assert.equal(impact.target, 'PROGRAM_020');
    assert.equal(impact.type, 'PROGRAM');
    assert.deepEqual(impact.directCallers, ['CALLERPGM']);
    assert.equal(impact.ambiguity.targetAmbiguous, true);
    assert.equal(impact.ambiguity.targetUnresolved, true);
    assert.deepEqual(impact.ambiguity.ambiguousPrograms, ['PROGRAM_020']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
