const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { executeBridgeCommand } = require('../src/cli/commands/bridgeCommand');
const { buildApprovalRecord } = require('../src/bridge/bridgeApprovalModel');
const { buildChangePlan } = require('../src/bridge/bridgePlanModel');
const { BridgeRefusalError } = require('../src/bridge/bridgeRefusal');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-bridge-command-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'profiles.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return tempRoot;
}

function writePlanAndApproval({
  tempRoot,
  profileName = 'local',
  program = 'ORDERPGM',
  approvedActions = ['stage'],
  overrideApproval = {},
}) {
  const outputProgramDir = path.join(tempRoot, 'output', program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  const plan = buildChangePlan({
    program,
    profileName,
    localSourcePath: './workspace/ORDERPGM.rpgle.txt',
    targetType: 'source-member',
    target: {
      targetType: 'source-member',
      library: 'APPLIB',
      sourceFile: 'QRPGLESRC',
      member: 'ORDERPGM',
    },
    beforeHash: 'before-hash',
    afterHash: 'after-hash',
    diffSummary: '1 line changed',
  });
  fs.writeFileSync(
    path.join(outputProgramDir, 'change-plan.json'),
    `${JSON.stringify(plan, null, 2)}\n`,
    'utf8'
  );

  const approval = {
    ...buildApprovalRecord({
      program,
      profileName,
      plan,
      approvedActions,
      approvedBy: 'operator.user',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    ...overrideApproval,
  };
  fs.writeFileSync(
    path.join(outputProgramDir, 'bridge-approval.json'),
    `${JSON.stringify(approval, null, 2)}\n`,
    'utf8'
  );
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
      () =>
        executeBridgeCommand(
          {
            _: ['plan'],
            profile: 'local',
            program: 'ORDERPGM',
            source: './workspace/ORDERPGM.rpgle.txt',
            'target-lib': 'APPLIB',
            'target-file': 'QRPGLESRC',
            'target-member': 'ORDERPGM',
          },
          {
            cwd: tempRoot,
            env: {},
          }
        ),
      error => error instanceof BridgeRefusalError && error.code === 'BRIDGE_DISABLED'
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
      () =>
        executeBridgeCommand(
          {
            _: ['plan'],
            profile: 'local',
            program: 'ORDERPGM',
            source: './workspace/ORDERPGM.rpgle.txt',
            'target-lib': 'APPLIB',
            'target-file': 'QRPGLESRC',
            'target-member': 'ORDERPGM',
          },
          {
            cwd: tempRoot,
            env: {},
          }
        ),
      error => error instanceof BridgeRefusalError && error.code === 'TARGET_NOT_ALLOWLISTED'
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
    const result = await executeBridgeCommand(
      {
        _: ['stage'],
        profile: 'local',
        program: 'ORDERPGM',
        'dry-run': 'true',
      },
      {
        cwd: tempRoot,
        env: {},
        remoteMutation() {
          mutationCalls += 1;
        },
      }
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.dryRun, true);
    assert.equal(result.approval.status, 'missing-plan');
    assert.equal(mutationCalls, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge stage dry-run reports accepted approval when plan and approval match', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: true,
        requireConfirmation: true,
      },
    },
  });

  try {
    writePlanAndApproval({
      tempRoot,
      approvedActions: ['stage'],
    });

    const result = await executeBridgeCommand(
      {
        _: ['stage'],
        profile: 'local',
        program: 'ORDERPGM',
        'dry-run': 'true',
      },
      {
        cwd: tempRoot,
        env: {},
      }
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.approval.status, 'accepted');
    assert.equal(result.approval.code, 'APPROVAL_ACCEPTED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge stage dry-run reports rejected approval when action is not approved', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: true,
        requireConfirmation: true,
      },
    },
  });

  try {
    writePlanAndApproval({
      tempRoot,
      approvedActions: ['apply'],
    });
    const result = await executeBridgeCommand(
      {
        _: ['stage'],
        profile: 'local',
        program: 'ORDERPGM',
        'dry-run': 'true',
      },
      {
        cwd: tempRoot,
        env: {},
      }
    );
    assert.equal(result.approval.status, 'rejected');
    assert.equal(result.approval.code, 'APPROVAL_ACTION_NOT_APPROVED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge apply non-dry-run refuses and writes approval-check audit events', async () => {
  const tempRoot = createTempProject({
    local: {
      outputRoot: './output',
      bridge: {
        enabled: true,
        requireConfirmation: true,
      },
    },
  });

  try {
    writePlanAndApproval({
      tempRoot,
      approvedActions: ['apply'],
    });
    await assert.rejects(
      () =>
        executeBridgeCommand(
          {
            _: ['apply'],
            profile: 'local',
            program: 'ORDERPGM',
            'dry-run': 'false',
          },
          {
            cwd: tempRoot,
            env: {},
          }
        ),
      error =>
        error instanceof BridgeRefusalError && error.code === 'BRIDGE_EXECUTION_NOT_IMPLEMENTED'
    );

    const auditPath = path.join(tempRoot, 'output', 'audit', 'bridge-audit.jsonl');
    const events = fs
      .readFileSync(auditPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map(line => JSON.parse(line));

    assert.ok(
      events.some(
        entry => entry.action === 'apply-approval-check' && entry.result === 'APPROVAL_ACCEPTED'
      )
    );
    assert.ok(
      events.some(entry => entry.action === 'apply' && entry.result === 'refused-not-implemented')
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
