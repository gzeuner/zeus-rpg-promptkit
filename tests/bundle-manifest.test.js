const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const {
  buildOutputBundle,
  BUNDLE_MANIFEST_SCHEMA_VERSION,
} = require('../src/bundle/outputBundleBuilder');

function createTempBundleProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bundle-manifest-'));
  const outputRoot = path.join(tempRoot, 'output');
  const bundleRoot = path.join(tempRoot, 'bundles');
  const programOutputDir = path.join(outputRoot, 'ORDERPGM');
  fs.mkdirSync(programOutputDir, { recursive: true });
  return {
    tempRoot,
    outputRoot,
    bundleRoot,
    programOutputDir,
  };
}

test('buildOutputBundle prefers analyze-run-manifest artifacts over directory scanning', () => {
  const { tempRoot, outputRoot, bundleRoot, programOutputDir } = createTempBundleProject();

  try {
    fs.writeFileSync(path.join(programOutputDir, 'context.json'), '{"program":"ORDERPGM"}\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'report.md'), '# Report\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'legacy.json'), '{"legacy":true}\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'analyze-run-manifest.json'), `${JSON.stringify({
      run: {
        status: 'succeeded',
        completedAt: '2026-03-16T10:00:00.000Z',
      },
      inputs: {
        sourceSnapshot: {
          fingerprint: 'abc123',
        },
      },
      artifacts: [
        { path: 'context.json' },
        { path: 'report.md' },
      ],
    }, null, 2)}\n`, 'utf8');

    const result = buildOutputBundle({
      program: 'ORDERPGM',
      sourceOutputRoot: outputRoot,
      bundleOutputRoot: bundleRoot,
    });

    assert.equal(result.manifest.schemaVersion, BUNDLE_MANIFEST_SCHEMA_VERSION);
    assert.equal(result.manifest.tool.command, 'bundle');
    assert.deepEqual(result.manifest.files, [
      'analyze-run-manifest.json',
      'context.json',
      'report.md',
    ]);
    assert.equal(result.manifest.analyzeRun.status, 'succeeded');
    assert.equal(result.manifest.analyzeRun.schemaVersion, null);
    assert.equal(result.manifest.analyzeRun.sourceFingerprint, 'abc123');
    assert.equal(result.manifest.summary.totalFiles, 3);
    assert.ok(result.manifest.summary.totalSizeBytes > 0);
    assert.deepEqual(
      result.manifest.artifacts.map((artifact) => ({
        path: artifact.path,
        kind: artifact.kind,
        source: artifact.source,
      })),
      [
        { path: 'analyze-run-manifest.json', kind: 'json', source: 'bundle-scan' },
        { path: 'context.json', kind: 'json', source: 'analyze-manifest' },
        { path: 'report.md', kind: 'markdown', source: 'analyze-manifest' },
      ],
    );
    assert.ok(result.manifest.artifacts.find((artifact) => artifact.path === 'context.json').sha256);

    const zip = new AdmZip(result.zipPath);
    const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
    assert.deepEqual(entryNames, [
      'README.txt',
      'analyze-run-manifest.json',
      'context.json',
      'manifest.json',
      'report.md',
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
