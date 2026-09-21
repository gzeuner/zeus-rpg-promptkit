'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { runLegacySourceInventory } = require('../src/legacySource/confidentialInventory');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'zeus.js');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-legacy-boundary-'));
  const workspace = path.join(root, 'workspace');
  const source = path.join(root, 'source');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(source, { recursive: true });

  const canary = ['opaque', 'synthetic', 'marker'].join('-');
  const credentialCanary = ['credential', 'synthetic', 'marker'].join('-');
  const hiddenName = ['hidden', 'unit'].join('-');
  const files = {
    [`${hiddenName}.rpgle`]: `**free\n// ${canary}\nDCL-S STATUS CHAR(1);\n`,
    'command.clle': `PGM\n  /* ${credentialCanary} */\n  CALL PGM(TESTPGM)\nENDPGM\n`,
    'screen.dds': 'A          R SCREEN\nA            FIELD         10A  B\n',
    'query.sql': `SELECT STATUS FROM SAFE_TABLE WHERE NOTE = '${canary}';\n`,
    'binding.bnd': 'STRPGMEXP PGMLVL(*CURRENT)\nENDPGMEXP\n',
    'include.rpgleinc': `DCL-C MARKER CONST('${canary}');\n`,
    'unrelated.txt': `not a source candidate ${credentialCanary}\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(source, name), content, 'utf8');
  }
  return { root, workspace, source, canary, credentialCanary, hiddenName };
}

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const location = path.join(current, entry.name);
      hash.update(entry.name);
      if (entry.isDirectory()) visit(location);
      else if (entry.isFile()) hash.update(fs.readFileSync(location));
    }
  }
  visit(directory);
  return hash.digest('hex');
}

function runInventory(fixture, out = '.local/legacy-source-inventory/inventory.json') {
  return runLegacySourceInventory({
    sourceRoot: fixture.source,
    workspaceRoot: fixture.workspace,
    out,
    salt: 'synthetic-test-salt',
  });
}

test('legacy-source inventory never exports source paths, names, text, or credential canaries', () => {
  const fixture = createFixture();
  try {
    const before = treeDigest(fixture.source);
    const result = runInventory(fixture);
    const artifactPath = path.join(fixture.workspace, result.artifacts[0]);
    const artifactText = fs.readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(artifactText);

    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(artifact.readOnly, true);
    assert.equal(artifact.privacy.containsRawSource, false);
    assert.equal(artifact.privacy.containsSourcePaths, false);
    assert.equal(artifact.privacy.containsCredentials, false);
    assert.doesNotMatch(artifactText, new RegExp(fixture.canary));
    assert.doesNotMatch(artifactText, new RegExp(fixture.credentialCanary));
    assert.doesNotMatch(artifactText, new RegExp(fixture.hiddenName));
    assert.doesNotMatch(
      artifactText,
      new RegExp(fixture.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.equal(artifact.inventory.candidateFiles, 6);
    assert.equal(artifact.evidence.count, 6);
    assert.ok(artifact.inventory.byFamily.RPG >= 1);
    assert.ok(artifact.inventory.byFamily.SQL >= 1);
    assert.equal(treeDigest(fixture.source), before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source inventory cache keeps the safe artifact stable and detects content changes', () => {
  const fixture = createFixture();
  try {
    runInventory(fixture);
    const artifactPath = path.join(
      fixture.workspace,
      '.local',
      'legacy-source-inventory',
      'inventory.json'
    );
    const first = fs.readFileSync(artifactPath, 'utf8');
    const secondResult = runInventory(fixture);
    const second = fs.readFileSync(artifactPath, 'utf8');
    assert.equal(first, second);
    assert.ok(secondResult.summary.cache.reusedFiles > 0);

    fs.appendFileSync(
      path.join(fixture.source, 'query.sql'),
      'UPDATE SAFE_TABLE SET STATUS = 1;\n'
    );
    const changed = runInventory(fixture);
    const third = fs.readFileSync(artifactPath, 'utf8');
    assert.notEqual(third, second);
    assert.ok(changed.summary.cache.reprocessedFiles >= 1);
    assert.notEqual(
      JSON.parse(third).inventoryFingerprint,
      JSON.parse(second).inventoryFingerprint
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source inventory rejects unsafe output boundaries', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => runInventory(fixture, '../outside.json'),
      error => error.code === 'OUTPUT_OUTSIDE_WORKSPACE'
    );
    assert.throws(
      () =>
        runLegacySourceInventory({
          sourceRoot: fixture.workspace,
          workspaceRoot: fixture.workspace,
          out: '.local/legacy-source-inventory/inventory.json',
          salt: 'synthetic-test-salt',
        }),
      error => error.code === 'SOURCE_OUTPUT_OVERLAP'
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy-source CLI returns only the bounded anonymized result', () => {
  const fixture = createFixture();
  try {
    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'legacy-source',
        'inventory',
        '--source-root',
        fixture.source,
        '--out',
        '.local/legacy-source-inventory/inventory.json',
        '--json',
      ],
      { cwd: fixture.workspace, encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    const output = run.stdout;
    assert.equal(payload.ok, true);
    assert.equal(payload.readOnly, true);
    assert.doesNotMatch(output, new RegExp(fixture.canary));
    assert.doesNotMatch(output, new RegExp(fixture.credentialCanary));
    assert.doesNotMatch(output, new RegExp(fixture.hiddenName));
    assert.doesNotMatch(output, new RegExp(fixture.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
