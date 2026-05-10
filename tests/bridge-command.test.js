const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { executeBridgeCommand } = require('../src/cli/commands/bridgeCommand');
const { BridgeRefusalError } = require('../src/bridge/bridgeRefusal');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bridge-command-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'profiles.json'), `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  return tempRoot;
}

test('bridge command refuses when bridge.enabled is not true', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: false,
      },
    },
  });

  try {
    await assert.rejects(
      () => executeBridgeCommand({
        _: ['plan'],
        profile: 'local',
        program: 'ORDERPGM',
        source: './workspace/ORDERPGM.rpgle.txt',
        'target-lib': 'APPLIB',
        'target-file': 'QRPGLESRC',
        'target-member': 'ORDERPGM',
      }, {
        cwd: tempRoot,
        env: {},
      }),
      (error) => error instanceof BridgeRefusalError && error.code === 'BRIDGE_DISABLED',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge plan refuses target that is not allowlisted', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: true,
        allowedTargets: {
          libraries: ['APPLIB'],
          sourceFiles: ['QCLLESRC'],
          ifsPaths: [],
        },
      },
    },
  });

  try {
    await assert.rejects(
      () => executeBridgeCommand({
        _: ['plan'],
        profile: 'local',
        program: 'ORDERPGM',
        source: './workspace/ORDERPGM.rpgle.txt',
        'target-lib': 'APPLIB',
        'target-file': 'QRPGLESRC',
        'target-member': 'ORDERPGM',
      }, {
        cwd: tempRoot,
        env: {},
      }),
      (error) => error instanceof BridgeRefusalError && error.code === 'TARGET_NOT_ALLOWLISTED',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge stage dry-run does not trigger remote mutation', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: true,
      },
    },
  });
  let mutationCalls = 0;

  try {
    const result = await executeBridgeCommand({
      _: ['stage'],
      profile: 'local',
      program: 'ORDERPGM',
      'dry-run': 'true',
    }, {
      cwd: tempRoot,
      env: {},
      remoteMutation() {
        mutationCalls += 1;
      },
    });
    assert.equal(result.status, 'skipped');
    assert.equal(result.dryRun, true);
    assert.equal(mutationCalls, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
