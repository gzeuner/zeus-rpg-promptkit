#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const files = [
  'LICENSE',
  'NOTICE',
  'README.md',
  'CHANGELOG.md',
  'package.json',
  'package-lock.json',
  'src',
  'cli',
  'scripts',
  'docs/quickstart',
  'docs/architecture',
  '.github/workflows',
];
const forbidden = [
  { label: 'private repository path', pattern: /zeus-rpg-promptkit-commercial/i },
  { label: 'unlicensed marker', pattern: /UNLICENSED/i },
  { label: 'private key material', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { label: 'internal network range', pattern: /\b10\.(20|30)\./ },
];

function walk(target, output) {
  const absolute = path.join(ROOT, target);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    output.push(absolute);
    return;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.local') continue;
    walk(path.join(target, entry.name), output);
  }
}

const targets = [];
for (const file of files) walk(file, targets);
const findings = [];
for (const file of targets) {
  if (path.relative(ROOT, file).replaceAll('\\', '/') === 'scripts/check-consolidated-hygiene.js')
    continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const check of forbidden) {
    if (check.pattern.test(text)) findings.push(`${check.label}: ${path.relative(ROOT, file)}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.license !== 'Apache-2.0') findings.push('package.json license is not Apache-2.0');
if (!fs.existsSync(path.join(ROOT, 'LICENSE'))) findings.push('LICENSE file is missing');

if (findings.length) {
  console.error('Consolidated hygiene check failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Consolidated hygiene check passed (${targets.length} files scanned).`);
