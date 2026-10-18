const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildFetchMemberPlan,
  checkFetchedSourceFreshness,
  executeReadOnlyMemberFetch,
} = require('../src/fetch/fetchMemberService');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-member-'));
}

test('read-only fetch plan is stable and never contains credentials', () => {
  const cwd = temporaryWorkspace();
  const plan = buildFetchMemberPlan({
    cwd,
    profile: 'dev',
    host: 'jdbc:as400://synthetic-system.example;ssl=true',
    transport: 'jt400',
    sourceLib: 'APPLIB',
    sourceFile: 'QRPGLESRC',
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
    workingContextFingerprint: 'context-1',
  });

  assert.match(plan.planId, /^[a-f0-9]{24}$/);
  assert.equal(plan.remoteMutation, false);
  assert.equal(plan.localArtifactWrite, true);
  assert.equal(plan.endpoint.credentialsIncluded, false);
  assert.equal(JSON.stringify(plan).includes('password'), false);
  assert.equal(plan.output.files[0], 'rpg_sources/QRPGLESRC/ORDERPGM.rpgle');
});

test('read-only fetch plan rejects unsafe output and identifiers', () => {
  const cwd = temporaryWorkspace();
  const base = {
    cwd,
    profile: 'dev',
    host: 'synthetic-system.example',
    sourceLib: 'APPLIB',
    sourceFile: 'QRPGLESRC',
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
  };

  assert.throws(() => buildFetchMemberPlan({ ...base, outputRoot: '../outside' }), /inside/i);
  assert.throws(
    () => buildFetchMemberPlan({ ...base, sourceLib: 'APP/../LIB' }),
    /invalid source library/i
  );
  assert.throws(() => buildFetchMemberPlan({ ...base, members: [] }), /source member/i);
});

test('confirmed fetch writes only the planned local artifact and returns safe metadata', () => {
  const cwd = temporaryWorkspace();
  const plan = buildFetchMemberPlan({
    cwd,
    profile: 'dev',
    host: 'synthetic-system.example',
    sourceLib: 'APPLIB',
    sourceFile: 'QRPGLESRC',
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
  });
  let exporterArgs = null;
  const result = executeReadOnlyMemberFetch({
    cwd,
    plan,
    host: 'synthetic-system.example',
    user: 'operator',
    password: 'do-not-return',
    confirmPlanId: plan.planId,
    exporter: args => {
      exporterArgs = args;
      fs.writeFileSync(args.targetPath, '**FREE\\nD main;\\n', 'utf8');
      return { ok: true, linesWritten: 2, usedFallback: true };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.remoteMutation, false);
  assert.equal(result.fetched[0].path, 'rpg_sources/QRPGLESRC/ORDERPGM.rpgle');
  assert.match(result.fetched[0].sourceFingerprint.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.freshness.status, 'fresh');
  assert.equal(result.sourceFingerprints[0].sha256, result.fetched[0].sha256);
  assert.equal(fs.existsSync(path.join(cwd, result.fetched[0].path)), true);
  assert.equal(exporterArgs.writeMode, 'local');
  assert.equal(exporterArgs.sourceLib, 'APPLIB');
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
});

test('fetched source freshness detects local changes and missing artifacts', () => {
  const cwd = temporaryWorkspace();
  const plan = buildFetchMemberPlan({
    cwd,
    profile: 'dev',
    host: 'synthetic-system.example',
    sourceLib: 'APPLIB',
    sourceFile: 'QRPGLESRC',
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
  });
  const result = executeReadOnlyMemberFetch({
    cwd,
    plan,
    host: 'synthetic-system.example',
    user: 'operator',
    password: 'do-not-return',
    confirmPlanId: plan.planId,
    exporter: args => {
      fs.writeFileSync(args.targetPath, '**FREE\nD main;\n', 'utf8');
      return { ok: true, linesWritten: 2, usedFallback: false };
    },
  });

  assert.equal(checkFetchedSourceFreshness({ cwd, fetched: result.fetched }).status, 'fresh');
  fs.appendFileSync(path.join(cwd, result.fetched[0].path), '// changed\n', 'utf8');
  const changed = checkFetchedSourceFreshness({ cwd, fetched: result.fetched });
  assert.equal(changed.status, 'changed');
  assert.equal(changed.files[0].reason, 'source-file-changed');

  fs.rmSync(path.join(cwd, result.fetched[0].path));
  const missing = checkFetchedSourceFreshness({ cwd, fetched: result.fetched });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.files[0].reason, 'source-file-missing');
});

test('freshness rejects paths outside the workspace without reading them', () => {
  const cwd = temporaryWorkspace();
  const result = checkFetchedSourceFreshness({
    cwd,
    fetched: [{ member: 'ORDERPGM', path: '../outside.rpgle', sha256: 'a'.repeat(64) }],
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.files[0].reason, 'path-outside-workspace');
});

test('fetch plan rejects an output directory linked outside the workspace', t => {
  const cwd = temporaryWorkspace();
  const outside = temporaryWorkspace();
  const link = path.join(cwd, 'linked_sources');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') {
      t.skip('directory links are unavailable');
      return;
    }
    throw error;
  }
  assert.throws(
    () =>
      buildFetchMemberPlan({
        cwd,
        host: 'synthetic-system.example',
        sourceLib: 'APPLIB',
        members: ['ORDERPGM'],
        outputRoot: './linked_sources',
      }),
    /inside the current workspace/i
  );
  fs.writeFileSync(path.join(outside, 'ORDERPGM.rpgle'), '**FREE\n', 'utf8');
  const freshness = checkFetchedSourceFreshness({
    cwd,
    fetched: [{ path: 'linked_sources/ORDERPGM.rpgle', sha256: 'a'.repeat(64) }],
  });
  assert.equal(freshness.files[0].reason, 'path-outside-workspace');
});

test('confirmed fetch rejects a stale or missing confirmation before calling exporter', () => {
  const cwd = temporaryWorkspace();
  const plan = buildFetchMemberPlan({
    cwd,
    profile: 'dev',
    host: 'synthetic-system.example',
    sourceLib: 'APPLIB',
    sourceFile: 'QRPGLESRC',
    members: ['ORDERPGM'],
    outputRoot: './rpg_sources',
  });
  let called = false;

  assert.throws(
    () =>
      executeReadOnlyMemberFetch({
        cwd,
        plan,
        host: 'synthetic-system.example',
        user: 'operator',
        password: 'secret',
        confirmPlanId: '000000000000000000000000',
        exporter: () => {
          called = true;
        },
      }),
    error => error.code === 'FETCH_PLAN_CONFIRMATION_REQUIRED'
  );
  assert.equal(called, false);
});
