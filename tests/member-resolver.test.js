const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveMemberProgram } = require('../src/cli/helpers/memberResolver');

test('resolveMemberProgram resolves a unique member from the local source catalog', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-member-resolver-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'QRPGLESRC', 'ORDERPGM.rpgle'), '**FREE\n', 'utf8');

  try {
    const resolved = resolveMemberProgram({
      member: 'orderpgm',
      sourceRoot,
      extensions: ['.rpgle'],
    });

    assert.equal(resolved.program, 'ORDERPGM');
    assert.equal(resolved.sourcePath.endsWith(path.join('QRPGLESRC', 'ORDERPGM.rpgle')), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveMemberProgram rejects ambiguous duplicate members', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-member-resolver-amb-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(path.join(sourceRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'QCLLESRC'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'QRPGLESRC', 'PROGRAM_010.rpgle'), '**FREE\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'QCLLESRC', 'PROGRAM_010.clle'), 'PGM\nENDPGM\n', 'utf8');

  try {
    assert.throws(
      () => resolveMemberProgram({
        member: 'PROGRAM_010',
        sourceRoot,
        extensions: ['.rpgle', '.clle'],
      }),
      /Ambiguous local sources found/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
