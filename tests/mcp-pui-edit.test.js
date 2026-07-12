const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMcpServer } = require('../src/mcp/mcpServer');
const { listMcpTools } = require('../src/mcp/mcpTools');
const { buildHtmlLines } = require('../src/pui/puiDdsParser');

const ALL_TOOL_NAMES = listMcpTools().map(tool => tool.name);

function writeSyntheticDisplay(filePath) {
  const uiJson = {
    items: [
      {
        id: 'gridMain',
        'field type': 'grid',
        'record format name': 'SFLMAIN',
        'number of columns': '1',
        'column widths': '120',
        'column headings': 'Name',
        width: '121px',
      },
    ],
  };

  const lines = [
    '     A          R HEADER',
    ...buildHtmlLines(JSON.stringify(uiJson)),
    '     A          R SFLMAIN',
    '     A            FIELD_A        10A  O  1  1',
    '     A          R FOOTER',
  ];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

test('listMcpTools exposes zeus.pui-edit with action required', () => {
  const byName = new Map(listMcpTools().map(tool => [tool.name, tool]));
  const tool = byName.get('zeus.pui-edit');
  assert.ok(tool, 'zeus.pui-edit should be registered');
  assert.deepEqual(tool.inputSchema.required, ['action']);
  assert.ok(
    tool.inputSchema.properties.action.enum.includes('grid-add-column'),
    'action enum should include grid-add-column'
  );
  assert.ok(
    tool.inputSchema.properties.action.enum.includes('dump-json'),
    'action enum should include dump-json'
  );
});

test('mcp tools call zeus.pui-edit dump-json returns parsed JSON', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-pui-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');

  try {
    writeSyntheticDisplay(filePath);

    const server = createMcpServer({
      cwd: tempDir,
      allowlistedTools: ALL_TOOL_NAMES,
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 701,
      method: 'tools/call',
      params: {
        name: 'zeus.pui-edit',
        arguments: { action: 'dump-json', file: 'DISPLAY_SAMPLE.MBR' },
      },
    });

    const payload = response.result.structuredContent;
    assert.equal(payload.ok, true);
    assert.equal(payload.puiAction, 'dump-json');
    assert.ok(payload.data && payload.data.json, 'expected data.json');
    assert.equal(payload.cliEquivalent, 'node cli/zeus.js pui-edit');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('mcp tools call zeus.pui-edit rejects file outside workspace root', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-pui-'));
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
        id: 702,
        method: 'tools/call',
        params: {
          name: 'zeus.pui-edit',
          arguments: { action: 'dump-json', file: outsideFile },
        },
      }),
      error => {
        assert.equal(error.code, -32602);
        assert.match(String(error.message || ''), /workspace root/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('mcp tools call zeus.pui-edit blocks apply without confirm', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-mcp-pui-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');
  const changeSetPath = path.join(tempDir, 'changes.json');

  try {
    writeSyntheticDisplay(filePath);
    fs.writeFileSync(changeSetPath, JSON.stringify({ changes: [] }), 'utf8');

    const server = createMcpServer({
      cwd: tempDir,
      allowlistedTools: ALL_TOOL_NAMES,
    });

    await assert.rejects(
      server.handleRequest({
        jsonrpc: '2.0',
        id: 703,
        method: 'tools/call',
        params: {
          name: 'zeus.pui-edit',
          arguments: {
            action: 'apply',
            file: 'DISPLAY_SAMPLE.MBR',
            'changes-file': 'changes.json',
          },
        },
      }),
      error => {
        assert.equal(error.code, -32602);
        assert.match(String(error.message || ''), /confirm/i);
        return true;
      }
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
