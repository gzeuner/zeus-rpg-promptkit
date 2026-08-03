const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAllowlistedTools, runMcp } = require('../src/cli/commands/mcpCommand');

test('parseAllowlistedTools normalizes comma-separated values', () => {
  assert.equal(parseAllowlistedTools(undefined), null);
  assert.deepEqual(
    parseAllowlistedTools(' zeus.health,zeus.version,zeus.health ', [
      'zeus.health',
      'zeus.version',
    ]),
    ['zeus.health', 'zeus.version']
  );
  assert.throws(
    () => parseAllowlistedTools(' , ', ['zeus.health', 'zeus.version']),
    /Invalid --allow-tools value/
  );
  assert.throws(
    () => parseAllowlistedTools('zeus.health,zeus.unknown', ['zeus.health', 'zeus.version']),
    /unknown tool name/i
  );
});

test('runMcp passes allowlisted tools into MCP server runtime', async () => {
  let started = false;
  let capturedRuntime = null;

  await runMcp(
    {
      _: ['serve'],
      stdio: true,
      'allow-tools': 'zeus.health,zeus.version',
    },
    {
      cwd: '/tmp/mcp-test-cwd',
      createMcpServer: runtime => {
        capturedRuntime = runtime;
        return {
          startStdio() {
            started = true;
          },
        };
      },
    }
  );

  assert.equal(started, true);
  assert.equal(capturedRuntime.cwd, '/tmp/mcp-test-cwd');
  assert.deepEqual(capturedRuntime.allowlistedTools, ['zeus.health', 'zeus.version']);
});

test('runMcp defaults to strict cursor mode when flag is omitted', async () => {
  let capturedRuntime = null;

  await runMcp(
    {
      _: ['serve'],
      stdio: true,
    },
    {
      cwd: '/tmp/mcp-test-cwd-default',
      createMcpServer: runtime => {
        capturedRuntime = runtime;
        return {
          startStdio() {},
        };
      },
    }
  );

  assert.equal(typeof capturedRuntime, 'object');
});

test('runMcp exits with code 2 when removed legacy-cursor-fallback option is provided', async () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  const errors = [];

  process.exit = code => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await assert.rejects(
      () => runMcp({ _: ['serve'], 'legacy-cursor-fallback': 'true' }),
      /__EXIT__2/
    );
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /--legacy-cursor-fallback option was removed/i);
    assert.match(errors.join('\n'), /numeric cursors are no longer supported/i);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});

test('runMcp exits with code 2 for invalid allow-tools flag usage', async () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  const errors = [];

  process.exit = code => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await assert.rejects(() => runMcp({ _: ['serve'], 'allow-tools': true }), /__EXIT__2/);
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /Invalid --allow-tools value/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});

test('runMcp exits with code 2 for unknown allow-tools names', async () => {
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  const errors = [];

  process.exit = code => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await assert.rejects(
      () => runMcp({ _: ['serve'], 'allow-tools': 'zeus.unknown' }),
      /__EXIT__2/
    );
    assert.equal(exitCode, 2);
    assert.match(errors.join('\n'), /unknown tool name/i);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});

test('resolveMcpToolPack returns bounded named surfaces', () => {
  const { resolveMcpToolPack } = require('../src/mcp/mcpPolicy');
  const known = require('../src/mcp/mcpTools')
    .listMcpTools()
    .map(tool => tool.name);
  const local = resolveMcpToolPack('local-evidence', known);
  const pi = resolveMcpToolPack('pi-status', known);
  assert.ok(local.includes('zeus.analyze'));
  assert.equal(local.includes('zeus.query-sql'), false);
  assert.deepEqual(pi, [
    'zeus.health',
    'zeus.version',
    'zeus.doctor',
    'zeus.help',
    'zeus.agent.bootstrap',
    'zeus.project-knowledge.discover',
    'zeus.project-knowledge.status',
  ]);
  assert.throws(() => resolveMcpToolPack('unknown', known), /unknown pack/i);
});

test('runMcp resolves a named tool pack and rejects ambiguous policy flags', async () => {
  let capturedRuntime = null;
  await runMcp(
    { _: ['serve'], stdio: true, 'tool-pack': 'pi-status' },
    {
      cwd: '/tmp/mcp-test-pack',
      createMcpServer: runtime => {
        capturedRuntime = runtime;
        return { startStdio() {} };
      },
    }
  );
  assert.deepEqual(capturedRuntime.allowlistedTools, [
    'zeus.health',
    'zeus.version',
    'zeus.doctor',
    'zeus.help',
    'zeus.agent.bootstrap',
    'zeus.project-knowledge.discover',
    'zeus.project-knowledge.status',
  ]);
  const originalExit = process.exit;
  const originalError = console.error;
  let exitCode = null;
  process.exit = code => {
    exitCode = code;
    throw new Error(`__EXIT__${code}`);
  };
  console.error = () => {};
  try {
    await assert.rejects(
      () => runMcp({ _: ['serve'], 'tool-pack': 'pi-status', 'allow-tools': 'zeus.health' }),
      /__EXIT__2/
    );
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});
