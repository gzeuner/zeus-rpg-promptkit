const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachConnectionTargetMetadata,
  buildConnectionTargetMetadata,
  describeConnectionTarget,
  listConnectionTargetNames,
  matchesConnectionTargetName,
} = require('../src/config/connectionTargetMetadata');

test('connection target metadata normalizes aliases and accepted names', () => {
  const config = attachConnectionTargetMetadata({
    host: 'dev-alias.example.local',
  }, buildConnectionTargetMetadata({
    systemKey: 'dev',
    systemDefinition: {
      displayName: 'Development IBM i',
      systemName: 'SYSDEV',
      aliases: ['DEVBOX', 'sys_test'],
      host: 'dev-alias.example.local',
    },
    resolvedConfig: {
      host: 'dev-alias.example.local',
    },
  }));

  assert.deepEqual(listConnectionTargetNames(config), [
    'DEV',
    'SYSDEV',
    'DEVBOX',
    'SYS_TEST',
    'DEV-ALIAS.EXAMPLE.LOCAL',
  ]);
  assert.equal(matchesConnectionTargetName(config, 'sysdev'), true);
  assert.equal(matchesConnectionTargetName(config, 'SYS_TEST'), true);
  assert.equal(matchesConnectionTargetName(config, 'unknown-system'), false);
  assert.match(describeConnectionTarget(config), /Development IBM i/);
});
