const test = require('node:test');
const assert = require('node:assert/strict');

const { runStages } = require('../src/analyze/runStages');

test('runStages executes stages in order and passes state through', () => {
  const result = runStages([
    {
      id: 'one',
      run(state) {
        return {
          ...state,
          value: state.value + 1,
          order: [...state.order, 'one'],
          stageMetadata: {
            operation: 'increment',
          },
          stageDiagnostics: [{
            severity: 'info',
            code: 'STAGE_ONE',
            message: 'Incremented value.',
          }],
        };
      },
    },
    {
      id: 'two',
      run(state) {
        return { ...state, value: state.value * 2, order: [...state.order, 'two'] };
      },
    },
  ], {
    value: 2,
    order: [],
  });

  assert.equal(result.value, 6);
  assert.deepEqual(result.order, ['one', 'two']);
  assert.equal(result.stageReports.length, 2);
  assert.equal(result.stageReports[0].id, 'one');
  assert.deepEqual(result.stageReports[0].metadata, { operation: 'increment' });
  assert.deepEqual(result.stageReports[0].diagnostics, [{
    severity: 'info',
    code: 'STAGE_ONE',
    message: 'Incremented value.',
  }]);
  assert.equal(result.stageReports[1].id, 'two');
  assert.equal(Array.isArray(result.diagnostics), true);
  assert.equal(result.diagnostics.length, 1);
});

test('runStages rejects invalid stage definitions', () => {
  assert.throws(
    () => runStages([{ id: 'broken' }], {}),
    /Invalid analyze stage: missing run function/,
  );
});

test('runStages records failing stage diagnostics on thrown errors', () => {
  assert.throws(
    () => runStages([
      {
        id: 'boom',
        run() {
          throw new Error('kaputt');
        },
      },
    ], {}),
    (error) => {
      assert.equal(error.stageId, 'boom');
      assert.equal(Array.isArray(error.stageReports), true);
      assert.equal(error.stageReports.length, 1);
      assert.equal(error.stageReports[0].status, 'failed');
      assert.deepEqual(error.stageReports[0].diagnostics, [{
        severity: 'error',
        code: 'STAGE_FAILED',
        message: 'kaputt',
      }]);
      return true;
    },
  );
});
