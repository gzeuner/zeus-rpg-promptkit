/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function normalizeRelativePath(rootDir, filePath) {
  const normalizedRoot = rootDir ? path.resolve(rootDir) : null;
  const normalizedPath = path.resolve(String(filePath || ''));
  if (!normalizedRoot) {
    return normalizedPath;
  }
  return path.relative(normalizedRoot, normalizedPath).replace(/\\/g, '/');
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function detectNewlineStyle(text) {
  const value = String(text || '');
  if (!value.includes('\n') && !value.includes('\r')) {
    return 'NONE';
  }

  const crlfCount = (value.match(/\r\n/g) || []).length;
  const bareCrCount = (value.match(/\r(?!\n)/g) || []).length;
  const bareLfCount = (value.match(/(?<!\r)\n/g) || []).length;

  if (crlfCount > 0 && bareCrCount === 0 && bareLfCount === 0) {
    return 'CRLF';
  }
  if (bareLfCount > 0 && crlfCount === 0 && bareCrCount === 0) {
    return 'LF';
  }
  if (bareCrCount > 0 && crlfCount === 0 && bareLfCount === 0) {
    return 'CR';
  }
  return 'MIXED';
}

function buildIssue(severity, code, message) {
  return {
    severity,
    code,
    message,
  };
}

function validateSourceFile(filePath, options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : null;
  const absolutePath = path.resolve(String(filePath || ''));
  const relativePath = normalizeRelativePath(rootDir, absolutePath);
  const issues = [];

  if (!fs.existsSync(absolutePath)) {
    issues.push(buildIssue('warning', 'SOURCE_FILE_MISSING', `Source file is missing: ${relativePath}`));
    return {
      path: absolutePath,
      relativePath,
      exists: false,
      sizeBytes: 0,
      sha256: null,
      utf8Valid: false,
      newlineStyle: 'UNKNOWN',
      normalizedNewlines: false,
      importChecksumMatch: null,
      status: 'invalid',
      issues,
    };
  }

  const buffer = fs.readFileSync(absolutePath);
  const sha256 = hashBuffer(buffer);

  let text;
  try {
    text = UTF8_DECODER.decode(buffer);
  } catch (error) {
    issues.push(buildIssue('warning', 'INVALID_UTF8', `Invalid UTF-8 source encoding detected in ${relativePath}`));
    return {
      path: absolutePath,
      relativePath,
      exists: true,
      sizeBytes: buffer.length,
      sha256,
      utf8Valid: false,
      newlineStyle: 'UNKNOWN',
      normalizedNewlines: false,
      importChecksumMatch: options.expectedSha256 ? false : null,
      status: 'invalid',
      issues,
    };
  }

  const newlineStyle = detectNewlineStyle(text);
  const normalizedNewlines = ['LF', 'CRLF', 'NONE'].includes(newlineStyle);

  if (newlineStyle === 'MIXED') {
    issues.push(buildIssue('warning', 'MIXED_NEWLINES', `Mixed newline styles detected in ${relativePath}`));
  } else if (newlineStyle === 'CR') {
    issues.push(buildIssue('warning', 'LEGACY_CR_NEWLINES', `Legacy CR-only newlines detected in ${relativePath}`));
  }

  let importChecksumMatch = null;
  if (options.expectedSha256) {
    importChecksumMatch = options.expectedSha256 === sha256;
    if (!importChecksumMatch) {
      issues.push(buildIssue('warning', 'SOURCE_CHANGED_SINCE_IMPORT', `Source file changed since import manifest was written: ${relativePath}`));
    }
  }

  return {
    path: absolutePath,
    relativePath,
    exists: true,
    sizeBytes: buffer.length,
    sha256,
    utf8Valid: true,
    newlineStyle,
    normalizedNewlines,
    importChecksumMatch,
    status: issues.length > 0 ? 'warning' : 'ok',
    issues,
  };
}

function validateSourceFiles(filePaths, options = {}) {
  const manifestEntries = new Map();
  const importManifest = options.importManifest && Array.isArray(options.importManifest.files)
    ? options.importManifest
    : null;

  if (importManifest) {
    for (const entry of importManifest.files) {
      const relativePath = String(entry && entry.localPath ? entry.localPath : '').trim().replace(/\\/g, '/');
      if (!relativePath) continue;
      manifestEntries.set(relativePath, entry);
    }
  }

  const results = (filePaths || []).map((filePath) => {
    const relativePath = normalizeRelativePath(options.rootDir, filePath);
    const manifestEntry = manifestEntries.get(relativePath) || null;
    return validateSourceFile(filePath, {
      rootDir: options.rootDir,
      expectedSha256: manifestEntry && typeof manifestEntry.sha256 === 'string' ? manifestEntry.sha256 : null,
    });
  });

  const validFiles = results.filter((result) => result.status !== 'invalid').map((result) => result.path);
  const invalidFiles = results.filter((result) => result.status === 'invalid').map((result) => result.path);
  const warningCount = results.reduce((sum, result) => sum + result.issues.filter((issue) => issue.severity === 'warning').length, 0);
  const invalidCount = results.filter((result) => result.status === 'invalid').length;

  return {
    importManifestFound: Boolean(importManifest),
    importManifestPath: options.importManifestPath || null,
    validFiles,
    invalidFiles,
    results,
    warningCount,
    invalidCount,
  };
}

module.exports = {
  detectNewlineStyle,
  normalizeRelativePath,
  validateSourceFile,
  validateSourceFiles,
};
