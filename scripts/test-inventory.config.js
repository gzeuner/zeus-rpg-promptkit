'use strict';

module.exports = {
  categories: {
    contract: [
      'tests/ai-knowledge-projection.test.js',
      'tests/analyze-run-manifest.test.js',
      'tests/bundle-manifest.test.js',
      'tests/cli-help.test.js',
      'tests/evidence-graph.test.js',
      'tests/graph-guided-context-planner.test.js',
      'tests/release-integrity.test.js',
      'tests/repository-control.test.js',
      'tests/fetch-readability-contract.test.js',
      'tests/schema-registry.test.js',
      'tests/task-oriented-analysis-index.test.js',
      'tests/tool-catalog-generator.test.js',
      'tests/workflow-presets.test.js',
    ],
    smoke: [
      'tests/reproducible-output.test.js',
      'tests/safe-sharing.test.js',
      'tests/v1-smoke.test.js',
    ],
    corpus: ['tests/scanner-corpus.test.js'],
    benchmark: ['tests/analyze-benchmark.test.js'],
    quality: ['tests/golden-quality.test.js'],
    unit: ['tests/test-inventory.test.js', 'tests/typecheck-scope.test.js'],
  },
  exclusions: [],
};
