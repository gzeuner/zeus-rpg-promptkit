const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PassThrough } = require('node:stream');
const { requestResourceApproval } = require('../src/cli/commands/resourcesCommand');
const { planResourceJob } = require('../src/config/resourceAccessPlan');

const cliPath = path.resolve(__dirname, '../cli/zeus.js');
const {
  discoverResources,
  prepareResourceJob,
  collectResourceJob,
} = require('../src/core/resourceDiscoveryService');

test('resource discovery shares exact loading and distinguishes configuration from live approval', async () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: {
          host: '${env:NEUTRAL_HOST}',
          user: '${env:NEUTRAL_USER}',
          password: '${env:NEUTRAL_PASSWORD}',
        },
      },
      resourceCatalog: {
        src: {
          kind: 'sourceCode',
          system: 'dev',
          library: 'SRC',
          sourceFiles: ['QRPGLESRC'],
          maxMembers: 2,
        },
      },
    },
    legacy: { fetch: { sourceLib: 'ELSEWHERE' } },
  });
  try {
    const args = { config: path.join(configDir, 'profiles.example.json'), profile: 'fixed' };
    const env = {
      NEUTRAL_HOST: 'neutral.example.test',
      NEUTRAL_USER: 'synthetic-operator',
      NEUTRAL_PASSWORD: 'synthetic-value',
      ZEUS_FETCH_HOST: 'wrong.example.test',
    };
    const result = discoverResources(args, { cwd: tempRoot, env });
    assert.equal(result.profiles[0].resources[0].readiness.configured, true);
    assert.equal(result.profiles[0].resources[0].readiness.live, 'not-checked');
    assert.equal(result.profiles[0].resources[0].readiness.approval, 'not-granted');
    assert.equal(result.profiles[0].nextCommand.argv[0], 'resources');
    assert.doesNotMatch(
      JSON.stringify(result),
      /neutral.example.test|synthetic-value|synthetic-operator|wrong.example.test/
    );
    const missing = discoverResources(args, { cwd: tempRoot, env: {} });
    assert.deepEqual(missing.profiles[0].resources[0].missingEnv, [
      'NEUTRAL_HOST',
      'NEUTRAL_PASSWORD',
      'NEUTRAL_USER',
    ]);
    assert.equal(discoverResources({}, { cwd: tempRoot, env }).status, 'needs-selection');
    const candidates = discoverResources(
      {},
      {
        cwd: path.join(tempRoot, env.NEUTRAL_PASSWORD),
        env: { ...env, ZEUS_MASK_TERMS: env.NEUTRAL_PASSWORD },
      }
    );
    assert.equal(candidates.configuration.automaticSelection, false);
    assert.doesNotMatch(JSON.stringify(candidates), /synthetic-value/);
    const all = discoverResources({ config: args.config }, { cwd: tempRoot, env });
    assert.equal(all.profiles.find(profile => profile.name === 'legacy').mode, 'legacy');
    const answers = ['1', '1', 'ONE', 'sources'];
    const preview = await collectResourceJob(
      { ...args, out: 'jobs/selected.json' },
      { cwd: tempRoot, env, ask: async () => answers.shift() }
    );
    assert.equal(preview.plan.remoteMutation, false);
    assert.equal(preview.approvalRequired, true);
    assert.equal(preview.executionStarted, false);
    assert.equal(preview.plan.operations[0].scope.library, 'SRC');
    assert.equal(fs.existsSync(path.join(tempRoot, 'sources')), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(tempRoot, 'jobs/selected.json'))).resources[0]
        .members[0],
      'ONE'
    );
    const job = JSON.parse(fs.readFileSync(path.join(tempRoot, 'jobs/selected.json')));
    assert.throws(
      () => prepareResourceJob({ ...args, out: 'jobs/selected.json' }, job, { cwd: tempRoot, env }),
      /RESOURCE_OUTPUT_EXISTS/
    );
    assert.throws(
      () => prepareResourceJob({ ...args, out: '../escape.json' }, job, { cwd: tempRoot, env }),
      /RESOURCE_OUTPUT_INVALID/
    );
    assert.throws(
      () =>
        prepareResourceJob(
          { ...args, out: 'jobs/private.json' },
          { ...job, goal: 'synthetic-value' },
          { cwd: tempRoot, env }
        ),
      /RESOURCE_PLAN_DISCLOSURE_DENIED/
    );
    assert.equal(fs.existsSync(path.join(tempRoot, 'jobs/private.json')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resource discovery exposes only library identifiers and keeps secret collisions masked', () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: {
          host: '${env:NEUTRAL_HOST}',
          user: '${env:NEUTRAL_USER}',
          password: '${env:ACCESS_REF}',
        },
      },
      resourceCatalog: {
        src: { kind: 'sourceCode', system: 'dev', library: 'LIBUSER', sourceFiles: ['QRPGLESRC'] },
        metadata: {
          kind: 'metadata',
          system: 'dev',
          schemas: ['LIBUSER', 'PASSLIB', 'XPASSLIB', 'TOKENLIB', 'MASKLIB', 'DEFAULTLIB'],
          tables: ['LIBUSER'],
        },
      },
    },
  });
  const env = {
    NEUTRAL_HOST: 'fixture.invalid',
    NEUTRAL_USER: 'LIBUSER',
    ACCESS_REF: 'PASSLIB',
    UI_TOKEN: 'TOKENLIB',
    ZEUS_MASK_TERMS: 'MASKLIB',
    ZEUS_DB_DEFAULT_SCHEMA: 'DEFAULTLIB',
  };
  try {
    for (const overrides of [{}, { NEUTRAL_USER: '' }]) {
      const discovery = discoverResources(
        { config: path.join(configDir, 'profiles.example.json'), profile: 'fixed' },
        { cwd: tempRoot, env: { ...env, ...overrides } }
      );
      const [source, metadata] = discovery.profiles[0].resources;
      assert.equal(source.scope.library, 'LIBUSER');
      assert.deepEqual(metadata.scope.schemas, [
        'LIBUSER',
        '[REDACTED]',
        '[REDACTED]',
        '[REDACTED]',
        '[REDACTED]',
        'DEFAULTLIB',
      ]);
      assert.equal(discovery.executionStarted, false);
      assert.equal(metadata.readiness.live, 'not-checked');
      assert.equal(metadata.readiness.approval, 'not-granted');
      if (!overrides.NEUTRAL_USER && Object.hasOwn(overrides, 'NEUTRAL_USER'))
        assert.equal(metadata.readiness.configured, false);
      else assert.deepEqual(metadata.scope.tables, ['[REDACTED]']);
      assert.doesNotMatch(JSON.stringify(discovery), /PASSLIB|TOKENLIB|MASKLIB|fixture\.invalid/);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function createTempConfig(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-resources-cli-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8'
  );
  return { tempRoot, configDir };
}

function runCli(commandArgs, configDir) {
  return spawnSync(process.execPath, [cliPath, '--config', configDir, ...commandArgs], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, ZEUS_NO_AUTO_ENV: '1' },
    encoding: 'utf8',
  });
}

test('resource CLI confirmation shows exact scope and defaults to no without manual hash entry', async () => {
  const plan = planResourceJob({
    profile: {
      systems: {
        dev: {
          host: 'neutral.example.test',
          user: 'synthetic-operator',
          password: 'synthetic-value',
        },
      },
      resourceCatalog: {
        src: { kind: 'sourceCode', system: 'dev', library: 'SRC', sourceFiles: ['QRPGLESRC'] },
      },
    },
    job: {
      goal: 'Review source copy',
      outputRoot: 'output/new-sources',
      resources: [{ ref: 'src', sourceFiles: ['QRPGLESRC'], members: ['ONE'] }],
    },
    cwd: os.tmpdir(),
  });
  for (const answer of ['', 'no', 'y', 'approve', 'yes', 'JA']) {
    const input = new PassThrough();
    input.isTTY = true;
    const output = new PassThrough();
    let transcript = '';
    output.on('data', chunk => {
      transcript += chunk.toString();
      if (chunk.toString().includes('[yes/NO]')) queueMicrotask(() => input.write(`${answer}\n`));
    });
    try {
      assert.equal(
        await requestResourceApproval(plan, { input, output }),
        /^(yes|ja)$/i.test(answer)
      );
      assert.match(transcript, /Review source copy|QRPGLESRC|ONE|output\/new-sources/);
      assert.doesNotMatch(transcript, new RegExp(plan.planHash));
      assert.doesNotMatch(transcript, /synthetic-value|neutral.example.test/);
    } finally {
      input.destroy();
      output.destroy();
    }
  }
  await assert.rejects(
    requestResourceApproval(plan, { input: new PassThrough(), output: new PassThrough() }),
    error => error.code === 'RESOURCE_PLAN_APPROVAL_REQUIRED'
  );
  const input = new PassThrough();
  input.isTTY = true;
  const output = new PassThrough();
  output.on('data', chunk => {
    if (chunk.toString().includes('[yes/NO]')) queueMicrotask(() => input.end());
  });
  try {
    await assert.rejects(
      requestResourceApproval(plan, { input, output }),
      error => error.name === 'AbortError'
    );
  } finally {
    input.destroy();
    output.destroy();
  }
});

test('investigation approval review includes its exact SELECT requests', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  const output = new PassThrough();
  let transcript = '';
  output.on('data', chunk => {
    const text = chunk.toString();
    transcript += text;
    if (text.includes('[yes/NO]')) queueMicrotask(() => input.write('yes\n'));
  });
  try {
    const approved = await requestResourceApproval(
      {
        schemaVersion: 'resource-investigation/v1',
        purpose: 'Neutral review',
        sessionId: 'neutral-session',
        operatorId: 'neutral-operator',
        limits: { queries: 1, rows: 2, bytes: 4096, durationMs: 30000 },
        expiresAt: 12345,
        output: 'stdout-masked',
        operations: [],
        remoteMutation: false,
      },
      {
        input,
        output,
        selects: [{ ref: 'samples', schema: 'DATA', table: 'ITEM', columns: ['ID'], maxRows: 2 }],
      }
    );
    assert.equal(approved, true);
    assert.match(transcript, /"table": "ITEM"/);
    assert.match(transcript, /"columns": \[\s+"ID"/);
  } finally {
    input.destroy();
    output.destroy();
  }
});

test('resource investigation CLI previews the envelope and never infers noninteractive approval', () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: { host: 'neutral.example.test', user: 'neutral', password: 'synthetic-value' },
      },
      resourceCatalog: {
        samples: {
          kind: 'data',
          system: 'dev',
          schemas: ['DATA'],
          tables: ['ITEM'],
          columns: ['ID'],
          maskColumns: [],
          maxRows: 2,
        },
      },
    },
  });
  try {
    const job = path.join(tempRoot, 'job.json');
    const investigation = path.join(tempRoot, 'investigation.json');
    fs.writeFileSync(
      job,
      JSON.stringify({
        goal: 'Neutral',
        dataAccess: 'samples',
        resources: [
          { ref: 'samples', schemas: ['DATA'], tables: ['ITEM'], columns: ['ID'], maxRows: 2 },
        ],
      })
    );
    fs.writeFileSync(
      investigation,
      JSON.stringify({
        schemaVersion: 1,
        operatorId: 'neutral',
        limits: { queries: 2, rows: 4, bytes: 4096, durationMs: 30000 },
        selects: [{ ref: 'samples', schema: 'DATA', table: 'ITEM', columns: ['ID'], maxRows: 2 }],
      })
    );
    const args = [
      'resources',
      '--config',
      path.join(configDir, 'profiles.example.json'),
      '--profile',
      'fixed',
      '--job',
      job,
      '--investigation',
      investigation,
      '--json',
    ];
    const preview = runCli(args, configDir);
    assert.equal(preview.status, 0, preview.stderr);
    const result = JSON.parse(preview.stdout);
    assert.equal(result.schemaVersion, 'resource-investigation/v1');
    assert.equal(result.status, 'planned');
    assert.equal(result.approvalRequired, true);
    assert.equal(result.limits.queries, 2);
    assert.equal(result.approvalHash, undefined);
    assert.doesNotMatch(preview.stdout, /synthetic-value|neutral\.example\.test/);
    const denied = runCli([...args, '--execute'], configDir);
    assert.equal(denied.status, 2);
    assert.equal(JSON.parse(denied.stdout).code, 'INVESTIGATION_INTERACTIVE_APPROVAL_REQUIRED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resources command prints the resolved resource model as JSON', () => {
  const { tempRoot, configDir } = createTempConfig({
    multi: {
      systems: {
        test: { host: 'test.example.local', systemName: 'SYSTEST' },
        prod: { host: 'prod.example.local', systemName: 'SYSPROD' },
      },
      resources: {
        sourceCode: { system: 'test', libraries: ['SRCLIB'], sourceFiles: ['QRPGLESRC'] },
        metadata: { system: 'prod', schemas: ['CATALOG'] },
      },
    },
  });
  try {
    const result = runCli(['resources', '--profile', 'multi', '--json'], configDir);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.profile, 'multi');
    assert.equal(parsed.model.multiSystem, true);
    assert.equal(parsed.model.resources.sourceCode.system, 'test');
    assert.deepEqual(parsed.model.resources.sourceCode.sourceFiles, ['QRPGLESRC']);
    assert.equal(parsed.model.resources.metadata.system, 'prod');
    // No secrets in output.
    assert.doesNotMatch(result.stdout, /password/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resource job CLI uses exact files and explicit env without remote execution', () => {
  const { tempRoot, configDir } = createTempConfig({
    multi: {
      systems: {
        dev: {
          host: '${env:NEUTRAL_HOST}',
          user: '${env:NEUTRAL_USER}',
          password: '${env:NEUTRAL_PASSWORD}',
        },
      },
      resourceCatalog: { tables: { kind: 'metadata', system: 'dev', schemas: ['DATA'] } },
    },
  });
  try {
    const config = path.join(configDir, 'profiles.example.json');
    const envFile = path.join(configDir, '.env.selected.local');
    const job = path.join(tempRoot, 'job.json');
    fs.writeFileSync(
      envFile,
      'NEUTRAL_HOST=dev.example.test\nNEUTRAL_USER=neutral\nNEUTRAL_PASSWORD=synthetic-fixture\n'
    );
    fs.writeFileSync(
      job,
      JSON.stringify({
        goal: 'Neutral',
        resources: [{ ref: 'tables', schemas: ['DATA'], tables: ['MYTABLE'] }],
      })
    );
    fs.writeFileSync(
      path.join(configDir, 'profiles.unrequested.json'),
      JSON.stringify({ multi: { systems: { dev: { host: 'unrequested.example.test' } } } })
    );
    const result = runCli(
      [
        'resources',
        '--config',
        config,
        '--profile',
        'multi',
        '--job',
        job,
        '--env-files',
        envFile,
        '--json',
      ],
      configDir
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const planned = JSON.parse(result.stdout);
    assert.equal(planned.status, 'planned');
    assert.match(planned.jobFileHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(result.stdout, /synthetic-fixture|dev.example.test/);
    const redirected = spawnSync(
      process.execPath,
      [
        cliPath,
        'resources',
        '--config',
        config,
        '--profile',
        'multi',
        '--job',
        job,
        '--env-files',
        envFile,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          NEUTRAL_HOST: 'stale.example.test',
          ZEUS_DB_HOST: 'ambient.example.test',
        },
        encoding: 'utf8',
      }
    );
    assert.equal(redirected.status, 0, redirected.stdout + redirected.stderr);
    assert.equal(planned.planHash, JSON.parse(redirected.stdout).planHash);
    fs.writeFileSync(job, `${JSON.stringify(JSON.parse(fs.readFileSync(job, 'utf8')), null, 2)}\n`);
    const changedJob = runCli(
      [
        'resources',
        '--config',
        config,
        '--profile',
        'multi',
        '--job',
        job,
        '--env-files',
        envFile,
        '--json',
      ],
      configDir
    );
    assert.equal(changedJob.status, 0, changedJob.stderr);
    assert.notEqual(JSON.parse(changedJob.stdout).planHash, planned.planHash);
    const denied = runCli(
      [
        'resources',
        '--config',
        config,
        '--profile',
        'multi',
        '--job',
        job,
        '--env-files',
        envFile,
        '--execute',
      ],
      configDir
    );
    assert.equal(denied.status, 2);
    assert.equal(JSON.parse(denied.stdout).code, 'RESOURCE_PLAN_APPROVAL_REQUIRED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('noninteractive resource execution revalidates the approved job before fetching', () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: {
          host: 'fixture.invalid',
          user: 'synthetic-operator',
          password: 'synthetic-value',
        },
      },
      resourceCatalog: {
        src: { kind: 'sourceCode', system: 'dev', library: 'SRC', sourceFiles: ['QRPGLESRC'] },
      },
    },
  });
  try {
    const config = path.join(configDir, 'profiles.example.json');
    const job = path.join(tempRoot, 'job.json');
    fs.writeFileSync(
      job,
      JSON.stringify({
        goal: 'Validate approved job revalidation',
        outputRoot: 'output/existing',
        resources: [{ ref: 'src', sourceFiles: ['QRPGLESRC'], members: ['ONE'] }],
      })
    );
    const planned = spawnSync(
      process.execPath,
      [cliPath, 'resources', '--config', config, '--profile', 'fixed', '--job', job, '--json'],
      {
        cwd: tempRoot,
        env: { ...process.env, ZEUS_NO_AUTO_ENV: '1' },
        encoding: 'utf8',
      }
    );
    assert.equal(planned.status, 0, planned.stdout + planned.stderr);
    const plan = JSON.parse(planned.stdout);
    const outputFile = path.join(
      tempRoot,
      plan.operations[0].scope.outputRoot,
      'QRPGLESRC',
      'ONE.rpgle'
    );
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, 'fixture');

    const executed = spawnSync(
      process.execPath,
      [
        cliPath,
        'resources',
        '--config',
        config,
        '--profile',
        'fixed',
        '--job',
        job,
        '--approve-plan',
        plan.planHash,
        '--execute',
        '--json',
      ],
      {
        cwd: tempRoot,
        env: { ...process.env, ZEUS_NO_AUTO_ENV: '1' },
        encoding: 'utf8',
      }
    );
    assert.equal(executed.status, 2, executed.stdout + executed.stderr);
    assert.equal(JSON.parse(executed.stdout).code, 'RESOURCE_OUTPUT_EXISTS');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resources command renders an ASCII table for the four resource kinds', () => {
  const { tempRoot, configDir } = createTempConfig({
    single: {
      fetch: { sourceLib: 'DEVLIB', files: ['QRPGLESRC'] },
      dbRoles: { metadata: { defaultSchema: 'APPMETA' } },
    },
  });
  try {
    const result = runCli(['resources', '--profile', 'single'], configDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Source code/);
    assert.match(result.stdout, /Objects/);
    assert.match(result.stdout, /DB metadata/);
    assert.match(result.stdout, /DB data/);
    assert.match(result.stdout, /backward compatible/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resources command fails clearly without a profile', () => {
  const { tempRoot, configDir } = createTempConfig({ x: {} });
  try {
    const result = runCli(['resources'], configDir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Missing required option: --profile/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resource discovery and wizard CLI never execute and save only a validated explicit job', () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: {
          host: '${env:NEUTRAL_HOST}',
          user: '${env:NEUTRAL_USER}',
          password: '${env:NEUTRAL_PASSWORD}',
        },
      },
      resourceCatalog: {
        tables: { kind: 'metadata', system: 'dev', schemas: ['DATA'], maxRows: 5 },
      },
    },
  });
  try {
    const config = path.join(configDir, 'profiles.example.json');
    const envFile = path.join(configDir, '.env.chosen.local');
    fs.writeFileSync(
      envFile,
      'NEUTRAL_HOST=neutral.example.test\nNEUTRAL_USER=synthetic-operator\nNEUTRAL_PASSWORD=synthetic-value\n'
    );
    const flags = ['--config', config, '--profile', 'fixed', '--env-files', envFile, '--json'];
    const discovered = runCli(['resources', '--discover', ...flags], configDir);
    assert.equal(discovered.status, 0, discovered.stdout + discovered.stderr);
    assert.equal(
      JSON.parse(discovered.stdout).profiles[0].resources[0].readiness.live,
      'not-checked'
    );
    assert.doesNotMatch(
      discovered.stdout,
      /neutral.example.test|synthetic-value|synthetic-operator/
    );
    const preflight = runCli(['agent', 'preflight', ...flags], configDir);
    assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
    const agent = JSON.parse(preflight.stdout);
    assert.equal(agent.resourceDiscovery.profiles[0].resources[0].ref, 'tables');
    assert.equal(agent.capabilities.remoteReadOnly, false);
    assert.equal(agent.capabilities.remoteConfigured, true);
    assert.deepEqual(agent.profileInventory.names, ['fixed']);
    assert.ok(agent.resourceNextCommands[0].argv.includes('--wizard'));
    const prompt = runCli(['agent', 'prompt', '--goal', 'Inspect metadata', ...flags], configDir);
    assert.equal(prompt.status, 0, prompt.stdout + prompt.stderr);
    assert.equal(
      JSON.parse(prompt.stdout).preflight.resourceDiscovery.profiles[0].resources[0].ref,
      'tables'
    );
    const selection = path.join(tempRoot, 'selection.json');
    fs.writeFileSync(
      selection,
      JSON.stringify({
        goal: 'Metadata only',
        resources: [{ ref: 'tables', schemas: ['DATA'], tables: ['MYTABLE'], maxRows: 5 }],
      })
    );
    const selected = spawnSync(
      process.execPath,
      [
        cliPath,
        'resources',
        '--wizard',
        ...flags,
        '--selection',
        selection,
        '--out',
        'jobs/chosen.json',
      ],
      { cwd: tempRoot, env: { ...process.env, ZEUS_NO_AUTO_ENV: '1' }, encoding: 'utf8' }
    );
    assert.equal(selected.status, 0, selected.stdout + selected.stderr);
    const preview = JSON.parse(selected.stdout);
    assert.equal(preview.executionStarted, false);
    assert.equal(preview.approvalRequired, true);
    const planned = runCli(
      ['resources', ...flags, '--job', path.join(tempRoot, 'jobs/chosen.json')],
      configDir
    );
    assert.equal(planned.status, 0, planned.stdout);
    assert.notEqual(JSON.parse(planned.stdout).planHash, null);
    const conflict = runCli(['resources', '--discover', ...flags, '--execute'], configDir);
    assert.equal(conflict.status, 2);
    assert.equal(JSON.parse(conflict.stdout).code, 'RESOURCE_ACTION_CONFLICT');
    const noInput = runCli(['resources', '--wizard', ...flags], configDir);
    assert.equal(noInput.status, 2);
    assert.equal(JSON.parse(noInput.stdout).code, 'RESOURCE_WIZARD_INPUT_REQUIRED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resource discovery validates catalogs, exact env precedence and invalid guided input locally', async () => {
  const { tempRoot, configDir } = createTempConfig({
    fixed: {
      systems: {
        dev: {
          host: '${env:NEUTRAL_HOST}',
          user: '${env:NEUTRAL_USER}',
          password: '${env:NEUTRAL_PASSWORD}',
        },
      },
      resourceCatalog: {
        tables: { kind: 'metadata', system: 'dev', schemas: ['DATA'], maxRows: 5 },
      },
    },
  });
  try {
    const args = { config: path.join(configDir, 'profiles.example.json'), profile: 'fixed' };
    const first = path.join(configDir, '.env.first.local');
    const second = path.join(configDir, '.env.second.local');
    fs.writeFileSync(
      first,
      'NEUTRAL_HOST=first.example.test\nNEUTRAL_USER=synthetic-operator\nNEUTRAL_PASSWORD=synthetic-value\n'
    );
    fs.writeFileSync(second, 'NEUTRAL_HOST=second.example.test\n');
    fs.writeFileSync(
      path.join(configDir, 'profiles.unrequested.json'),
      JSON.stringify({ fixed: { systems: { dev: { host: 'overlay.example.test' } } } })
    );
    const layered = discoverResources(
      { ...args, 'env-files': `${first},${second}` },
      { cwd: tempRoot, env: {} }
    );
    const explicit = discoverResources({ ...args, 'env-files': first }, { cwd: tempRoot, env: {} });
    assert.notEqual(
      layered.profiles[0].resources[0].targetFingerprint,
      explicit.profiles[0].resources[0].targetFingerprint
    );
    assert.equal(layered.configuration.configSources.length, 1);
    assert.deepEqual(layered.profileInventory.names, ['fixed']);
    assert.equal(layered.configuration.envFiles.length, 2);
    assert.throws(
      () => discoverResources({ ...args, kind: 'unsupported' }, { cwd: tempRoot }),
      /RESOURCE_KIND_INVALID/
    );
    const answers = ['1', '1', 'MYTABLE', 'invalid-number'];
    await assert.rejects(
      () =>
        collectResourceJob(
          { ...args, 'env-files': first, out: 'jobs/invalid.json' },
          { cwd: tempRoot, env: {}, ask: async () => answers.shift() }
        ),
      /RESOURCE_LIMIT_EXCEEDED/
    );
    assert.equal(fs.existsSync(path.join(tempRoot, 'jobs/invalid.json')), false);
    const blocked = await collectResourceJob(
      { ...args, 'env-files': first },
      { cwd: tempRoot, env: {}, ask: async () => '0' }
    ).then(
      () => false,
      () => true
    );
    assert.equal(blocked, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('discover-environment fails gracefully when DB connection is not configured', () => {
  const { tempRoot, configDir } = createTempConfig({
    nodbprofile: {
      fetch: { sourceLib: 'DEVLIB' },
    },
  });
  try {
    const result = runCli(['discover-environment', '--profile', 'nodbprofile'], configDir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /connection configuration is incomplete/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
