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
const { classifySourceFile } = require('./sourceType');

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF16LE_DECODER = new TextDecoder('utf-16le', { fatal: true });
const UTF16BE_DECODER = new TextDecoder('utf-16be', { fatal: true });

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

function decodeBuffer(buffer, decoder) {
  try {
    return decoder.decode(buffer);
  } catch (_) {
    return null;
  }
}

function detectEncoding(buffer, options = {}) {
  const strictUtf8Only = Boolean(options.strictUtf8Only);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const decoded = decodeBuffer(bytes.subarray(3), UTF8_DECODER);
    if (decoded !== null) {
      return {
        detectedEncoding: 'UTF-8',
        hadBom: true,
        encodingConverted: false,
        text: decoded,
      };
    }
  }

  if (!strictUtf8Only && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const decoded = decodeBuffer(bytes.subarray(2), UTF16LE_DECODER);
    if (decoded !== null) {
      return {
        detectedEncoding: 'UTF-16LE',
        hadBom: true,
        encodingConverted: true,
        text: decoded,
      };
    }
  }

  if (!strictUtf8Only && bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const decoded = decodeBuffer(bytes.subarray(2), UTF16BE_DECODER);
    if (decoded !== null) {
      return {
        detectedEncoding: 'UTF-16BE',
        hadBom: true,
        encodingConverted: true,
        text: decoded,
      };
    }
  }

  const utf8 = decodeBuffer(bytes, UTF8_DECODER);
  if (utf8 !== null) {
    return {
      detectedEncoding: 'UTF-8',
      hadBom: false,
      encodingConverted: false,
      text: utf8,
    };
  }

  return null;
}

function normalizeTextContract(text, options = {}) {
  const originalText = String(text || '');
  const originalNewlineStyle = detectNewlineStyle(originalText);
  const normalizedText = options.normalizeText === false
    ? originalText
    : originalText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedNewlineStyle = detectNewlineStyle(normalizedText);
  const lineEndingsNormalized = normalizedText !== originalText;

  return {
    text: normalizedText,
    originalNewlineStyle,
    normalizedNewlineStyle,
    lineEndingsNormalized,
  };
}

function getManifestLocalPath(entry) {
  return String(
    (entry && entry.origin && entry.origin.localPath)
    || (entry && entry.localPath)
    || '',
  ).trim().replace(/\\/g, '/');
}

function getManifestSha256(entry) {
  if (entry && entry.validation && typeof entry.validation.sha256 === 'string') {
    return entry.validation.sha256;
  }
  if (entry && typeof entry.sha256 === 'string') {
    return entry.sha256;
  }
  return null;
}

function validateSourceFile(filePath, options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : null;
  const absolutePath = path.resolve(String(filePath || ''));
  const relativePath = normalizeRelativePath(rootDir, absolutePath);
  const issues = [];
  const strictUtf8Only = Boolean(options.strictUtf8Only);

  if (!fs.existsSync(absolutePath)) {
    issues.push(buildIssue('warning', 'SOURCE_FILE_MISSING', `Source file is missing: ${relativePath}`));
    return {
      path: absolutePath,
      relativePath,
      sourceType: classifySourceFile(absolutePath, options.sourceType || ''),
      exists: false,
      sizeBytes: 0,
      sha256: null,
      utf8Valid: false,
      detectedEncoding: null,
      hadBom: false,
      newlineStyle: 'UNKNOWN',
      normalizedNewlineStyle: 'UNKNOWN',
      normalizedNewlines: false,
      normalizationStatus: 'invalid',
      normalizationActions: [],
      normalizedText: null,
      importChecksumMatch: null,
      status: 'invalid',
      issues,
    };
  }

  const buffer = fs.readFileSync(absolutePath);
  const sha256 = hashBuffer(buffer);
  const sizeBytes = buffer.length;
  const sourceType = classifySourceFile(absolutePath, options.sourceType || '');
  const decoded = detectEncoding(buffer, { strictUtf8Only });

  if (!decoded) {
    issues.push(buildIssue(
      'warning',
      'INVALID_UTF8',
      `Invalid UTF-8 source encoding detected in ${relativePath}. Supported analyze conversions currently require UTF-8 or UTF-16 BOM markers.`,
    ));
    return {
      path: absolutePath,
      relativePath,
      sourceType,
      exists: true,
      sizeBytes,
      sha256,
      utf8Valid: false,
      detectedEncoding: null,
      hadBom: false,
      newlineStyle: 'UNKNOWN',
      normalizedNewlineStyle: 'UNKNOWN',
      normalizedNewlines: false,
      normalizationStatus: 'invalid',
      normalizationActions: [],
      normalizedText: null,
      importChecksumMatch: options.expectedSha256 ? false : null,
      status: 'invalid',
      issues,
    };
  }

  const normalized = normalizeTextContract(decoded.text, { normalizeText: options.normalizeText !== false });
  const normalizationActions = [];

  if (decoded.hadBom) {
    normalizationActions.push('STRIP_BOM');
    issues.push(buildIssue('info', 'SOURCE_BOM_REMOVED', `Removed BOM from ${relativePath} before analysis.`));
  }

  if (decoded.encodingConverted) {
    normalizationActions.push(`DECODE_${decoded.detectedEncoding}`);
    issues.push(buildIssue('warning', 'SOURCE_ENCODING_CONVERTED', `Converted ${relativePath} from ${decoded.detectedEncoding} into the UTF-8 analysis contract.`));
  }

  if (normalized.lineEndingsNormalized) {
    normalizationActions.push('NORMALIZE_LINE_ENDINGS');
    const severity = ['MIXED', 'CR'].includes(normalized.originalNewlineStyle) ? 'warning' : 'info';
    issues.push(buildIssue(
      severity,
      'SOURCE_LINE_ENDINGS_NORMALIZED',
      `Normalized ${relativePath} line endings from ${normalized.originalNewlineStyle} to ${normalized.normalizedNewlineStyle}.`,
    ));
  } else if (normalized.originalNewlineStyle === 'MIXED') {
    issues.push(buildIssue('warning', 'MIXED_NEWLINES', `Mixed newline styles detected in ${relativePath}`));
  } else if (normalized.originalNewlineStyle === 'CR') {
    issues.push(buildIssue('warning', 'LEGACY_CR_NEWLINES', `Legacy CR-only newlines detected in ${relativePath}`));
  }

  let importChecksumMatch = null;
  if (options.expectedSha256) {
    importChecksumMatch = options.expectedSha256 === sha256;
    if (!importChecksumMatch) {
      issues.push(buildIssue('warning', 'SOURCE_CHANGED_SINCE_IMPORT', `Source file changed since import manifest was written: ${relativePath}`));
    }
  }

  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  let normalizationStatus = 'ok';
  if (decoded.encodingConverted) {
    normalizationStatus = 'converted';
  } else if (decoded.hadBom || normalized.lineEndingsNormalized) {
    normalizationStatus = 'normalized';
  }

  return {
    path: absolutePath,
    relativePath,
    sourceType,
    exists: true,
    sizeBytes,
    sha256,
    utf8Valid: decoded.detectedEncoding === 'UTF-8',
    detectedEncoding: decoded.detectedEncoding,
    hadBom: decoded.hadBom,
    newlineStyle: normalized.originalNewlineStyle,
    normalizedNewlineStyle: normalized.normalizedNewlineStyle,
    normalizedNewlines: ['LF', 'NONE'].includes(normalized.normalizedNewlineStyle),
    normalizationStatus,
    normalizationActions,
    normalizedText: normalized.text,
    importChecksumMatch,
    status: warningCount > 0 ? 'warning' : 'ok',
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
      const relativePath = getManifestLocalPath(entry);
      if (!relativePath) continue;
      manifestEntries.set(relativePath, entry);
    }
  }

  const results = (filePaths || []).map((filePath) => {
    const relativePath = normalizeRelativePath(options.rootDir, filePath);
    const manifestEntry = manifestEntries.get(relativePath) || null;
    return validateSourceFile(filePath, {
      rootDir: options.rootDir,
      sourceType: options.sourceTypeByPath && options.sourceTypeByPath.get
        ? options.sourceTypeByPath.get(path.resolve(filePath))
        : null,
      expectedSha256: manifestEntry ? getManifestSha256(manifestEntry) : null,
      strictUtf8Only: Boolean(options.strictUtf8Only),
      normalizeText: options.normalizeText !== false,
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
    normalizationSummary: {
      fileCount: results.length,
      convertedEncodingCount: results.filter((result) => result.normalizationStatus === 'converted').length,
      normalizedFileCount: results.filter((result) => ['normalized', 'converted'].includes(result.normalizationStatus)).length,
      bomRemovedCount: results.filter((result) => result.hadBom).length,
      normalizedLineEndingCount: results.filter((result) => result.normalizationActions.includes('NORMALIZE_LINE_ENDINGS')).length,
      invalidFileCount: invalidCount,
      warningCount,
    },
  };
}

module.exports = {
  detectNewlineStyle,
  normalizeRelativePath,
  validateSourceFile,
  validateSourceFiles,
};
