#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'jsconfig.json');
const REQUIRED = [
  'src/core/capabilityRegistry.js',
  'src/mcp/mcpPolicy.js',
  'src/api/zeusApi.js',
  'types.d.ts',
];

function parseConfig(file = CONFIG) {
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return JSON.parse(text);
}

function verifyScope(configFile = CONFIG) {
  const config = parseConfig(configFile);
  const files = Array.isArray(config.files) ? config.files : [];
  const errors = [];
  for (const required of REQUIRED) {
    if (!files.includes(required)) errors.push(`required core file is not declared: ${required}`);
  }
  if (files.length < REQUIRED.length)
    errors.push(`declared file count shrank below ${REQUIRED.length}`);
  for (const file of files) {
    if (!fs.existsSync(path.resolve(ROOT, file)))
      errors.push(`declared core file is missing: ${file}`);
  }
  return { files, errors };
}

function main() {
  let report;
  try {
    report = verifyScope();
  } catch (error) {
    process.stderr.write(`Typecheck core scope is invalid: ${error.message}\n`);
    process.exit(1);
  }
  if (report.errors.length) {
    process.stderr.write(`${report.errors.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`Typecheck core scope verified: ${report.files.length} declared files\n`);
}

if (require.main === module) main();

module.exports = { REQUIRED, parseConfig, verifyScope };
