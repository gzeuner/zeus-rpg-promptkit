'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRIBUTION_PACKAGE_KIND,
  CONTRIBUTION_PACKAGE_MAX_FILE_BYTES,
  CONTRIBUTION_PACKAGE_SCHEMA,
  ContributionPackageError,
  DERIVATION_CLASSES,
  canonicalizeContribution,
  createContributionPackage,
  openContributionPackage,
  writeContributionPackage,
} = (() => {
  const contribution = require('../src/projectIntelligence/export');
  const constants = require('../src/projectIntelligence/constants');
  return { ...contribution, DERIVATION_CLASSES: constants.DERIVATION_CLASSES };
})();

function contributionOptions(overrides = {}) {
  return {
    contributionId: 'instance-a:contribution-001',
    originInstanceId: 'instance-a',
    baseSnapshot: {
      snapshotId: 'snapshot-001',
      contentHash: 'a'.repeat(64),
    },
    contractVersions: {
      'knowledge.snapshot': '1',
      'knowledge.contribution': '1',
    },
    derivationClass: DERIVATION_CLASSES.INFERRED,
    evidenceReferences: [{ id: 'evidence-001', contract: 'evidence@1' }],
    provenance: { collector: 'local-adapter', collectedAt: '2026-09-25T10:00:00.000Z' },
    privacyReport: { status: 'passed', redacted: false },
    qualityReport: { status: 'passed', checks: ['schema', 'integrity'] },
    payload: { fact: 'structured observation', sourceId: 'source-001' },
    ...overrides,
  };
}

function tempPackageDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contribution-contract-'));
}

test('canonical serialization is stable across object insertion order', () => {
  const left = canonicalizeContribution({ z: 2, nested: { b: true, a: 1 }, a: 'first' });
  const right = canonicalizeContribution({ a: 'first', nested: { a: 1, b: true }, z: 2 });
  assert.equal(left, right);

  const first = createContributionPackage(contributionOptions({ payload: { b: 2, a: 1 } }));
  const second = createContributionPackage(contributionOptions({ payload: { a: 1, b: 2 } }));
  assert.equal(first.hashes.payloadHash, second.hashes.payloadHash);
  assert.equal(first.hashes.manifestHash, second.hashes.manifestHash);
  assert.equal(first.hashes.packageHash, second.hashes.packageHash);
});

test('package exposes canonical manifest and payload with all integrity hashes', () => {
  const contribution = createContributionPackage(contributionOptions());

  assert.equal(contribution.kind, CONTRIBUTION_PACKAGE_KIND);
  assert.equal(contribution.schema, CONTRIBUTION_PACKAGE_SCHEMA);
  assert.equal(contribution.manifest.files['payload.json'], contribution.hashes.payloadHash);
  assert.equal(contribution.manifest.manifestHash, contribution.hashes.manifestHash);
  assert.equal(contribution.manifest.packageHash, contribution.hashes.packageHash);
  assert.equal(contribution.manifest.advisory, true);
  assert.equal(contribution.manifest.sourceOfTruth, false);
  assert.equal(contribution.files['payload.json'].endsWith('\n'), true);
  assert.equal(contribution.files['manifest.json'].endsWith('\n'), true);
});

test('package result is isolated from later input mutation', () => {
  const options = contributionOptions();
  const contribution = createContributionPackage(options);

  options.payload.fact = 'changed after creation';
  assert.equal(contribution.payload.fact, 'structured observation');
  assert.throws(() => {
    contribution.payload.fact = 'mutation';
  }, TypeError);
});

test('write and read roundtrip is read-only and preserves the contract', () => {
  const packageDir = tempPackageDir();
  try {
    const before = fs.readdirSync(packageDir);
    const written = writeContributionPackage({ packageDir, ...contributionOptions() });
    const opened = openContributionPackage({ packageDir });

    assert.deepEqual(before, []);
    assert.equal(written.ok, true);
    assert.deepEqual(opened.payload, contributionOptions().payload);
    assert.deepEqual(opened.hashes, written.hashes);
    assert.deepEqual(fs.readdirSync(packageDir).sort(), ['manifest.json', 'payload.json']);
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});

test('tampered or non-canonical files fail closed', () => {
  const packageDir = tempPackageDir();
  try {
    writeContributionPackage({ packageDir, ...contributionOptions() });
    fs.writeFileSync(path.join(packageDir, 'payload.json'), '{"z":2,"a":1}\n', 'utf8');

    assert.throws(
      () => openContributionPackage({ packageDir }),
      error =>
        error instanceof ContributionPackageError &&
        ['CONTENT_HASH_MISMATCH', 'PACKAGE_INVALID'].includes(error.code)
    );

    writeContributionPackage({ packageDir, ...contributionOptions() });
    const manifestPath = path.join(packageDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.status = 'accepted';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    assert.throws(
      () => openContributionPackage({ packageDir }),
      error =>
        error instanceof ContributionPackageError &&
        ['CONTENT_HASH_MISMATCH', 'PACKAGE_INVALID'].includes(error.code)
    );

    writeContributionPackage({ packageDir, ...contributionOptions() });
    const payloadPath = path.join(packageDir, 'payload.json');
    const payload = fs.readFileSync(payloadPath, 'utf8');
    fs.writeFileSync(payloadPath, `\uFEFF${payload.replace(/\n$/, '\r\n')}`, 'utf8');
    assert.throws(
      () => openContributionPackage({ packageDir }),
      error =>
        error instanceof ContributionPackageError &&
        ['CONTENT_HASH_MISMATCH', 'PACKAGE_INVALID'].includes(error.code)
    );
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});

test('verified contributions require evidence and unsafe data is rejected', () => {
  assert.throws(
    () =>
      createContributionPackage(
        contributionOptions({
          derivationClass: DERIVATION_CLASSES.VERIFIED,
          evidenceReferences: [],
        })
      ),
    error =>
      error instanceof ContributionPackageError && error.code === 'VERIFIED_EVIDENCE_REQUIRED'
  );

  for (const payload of [
    { rawSource: 'content' },
    { secretToken: 'value' },
    { path: 'C:\\private\\input.txt' },
    { path: '/private/input.txt' },
    { path: '//host/share/input.txt' },
    { relativePath: '../private/input.txt' },
    { endpoint: 'https://example.invalid/resource' },
    { note: 'password=hidden' },
    { sourceOfTruth: true },
    { advisory: false },
  ]) {
    assert.throws(
      () => createContributionPackage(contributionOptions({ payload })),
      error => error instanceof ContributionPackageError && error.code === 'PAYLOAD_UNSAFE'
    );
  }

  assert.throws(
    () =>
      createContributionPackage(
        contributionOptions({ provenance: { prompt: 'unredacted input' } })
      ),
    error => error instanceof ContributionPackageError && error.code === 'PAYLOAD_UNSAFE'
  );

  const sparse = [];
  sparse[1] = 'value';
  assert.throws(
    () => createContributionPackage(contributionOptions({ payload: { values: sparse } })),
    error => error instanceof ContributionPackageError && error.code === 'JSON_VALUE_INVALID'
  );
});

test('package writer does not discover or accept extra files', () => {
  const packageDir = tempPackageDir();
  try {
    fs.writeFileSync(path.join(packageDir, 'unrelated.json'), '{}\n', 'utf8');
    assert.throws(
      () => writeContributionPackage({ packageDir, ...contributionOptions() }),
      error => error instanceof ContributionPackageError && error.code === 'PACKAGE_INVALID'
    );
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});

test('reader rejects non-regular and oversized package files', () => {
  const packageDir = tempPackageDir();
  try {
    writeContributionPackage({ packageDir, ...contributionOptions() });
    const payloadPath = path.join(packageDir, 'payload.json');
    fs.writeFileSync(payloadPath, Buffer.alloc(CONTRIBUTION_PACKAGE_MAX_FILE_BYTES + 1));
    assert.throws(
      () => openContributionPackage({ packageDir }),
      error => error instanceof ContributionPackageError && error.code === 'PACKAGE_INVALID'
    );
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
});
