const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { planResourceJob } = require('../src/config/resourceAccessPlan');
const {
  executeResourceJob,
  confirmAndExecuteResourceJob,
} = require('../src/core/resourceAccessService');
const {
  planResourceInvestigation,
  openResourceInvestigation,
} = require('../src/core/resourceInvestigationService');

function jobProfile() {
  return {
    systems: {
      test: { host: 'dev.example.test', user: 'neutral', password: 'synthetic-only' },
      prod: { host: 'prod.example.test', user: 'neutral', password: 'synthetic-only' },
    },
    resourceCatalog: {
      'dev.source': {
        kind: 'sourceCode',
        system: 'test',
        library: 'SOURCE',
        sourceFiles: ['QRPGLESRC'],
        maxMembers: 5,
      },
      'prod.metadata': { kind: 'metadata', system: 'prod', schemas: ['DATA'] },
    },
  };
}

function investigationFixture() {
  const profile = jobProfile();
  profile.resourceCatalog.samples = {
    kind: 'data',
    system: 'test',
    schemas: ['DATA'],
    tables: ['MYTABLE'],
    columns: ['ID', 'NAME'],
    maskColumns: ['NAME'],
    maxRows: 5,
  };
  const job = {
    goal: 'Neutral investigation',
    dataAccess: 'samples',
    resources: [
      {
        ref: 'samples',
        schemas: ['DATA'],
        tables: ['MYTABLE'],
        columns: ['ID', 'NAME'],
        maxRows: 2,
      },
    ],
  };
  const loadPlan = () => planResourceJob({ profile, job, cwd: os.tmpdir() });
  const plan = loadPlan();
  const calls = [];
  const audit = [];
  const services = {
    query: args => {
      calls.push(args);
      return { columns: ['ID', 'NAME'], rows: [{ ID: 1, NAME: 'private-name' }] };
    },
  };
  let time = 1000;
  let selectionHash = 'a'.repeat(64);
  const reviewed = planResourceInvestigation({
    plan,
    sessionId: 'neutral-session',
    operatorId: 'neutral-operator',
    limits: { queries: 3, rows: 6, bytes: 4096, durationMs: 1000 },
    selectionHash,
    now: () => time,
  });
  const request = {
    ref: 'samples',
    schema: 'DATA',
    table: 'MYTABLE',
    columns: ['ID', 'NAME'],
    maxRows: 2,
  };
  return {
    profile,
    job,
    reviewed,
    request,
    calls,
    audit,
    loadPlan,
    loadSelection: () => selectionHash,
    services,
    changeSelection: () => {
      selectionHash = 'b'.repeat(64);
    },
    advance: () => {
      time += 1001;
    },
    open: (approve = reviewed.approvalHash) =>
      openResourceInvestigation({
        reviewed,
        approve,
        loadPlan,
        loadSelection: () => selectionHash,
        now: () => time,
        audit: event => audit.push(event),
        services,
      }),
  };
}

test('scoped investigation approves two different SELECTs once and audits masked evidence', async () => {
  const fixture = investigationFixture();
  assert.throws(() => fixture.open(fixture.reviewed.planHash), /INVESTIGATION_APPROVAL_REQUIRED/);
  const session = fixture.open();
  const first = await session.select(fixture.request);
  const second = await session.select({ ...fixture.request, where: [{ column: 'ID', equals: 2 }] });
  assert.equal(fixture.calls.length, 2);
  assert.notEqual(fixture.calls[0].query, fixture.calls[1].query);
  assert.match(fixture.calls[1].query, /WHERE "ID" = 2/);
  assert.equal(first.rows[0].NAME, '[MASKED]');
  assert.equal(second.rows[0].NAME, '[MASKED]');
  assert.equal(session.summary().approvalCount, 1);
  assert.doesNotMatch(JSON.stringify(fixture.audit), /private-name|synthetic-only|example\.test/);
  assert.equal(fixture.audit.filter(event => event.status === 'started').length, 2);
  for (const request of [
    { ...fixture.request, table: 'OTHER' },
    { ...fixture.request, columns: ['SECRET'] },
    { ...fixture.request, query: 'SELECT * FROM DATA.OTHER' },
    { ...fixture.request, where: [{ column: 'SECRET', equals: 1 }] },
    { ...fixture.request, maxRows: 3 },
  ])
    await assert.rejects(session.select(request), /INVESTIGATION_(SCOPE|REQUEST)_DENIED/);
  assert.equal(fixture.calls.length, 2);
});

test('investigation blocks expiry, revocation, authority changes and exhausted budgets before transport', async () => {
  for (const change of ['expiry', 'revocation', 'authority', 'target', 'scope', 'budget']) {
    const fixture = investigationFixture();
    const session = fixture.open();
    if (change === 'expiry') fixture.advance();
    if (change === 'revocation') session.revoke();
    if (change === 'authority') fixture.profile.systems.test.user = 'other-operator';
    if (change === 'target') fixture.profile.systems.test.host = 'other.example.test';
    if (change === 'scope') fixture.job.goal = 'other-purpose';
    if (change === 'selection') fixture.changeSelection();
    if (change === 'budget')
      for (let index = 0; index < 3; index++) await session.select(fixture.request);
    const before = fixture.calls.length;
    await assert.rejects(
      session.select(fixture.request),
      /INVESTIGATION_(EXPIRED|REVOKED|INPUT_CHANGED|BUDGET_EXHAUSTED)/
    );
    assert.equal(fixture.calls.length, before);
  }
});

test('investigation rejects disclosure, row exhaustion, serialized grants and audit-time changes', async () => {
  const fixture = investigationFixture();
  assert.throws(
    () =>
      planResourceInvestigation({
        plan: fixture.loadPlan(),
        sessionId: 'neutral-session',
        operatorId: 'synthetic-only',
        limits: fixture.reviewed.limits,
        now: () => 1000,
      }),
    /INVESTIGATION_REVIEW_DISCLOSURE_DENIED/
  );
  assert.throws(
    () =>
      openResourceInvestigation({
        reviewed: structuredClone(fixture.reviewed),
        approve: fixture.reviewed.approvalHash,
      }),
    /INVESTIGATION_REVIEW_INVALID/
  );
  const limited = planResourceInvestigation({
    plan: fixture.loadPlan(),
    sessionId: 'neutral-session',
    operatorId: 'neutral-operator',
    limits: { ...fixture.reviewed.limits, rows: 1 },
    now: () => 1000,
  });
  const session = openResourceInvestigation({
    reviewed: limited,
    approve: limited.approvalHash,
    loadPlan: fixture.loadPlan,
    now: () => 1000,
    audit: event => fixture.audit.push(event),
    services: fixture.services,
  });
  await assert.rejects(session.select(fixture.request), /INVESTIGATION_BUDGET_EXHAUSTED/);
  assert.equal(fixture.calls.length, 0);
  const changed = openResourceInvestigation({
    reviewed: fixture.reviewed,
    approve: fixture.reviewed.approvalHash,
    loadPlan: fixture.loadPlan,
    loadSelection: fixture.loadSelection,
    now: () => 1000,
    audit: () => {
      fixture.profile.systems.test.user = 'changed-after-audit';
    },
    services: fixture.services,
  });
  await assert.rejects(changed.select(fixture.request), /INVESTIGATION_INPUT_CHANGED/);
  assert.equal(fixture.calls.length, 0);
});

test('workflow baseline reports two-query timings and deterministic preparation counts', async t => {
  const before = [];
  const after = [];
  const preparationCounts = { before: [], after: [] };
  const warmSampleCount = 20;
  let prepareCalls = 0;
  const prepare = () => {
    prepareCalls += 1;
    return execFileSync(process.execPath, ['-e', 'require("node:assert/strict").equal(1 + 1, 2)'], {
      encoding: 'utf8',
      timeout: 10000,
    });
  };
  for (let sample = 0; sample <= warmSampleCount; sample++) {
    const fixture = investigationFixture();
    const original = fixture.services.query;
    fixture.services.query = args => {
      prepare();
      return original(args);
    };
    const runBefore = async () => {
      const started = performance.now();
      for (let index = 0; index < 2; index++)
        await confirmAndExecuteResourceJob({
          args: {},
          loader: () => ({ plan: fixture.loadPlan() }),
          services: fixture.services,
          confirm: async () => {
            prepare();
            return true;
          },
        });
      return performance.now() - started;
    };
    const runAfter = async () => {
      const started = performance.now();
      prepare();
      const session = fixture.open();
      await session.select(fixture.request);
      await session.select({ ...fixture.request, where: [{ column: 'ID', equals: 2 }] });
      assert.equal(session.summary().approvalCount, 1);
      return performance.now() - started;
    };
    if (sample % 2 === 0) {
      let startedWith = prepareCalls;
      before.push(await runBefore());
      preparationCounts.before.push(prepareCalls - startedWith);
      startedWith = prepareCalls;
      after.push(await runAfter());
      preparationCounts.after.push(prepareCalls - startedWith);
    } else {
      let startedWith = prepareCalls;
      after.push(await runAfter());
      preparationCounts.after.push(prepareCalls - startedWith);
      startedWith = prepareCalls;
      before.push(await runBefore());
      preparationCounts.before.push(prepareCalls - startedWith);
    }
  }
  const summarize = samples => {
    const warm = samples.slice(1).sort((left, right) => left - right);
    return {
      coldMs: samples[0],
      warmSamples: warm.length,
      p50Ms: warm[Math.ceil(warm.length * 0.5) - 1],
      p95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
    };
  };
  const report = {
    schemaVersion: 'workflow-performance/v1',
    fixture: 'neutral-two-query-process-overhead/v1',
    node: process.versions.node,
    platform: process.platform,
    before: { ...summarize(before), approvalCount: 2, queries: 2 },
    after: { ...summarize(after), approvalCount: 1, queries: 2 },
    preparationCounts,
    pairedRegression: summarize(after.map((duration, index) => duration - before[index])),
    remoteIBM: 'not-measured',
    humanWait: 'not-measured',
  };
  t.diagnostic(JSON.stringify(report));
  assert.ok(
    preparationCounts.before.every((count, index) => count > preparationCounts.after[index]),
    'scoped execution must perform fewer deterministic preparation steps for each pair'
  );
});

test('resource job selects explicit multi-system scopes without exposing credentials', () => {
  const job = {
    goal: 'Neutral dependency analysis',
    outputRoot: 'output/job',
    resources: [
      { ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['MYPGM'] },
      { ref: 'prod.metadata', schemas: ['DATA'], tables: ['MYTABLE'] },
    ],
  };
  const plan = planResourceJob({
    profile: jobProfile(),
    job,
    profileName: 'neutral',
    configPath: path.join(os.tmpdir(), 'profiles.neutral.json'),
    cwd: os.tmpdir(),
  });
  assert.equal(plan.remoteMutation, false);
  assert.equal(plan.approvalRequired, true);
  assert.deepEqual(plan.systems, ['prod', 'test']);
  assert.equal(JSON.stringify(plan).includes('synthetic-only'), false);
  assert.equal(JSON.stringify(plan).includes('dev.example.test'), false);
  assert.throws(
    () =>
      planResourceJob({
        profile: jobProfile(),
        job: { ...job, resources: [{ ref: 'missing' }] },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_REFERENCE_UNKNOWN'
  );
  assert.throws(
    () =>
      planResourceJob({
        profile: jobProfile(),
        job: {
          ...job,
          resources: [{ ref: 'dev.source', sourceFiles: ['OTHER'], members: ['MYPGM'] }],
        },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_SCOPE_DENIED'
  );
  assert.throws(
    () =>
      planResourceJob({
        profile: jobProfile(),
        job: {
          ...job,
          resources: [{ ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['*ALL'] }],
        },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_SCOPE_INVALID'
  );
});

test('resource job execution denies unconfirmed or serialized plans before any query', async () => {
  const plan = planResourceJob({
    profile: jobProfile(),
    job: {
      goal: 'Neutral',
      resources: [{ ref: 'prod.metadata', schemas: ['DATA'], tables: ['MYTABLE'] }],
    },
    cwd: os.tmpdir(),
  });
  let calls = 0;
  const services = {
    query: () => {
      calls++;
      return { rows: [], columns: [] };
    },
  };
  await assert.rejects(
    executeResourceJob({ plan, services }),
    error => error.code === 'RESOURCE_PLAN_APPROVAL_REQUIRED'
  );
  await assert.rejects(
    executeResourceJob({
      plan: JSON.parse(JSON.stringify(plan)),
      approve: plan.planHash,
      services,
    }),
    error => error.code === 'RESOURCE_PLAN_INVALID'
  );
  assert.equal(calls, 0);
  const result = await executeResourceJob({ plan, approve: plan.planHash, services });
  assert.equal(calls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.evidence[0].system, 'prod');
});

test('resource confirmation binds the reviewed job, reloads it and never infers approval', async () => {
  const job = {
    goal: 'Metadata review',
    resources: [{ ref: 'prod.metadata', schemas: ['DATA'], tables: ['MYTABLE'], maxRows: 2 }],
  };
  const createPlan = (profile = jobProfile(), selectedJob = job) =>
    planResourceJob({ profile, job: selectedJob, cwd: os.tmpdir() });
  let loads = 0;
  let calls = 0;
  const services = {
    query: async () => {
      calls++;
      return { rows: [], columns: [] };
    },
  };
  const loader = () => {
    loads++;
    return { plan: createPlan() };
  };
  await assert.rejects(
    confirmAndExecuteResourceJob({ args: {}, loader, services }),
    error => error.code === 'RESOURCE_PLAN_APPROVAL_REQUIRED'
  );
  assert.equal(loads, 0);
  for (const answer of [false, undefined, 'yes']) {
    loads = 0;
    await assert.rejects(
      confirmAndExecuteResourceJob({ args: {}, loader, services, confirm: async () => answer }),
      error => error.code === 'RESOURCE_PLAN_APPROVAL_DECLINED'
    );
    assert.equal(loads, 1);
    assert.equal(calls, 0);
  }
  loads = 0;
  const result = await confirmAndExecuteResourceJob({
    args: {},
    loader,
    services,
    confirm: async plan => {
      assert.equal(plan.operations[0].scope.maxRows, 2);
      assert.equal(plan.remoteMutation, false);
      assert.doesNotMatch(JSON.stringify(plan), /synthetic-only|prod.example.test/);
      assert.equal(calls, 0);
      return true;
    },
  });
  assert.equal(loads, 3);
  assert.equal(calls, 1);
  assert.equal(result.status, 'completed');
  const other = jobProfile();
  other.systems.prod.host = 'changed.example.test';
  const changes = [
    createPlan(other),
    createPlan({
      ...jobProfile(),
      systems: {
        ...jobProfile().systems,
        prod: { ...jobProfile().systems.prod, password: 'changed-secret' },
      },
    }),
    createPlan(jobProfile(), { ...job, goal: 'Different purpose' }),
    createPlan(jobProfile(), { ...job, resources: [{ ...job.resources[0], tables: ['OTHER'] }] }),
    createPlan(jobProfile(), { ...job, resources: [{ ...job.resources[0], maxRows: 3 }] }),
  ];
  for (const changed of changes) {
    loads = 0;
    calls = 0;
    await assert.rejects(
      confirmAndExecuteResourceJob({
        args: {},
        services,
        loader: () => ({ plan: ++loads === 1 ? createPlan() : changed }),
        confirm: async () => true,
      }),
      error => error.code === 'RESOURCE_PLAN_APPROVAL_REQUIRED'
    );
    assert.equal(loads, 2);
    assert.equal(calls, 0);
  }
  const sourceJob = {
    goal: 'Source review',
    outputRoot: 'output/first',
    resources: [{ ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['MYPGM'] }],
  };
  const sourcePlans = [sourceJob, { ...sourceJob, outputRoot: 'output/changed' }].map(selected =>
    createPlan(jobProfile(), selected)
  );
  loads = 0;
  calls = 0;
  await assert.rejects(
    confirmAndExecuteResourceJob({
      args: {},
      loader: () => ({ plan: sourcePlans[loads++] }),
      confirm: async () => true,
      services: {
        exporter: () => {
          calls++;
          throw new Error('Unexpected export');
        },
      },
    }),
    error => error.code === 'RESOURCE_PLAN_APPROVAL_REQUIRED'
  );
  assert.equal(calls, 0);
});

test('resource execution revalidates the approved job before every query', async () => {
  const profile = jobProfile();
  const job = {
    goal: 'Metadata review',
    resources: [{ ref: 'prod.metadata', schemas: ['DATA'], tables: ['ONE', 'TWO'] }],
  };
  const plan = planResourceJob({
    profile,
    job,
    cwd: os.tmpdir(),
    jobFileHash: 'a'.repeat(64),
  });
  const changed = planResourceJob({
    profile,
    job,
    cwd: os.tmpdir(),
    jobFileHash: 'b'.repeat(64),
  });
  let loads = 0;
  let calls = 0;
  await assert.rejects(
    executeResourceJob({
      plan,
      approve: plan.planHash,
      loadPlan: () => (++loads === 1 ? plan : changed),
      services: {
        query: () => {
          calls++;
          return { rows: [], columns: [] };
        },
      },
    }),
    error => error.code === 'RESOURCE_PLAN_CHANGED'
  );
  assert.equal(loads, 2);
  assert.equal(calls, 1);
});

test('resource plans bind targets and purpose, reject unrelated selectors and data widening', async () => {
  const profile = jobProfile();
  profile.resourceCatalog.samples = {
    kind: 'data',
    system: 'prod',
    schemas: ['DATA'],
    tables: ['MYTABLE'],
    columns: ['ID', 'NAME'],
    maskColumns: ['NAME'],
    maxRows: 5,
  };
  const job = {
    goal: 'Sample',
    dataAccess: 'samples',
    resources: [
      {
        ref: 'samples',
        schemas: ['DATA'],
        tables: ['MYTABLE'],
        columns: ['ID', 'NAME'],
        maxRows: 2,
      },
    ],
  };
  const plan = planResourceJob({ profile, job, cwd: os.tmpdir() });
  const other = structuredClone(profile);
  other.systems.prod.host = 'other.example.test';
  assert.notEqual(
    plan.planHash,
    planResourceJob({ profile: other, job, cwd: os.tmpdir() }).planHash
  );
  assert.notEqual(
    plan.planHash,
    planResourceJob({ profile, job: { ...job, goal: 'Different' }, cwd: os.tmpdir() }).planHash
  );
  assert.throws(
    () =>
      planResourceJob({ profile, job: { ...job, dataAccess: 'metadata-only' }, cwd: os.tmpdir() }),
    error => error.code === 'RESOURCE_DATA_APPROVAL_REQUIRED'
  );
  assert.throws(
    () =>
      planResourceJob({
        profile,
        job: { ...job, resources: [{ ...job.resources[0], maxRows: 6 }] },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_LIMIT_EXCEEDED'
  );
  assert.throws(
    () =>
      planResourceJob({
        profile,
        job: { ...job, resources: [{ ...job.resources[0], members: ['MYPGM'] }] },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_FIELDS_INVALID'
  );
  assert.throws(
    () =>
      planResourceJob({
        profile,
        job: { ...job, resources: [{ ref: '__proto__' }] },
        cwd: os.tmpdir(),
      }),
    error => error.code === 'RESOURCE_REFERENCE_UNKNOWN'
  );
  let sql;
  const result = await executeResourceJob({
    plan,
    approve: plan.planHash,
    services: {
      query: args => {
        sql = args.query;
        return {
          rows: [{ ID: 1, NAME: 'private person' }, { ID: 2, NAME: 'private person' }, { ID: 3 }],
          columns: [],
        };
      },
    },
  });
  assert.match(sql, /^SELECT "ID", "NAME" FROM "DATA"\."MYTABLE"$/);
  assert.equal(result.evidence[0].rows.length, 2);
  assert.equal(result.evidence[0].rows[0].NAME, '[MASKED]');
});

test('resource source execution uses local-only exporter and refuses overwrites before remote reads', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-source-'));
  try {
    const job = {
      goal: 'Source',
      outputRoot: 'output/job',
      resources: [{ ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['MYPGM'] }],
    };
    const plan = planResourceJob({ profile: jobProfile(), job, cwd });
    let calls = 0;
    const services = {
      exporter: options => {
        calls++;
        assert.equal(options.writeMode, 'local');
        assert.equal(options.sourceLib, 'SOURCE');
        fs.writeFileSync(options.targetPath, '**FREE\ndcl-s label char(10);\n*inlr = *on;\n');
        return { ok: true, linesWritten: 3 };
      },
    };
    const result = await executeResourceJob({ plan, approve: plan.planHash, services });
    assert.equal(calls, 1);
    assert.match(result.evidence[0].fetched[0].sourceFingerprint.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(
      executeResourceJob({ plan, approve: plan.planHash, services }),
      error => error.code === 'RESOURCE_OUTPUT_EXISTS'
    );
    assert.equal(calls, 1);
    const java = fs.readFileSync(
      path.resolve(__dirname, '../java/IbmiSourceMemberExporter.java'),
      'utf8'
    );
    const localMethod = java.slice(
      java.indexOf('private static int writeToLocalFile'),
      java.indexOf('private static int writeToIfsFile')
    );
    assert.match(localMethod, /AS400File\.READ_ONLY/);
    assert.match(localMethod, /StandardOpenOption\.CREATE_NEW/);
    assert.doesNotMatch(localMethod, /executeUpdate|CREATE ALIAS|executeQuery|IFSFile/);
    assert.ok(
      java.indexOf('if (localWrite) {') < java.indexOf('connection = DriverManager.getConnection')
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('one resource job fetches multiple source files with separate import manifests', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-multisource-'));
  try {
    const profile = jobProfile();
    profile.resourceCatalog['dev.source'].sourceFiles.push('SQLTBLSRC');
    const job = {
      goal: 'Multi-source read',
      outputRoot: 'output/job',
      resources: [
        { ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['RELPROD'] },
        { ref: 'dev.source', sourceFiles: ['SQLTBLSRC'], members: ['RELPROD_00'] },
      ],
    };
    const plan = planResourceJob({
      profile,
      job,
      cwd,
      jobFileHash: 'a'.repeat(64),
    });
    const exported = [];
    const result = await executeResourceJob({
      plan,
      approve: plan.planHash,
      loadPlan: () => plan,
      services: {
        exporter: options => {
          exported.push(options.sourceFile);
          fs.writeFileSync(options.targetPath, '**FREE\n*inlr = *on;\n', 'utf8');
          return { ok: true, linesWritten: 2 };
        },
      },
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(exported, ['QRPGLESRC', 'SQLTBLSRC']);
    assert.equal(result.evidence.length, 2);
    for (const sourceFile of ['QRPGLESRC', 'SQLTBLSRC']) {
      assert.equal(
        fs.existsSync(
          path.join(
            cwd,
            plan.operations[0].scope.outputRoot,
            sourceFile,
            'zeus-import-manifest.json'
          )
        ),
        true
      );
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('JDBC resource metadata uses exact named connection and case-preserving scopes', async () => {
  const profile = {
    jdbcConnections: {
      external: {
        url: 'jdbc:sqlserver://neutral.example.test;databaseName=Demo',
        user: 'neutral-user',
        password: 'synthetic-only',
        driver: 'neutral.Driver',
      },
    },
    resourceCatalog: { external: { kind: 'metadata', connection: 'external', schemas: ['dbo'] } },
  };
  const job = {
    goal: 'External',
    resources: [{ ref: 'external', schemas: ['dbo'], tables: ['Orders'] }],
  };
  const plan = planResourceJob({ profile, job, cwd: os.tmpdir() });
  let sql;
  const result = await executeResourceJob({
    plan,
    approve: plan.planHash,
    services: {
      query: options => {
        sql = options.query;
        assert.equal(options.config.driver, 'neutral.Driver');
        return { rows: [{ COLUMN_NAME: 'Id' }] };
      },
    },
  });
  assert.match(sql, /INFORMATION_SCHEMA.COLUMNS/);
  assert.match(sql, /TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Orders'/);
  assert.equal(result.evidence[0].connection, 'external');
  profile.jdbcConnections.external.url = 'jdbc:sqlserver://neutral.example.test;databaseName=Other';
  assert.notEqual(plan.planHash, planResourceJob({ profile, job, cwd: os.tmpdir() }).planHash);
});

test('resource job rejects output escapes and symlink ancestors without querying', async testContext => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-path-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-outside-'));
  const job = {
    goal: 'Path',
    outputRoot: '../outside',
    resources: [{ ref: 'dev.source', sourceFiles: ['QRPGLESRC'], members: ['MYPGM'] }],
  };
  try {
    assert.throws(
      () => planResourceJob({ profile: jobProfile(), job, cwd }),
      error => error.code === 'RESOURCE_OUTPUT_INVALID'
    );
    const plan = planResourceJob({
      profile: jobProfile(),
      job: { ...job, outputRoot: 'output/job' },
      cwd,
    });
    try {
      fs.symlinkSync(
        outside,
        path.join(cwd, 'output'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (error) {
      if (error.code === 'EPERM') {
        testContext.skip('Local OS does not permit directory symlink creation.');
        return;
      }
      throw error;
    }
    await assert.rejects(
      executeResourceJob({
        plan,
        approve: plan.planHash,
        services: { exporter: () => assert.fail('Must not read remotely') },
      }),
      error => error.code === 'RESOURCE_OUTPUT_INVALID'
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

const {
  resolveResourceModel,
  deriveLegacyResources,
  RESOURCE_KINDS,
} = require('../src/config/resourceModel');
const {
  loadProfiles,
  resolveProfile,
  resolveProfileResources,
  validateProfiles,
} = require('../src/config/runtimeConfig');

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resource-model-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return tempRoot;
}

test('resolveResourceModel exposes the four canonical resource kinds', () => {
  const model = resolveResourceModel({});
  assert.equal(model.kind, 'resource-model');
  assert.equal(model.schemaVersion, 1);
  for (const kind of RESOURCE_KINDS) {
    assert.ok(model.resources[kind], `missing resource kind ${kind}`);
    assert.equal(model.resources[kind].kind, kind);
  }
  assert.deepEqual(RESOURCE_KINDS, ['sourceCode', 'objects', 'metadata', 'data']);
});

test('explicit unknown resource system cannot fall back to a legacy connection', () => {
  assert.throws(
    () =>
      resolveResourceModel({
        fetch: { host: 'legacy.example.test', sourceLib: 'SOURCE' },
        resources: { sourceCode: { system: 'missing', libraries: ['SOURCE'] } },
      }),
    error => error.code === 'RESOURCE_SYSTEM_UNKNOWN'
  );
});

test('deriveLegacyResources maps fetch and dbRoles into resource scopes', () => {
  const profile = {
    fetch: {
      sourceLib: 'devlib',
      files: ['QRPGLESRC', 'qddssrc'],
      members: ['ORDERPGM'],
      ifsDir: '/home/dev/src',
    },
    db: { defaultLibrary: 'APPDATA' },
    dbRoles: {
      metadata: { defaultSchema: 'APPMETA', schemaPreference: ['SHARED'] },
      testData: { defaultSchema: 'APPDATA' },
    },
  };
  const derived = deriveLegacyResources(profile);
  assert.deepEqual(derived.sourceCode.libraries, ['DEVLIB']);
  assert.deepEqual(derived.sourceCode.sourceFiles, ['QRPGLESRC', 'QDDSSRC']);
  assert.deepEqual(derived.sourceCode.members, ['ORDERPGM']);
  assert.deepEqual(derived.sourceCode.ifsPaths, ['/home/dev/src']);
  assert.deepEqual(derived.objects.libraries, ['APPDATA', 'DEVLIB']);
  assert.deepEqual(derived.metadata.schemas, ['APPMETA', 'SHARED']);
  assert.deepEqual(derived.data.schemas, ['APPDATA']);
});

test('resolveResourceModel keeps single-system profiles working without a resources block', () => {
  const profile = {
    fetch: { sourceLib: 'DEVLIB', files: ['QRPGLESRC'] },
    dbRoles: { metadata: { defaultSchema: 'APPMETA' }, testData: { defaultSchema: 'APPDATA' } },
  };
  const model = resolveResourceModel(profile);
  assert.equal(model.hasExplicitResources, false);
  assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC']);
  assert.deepEqual(model.resources.metadata.schemas, ['APPMETA']);
  assert.deepEqual(model.resources.data.schemas, ['APPDATA']);
});

test('resolveResourceModel resolves explicit per-system resources across multiple systems', () => {
  const tempRoot = createTempProject({
    multi: {
      systems: {
        test: { host: 'test.example.local', systemName: 'SYSTEST', displayName: 'Test System' },
        prod: { host: 'prod.example.local', systemName: 'SYSPROD', displayName: 'Prod System' },
      },
      resources: {
        sourceCode: {
          system: 'test',
          libraries: ['srclib'],
          sourceFiles: ['QRPGLESRC', 'QCLLESRC'],
          members: ['custsrv'],
        },
        objects: { system: 'test', libraries: ['objlib'], objectTypes: ['*PGM', '*SRVPGM'] },
        metadata: { system: 'prod', schemas: ['catalog'] },
        data: { system: 'prod', schemas: ['appdata'] },
      },
    },
  });
  try {
    const profiles = loadProfiles({ cwd: tempRoot, env: {} });
    const resolved = resolveProfile(profiles, 'multi', { env: {} });
    const model = resolveResourceModel(resolved, { env: {} });

    assert.equal(model.hasExplicitResources, true);
    assert.equal(model.multiSystem, true);

    assert.equal(model.resources.sourceCode.system, 'test');
    assert.deepEqual(model.resources.sourceCode.libraries, ['SRCLIB']);
    assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC', 'QCLLESRC']);
    assert.deepEqual(model.resources.sourceCode.members, ['CUSTSRV']);
    assert.equal(model.resources.sourceCode.target.host.toLowerCase(), 'test.example.local');

    assert.equal(model.resources.objects.system, 'test');
    assert.deepEqual(model.resources.objects.objectTypes, ['*PGM', '*SRVPGM']);

    assert.equal(model.resources.metadata.system, 'prod');
    assert.deepEqual(model.resources.metadata.schemas, ['CATALOG']);
    assert.equal(model.resources.metadata.target.host.toLowerCase(), 'prod.example.local');

    assert.equal(model.resources.data.system, 'prod');
    assert.deepEqual(model.resources.data.schemas, ['APPDATA']);

    assert.deepEqual(model.systemsInUse, ['prod', 'test']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('system-level resource defaults are inherited and overridden by profile resources', () => {
  const profile = {
    systems: {
      test: {
        host: 'test.example.local',
        systemName: 'SYSTEST',
        resources: {
          sourceCode: { sourceFiles: ['QRPGLESRC', 'QDDSSRC'], libraries: ['BASELIB'] },
        },
      },
    },
    resources: {
      sourceCode: { system: 'test', libraries: ['OVERRIDELIB'] },
    },
  };
  const model = resolveResourceModel(profile);
  // libraries overridden at profile level, sourceFiles inherited from system defaults
  assert.deepEqual(model.resources.sourceCode.libraries, ['OVERRIDELIB']);
  assert.deepEqual(model.resources.sourceCode.sourceFiles, ['QRPGLESRC', 'QDDSSRC']);
});

test('resolveProfileResources facade returns sanitized model without secrets', () => {
  const tempRoot = createTempProject({
    secure: {
      systems: {
        test: {
          host: 'test.example.local',
          user: 'SECRETUSER',
          password: 'SECRETPW',
          systemName: 'SYSTEST',
        },
      },
      resources: {
        sourceCode: { system: 'test', libraries: ['SRCLIB'], sourceFiles: ['QRPGLESRC'] },
      },
    },
  });
  try {
    const result = resolveProfileResources({ profile: 'secure' }, { cwd: tempRoot, env: {} });
    const serialized = JSON.stringify(result.model);
    assert.equal(result.profile, 'secure');
    assert.doesNotMatch(serialized, /SECRETPW/);
    assert.doesNotMatch(serialized, /SECRETUSER/);
    assert.match(serialized, /test\.example\.local/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveProfileResources requires a profile name', () => {
  assert.throws(() => resolveProfileResources({}, { env: {} }), /profile name is required/i);
});

test('validateProfiles rejects unsupported resource kinds', () => {
  assert.throws(
    () => validateProfiles({ sample: { resources: { bogus: {} } } }),
    /not a supported resource kind/i
  );
});

test('validateProfiles rejects unsupported fields for a resource kind', () => {
  assert.throws(
    () => validateProfiles({ sample: { resources: { metadata: { libraries: ['X'] } } } }),
    /not supported for resource kind "metadata"/i
  );
});

test('validateProfiles accepts a well-formed resources block', () => {
  assert.doesNotThrow(() =>
    validateProfiles({
      sample: {
        resources: {
          system: 'test',
          sourceCode: {
            system: 'test',
            libraries: ['SRCLIB'],
            sourceFiles: ['QRPGLESRC'],
            members: ['PGM'],
            ifsPaths: ['/a'],
          },
          objects: { libraries: ['OBJLIB'], objectTypes: ['*PGM'] },
          metadata: { schemas: ['META'] },
          data: { schemas: ['DATA'] },
        },
      },
    })
  );
});
