const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildAnalyzeOptions,
  buildCliInvocation,
  computeLocalSourceRoot,
  formatTarget,
  isPathWithin,
  resolveCurrentTarget,
} = require('../src/adapter');

test('resolveCurrentTarget makes the current member and source file explicit', () => {
  const target = resolveCurrentTarget({
    scheme: 'member',
    path: '/LIBRARY/QRPGLESRC/ORDERPGM.MBR',
    fsPath: 'C:\\workspace\\LIBRARY\\QRPGLESRC\\ORDERPGM.MBR',
  });

  assert.equal(target.program, 'ORDERPGM');
  assert.equal(target.member, 'ORDERPGM');
  assert.equal(target.sourceFile, 'QRPGLESRC');
  assert.equal(target.system, null);
  assert.equal(target.library, null);
});

test('computeLocalSourceRoot prefers the source container and stays deterministic', () => {
  const sourceRoot = path.join('C:', 'workspace', 'rpg_sources');
  const target = resolveCurrentTarget({
    scheme: 'file',
    fsPath: path.join(sourceRoot, 'QRPGLESRC', 'ORDERPGM.rpgle'),
  });
  const result = computeLocalSourceRoot(
    target,
    [{ uri: { fsPath: path.join('C:', 'workspace') } }],
    candidate => candidate === sourceRoot || candidate.endsWith(`${path.sep}QRPGLESRC`)
  );

  assert.equal(result, sourceRoot);
});

test('buildAnalyzeOptions preserves the explicit target and workspace boundaries', () => {
  const target = { program: 'ORDERPGM', member: 'ORDERPGM', sourceFile: 'QRPGLESRC' };
  const options = buildAnalyzeOptions({
    target,
    sourceRoot: 'C:\\workspace\\rpg_sources',
    outputRoot: 'C:\\workspace\\.zeus\\output',
    denseLevel: 'lite',
  });

  assert.deepEqual(options, {
    source: 'C:\\workspace\\rpg_sources',
    sourceRoot: 'C:\\workspace\\rpg_sources',
    out: 'C:\\workspace\\.zeus\\output',
    program: 'ORDERPGM',
    member: 'ORDERPGM',
    dense: 'lite',
    mode: 'documentation',
    optimizeContext: true,
  });
  assert.equal(isPathWithin('C:\\workspace', 'C:\\workspace\\rpg_sources'), true);
  assert.equal(isPathWithin('C:\\workspace', 'C:\\other'), false);
});

test('formatTarget keeps unknown IBM i dimensions visible instead of guessing', () => {
  const formatted = formatTarget({ sourceFile: 'QRPGLESRC', member: 'ORDERPGM' });
  assert.match(formatted, /System: unknown/);
  assert.match(formatted, /Library\/schema: unknown/);
  assert.match(formatted, /Source file: QRPGLESRC/);
  assert.match(formatted, /Member\/program: ORDERPGM/);
});

test('buildCliInvocation prefers the workspace CLI and rejects paths outside the workspace', () => {
  const invocation = buildCliInvocation({
    workspaceRoot: 'C:\\workspace',
    target: { program: 'ORDERPGM', member: 'ORDERPGM' },
    sourceRoot: 'C:\\workspace\\rpg_sources',
    outputRoot: 'C:\\workspace\\.zeus\\output',
    profile: 'demo',
    denseLevel: 'full',
    fileExists: candidate => candidate.endsWith('cli\\zeus.js'),
  });

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /cli[\\/]zeus\.js$/);
  assert.ok(invocation.args.includes('--json'));
  assert.deepEqual(invocation.args.slice(1, 5), ['analyze', '--profile', 'demo', '--source']);
  assert.throws(
    () =>
      buildCliInvocation({
        workspaceRoot: 'C:\\workspace',
        cliPath: 'C:\\tools\\zeus.js',
        target: { program: 'ORDERPGM' },
        sourceRoot: 'C:\\workspace\\rpg_sources',
        outputRoot: 'C:\\workspace\\.zeus\\output',
      }),
    /must remain inside the workspace/
  );
});
