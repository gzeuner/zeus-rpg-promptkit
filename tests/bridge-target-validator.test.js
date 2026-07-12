const test = require('node:test');
const assert = require('node:assert/strict');

const { validateBridgeTarget } = require('../src/bridge/bridgeTargetValidator');

test('validateBridgeTarget rejects dangerous member values', () => {
  assert.throws(
    () =>
      validateBridgeTarget(
        {
          targetType: 'source-member',
          library: 'APPLIB',
          sourceFile: 'QRPGLESRC',
          member: '*ALL',
        },
        {
          libraries: ['APPLIB'],
          sourceFiles: ['QRPGLESRC'],
          ifsPaths: [],
        }
      ),
    /Invalid bridge target member/
  );
});

test('validateBridgeTarget flags non-allowlisted source member target', () => {
  const result = validateBridgeTarget(
    {
      targetType: 'source-member',
      library: 'APPDATA',
      sourceFile: 'QRPGLESRC',
      member: 'ORDERPGM',
    },
    {
      libraries: ['APPLIB'],
      sourceFiles: ['QCLLESRC'],
      ifsPaths: [],
    }
  );

  assert.equal(result.allowlisted, false);
});

test('validateBridgeTarget rejects parent traversal in IFS paths', () => {
  assert.throws(
    () =>
      validateBridgeTarget(
        {
          targetType: 'ifs-streamfile',
          ifsPath: '/tmp/../prod/ORDERPGM.rpgle',
        },
        {
          libraries: [],
          sourceFiles: [],
          ifsPaths: ['/tmp'],
        }
      ),
    /parent traversal/
  );
});
