const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildLineComparison,
  resolveDiffPaths,
} = require('../src/diff/workspaceDiffService');

function createDiffFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-workspace-diff-'));
  const fetchRoot = path.join(tempRoot, 'rpg_sources');
  const workspaceRoot = path.join(tempRoot, 'source');

  fs.mkdirSync(path.join(fetchRoot, 'QRPGLESRC'), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(fetchRoot, 'QRPGLESRC', 'MAINPROG.rpgle'), '**FREE\nA\nB\n', 'utf8');
  fs.writeFileSync(path.join(fetchRoot, 'zeus-import-manifest.json'), `${JSON.stringify({
    files: [{
      member: 'MAINPROG',
      localPath: 'QRPGLESRC/MAINPROG.rpgle',
      origin: {
        member: 'MAINPROG',
        localPath: 'QRPGLESRC/MAINPROG.rpgle',
      },
    }],
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(workspaceRoot, 'MAINPROG.rpgle.txt'), '**FREE\nA\nC\n', 'utf8');

  return {
    tempRoot,
    fetchRoot,
    workspaceRoot,
  };
}

test('resolveDiffPaths maps a member to fetched original and local work copy', () => {
  const fixture = createDiffFixture();

  try {
    const resolved = resolveDiffPaths({
      member: 'MAINPROG',
      fetchRoot: fixture.fetchRoot,
      workspaceRoot: fixture.workspaceRoot,
      workCopyMode: 'txt',
    });

    assert.equal(resolved.originalPath.endsWith(path.join('QRPGLESRC', 'MAINPROG.rpgle')), true);
    assert.equal(resolved.modifiedPath.endsWith('MAINPROG.rpgle.txt'), true);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('buildLineComparison marks changed and unchanged rows', () => {
  const comparison = buildLineComparison(
    ['A', 'B'],
    ['A', 'C', 'D'],
  );

  assert.equal(comparison.changedCount, 2);
  assert.deepEqual(comparison.rows.map((row) => row.marker), [' ', '~', '+']);
});
