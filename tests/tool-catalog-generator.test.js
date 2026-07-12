const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalogModel, renderMarkdown } = require('../src/docs/toolCatalogGenerator');

const projectRoot = require('path').resolve(__dirname, '..');

test('tool catalog model includes docs generator command with S0 safety', () => {
  const model = buildCatalogModel({ repoRoot: projectRoot });
  const row = model.commandRows.find(entry => entry.command === 'docs:generate-catalog');
  assert.ok(row, 'docs:generate-catalog row should exist');
  assert.equal(row.safety, 'S0');
  assert.match(row.purpose, /Regenerate docs\/tool-catalog\.md/i);
});

test('tool catalog markdown contains auto-generated notice and required sections', () => {
  const model = buildCatalogModel({ repoRoot: projectRoot });
  const markdown = renderMarkdown(model, new Date('2026-05-17T08:55:42Z'));

  assert.match(markdown, /AUTO-GENERATED FILE/);
  assert.match(markdown, /Regenerate with: zeus docs:generate-catalog/);
  assert.match(markdown, /Last generated: 2026-05-17 \d{2}:\d{2}:42/);
  assert.match(markdown, /## Safety Levels/);
  assert.match(markdown, /## CLI Command Catalog/);
  assert.match(markdown, /\| `docs:generate-catalog` \| `S0` \|/);
});
