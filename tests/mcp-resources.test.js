const test = require('node:test');
const assert = require('node:assert/strict');

const { createMcpServer } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');

const ALL_TOOL_NAMES = listMcpTools().map(tool => tool.name);

function createTestServer(runtime = {}) {
  return createMcpServer({
    cwd: process.cwd(),
    allowlistedTools: ALL_TOOL_NAMES,
    ...runtime,
  });
}

test('listMcpTools exposes zeus.resources and zeus.discover-environment', () => {
  const byName = new Map(listMcpTools().map(tool => [tool.name, tool]));

  const resources = byName.get('zeus.resources');
  assert.ok(resources, 'zeus.resources should be registered');
  assert.deepEqual(resources.inputSchema.required, ['profile']);

  const discover = byName.get('zeus.discover-environment');
  assert.ok(discover, 'zeus.discover-environment should be registered');
  assert.deepEqual(discover.inputSchema.required, ['profile']);
  assert.equal(discover.inputSchema.properties.includeMembers.type, 'boolean');
  assert.deepEqual(discover.inputSchema.properties.role.enum, ['metadata', 'data']);
});

test('mcp resources include agent bootstrap metadata', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 400,
    method: 'resources/list',
    params: {},
  });

  const uris = listResponse.result.resources.map(resource => resource.uri);
  assert.ok(uris.includes('zeus://metadata/agent-bootstrap.json'));

  const readResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 401,
    method: 'resources/read',
    params: {
      uri: 'zeus://metadata/agent-bootstrap.json',
    },
  });

  assert.equal(readResponse.result.contents[0].mimeType, 'application/json');
  const bootstrap = JSON.parse(readResponse.result.contents[0].text);
  assert.equal(bootstrap.schemaVersion, 1);
  assert.equal(bootstrap.next, 'help');
  assert.ok(bootstrap.defaultTools.includes('zeus.agent.bootstrap'));
  assert.equal(bootstrap.piDiscoverySnapshot.present, false);
});

test('mcp resources expose the same live AI orientation used by the CLI guide', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 408,
    method: 'resources/list',
    params: {},
  });
  assert.ok(
    listResponse.result.resources.some(
      resource => resource.uri === 'zeus://metadata/agent-orientation.json'
    )
  );

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 409,
    method: 'resources/read',
    params: { uri: 'zeus://metadata/agent-orientation.json' },
  });
  const orientation = JSON.parse(response.result.contents[0].text);
  assert.equal(orientation.schemaVersion, 1);
  assert.equal(orientation.firstPoint.mcp, 'zeus.agent.bootstrap (optional adapter)');
  assert.equal(orientation.commands.length, 51);
  assert.ok(orientation.workingContext.fields.includes('sourceFile'));
  assert.ok(orientation.intents.some(intent => intent.intent === 'remote-read'));
});

test('mcp tools call zeus.resources returns sanitized resource model', async () => {
  const server = createTestServer({
    resourcesRunner: () => ({
      profile: 'dev',
      configSource: 'config/profiles.json',
      model: {
        kind: 'resource-model',
        schemaVersion: 1,
        multiSystem: false,
        systemsInUse: ['dev'],
        resources: {
          sourceCode: {
            kind: 'sourceCode',
            system: 'dev',
            target: { systemKey: 'dev', host: 'DEVHOST' },
            libraries: ['APPLIB'],
          },
        },
      },
    }),
  });

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 402,
    method: 'tools/call',
    params: {
      name: 'zeus.resources',
      arguments: { profile: 'dev' },
    },
  });

  const payload = response.result.structuredContent;
  assert.equal(payload.ok, true);
  assert.equal(payload.profile, 'dev');
  assert.equal(payload.configSource, 'config/profiles.json');
  assert.equal(payload.model.kind, 'resource-model');
  assert.deepEqual(payload.model.systemsInUse, ['dev']);
  assert.equal(payload.model.resources.sourceCode.libraries[0], 'APPLIB');
});

test('mcp tools call zeus.resources without profile raises invalid arguments', async () => {
  const server = createTestServer();

  await assert.rejects(
    server.handleRequest({
      jsonrpc: '2.0',
      id: 403,
      method: 'tools/call',
      params: {
        name: 'zeus.resources',
        arguments: {},
      },
    }),
    error => {
      assert.equal(error.code, -32602);
      assert.match(String(error.message || ''), /profile/i);
      return true;
    }
  );
});

test('mcp tools call zeus.discover-environment returns report and suggested resources', async () => {
  const server = createTestServer({
    discoverEnvironmentRunner: async args => {
      assert.equal(args.profile, 'dev');
      assert.deepEqual(args.libraries, ['DEVLIB']);
      return {
        profile: 'dev',
        report: {
          kind: 'environment-discovery-report',
          schemaVersion: 1,
          target: { systemKey: 'dev', host: 'DEVHOST' },
          schemas: ['DEVLIB'],
          sourceLibraries: ['DEVLIB'],
          sourceFiles: [{ schema: 'DEVLIB', name: 'QRPGLESRC', text: 'RPG source' }],
          tables: [{ schema: 'DEVLIB', name: 'ORDERS', type: 'T' }],
          members: [],
          notes: [],
        },
        suggestedResources: {
          sourceCode: { system: 'dev', libraries: ['DEVLIB'], sourceFiles: ['QRPGLESRC'] },
          objects: { system: 'dev', libraries: ['DEVLIB'], objectTypes: ['*PGM', '*SRVPGM'] },
          metadata: { system: 'dev', schemas: ['DEVLIB'] },
          data: { system: 'dev', schemas: ['DEVLIB'] },
        },
      };
    },
  });

  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 404,
    method: 'tools/call',
    params: {
      name: 'zeus.discover-environment',
      arguments: { profile: 'dev', libraries: ['DEVLIB'] },
    },
  });

  const payload = response.result.structuredContent;
  assert.equal(payload.ok, true);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.profile, 'dev');
  assert.equal(payload.report.kind, 'environment-discovery-report');
  assert.equal(payload.report.sourceFiles[0].name, 'QRPGLESRC');
  assert.equal(payload.suggestedResources.objects.objectTypes[0], '*PGM');
});

test('mcp tools call zeus.discover-environment surfaces incomplete config as invalid arguments', async () => {
  const server = createTestServer({
    discoverEnvironmentRunner: async () => {
      const error = new Error(
        'DB2 connection configuration is incomplete for the selected profile.'
      );
      error.code = 'TOOL_INVALID_ARGUMENTS';
      throw error;
    },
  });

  await assert.rejects(
    server.handleRequest({
      jsonrpc: '2.0',
      id: 405,
      method: 'tools/call',
      params: {
        name: 'zeus.discover-environment',
        arguments: { profile: 'dev' },
      },
    }),
    error => {
      assert.equal(error.code, -32602);
      assert.match(String(error.message || ''), /incomplete/i);
      return true;
    }
  );
});

test('H0 surface parity resource exposes guarded CLI/MCP/capability mappings', async () => {
  const server = createTestServer({ cwd: process.cwd() });
  const listResponse = await server.handleRequest({
    jsonrpc: '2.0',
    id: 406,
    method: 'resources/list',
    params: {},
  });
  assert.ok(
    listResponse.result.resources.some(
      resource => resource.uri === 'zeus://metadata/surface-parity.json'
    )
  );
  const response = await server.handleRequest({
    jsonrpc: '2.0',
    id: 407,
    method: 'resources/read',
    params: { uri: 'zeus://metadata/surface-parity.json' },
  });
  const parity = JSON.parse(response.result.contents[0].text);
  const mcpNames = new Set(parity.mcpTools.map(tool => tool.name));
  assert.equal(parity.schemaVersion, 1);
  assert.ok(parity.cliCommands.some(command => command.command === 'doctor'));
  assert.ok(parity.capabilityMappings.some(mapping => mapping.mcpName === 'zeus.analyze'));
  for (const name of parity.defaultAllowlist) assert.ok(mcpNames.has(name), name);
});
