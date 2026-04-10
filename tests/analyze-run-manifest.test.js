const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MANIFEST_SCHEMA_VERSION,
  buildAnalyzeRunManifest,
} = require('../src/analyze/analyzeRunManifest');

function createTempAnalyzeOutput() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-manifest-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outputProgramDir = path.join(tempRoot, 'output', 'ORDERPGM');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(outputProgramDir, { recursive: true });
  return {
    tempRoot,
    sourceRoot,
    outputProgramDir,
  };
}

test('buildAnalyzeRunManifest creates a stable success manifest with artifact metadata and comparison', () => {
  const { tempRoot, sourceRoot, outputProgramDir } = createTempAnalyzeOutput();

  try {
    const sourceFile = path.join(sourceRoot, 'ORDERPGM.rpgle');
    fs.writeFileSync(sourceFile, 'dcl-proc ORDERPGM;\nend-proc;\n', 'utf8');
    fs.writeFileSync(path.join(outputProgramDir, 'context.json'), '{"program":"ORDERPGM"}\n', 'utf8');
    fs.writeFileSync(path.join(outputProgramDir, 'report.md'), '# Report\n', 'utf8');

    const manifest = buildAnalyzeRunManifest({
      status: 'succeeded',
      context: {
        program: 'ORDERPGM',
        sourceRoot,
        outputRoot: path.join(tempRoot, 'output'),
        outputProgramDir,
        cwd: tempRoot,
        startedAt: '2026-03-16T10:00:00.000Z',
        completedAt: '2026-03-16T10:00:02.000Z',
        durationMs: 2000,
        optimizeContextEnabled: true,
        skipTestData: false,
        testDataLimit: 25,
        extensions: ['.rpgle'],
        guidedMode: {
          name: 'modernization',
          promptTemplates: ['documentation', 'modernization'],
          effectiveOptimizeContext: true,
          reviewWorkflow: {
            intendedAudience: ['Modernization leads'],
            keyQuestionsAnswered: ['Which change boundaries look safest to extract or rewrite first?'],
            expectedDecisions: ['Choose a pilot modernization target.'],
            interpretationGuidance: ['Validate proposed seams against semantic evidence.'],
            requiredInputs: ['Canonical analysis and modernization prompts.'],
            recommendedOutputs: [
              { path: 'ai_prompt_modernization.md', purpose: 'Modernization review prompt.' },
            ],
          },
        },
        workflowPreset: {
          name: 'modernization-review',
          title: 'Modernization Review',
          analyzeMode: 'modernization',
          promptTemplates: ['documentation', 'modernization'],
          workflowKeys: ['documentation'],
          bundleArtifacts: ['analyze-run-manifest.json', 'ai_prompt_modernization.md'],
          reviewWorkflow: {
            intendedAudience: ['Modernization leads'],
            keyQuestionsAnswered: ['Which outputs should be shared for modernization readiness?'],
            expectedDecisions: ['Choose whether to proceed with a pilot change.'],
            interpretationGuidance: ['Treat unresolved calls as blockers.'],
            requiredInputs: ['Shareable bundle artifacts.'],
            recommendedOutputs: [
              { path: 'ai_prompt_modernization.md', purpose: 'Primary modernization bundle output.' },
            ],
          },
        },
      },
      result: {
        sourceFiles: [sourceFile],
        generatedFiles: ['context.json', 'report.md'],
        stageReports: [{
          id: 'collect-scan',
          status: 'completed',
          startedAt: '2026-03-16T10:00:00.000Z',
          completedAt: '2026-03-16T10:00:01.000Z',
          durationMs: 1000,
          metadata: {
            sourceFileCount: 1,
          },
          diagnostics: [{
            severity: 'warning',
            code: 'NOTE',
            message: 'Example warning.',
          }],
        }],
      },
      previousManifest: {
        run: {
          status: 'succeeded',
          completedAt: '2026-03-15T09:00:00.000Z',
        },
        summary: {
          stageCount: 2,
          diagnosticCount: 0,
          generatedArtifactCount: 1,
        },
        inputs: {
          sourceSnapshot: {
            fingerprint: 'older-fingerprint',
          },
        },
        artifacts: [{
          path: 'context.json',
        }],
      },
    });

    assert.equal(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
    assert.equal(manifest.run.status, 'succeeded');
    assert.equal(manifest.run.durationMs, 2000);
    assert.equal(manifest.inputs.sourceSnapshot.fileCount, 1);
    assert.equal(manifest.summary.generatedArtifactCount, 2);
    assert.equal(manifest.summary.warningCount, 1);
    assert.equal(manifest.inputs.options.guidedMode.name, 'modernization');
    assert.deepEqual(manifest.inputs.options.guidedMode.promptTemplates, ['documentation', 'modernization']);
    assert.match(manifest.inputs.options.guidedMode.reviewWorkflow.intendedAudience.join('\n'), /Modernization leads/);
    assert.equal(manifest.inputs.options.workflowPreset.name, 'modernization-review');
    assert.match(manifest.inputs.options.workflowPreset.reviewWorkflow.expectedDecisions.join('\n'), /pilot change/i);
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(manifest.artifacts[0].exists, true);
    assert.ok(typeof manifest.artifacts[0].sha256 === 'string' && manifest.artifacts[0].sha256.length > 0);
    assert.equal(manifest.comparison.previousRunStatus, 'succeeded');
    assert.equal(manifest.comparison.sourceFingerprintChanged, true);
    assert.deepEqual(manifest.comparison.addedArtifacts, ['report.md']);
    assert.deepEqual(manifest.comparison.removedArtifacts, []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildAnalyzeRunManifest includes failure details for failed runs', () => {
  const { tempRoot, sourceRoot, outputProgramDir } = createTempAnalyzeOutput();

  try {
    const manifest = buildAnalyzeRunManifest({
      status: 'failed',
      context: {
        program: 'ORDERPGM',
        sourceRoot,
        outputRoot: path.join(tempRoot, 'output'),
        outputProgramDir,
        cwd: tempRoot,
        startedAt: '2026-03-16T10:00:00.000Z',
        completedAt: '2026-03-16T10:00:01.000Z',
        durationMs: 1000,
        optimizeContextEnabled: false,
        skipTestData: true,
        testDataLimit: 10,
        extensions: ['.rpgle'],
        guidedMode: {
          name: 'impact',
          promptTemplates: [],
          effectiveOptimizeContext: false,
          reviewWorkflow: {
            intendedAudience: ['Release coordinators'],
            keyQuestionsAnswered: ['Which artifacts should be reviewed before impact analysis?'],
            expectedDecisions: ['Choose the impact target.'],
            interpretationGuidance: ['Use this workflow before zeus impact.'],
            requiredInputs: ['Dependency graph artifacts.'],
            recommendedOutputs: [
              { path: 'dependency-graph.json', purpose: 'Impact follow-up graph.' },
            ],
          },
        },
      },
      error: {
        message: 'boom',
        stageId: 'write-artifacts',
        stageReports: [{
          id: 'write-artifacts',
          status: 'failed',
          startedAt: '2026-03-16T10:00:00.000Z',
          completedAt: '2026-03-16T10:00:01.000Z',
          durationMs: 1000,
          metadata: {},
          diagnostics: [{
            severity: 'error',
            code: 'STAGE_FAILED',
            message: 'boom',
          }],
        }],
      },
    });

    assert.equal(manifest.run.status, 'failed');
    assert.deepEqual(manifest.run.failure, {
      message: 'boom',
      stageId: 'write-artifacts',
    });
    assert.equal(manifest.summary.failedStageCount, 1);
    assert.equal(manifest.summary.errorCount, 1);
    assert.equal(manifest.diagnostics.length, 1);
    assert.equal(manifest.inputs.options.guidedMode.name, 'impact');
    assert.match(manifest.inputs.options.guidedMode.reviewWorkflow.expectedDecisions.join('\n'), /impact target/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
