const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildWorkCopyTargetName,
  copyFetchedSourcesToWorkspace,
  discoverFetchedSources,
} = require('../src/workspace/workCopyService');

function createFetchedSourceFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-work-copy-'));
  const fetchRoot = path.join(tempRoot, 'rpg_sources');
  fs.mkdirSync(path.join(fetchRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(path.join(fetchRoot, 'QSQLRPGLESRC'), { recursive: true });
  fs.writeFileSync(path.join(fetchRoot, 'QRPGLESRC', 'MAINPROG.rpgle'), '**FREE\n', 'utf8');
  fs.writeFileSync(path.join(fetchRoot, 'QSQLRPGLESRC', 'ORDERPGM.sqlrpgle'), '**FREE\n', 'utf8');
  fs.writeFileSync(path.join(fetchRoot, 'zeus-import-manifest.json'), `${JSON.stringify({
    files: [
      {
        member: 'MAINPROG',
        localPath: 'QRPGLESRC/MAINPROG.rpgle',
        origin: {
          member: 'MAINPROG',
          localPath: 'QRPGLESRC/MAINPROG.rpgle',
        },
      },
      {
        member: 'ORDERPGM',
        localPath: 'QSQLRPGLESRC/ORDERPGM.sqlrpgle',
        origin: {
          member: 'ORDERPGM',
          localPath: 'QSQLRPGLESRC/ORDERPGM.sqlrpgle',
        },
      },
    ],
  }, null, 2)}\n`, 'utf8');
  return {
    tempRoot,
    fetchRoot,
  };
}

test('discoverFetchedSources prefers import manifest metadata', () => {
  const fixture = createFetchedSourceFixture();

  try {
    const discovered = discoverFetchedSources(fixture.fetchRoot);
    assert.equal(discovered.length, 2);
    assert.equal(discovered[0].member, 'MAINPROG');
    assert.equal(discovered[0].relativePath, 'QRPGLESRC/MAINPROG.rpgle');
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('buildWorkCopyTargetName supports txt, original, and suffixed modes', () => {
  const entry = {
    member: 'MAINPROG',
    extension: '.rpgle',
  };

  assert.equal(buildWorkCopyTargetName(entry, 'txt'), 'MAINPROG.rpgle.txt');
  assert.equal(buildWorkCopyTargetName(entry, 'original'), 'MAINPROG.rpgle');
  assert.equal(buildWorkCopyTargetName(entry, 'suffixed'), 'MAINPROG.rpgle.work');
});

test('copyFetchedSourcesToWorkspace copies requested members and reports missing ones as skipped', () => {
  const fixture = createFetchedSourceFixture();
  const targetRoot = path.join(fixture.tempRoot, 'workspace-copy');

  try {
    const summary = copyFetchedSourcesToWorkspace({
      sourceRoot: fixture.fetchRoot,
      targetRoot,
      workCopyMode: 'txt',
      force: false,
      members: ['MAINPROG', 'MISSINGPGM'],
    });

    assert.equal(summary.copiedCount, 1);
    assert.equal(summary.selectedCount, 1);
    assert.ok(fs.existsSync(path.join(targetRoot, 'MAINPROG.rpgle.txt')));
    assert.ok(summary.results.some((entry) => entry.status === 'skipped' && entry.member === 'MISSINGPGM'));
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});
