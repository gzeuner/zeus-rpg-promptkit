const test = require('node:test');
const assert = require('node:assert/strict');

const QAStageRunner = require('../src/qa/qaStageRunner');

test('qa stage runner supports analyze/check methods besides validate', async () => {
  const analyzeRunner = new QAStageRunner({
    name: 'qa-analyze-stage',
    severity: 'WARNING',
    stage: {
      analyze: async () => ({ ok: true }),
    },
  });
  const checkRunner = new QAStageRunner({
    name: 'qa-check-stage',
    severity: 'WARNING',
    stage: {
      check: async () => ({ ok: true }),
    },
  });

  const analyzeResult = await analyzeRunner.run({ canonicalAnalysis: {}, sourceFiles: [] });
  const checkResult = await checkRunner.run({ canonicalAnalysis: {}, sourceFiles: [] });

  assert.equal(analyzeResult.status, 'COMPLETED');
  assert.equal(checkResult.status, 'COMPLETED');
});
