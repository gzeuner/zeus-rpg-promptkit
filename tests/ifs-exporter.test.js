const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCopyCommand,
  DEFAULT_STREAM_FILE_CCSID,
  buildRemoteTargetPath,
  shouldUseJdbcFallback,
} = require('../src/fetch/ifsExporter');
const { readSanitizedFixtureJson } = require('./helpers/fixtureCorpus');

const ifsFixtures = readSanitizedFixtureJson('ifs', 'export-cases.json');

test('buildCopyCommand uses UTF-8 stream file CCSID by default', () => {
  const command = buildCopyCommand(ifsFixtures.defaultUtf8);

  assert.match(command, new RegExp(`STMFCODPAG\\(${ifsFixtures.defaultUtf8.expectedCcsid}\\)`));
  assert.equal(DEFAULT_STREAM_FILE_CCSID, ifsFixtures.defaultUtf8.expectedCcsid);
});

test('buildCopyCommand allows an explicit stream file CCSID override', () => {
  const command = buildCopyCommand(ifsFixtures.explicitCcsid);

  assert.match(command, /STMFOPT\(\*NONE\)/);
  assert.match(command, new RegExp(`STMFCODPAG\\(${ifsFixtures.explicitCcsid.expectedCcsid}\\)`));
  assert.match(command, new RegExp(`${ifsFixtures.explicitCcsid.expectedSuffix.replace('.', '\\.')}`));
});

test('buildRemoteTargetPath resolves the remote IFS stream file path', () => {
  const targetPath = buildRemoteTargetPath(ifsFixtures.defaultUtf8);

  assert.equal(targetPath, ifsFixtures.defaultUtf8.expectedRemotePath);
});

test('shouldUseJdbcFallback detects CCSID 65535 export failures', () => {
  assert.equal(shouldUseJdbcFallback(ifsFixtures.jdbcFallback.positive), true);

  assert.equal(shouldUseJdbcFallback(ifsFixtures.jdbcFallback.negative), false);
});
