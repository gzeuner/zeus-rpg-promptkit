const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMcpServer, DEFAULT_MCP_SAFE_TOOL_NAMES } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');
const { buildHtmlLines } = require('../src/displayUi/displayUiDdsParser');

const ALL_TOOL_NAMES = listMcpTools().map(tool => tool.name);

function writeSyntheticDisplay(filePath) {
  const uiJson = {
    'record format name': 'GRIDFMT',
    items: [
      {
        id: 'grid1',
        'field type': 'grid',
        'record format name': 'GRIDFMT',
        'number of columns': '2',
        'column headings': 'Code,Text',
      },
      {
        id: 'c1',
        grid: 'grid1',
        column: '1',
        'field type': 'output field',
        'field name': 'STATUSCODE',
        tooltip: 'I=Import Z=Category',
      },
      {
        id: 'c2',
        grid: 'grid1',
        column: '2',
        'field type': 'output field',
        'field name': 'STATUSTEXT',
      },
    ],
  };

  const lines = ['     A          R GRIDFMT', ...buildHtmlLines(JSON.stringify(uiJson))];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

test('listMcpTools exposes zeus.display-ui-inspect with file required', () => {
  const byName = new Map(listMcpTools().map(tool => [tool.name, tool]));
  const tool = byName.get('zeus.display-ui-inspect');
  assert.ok(tool, 'zeus.display-ui-inspect should be registered');
  assert.deepEqual(tool.inputSchema.required, ['file']);
  assert.ok(tool.inputSchema.properties.trace, 'trace property should exist');
});

test('zeus.display-ui-inspect is opt-in only (not part of the default MCP-safe surface)', () => {
  assert.equal(DEFAULT_MCP_SAFE_TOOL_NAMES.includes('zeus.display-ui-inspect'), false);
});

test('mcp tools call zeus.display-ui-inspect returns a projection', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-displayUiins-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');

  try {
    writeSyntheticDisplay(filePath);

    const server = createMcpServer({
      cwd: tempDir,
      allowlistedTools: ALL_TOOL_NAMES,
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 801,
      method: 'tools/call',
      params: {
        name: 'zeus.display-ui-inspect',
        arguments: { file: 'DISPLAY_SAMPLE.MBR' },
      },
    });

    const payload = response.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.readOnly, true);
    assert.equal(payload.mode, 'projection');
    assert.equal(payload.recordFormatCount, 1);
    assert.equal(payload.cliEquivalent, 'node cli/zeus.js display-ui-inspect');

    const rf = payload.recordFormats[0];
    assert.equal(rf.recordFormat, 'GRIDFMT');
    const grid = rf.grids[0];
    assert.equal(grid.columns[0].boundField, 'STATUSCODE');
    assert.equal(grid.columns[0].tooltip, 'I=Import Z=Category');
    assert.equal(grid.columns[1].boundField, 'STATUSTEXT');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp tools call zeus.display-ui-inspect trace locates a field binding', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-displayUiins-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');

  try {
    writeSyntheticDisplay(filePath);

    const server = createMcpServer({
      cwd: tempDir,
      allowlistedTools: ALL_TOOL_NAMES,
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 802,
      method: 'tools/call',
      params: {
        name: 'zeus.display-ui-inspect',
        arguments: { file: 'DISPLAY_SAMPLE.MBR', trace: 'statuscode' },
      },
    });

    const payload = response.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, 'trace');
    assert.ok(payload.trace, 'trace payload expected');
    assert.equal(payload.trace.field, 'STATUSCODE');
    assert.equal(payload.trace.hits.length, 1);
    assert.equal(payload.trace.hits[0].location, 'grid-column');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp tools call zeus.display-ui-inspect rejects file outside workspace root', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-displayUiins-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-out-'));
  const outsideFile = path.join(outsideDir, 'DISPLAY_OUTSIDE.MBR');

  try {
    writeSyntheticDisplay(outsideFile);

    const server = createMcpServer({
      cwd: tempDir,
      allowlistedTools: ALL_TOOL_NAMES,
    });

    await assert.rejects(
      server.handleRequest({
        jsonrpc: '2.0',
        id: 803,
        method: 'tools/call',
        params: {
          name: 'zeus.display-ui-inspect',
          arguments: { file: outsideFile },
        },
      }),
      error => {
        assert.equal(error.code, -32602);
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
