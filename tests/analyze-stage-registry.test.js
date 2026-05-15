const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildAnalyzeStageRegistry,
  runAnalyzeCore,
} = require('../src/analyze/analyzePipeline');
const { createAnalyzeStageRegistry } = require('../src/analyze/stageRegistry');

function createAnalyzeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-analyze-plugin-'));
  const sourceRoot = path.join(tempRoot, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'ORDERPGM.rpgle'), '**FREE\nCALL SUBPGM;\n', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'SUBPGM.rpgle'), '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');
  return {
    tempRoot,
    sourceRoot,
  };
}

test('analyze stage registry resolves plugin stages deterministically around core stages', () => {
  const registry = buildAnalyzeStageRegistry({
    plugins: [{
      name: 'custom-audit',
      register({ registerStage }) {
        registerStage({
          id: 'plugin-audit',
          title: 'Plugin audit stage',
          category: 'plugin',
          after: 'build-context',
          before: 'optimize-context',
          run(state) {
            return state;
          },
        });
      },
    }],
  });

  const stageIds = registry.resolveStages().map((stage) => stage.id);
  assert.equal(stageIds.indexOf('plugin-audit') > stageIds.indexOf('build-context'), true);
  assert.equal(stageIds.indexOf('plugin-audit') < stageIds.indexOf('optimize-context'), true);

  const stage = registry.listStages().find((entry) => entry.id === 'plugin-audit');
  assert.equal(stage.pluginName, 'custom-audit');
  assert.deepEqual(stage.before, ['optimize-context']);
  assert.deepEqual(stage.after, ['build-context']);
});

test('analyze stage registry rejects unknown anchors and cyclic ordering', () => {
  const unknownAnchorRegistry = createAnalyzeStageRegistry();
  unknownAnchorRegistry.registerStage({
    id: 'one',
    run(state) {
      return state;
    },
    after: 'missing-stage',
  });
  assert.throws(() => unknownAnchorRegistry.resolveStages(), /unknown after anchor: missing-stage/);

  const cyclicRegistry = createAnalyzeStageRegistry();
  cyclicRegistry.registerStage({
    id: 'one',
    after: 'two',
    run(state) {
      return state;
    },
  });
  cyclicRegistry.registerStage({
    id: 'two',
    after: 'one',
    run(state) {
      return state;
    },
  });
  assert.throws(() => cyclicRegistry.resolveStages(), /contains a cycle/);
});

test('runAnalyzeCore accepts plugin stages and lifecycle hooks without changing core wiring', () => {
  const { tempRoot, sourceRoot } = createAnalyzeFixture();
  const lifecycleEvents = [];

  try {
    const result = runAnalyzeCore({
      program: 'ORDERPGM',
      sourceRoot,
      outputRoot: path.join(tempRoot, 'output'),
      config: {
        extensions: ['.rpgle'],
        contextOptimizer: {},
        testData: { limit: 10, maskColumns: [] },
        db: null,
      },
      testDataLimit: 10,
      skipTestData: true,
      verbose: false,
      optimizeContextEnabled: false,
      logVerbose() {},
      analyzePlugins: [{
        name: 'custom-note-plugin',
        register({ registerStage, registerLifecycleHooks }) {
          registerLifecycleHooks({
            beforeStage({ stage }) {
              lifecycleEvents.push(`before:${stage.id}`);
            },
            afterStage({ stage, stageReport }) {
              lifecycleEvents.push(`after:${stage.id}:${stageReport.status}`);
            },
          });

          registerStage({
            id: 'plugin-note',
            title: 'Inject plugin note',
            description: 'Adds a small plugin-owned marker into the analyze state.',
            category: 'plugin',
            after: 'build-context',
            before: 'investigate-sources',
            run(state) {
              return {
                ...state,
                pluginNote: 'injected',
                stageMetadata: {
                  injected: true,
                },
                stageDiagnostics: [{
                  severity: 'info',
                  code: 'PLUGIN_NOTE',
                  message: 'Plugin stage injected marker state.',
                }],
              };
            },
          });
        },
      }],
    });

    assert.equal(result.pluginNote, 'injected');
    const pluginStage = result.stageReports.find((stage) => stage.id === 'plugin-note');
    assert.ok(pluginStage);
    assert.equal(pluginStage.status, 'completed');
    assert.equal(pluginStage.definition.pluginName, 'custom-note-plugin');
    assert.equal(pluginStage.definition.category, 'plugin');
    assert.equal(pluginStage.definition.registrationOrder >= 0, true);
    assert.deepEqual(pluginStage.metadata, { injected: true });
    assert.ok(result.diagnostics.some((entry) => entry.code === 'PLUGIN_NOTE'));
    assert.ok(lifecycleEvents.includes('before:plugin-note'));
    assert.ok(lifecycleEvents.includes('after:plugin-note:completed'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
