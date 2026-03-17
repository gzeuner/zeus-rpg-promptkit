const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCopyCommand,
  DEFAULT_STREAM_FILE_CCSID,
  buildRemoteTargetPath,
  shouldUseJdbcFallback,
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

test('buildRemoteTargetPath resolves the remote IFS stream file path', () => {
  const targetPath = buildRemoteTargetPath({
    sourceFile: 'QRPGLESRC',
    member: 'ORDERPGM',
    ifsDir: '/home/zeus/rpg_sources',
  });

  assert.equal(targetPath, '/home/zeus/rpg_sources/QRPGLESRC/ORDERPGM.rpgle');
});

test('shouldUseJdbcFallback detects CCSID 65535 export failures', () => {
  assert.equal(shouldUseJdbcFallback({
    messages: ['CPDA08C Datenbankdatei hat CCSID 65535.'],
    stderr: '',
  }), true);

  assert.equal(shouldUseJdbcFallback({
    messages: ['CPF0000 Something else happened.'],
    stderr: '',
  }), false);
});
