const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCopyCommand,
  DEFAULT_STREAM_FILE_CCSID,
} = require('../src/fetch/ifsExporter');

test('buildCopyCommand uses UTF-8 stream file CCSID by default', () => {
  const command = buildCopyCommand({
    sourceLib: 'SOURCEN',
    sourceFile: 'QRPGLESRC',
    member: 'ORDERPGM',
    ifsDir: '/home/zeus/rpg_sources',
    replace: true,
  });

  assert.match(command, /STMFCODPAG\(1208\)/);
  assert.equal(DEFAULT_STREAM_FILE_CCSID, 1208);
});

test('buildCopyCommand allows an explicit stream file CCSID override', () => {
  const command = buildCopyCommand({
    sourceLib: 'SOURCEN',
    sourceFile: 'QCLLESRC',
    member: 'RUNJOB',
    ifsDir: '/home/zeus/rpg_sources',
    replace: false,
    streamFileCcsid: 1252,
  });

  assert.match(command, /STMFOPT\(\*NONE\)/);
  assert.match(command, /STMFCODPAG\(1252\)/);
  assert.match(command, /RUNJOB\.clle/);
});
