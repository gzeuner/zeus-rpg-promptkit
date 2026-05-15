/**
 * QA Stage Runner Tests
 */

const assert = require('assert');
const QAStageRunner = require('../../src/qa/qaStageRunner');

describe('QA Stage Runner', () => {
  it('should create runner with correct config', () => {
    const config = {
      name: 'test-stage',
      severity: 'ERROR',
      optional: true,
      stage: {
        validate: async () => ({ test: true }),
      },
    };

    const runner = new QAStageRunner(config);
    assert.strictEqual(runner.name, 'test-stage');
    assert.strictEqual(runner.severity, 'ERROR');
  });

  it('should determine fail-hard behavior correctly', () => {
    const config = {
      name: 'test-stage',
      severity: 'ERROR',
      stage: { validate: () => {} },
    };
    const runner = new QAStageRunner(config);

    assert.strictEqual(runner.shouldFailHard('STRICT'), true);
    assert.strictEqual(runner.shouldFailHard('LENIENT'), false);
    assert.strictEqual(runner.shouldFailHard('UNKNOWN'), true); // Default: errors fail
  });

  it('should handle warning severity correctly', () => {
    const config = {
      name: 'test-stage',
      severity: 'WARNING',
      stage: { validate: () => {} },
    };
    const runner = new QAStageRunner(config);

    assert.strictEqual(runner.shouldFailHard('STRICT'), true); // Strict mode fails on all
    assert.strictEqual(runner.shouldFailHard('LENIENT'), false);
    assert.strictEqual(runner.shouldFailHard('UNKNOWN'), false); // Default: warnings don't fail
  });
});
