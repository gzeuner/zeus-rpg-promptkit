'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildCatalogModel,
  formatOutputLabel,
  generateToolCatalog,
  renderJson,
  renderMarkdown,
  resolveGeneratedAt,
  validateCatalogMetadata,
  validateRenderedCatalog,
} = require('../src/docs/toolCatalogGenerator');
const {
  COMMAND_METADATA,
  COMMAND_CATALOG_CONTRACTS,
  COMMAND_ORDER,
} = require('../src/docs/toolCatalogMetadata');

const projectRoot = path.resolve(__dirname, '..');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeExportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-tool-catalog-export-'));
  fs.mkdirSync(path.join(root, 'cli'), { recursive: true });
  for (const relativePath of ['package.json', 'CHANGELOG.md', 'cli/zeus.js']) {
    fs.copyFileSync(path.join(projectRoot, relativePath), path.join(root, relativePath));
  }
  return root;
}

test('catalog model is deterministic and preserves the public command contracts', () => {
  const first = buildCatalogModel({ repoRoot: projectRoot, env: {} });
  const second = buildCatalogModel({ repoRoot: projectRoot, env: {} });
  assert.deepEqual(first, second);
  assert.equal(first.generatedAt, '2026-07-12T00:00:00.000Z');
  assert.deepEqual(first.package, { name: 'zeus-rpg-promptkit', version: '0.2.0-beta.2' });

  const investigate = first.commandRows.find(entry => entry.command === 'investigate');
  assert.deepEqual(investigate.aliases, ['investigation']);
  assert.equal(investigate.safety, 'S1');
  assert.deepEqual(investigate.sideEffects, ['local-artifact-write']);
  assert.equal(investigate.capabilityId, 'investigation.investigate');

  const querySql = first.commandRows.find(entry => entry.command === 'query-sql');
  assert.deepEqual(querySql.aliases, ['sql']);
  assert.equal(querySql.safety, 'S2');
  assert.equal(
    first.commandRows.some(entry => entry.command === 'help'),
    false
  );
  assert.ok(first.commandRows.every(entry => entry.availability.cli === true));
  for (const command of ['validate-rpg-sql', 'onboarding', 'trace', 'xref', 'pui-inspect']) {
    assert.ok(
      first.commandRows.some(entry => entry.command === command),
      `missing ${command}`
    );
  }
});

test('SOURCE_DATE_EPOCH is strict, deterministic, and independent from the local clock', () => {
  assert.equal(
    resolveGeneratedAt(projectRoot, { SOURCE_DATE_EPOCH: '0' }),
    '1970-01-01T00:00:00.000Z'
  );
  assert.equal(
    resolveGeneratedAt(projectRoot, { SOURCE_DATE_EPOCH: '1784160000' }),
    '2026-07-16T00:00:00.000Z'
  );
  for (const invalid of ['', ' 0', '-1', '1.5', 'not-a-date']) {
    assert.throws(
      () => resolveGeneratedAt(projectRoot, { SOURCE_DATE_EPOCH: invalid }),
      /SOURCE_DATE_EPOCH/
    );
  }
});

test('release-date fallback rejects calendar dates that JavaScript would normalize', () => {
  const root = makeExportFixture();
  try {
    fs.writeFileSync(
      path.join(root, 'CHANGELOG.md'),
      '# Changelog\n\n## [0.2.0-beta.2] - 2026-02-30\n',
      'utf8'
    );
    assert.throws(() => resolveGeneratedAt(root, {}), /invalid release date/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI output labels never expose absolute local paths', () => {
  assert.equal(
    formatOutputLabel(projectRoot, path.join(projectRoot, 'docs', 'tool-catalog.md')),
    'docs/tool-catalog.md'
  );
  assert.equal(
    formatOutputLabel(projectRoot, path.join(os.tmpdir(), 'private-user', 'catalog.md')),
    '<external-output>'
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-catalog-cli-output-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        'cli/zeus.js',
        'docs:generate-catalog',
        '--output',
        path.join(root, 'catalog.md'),
        '--json-output',
        path.join(root, 'catalog.json'),
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tool catalog markdown written to: <external-output>/);
    assert.match(result.stdout, /Tool catalog json written to: <external-output>/);
    assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(
      result.stdout,
      new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generation is byte-identical on repeat and matches committed Markdown and JSON', () => {
  const root = makeExportFixture();
  try {
    const markdownPath = path.join(root, 'catalog.md');
    const jsonPath = path.join(root, 'catalog.json');
    generateToolCatalog({
      repoRoot: root,
      markdownOutputPath: markdownPath,
      jsonOutputPath: jsonPath,
      env: {},
    });
    const firstMarkdown = fs.readFileSync(markdownPath, 'utf8');
    const firstJson = fs.readFileSync(jsonPath, 'utf8');
    generateToolCatalog({
      repoRoot: root,
      markdownOutputPath: markdownPath,
      jsonOutputPath: jsonPath,
      env: {},
    });
    assert.equal(sha256(fs.readFileSync(markdownPath)), sha256(firstMarkdown));
    assert.equal(sha256(fs.readFileSync(jsonPath)), sha256(firstJson));
    assert.equal(
      firstMarkdown,
      fs.readFileSync(path.join(projectRoot, 'docs/tool-catalog.md'), 'utf8')
    );
    assert.equal(
      firstJson,
      fs.readFileSync(path.join(projectRoot, 'docs/tool-catalog.json'), 'utf8')
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generation works in an exported tree without Git metadata', () => {
  const root = makeExportFixture();
  try {
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    const model = buildCatalogModel({ repoRoot: root, env: {} });
    assert.equal(model.generatedAt, '2026-07-12T00:00:00.000Z');
    assert.equal(model.commandRows.length, COMMAND_ORDER.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metadata validation is stable across object registration order and fails closed on drift', () => {
  const cliSource = fs.readFileSync(path.join(projectRoot, 'cli/zeus.js'), 'utf8');
  const reversedMetadata = Object.fromEntries(Object.entries(COMMAND_METADATA).reverse());
  const reversedContracts = Object.fromEntries(Object.entries(COMMAND_CATALOG_CONTRACTS).reverse());
  assert.equal(
    validateCatalogMetadata({
      metadata: reversedMetadata,
      contracts: reversedContracts,
      order: COMMAND_ORDER,
      cliSource,
    }),
    true
  );

  const missing = { ...COMMAND_METADATA };
  delete missing['query-sql'];
  assert.throws(
    () => validateCatalogMetadata({ metadata: missing, cliSource }),
    /missing command metadata: query-sql/
  );
  assert.throws(
    () => validateCatalogMetadata({ order: [...COMMAND_ORDER, COMMAND_ORDER[0]], cliSource }),
    /duplicate command order entry/
  );
  assert.throws(
    () =>
      validateCatalogMetadata({ cliSource: `${cliSource}\nif (command === 'private-only') {}` }),
    /implemented CLI route has no public catalog contract: private-only/
  );
  const withoutQuerySql = cliSource.replace(
    /command === 'query-sql'/g,
    "command === 'removed-query-sql'"
  );
  assert.throws(
    () => validateCatalogMetadata({ cliSource: withoutQuerySql }),
    /declared public CLI route is not implemented: query-sql/
  );
});

test('metadata validation rejects duplicate aliases and incomplete required contracts', () => {
  const cliSource = fs.readFileSync(path.join(projectRoot, 'cli/zeus.js'), 'utf8');
  const duplicateAliasContracts = {
    ...COMMAND_CATALOG_CONTRACTS,
    'query-sql': { ...COMMAND_CATALOG_CONTRACTS['query-sql'], aliases: ['doctor'] },
  };
  assert.throws(
    () => validateCatalogMetadata({ contracts: duplicateAliasContracts, cliSource }),
    /duplicate public command name: doctor/
  );
  const mcpOnlyContract = {
    ...COMMAND_CATALOG_CONTRACTS,
    doctor: {
      ...COMMAND_CATALOG_CONTRACTS.doctor,
      availability: { ...COMMAND_CATALOG_CONTRACTS.doctor.availability, cli: false },
    },
  };
  assert.throws(
    () => validateCatalogMetadata({ contracts: mcpOnlyContract, cliSource }),
    /doctor is not an implemented public CLI command/
  );
  const incompleteMetadata = {
    ...COMMAND_METADATA,
    doctor: { ...COMMAND_METADATA.doctor, purpose: '' },
  };
  assert.throws(
    () => validateCatalogMetadata({ metadata: incompleteMetadata, cliSource }),
    /doctor\.purpose must be a non-empty string/
  );
});

test('Markdown and JSON are projections of one model and reject divergence or local paths', () => {
  const model = buildCatalogModel({ repoRoot: projectRoot, env: {} });
  const markdown = renderMarkdown(model);
  const json = renderJson(model);
  assert.equal(validateRenderedCatalog(model, markdown, json), true);
  const commandTable = markdown.split('## CLI Command Catalog')[1].split('## Workflow Presets')[0];
  assert.deepEqual(
    [...commandTable.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]),
    model.commandRows.map(entry => entry.command)
  );
  assert.throws(
    () =>
      validateRenderedCatalog(model, markdown.replace('| `investigate` |', '| `omitted` |'), json),
    /missing command: investigate/
  );
  assert.throws(
    () => validateRenderedCatalog(model, `${markdown}\n/home/example/private.txt`, json),
    /forbidden local metadata/
  );
  assert.doesNotMatch(json, /(?:password|token|api[_-]?key)\s*[=:]\s*[^,}\s]+/i);
});

test('generator rejects colliding output targets before writing', () => {
  const root = makeExportFixture();
  try {
    assert.throws(
      () =>
        generateToolCatalog({
          repoRoot: root,
          markdownOutputPath: 'same-output',
          jsonOutputPath: './same-output',
          env: {},
        }),
      /must be different/
    );
    assert.equal(fs.existsSync(path.join(root, 'same-output')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
