'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createZeus } = require('zeus-rpg-promptkit/api');
const { generateEphemeralKeyPair, buildUnsignedLicense, signLicenseDocument } = require('../src');
const {
  PINNED_COMMUNITY_SHA,
  MODULE_ID,
  CAPABILITY_ID,
  DIFF_CAPABILITY_ID,
  PUB400_PROFILE_ID,
  PUB400_HOST_LABEL,
  REASON_CODES,
  MODES,
  NON_CLAIMS,
  validateActivationPack,
  buildCompilePlan,
  validateConfirmationToken,
  runCompileValidation,
  runDifferentialExecution,
  createOfflineTransport,
  registerIbmiCompileValidationModule,
  redactDiagnostics,
  assertNoCommandText,
} = require('../src/ibmiValidation');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_CORE_HINT = '84822a68309f123c43e848c7ed2158853364fd46';

function completeActivationPack(overrides = {}) {
  return {
    environmentName: 'pub400-synthetic-nonprod',
    nonProductionConfirmed: true,
    serviceAccount: 'SYNTHUSR',
    commandAllowlistVersion: 'v1-pub400',
    cleanupRollbackDocumentId: 'cleanup-pub400-v1',
    redactionPolicyVersion: 'redact-v1',
    confirmationTokenProcedure: true,
    acceptanceCriteriaId: 'ac-pub400-compile-v1',
    ownerSignatureDate: '2026-07-21',
    threatModelAck: { who: 'owner', when: '2026-07-21' },
    ownedLibraries: ['ZTESTLIB'],
    commandAllowlist: ['crtbndrpg', 'crtrpgmod'],
    cleanupManifest: [
      { action: 'delete-object', library: 'ZTESTLIB', object: 'ZHELLO' },
      { action: 'delete-member', library: 'ZTESTLIB', sourceFile: 'QRPGLESRC', member: 'ZHELLO' },
    ],
    profileId: PUB400_PROFILE_ID,
    hostLabel: PUB400_HOST_LABEL,
    liveAccessAuthorized: false,
    ...overrides,
  };
}

function compileRequest(overrides = {}) {
  return {
    templateId: 'crtbndrpg',
    target: {
      library: 'ZTESTLIB',
      sourceFile: 'QRPGLESRC',
      member: 'ZHELLO',
      object: 'ZHELLO',
      memberType: 'RPGLE',
    },
    sources: [
      {
        member: 'ZHELLO',
        synthetic: true,
        content: "**free\ndsply 'hello';\nreturn;\n",
      },
    ],
    ...overrides,
  };
}

function enterpriseLicense(privateKey, now = new Date('2026-07-21T12:00:00.000Z')) {
  return signLicenseDocument(
    buildUnsignedLicense({
      edition: 'enterprise',
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }),
    privateKey
  );
}

test('unified package is self-contained under Apache-2.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'zeus-rpg-promptkit');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.dependencies['zeus-rpg-promptkit'], undefined);
  assert.equal(PINNED_COMMUNITY_SHA, PUBLIC_CORE_HINT);
});

test('activation pack rejects missing gates and credential fields', () => {
  const incomplete = validateActivationPack({});
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.reasonCode, REASON_CODES.OWNER_GATE_INCOMPLETE);
  assert.ok(incomplete.missing.length > 0);

  const withSecret = validateActivationPack(
    completeActivationPack({ password: 'should-never-be-here' })
  );
  assert.equal(withSecret.ok, false);
  assert.equal(withSecret.reasonCode, REASON_CODES.OWNER_GATE_INCOMPLETE);

  const prod = validateActivationPack(
    completeActivationPack({ environmentName: 'production-lpar-1' })
  );
  assert.equal(prod.ok, false);
  assert.equal(prod.reasonCode, REASON_CODES.TARGET_DENIED);

  const ok = validateActivationPack(completeActivationPack());
  assert.equal(ok.ok, true);
  assert.equal(ok.pack.liveAccessAuthorized, false);
  assert.equal(ok.pack.profileId, PUB400_PROFILE_ID);
});

test('free-form command text is denied', () => {
  const denied = assertNoCommandText('CRTBNDRPG PGM(FOO)');
  assert.equal(denied.ok, false);
  assert.equal(denied.reasonCode, REASON_CODES.COMMAND_DENIED);
});

test('name validation rejects foreign libraries and bad names', async () => {
  const pack = completeActivationPack();
  const gate = validateActivationPack(pack);
  const badLib = buildCompilePlan(
    compileRequest({
      target: {
        library: 'QGPL',
        sourceFile: 'QRPGLESRC',
        member: 'ZHELLO',
        object: 'ZHELLO',
      },
    }),
    gate.pack
  );
  assert.equal(badLib.ok, false);
  assert.equal(badLib.reasonCode, REASON_CODES.TARGET_DENIED);

  const badName = buildCompilePlan(
    compileRequest({
      target: {
        library: 'ZTESTLIB',
        sourceFile: 'QRPGLESRC',
        member: 'bad name!!',
        object: 'ZHELLO',
      },
    }),
    gate.pack
  );
  assert.equal(badName.ok, false);
  assert.equal(badName.reasonCode, REASON_CODES.NAME_INVALID);
});

test('plan hash binds confirmation token', () => {
  const gate = validateActivationPack(completeActivationPack());
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.OFFLINE);
  assert.equal(plan.ok, true);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);

  const bad = validateConfirmationToken('confirm:deadbeef:nonce', plan.planHash);
  assert.equal(bad.ok, false);
  assert.equal(bad.reasonCode, REASON_CODES.CONFIRMATION_INVALID);

  const good = validateConfirmationToken(`confirm:${plan.planHash}:operator-1`, plan.planHash);
  assert.equal(good.ok, true);
  assert.match(good.confirmationTokenFingerprint, /^[a-f0-9]{64}$/);
});

test('offline synthetic compile produces evidence and non-claims', async () => {
  const pack = completeActivationPack();
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.OFFLINE);
  const token = `confirm:${plan.planHash}:offline-test`;

  const result = await runCompileValidation({
    mode: MODES.OFFLINE,
    activationPack: pack,
    request: compileRequest(),
    confirmationToken: token,
    profileId: PUB400_PROFILE_ID,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, REASON_CODES.OK);
  assert.equal(result.mode, MODES.OFFLINE);
  assert.ok(result.evidence);
  assert.equal(result.evidence.contractRef, 'zeus-enterprise.ibmi-compile-evidence@1');
  assert.equal(result.evidence.claims.deployed, false);
  assert.equal(result.evidence.claims.productionValidated, false);
  assert.equal(result.claims.deployed, false);
  assert.ok(Array.isArray(result.diagnostics));
  assert.equal(result.cleanup.completed, true);
});

test('live mode fails closed without liveAccessAuthorized and without factory', async () => {
  const pack = completeActivationPack({ liveAccessAuthorized: false });
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.LIVE);
  const token = `confirm:${plan.planHash}:live-deny`;

  const denied = await runCompileValidation({
    mode: MODES.LIVE,
    activationPack: pack,
    request: compileRequest(),
    confirmationToken: token,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reasonCode, REASON_CODES.LIVE_DISABLED);

  const packLive = completeActivationPack({ liveAccessAuthorized: true });
  const gateLive = validateActivationPack(packLive);
  const planLive = buildCompilePlan(compileRequest(), gateLive.pack, MODES.LIVE);
  const tokenLive = `confirm:${planLive.planHash}:live-nofactory`;
  const noFactory = await runCompileValidation({
    mode: MODES.LIVE,
    activationPack: packLive,
    request: compileRequest(),
    confirmationToken: tokenLive,
  });
  assert.equal(noFactory.ok, false);
  assert.equal(noFactory.reasonCode, REASON_CODES.LIVE_DISABLED);
});

test('refuse-if-exists blocks compile on pre-existing object', async () => {
  const pack = completeActivationPack();
  const transport = createOfflineTransport({
    existingObjects: [{ library: 'ZTESTLIB', object: 'ZHELLO' }],
  });
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.OFFLINE);
  const token = `confirm:${plan.planHash}:exists`;

  const result = await runCompileValidation({
    mode: MODES.OFFLINE,
    activationPack: pack,
    request: compileRequest(),
    confirmationToken: token,
    transport,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.OBJECT_EXISTS_REFUSED);
});

test('unknown template and non-synthetic sources are denied', async () => {
  const pack = completeActivationPack();
  const gate = validateActivationPack(pack);

  const badTemplate = buildCompilePlan(compileRequest({ templateId: 'dltlib' }), gate.pack);
  assert.equal(badTemplate.ok, false);
  assert.equal(badTemplate.reasonCode, REASON_CODES.TEMPLATE_DENIED);

  const nonSynthetic = buildCompilePlan(
    compileRequest({
      sources: [{ member: 'ZHELLO', content: 'x', synthetic: false }],
    }),
    gate.pack
  );
  assert.equal(nonSynthetic.ok, false);
  assert.equal(nonSynthetic.reasonCode, REASON_CODES.INPUT_INVALID);
});

test('redaction strips secrets from diagnostics', () => {
  const redacted = redactDiagnostics([
    {
      id: 'SEC1',
      severity: 'error',
      message: 'password=super-secret token=abc bearer xyz',
      source: 'ZHELLO',
      line: 2,
    },
  ]);
  assert.equal(redacted.ok, true);
  assert.match(redacted.diagnostics[0].message, /redacted/i);
  assert.doesNotMatch(redacted.diagnostics[0].message, /super-secret/);
});

test('cleanup residual blocks approval', async () => {
  const pack = completeActivationPack({
    cleanupManifest: [{ action: 'report-residual', library: 'ZTESTLIB', object: 'ZHELLO' }],
  });
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.OFFLINE);
  const token = `confirm:${plan.planHash}:residual`;

  const result = await runCompileValidation({
    mode: MODES.OFFLINE,
    activationPack: pack,
    request: compileRequest(),
    confirmationToken: token,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.CLEANUP_RESIDUAL);
  assert.ok(result.evidence);
});

test('dry-run performs preflight only', async () => {
  const pack = completeActivationPack();
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.DRY_RUN);
  const token = `confirm:${plan.planHash}:dry`;

  const result = await runCompileValidation({
    mode: MODES.DRY_RUN,
    activationPack: pack,
    request: compileRequest(),
    confirmationToken: token,
  });
  assert.equal(result.ok, true);
  assert.equal(result.preflightOnly, true);
  assert.equal(result.evidence.objectOutcomes[0].status, 'preflight-only');
});

test('differential synthetic compare blocks on mismatch', async () => {
  const pack = completeActivationPack({
    differential: {
      enabled: true,
      testDataIsolated: true,
      snapshotRestoreProven: true,
      sideEffectInventory: ['database', 'spooled'],
    },
  });

  const mismatch = await runDifferentialExecution({
    mode: MODES.OFFLINE,
    activationPack: pack,
    baselineOutputs: {
      synthetic: true,
      returnCode: 0,
      outputs: ['A'],
      sideEffects: [{ class: 'database', fingerprint: 'x' }],
    },
    candidateOutputs: {
      synthetic: true,
      returnCode: 1,
      outputs: ['B'],
      sideEffects: [{ class: 'database', fingerprint: 'x' }],
    },
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reasonCode, REASON_CODES.APPROVAL_BLOCKED);
  assert.ok(mismatch.differences.length >= 1);

  const match = await runDifferentialExecution({
    mode: MODES.OFFLINE,
    activationPack: pack,
    baselineOutputs: {
      synthetic: true,
      returnCode: 0,
      outputs: ['A'],
      sideEffects: [{ class: 'database', fingerprint: 'x' }],
    },
    candidateOutputs: {
      synthetic: true,
      returnCode: 0,
      outputs: ['A'],
      sideEffects: [{ class: 'database', fingerprint: 'x' }],
    },
  });
  assert.equal(match.ok, true);
});

test('enterprise entitlement registers S4 capabilities; professional does not', async () => {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const now = new Date('2026-07-21T12:00:00.000Z');
  const zeus = createZeus();

  const denied = await registerIbmiCompileValidationModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: signLicenseDocument(
      buildUnsignedLicense({
        edition: 'professional',
        notBefore: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 3_600_000),
      }),
      privateKey
    ),
    now,
  });
  assert.equal(denied.ok, false);
  assert.equal(zeus.capabilities.get(CAPABILITY_ID), null);

  const ok = await registerIbmiCompileValidationModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument: enterpriseLicense(privateKey, now),
    now,
  });
  assert.equal(ok.ok, true);
  assert.ok(zeus.capabilities.get(CAPABILITY_ID));
  assert.ok(zeus.capabilities.get(DIFF_CAPABILITY_ID));
  assert.equal(MODULE_ID, 'zeus-enterprise.ibmi-compile-validation');

  const pack = completeActivationPack();
  const gate = validateActivationPack(pack);
  const plan = buildCompilePlan(compileRequest(), gate.pack, MODES.OFFLINE);
  const token = `confirm:${plan.planHash}:cap`;
  const exec = await zeus.capabilities.execute(
    CAPABILITY_ID,
    {},
    {
      mode: MODES.OFFLINE,
      activationPack: pack,
      request: compileRequest(),
      confirmationToken: token,
      profileId: PUB400_PROFILE_ID,
    }
  );
  assert.equal(exec.ok, true);
  assert.equal(exec.result.ok, true);
  assert.equal(exec.result.claims.deployed, NON_CLAIMS.deployed);
});

test('module source tree contains no embedded secrets or production host passwords', () => {
  const dir = path.join(ROOT, 'src/ibmiValidation');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.js'));
  const content = files.map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(content, /BEGIN (RSA|OPENSSH|PRIVATE) KEY/i);
  assert.doesNotMatch(content, /password\s*[:=]\s*['"][^'"]+['"]/i);
  assert.doesNotMatch(content, /kind:\s*Secret/i);
});
