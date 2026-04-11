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
    assert.equal(result.manifest.reproducibility.enabled, false);
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

test('buildOutputBundle can package explicit workflow preset artifacts with preset metadata', () => {
  const { tempRoot, outputRoot, bundleRoot, programOutputDir } = createTempBundleProject();

  try {
    fs.writeFileSync(path.join(programOutputDir, 'analysis-index.json'), '{"kind":"analysis-task-index"}\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'report.md'), '# Report\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'context.json'), '{"program":"ORDERPGM"}\n', 'utf8');
    fs.writeFileSync(path.join(programOutputDir, 'analyze-run-manifest.json'), `${JSON.stringify({
      run: {
        status: 'succeeded',
        completedAt: '2026-04-09T10:00:00.000Z',
      },
      inputs: {
        options: {
          workflowPreset: {
            name: 'onboarding',
            title: 'Onboarding',
            analyzeMode: 'documentation',
            promptTemplates: ['documentation'],
            workflowKeys: ['documentation'],
            bundleArtifacts: ['analyze-run-manifest.json', 'analysis-index.json', 'report.md'],
            reviewWorkflow: {
              intendedAudience: ['New engineers'],
              keyQuestionsAnswered: ['Which artifacts explain the program quickly?'],
              expectedDecisions: ['Decide whether deeper architecture review is needed.'],
              interpretationGuidance: ['Start with report.md before deeper review.'],
              requiredInputs: ['Prompt-ready documentation artifacts.'],
              recommendedOutputs: [
                { path: 'report.md', purpose: 'Quick orientation summary.' },
              ],
            },
          },
        },
        sourceSnapshot: {
          fingerprint: 'wf-123',
        },
      },
      artifacts: [
        { path: 'analysis-index.json', kind: 'json', sizeBytes: 32, sha256: 'a' },
        { path: 'report.md', kind: 'markdown', sizeBytes: 9, sha256: 'b' },
        { path: 'context.json', kind: 'json', sizeBytes: 24, sha256: 'c' },
      ],
    }, null, 2)}\n`, 'utf8');

    const result = buildOutputBundle({
      program: 'ORDERPGM',
      sourceOutputRoot: outputRoot,
      bundleOutputRoot: bundleRoot,
      artifactPaths: ['analyze-run-manifest.json', 'analysis-index.json', 'report.md'],
      bundleFileName: 'ORDERPGM-onboarding-bundle.zip',
    });

    assert.deepEqual(result.manifest.files, [
      'analysis-index.json',
      'analyze-run-manifest.json',
      'report.md',
    ]);
    assert.equal(result.manifest.reproducibility.enabled, false);
    assert.equal(result.manifest.workflowPreset.name, 'onboarding');
    assert.deepEqual(result.manifest.workflowPreset.promptTemplates, ['documentation']);
    assert.match(result.manifest.workflowPreset.reviewWorkflow.intendedAudience.join('\n'), /New engineers/);
    assert.equal(path.basename(result.zipPath), 'ORDERPGM-onboarding-bundle.zip');

    const zip = new AdmZip(result.zipPath);
    const entryNames = zip.getEntries().map((entry) => entry.entryName).sort();
    assert.deepEqual(entryNames, [
      'README.txt',
      'analysis-index.json',
      'analyze-run-manifest.json',
      'manifest.json',
      'report.md',
    ]);
    const readme = zip.readAsText('README.txt');
    assert.match(readme, /Workflow preset: onboarding/);
    assert.match(readme, /Expected decisions:/);
    assert.match(readme, /report\.md: Quick orientation summary\./);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
