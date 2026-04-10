const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  sanitizedCorpusRoot,
  readSanitizedFixtureJson,
  resolveSanitizedFixturePath,
} = require('./helpers/fixtureCorpus');

function listFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

test('sanitized fixture corpus includes a recorded review checklist', () => {
  const checklistPath = resolveSanitizedFixturePath('review-checklist.json');
  const checklist = readSanitizedFixtureJson('review-checklist.json');

  assert.equal(fs.existsSync(checklistPath), true);
  assert.equal(checklist.kind, 'sanitized-fixture-review-checklist');
  assert.equal(checklist.schemaVersion, 1);
  assert.ok(Array.isArray(checklist.expectations));
  assert.ok(checklist.expectations.length >= 4);
});

test('sanitized fixture corpus rejects copied case-specific names and common confidential patterns', () => {
  const textExtensions = new Set(['.json', '.md', '.rpgle', '.sqlrpgle', '.clle', '.txt']);
  const forbiddenPatterns = [
    /\bORDERPGM\b/,
    /\bINVPGM\b/,
    /\bORDERS\b/,
    /\bINVOICE\b/,
    /\bCUSTOMER\b/,
    /\bMYLIB\b/,
    /\bSOURCEN\b/,
    /\bAPPLIB\b/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  ];

  for (const filePath of listFiles(sanitizedCorpusRoot)) {
    if (!textExtensions.has(path.extname(filePath).toLowerCase())) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(content, pattern, `sanitization violation in ${path.relative(sanitizedCorpusRoot, filePath)} for pattern ${pattern}`);
    }
  }
});
