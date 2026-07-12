/**
 * QA Stage Registry Tests
 */

const assert = require('assert');
const { describe, it } = require('node:test');
const {
  QA_STAGE_REGISTRY,
  loadQAStages,
  getRegistryMetadata,
} = require('../src/qa/qaStageRegistry');

describe('QA Stage Registry', () => {
  it('should have all stages disabled by default', () => {
    for (const stage of Object.values(QA_STAGE_REGISTRY)) {
      assert.strictEqual(stage.enabled, false, `${stage.name} should be disabled by default`);
    }
  });

  it('should return empty array when qa mode is disabled', () => {
    const stages = loadQAStages({ qaMode: false });
    assert.strictEqual(stages.length, 0);
  });

  it('should load all stages when qa mode is enabled', () => {
    const stages = loadQAStages({ qaMode: true });
    assert.strictEqual(stages.length, Object.keys(QA_STAGE_REGISTRY).length);
  });

  it('should provide registry metadata', () => {
    const metadata = getRegistryMetadata();
    assert(metadata.totalStages > 0);
    assert(Array.isArray(metadata.stages));
    assert(metadata.stages.length === metadata.totalStages);
  });

  it('should have consistent stage configuration', () => {
    for (const [key, stage] of Object.entries(QA_STAGE_REGISTRY)) {
      assert(stage.name, `Stage ${key} must have a name`);
      assert(stage.title, `Stage ${key} must have a title`);
      assert(stage.description, `Stage ${key} must have a description`);
      assert(stage.severity, `Stage ${key} must have a severity`);
      assert(['ERROR', 'WARNING', 'INFO'].includes(stage.severity), `Invalid severity for ${key}`);
    }
  });
});
