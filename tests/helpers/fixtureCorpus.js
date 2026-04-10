const fs = require('fs');
const path = require('path');

const sanitizedCorpusRoot = path.join(__dirname, '..', 'fixtures', 'sanitized-corpus');

function resolveSanitizedFixturePath(...parts) {
  return path.join(sanitizedCorpusRoot, ...parts);
}

function readSanitizedFixtureJson(...parts) {
  return JSON.parse(fs.readFileSync(resolveSanitizedFixturePath(...parts), 'utf8'));
}

function readSanitizedFixtureText(...parts) {
  return fs.readFileSync(resolveSanitizedFixturePath(...parts), 'utf8');
}

function copySanitizedFixtureTree(relativePath, targetDir) {
  fs.cpSync(resolveSanitizedFixturePath(relativePath), targetDir, { recursive: true });
  return targetDir;
}

module.exports = {
  sanitizedCorpusRoot,
  resolveSanitizedFixturePath,
  readSanitizedFixtureJson,
  readSanitizedFixtureText,
  copySanitizedFixtureTree,
};
