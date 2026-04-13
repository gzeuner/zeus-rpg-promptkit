const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateArchitectureViewer,
  getArchitectureViewerAssetMetadata,
  renderHtml,
} = require('../src/viewer/architectureViewerGenerator');

function createGraphFixture() {
  return {
    rootProgram: 'ORDERPGM',
    summary: {
      programCount: 2,
      tableCount: 1,
      copyMemberCount: 0,
      edgeCount: 1,
      unresolvedPrograms: [],
    },
    nodes: [
      { id: 'ORDERPGM', type: 'PROGRAM' },
      { id: 'ORDERS', type: 'TABLE' },
    ],
    edges: [
      { from: 'ORDERPGM', to: 'ORDERS', type: 'USES_TABLE' },
    ],
    unresolvedPrograms: [],
  };
}

test('architecture viewer renders as self-contained offline HTML with bundled asset metadata', () => {
  const graph = createGraphFixture();
  const metadata = getArchitectureViewerAssetMetadata();
  const html = renderHtml(graph);

  assert.equal(metadata.packageName, 'vis-network');
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
  assert.equal(metadata.asset, 'vis-network/standalone/umd/vis-network.min.js');
  assert.equal(metadata.sourceMode, 'bundled-inline');
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);

  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(html.includes('unpkg.com/vis-network'), false);
  assert.match(html, /meta name="zeus-viewer-library"/);
  assert.match(html, new RegExp(`Bundled asset: ${metadata.packageName} ${metadata.version}`));
  assert.match(html, /new vis\.Network/);
});

test('generateArchitectureViewer writes a portable offline artifact to disk', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-architecture-viewer-'));
  const graphPath = path.join(tempRoot, 'program-call-tree.json');
  const outputPath = path.join(tempRoot, 'architecture.html');

  try {
    fs.writeFileSync(graphPath, `${JSON.stringify(createGraphFixture(), null, 2)}\n`, 'utf8');
    const writtenPath = generateArchitectureViewer({
      graphPath,
      outputPath,
    });

    assert.equal(writtenPath, outputPath);
    assert.equal(fs.existsSync(outputPath), true);
    const html = fs.readFileSync(outputPath, 'utf8');
    assert.equal(/<script[^>]+src=/i.test(html), false);
    assert.equal(html.includes('unpkg.com/vis-network'), false);
    assert.match(html, /Bundled viewer asset: vis-network@/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
