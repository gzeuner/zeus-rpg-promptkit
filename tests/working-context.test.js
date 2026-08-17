const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyWorkingContextDefaults,
  buildWorkingContextView,
  clearWorkingContext,
  loadWorkingContext,
  setWorkingContext,
} = require('../src/context/workingContext');
const { createMcpServer } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-working-context-'));
}

test('working context stores separated source, metadata, and data routing without secrets', () => {
  const cwd = makeTempWorkspace();
  try {
    const result = setWorkingContext({
      cwd,
      actor: 'test',
      patch: {
        profile: 'dev',
        activeKind: 'sourceCode',
        resources: {
          sourceCode: {
            system: 'test',
            library: 'applib',
            sourceFile: 'qrpglesrc',
            member: 'orderpgm',
            localRoot: './rpg_sources',
          },
          metadata: { system: 'meta', schema: 'appdata', table: 'orders' },
          data: { system: 'data', schema: 'sample', table: 'orders' },
        },
      },
    });

    assert.equal(result.context.resources.sourceCode.system, 'TEST');
    assert.equal(result.context.resources.sourceCode.sourceFile, 'Q RPGLESRC'.replace(' ', ''));
    assert.equal(result.context.resources.metadata.schema, 'APPDATA');
    assert.equal(result.context.resources.data.system, 'DATA');

    const stored = JSON.parse(fs.readFileSync(result.storagePath, 'utf8'));
    assert.equal(stored.profile, 'dev');
    assert.equal(stored.resources.sourceCode.member, 'ORDERPGM');
    assert.equal(JSON.stringify(stored).includes('password'), false);
    assert.equal(JSON.stringify(stored).includes('secret'), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('explicit command arguments override working context defaults', () => {
  const cwd = makeTempWorkspace();
  try {
    setWorkingContext({
      cwd,
      patch: {
        profile: 'context-profile',
        resources: {
          sourceCode: {
            system: 'context-system',
            library: 'CONTEXTLIB',
            sourceFile: 'QRPGLESRC',
            member: 'CONTEXT_MEMBER',
            localRoot: './context-source',
          },
          metadata: { schema: 'CONTEXT_SCHEMA', table: 'CONTEXT_TABLE' },
        },
      },
    });

    const applied = applyWorkingContextDefaults(
      {
        sourceLib: 'EXPLICITLIB',
        source: './explicit-source',
        program: 'EXPLICIT_MEMBER',
      },
      { cwd, command: 'fetch' }
    ).args;
    assert.equal(applied.profile, 'context-profile');
    assert.equal(applied.sourceLib, 'EXPLICITLIB');
    assert.equal(applied.source, './explicit-source');
    assert.equal(applied.system, 'CONTEXT-SYSTEM');
    assert.equal(applied.member, 'CONTEXT_MEMBER');

    const query = applyWorkingContextDefaults(
      { profile: 'explicit-profile', table: 'EXPLICIT_TABLE' },
      { cwd, command: 'query-table' }
    ).args;
    assert.equal(query.profile, 'explicit-profile');
    assert.equal(query.table, 'EXPLICIT_TABLE');
    assert.equal(query.schema, 'CONTEXT_SCHEMA');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('MCP context tools expose and control the current location, and fetch-member inherits it', async () => {
  const cwd = makeTempWorkspace();
  try {
    const calls = [];
    const server = createMcpServer({
      cwd,
      allowlistedTools: listMcpTools().map(tool => tool.name),
      fetchMemberRunner: args => {
        calls.push(args);
        return {
          profile: args.profile,
          sourceLib: args.lib,
          sourceFile: args.file,
          outDir: args.out,
          fetched: [],
          failures: [],
        };
      },
    });

    const setResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'zeus.context.set',
        arguments: {
          profile: 'dev',
          activeKind: 'sourceCode',
          sourceCode: {
            system: 'test',
            library: 'APPLIB',
            sourceFile: 'QRPGLESRC',
            member: 'ORDERPGM',
            localRoot: './rpg_sources',
          },
        },
      },
    });
    assert.equal(
      setResponse.result.structuredContent.context.resources.sourceCode.library,
      'APPLIB'
    );

    const getResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'zeus.context.get', arguments: {} },
    });
    assert.equal(getResponse.result.structuredContent.context.active.sourceFile, 'QRPGLESRC');

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'zeus.fetch-member', arguments: {} },
    });
    assert.equal(calls[0].profile, 'dev');
    assert.equal(calls[0].lib, 'APPLIB');
    assert.equal(calls[0].file, 'QRPGLESRC');
    assert.equal(calls[0].member, 'ORDERPGM');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('clearing context removes selections and preserves a local reset marker', () => {
  const cwd = makeTempWorkspace();
  try {
    setWorkingContext({ cwd, patch: { profile: 'dev', activeKind: 'metadata' } });
    clearWorkingContext({ cwd, actor: 'test' });
    const view = buildWorkingContextView({ cwd });
    assert.equal(view.profile, null);
    assert.equal(view.activeKind, 'sourceCode');
    assert.equal(view.lastChange.actor, 'test');
    assert.deepEqual(loadWorkingContext({ cwd }).context.resources.metadata, {
      profile: null,
      system: null,
      schema: null,
      table: null,
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
