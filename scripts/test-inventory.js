#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const defaultConfig = require('./test-inventory.config');

const ROOT = path.resolve(__dirname, '..');
const MCP_TEST = 'tests/mcp-server.test.js';
const ISSUE_PATTERN = /^https:\/\/github\.com\/gzeuner\/zeus-rpg-promptkit\/issues\/\d+$/;

function normalize(file) {
  return String(file).split(path.sep).join('/').replace(/^\.\//, '');
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, result);
    else if (/\.(?:test|spec)\.js$/.test(entry.name))
      result.push(normalize(path.relative(ROOT, target)));
  }
  return result;
}

function trackedTests() {
  const output = execFileSync('git', ['ls-files', '-z', '--', 'tests'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(file => /\.(?:test|spec)\.js$/.test(file))
    .map(normalize);
}

function inspectInventory(config = defaultConfig, now = new Date()) {
  const maintained = walk(path.join(ROOT, 'tests')).sort();
  const maintainedSet = new Set(maintained);
  const categories = Object.fromEntries(
    Object.entries(config.categories || {}).map(([name, files]) => [
      name,
      [...files].map(normalize).sort(),
    ])
  );
  const explicitlyClassified = new Set(Object.values(categories).flat());
  const implicitUnits = trackedTests().filter(
    file => maintainedSet.has(file) && !explicitlyClassified.has(file)
  );
  categories.unit = [...new Set([...(categories.unit || []), ...implicitUnits])].sort();

  const owners = new Map(maintained.map(file => [file, []]));
  const missing = [];
  for (const [category, files] of Object.entries(categories)) {
    for (const file of files) {
      if (!maintainedSet.has(file)) missing.push(`${category}:${file}`);
      else owners.get(file).push(category);
    }
  }

  const exclusions = Array.isArray(config.exclusions) ? config.exclusions : [];
  const exclusionErrors = [];
  for (const entry of exclusions) {
    if (!entry || typeof entry !== 'object') {
      exclusionErrors.push('exclusion must be an object');
      continue;
    }
    const file = normalize(entry.file || '');
    if (!file || file.includes('*') || file.endsWith('/'))
      exclusionErrors.push(`invalid exclusion file: ${file}`);
    if (!maintainedSet.has(file)) exclusionErrors.push(`excluded file is missing: ${file}`);
    if (file === MCP_TEST) exclusionErrors.push(`${MCP_TEST} may not be excluded`);
    if (!ISSUE_PATTERN.test(String(entry.issue || '')))
      exclusionErrors.push(`invalid exclusion issue: ${file}`);
    if (!entry.reason || /^(flaky|legacy|green ci)$/i.test(String(entry.reason).trim()))
      exclusionErrors.push(`invalid exclusion reason: ${file}`);
    if (!entry.owner || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.introduced || '')))
      exclusionErrors.push(`incomplete exclusion metadata: ${file}`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires || '')) ||
      new Date(`${entry.expires}T23:59:59Z`) < now
    )
      exclusionErrors.push(`expired or invalid exclusion: ${file}`);
  }

  const excluded = new Set(
    exclusions.map(entry => normalize(entry && entry.file ? entry.file : ''))
  );
  const omitted = maintained.filter(file => owners.get(file).length === 0 && !excluded.has(file));
  const duplicates = maintained.filter(file => owners.get(file).length > 1);
  const classified = maintained.filter(file => owners.get(file).length === 1).length;
  const errors = [
    ...missing.map(value => `missing referenced test: ${value}`),
    ...omitted.map(file => `omitted test: ${file}`),
    ...duplicates.map(
      file => `duplicate primary classification: ${file} (${owners.get(file).join(', ')})`
    ),
    ...exclusionErrors,
  ];
  return {
    maintained,
    categories,
    owners,
    missing,
    omitted,
    duplicates,
    exclusions,
    classified,
    errors,
  };
}

function renderSummary(report) {
  let output =
    [
      'Test inventory',
      `Maintained test files discovered: ${report.maintained.length}`,
      `Maintained test files classified: ${report.classified}`,
      'Maintained test files executed: 0 (inventory only)',
      `Test files excluded: ${report.exclusions.length}`,
      `Test files omitted: ${report.omitted.length}`,
      `Duplicate primary classifications: ${report.duplicates.length}`,
      ...Object.keys(report.categories)
        .sort()
        .map(name => `Category ${name}: ${report.categories[name].length}`),
    ].join('\n') + '\n';
  if (report.exclusions.length) {
    output += `EXCLUDED TEST FILES:\n${report.exclusions.map(entry => `- ${entry.file}: ${entry.issue}`).join('\n')}\n`;
  }
  return output;
}

function printSummary(report) {
  process.stdout.write(renderSummary(report));
}

function main() {
  const config = process.env.ZEUS_TEST_INVENTORY_CONFIG
    ? JSON.parse(fs.readFileSync(process.env.ZEUS_TEST_INVENTORY_CONFIG, 'utf8'))
    : defaultConfig;
  const report = inspectInventory(config);
  printSummary(report);
  if (report.errors.length) {
    process.stderr.write(
      `Test inventory integrity failed:\n${report.errors.map(error => `- ${error}`).join('\n')}\n`
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { inspectInventory, printSummary, renderSummary, MCP_TEST };
