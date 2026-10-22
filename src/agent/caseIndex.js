'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { safeWorkspacePath } = require('./agentResume');

const CASE_INDEX_FILE = 'case-index.json';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCES = 64;
const DOCUMENT_ROLES = new Set([
  'test-plan',
  'overview',
  'source-evidence',
  'execution-log',
  'briefing',
]);
const EVIDENCE_ROLES = new Set([
  'source-evidence',
  'analysis-manifest',
  'configuration-evidence',
  'execution-log',
  'screenshot',
]);
const WARNING_MESSAGES = {
  DOCUMENT_CHANGED:
    'Document bytes differ from the reviewed index hash. Review changes before updating the hash.',
  DOCUMENT_UNVERIFIED:
    'Document could not be verified locally. Check its path and readability; no current document check is claimed.',
  CASE_IDS_DIFFER:
    'Current test-plan and overview TC/OPT identifiers differ. Compare the cases; this is not a program-test result.',
  DOCUMENT_VALIDATION_NOT_CURRENT:
    'The receipt checks an older document version. This does not indicate a failed program test. Keep the old receipt and perform a new document check.',
  DOCUMENT_VALIDATION_UNVERIFIED:
    'Document-check receipt could not be read or verified. Inspect the receipt; this does not indicate a failed program test.',
  EVIDENCE_UNVERIFIED:
    'Evidence could not be verified as a regular, unlinked file. Inspect the reference; this does not indicate a failed program test.',
  EVIDENCE_NOT_REQUIRED:
    'Optional or planned evidence is not yet present; it is not a required acceptance criterion. Attach it when available; no passed or failed program test is inferred.',
  CASE_INDEX_INVALID_OR_UNSAFE:
    'Case index is malformed or contains unsafe references. Review its contract and paths; no execution is authorized.',
};
const VALIDATION_MESSAGES = {
  failed:
    'The current document check did not pass. Review that check; this does not indicate a failed program test.',
  unverified:
    'The document-check receipt cannot be compared with the current document. Inspect the document; this does not indicate a failed program test.',
};

function caseWarning(code, reference, severity = 'warning', message = WARNING_MESSAGES[code]) {
  return { code, path: reference, severity, message };
}

function requireShape(value, allowedKeys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !allowedKeys.includes(key))
  )
    throw new Error('Invalid case index shape.');
}

function relativeReference(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 512 ||
    value.trim() !== value ||
    path.isAbsolute(value) ||
    /(?:^[a-z]:)|(?:[\\\u0000-\u001f])/i.test(value) ||
    value.split('/').some(segment => !segment || segment === '.' || segment === '..')
  )
    throw new Error('Invalid case-relative reference.');
  return value;
}

function readBoundedFile(file, budget) {
  const safe = assertUnlinkedPath(file);
  const stat = fs.statSync(safe);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES || stat.size > budget.remaining)
    throw new Error('Case index read budget exceeded.');
  const bytes = fs.readFileSync(safe);
  if (bytes.length > MAX_FILE_BYTES || bytes.length > budget.remaining)
    throw new Error('Case index read budget exceeded.');
  budget.remaining -= bytes.length;
  return bytes;
}

function assertUnlinkedPath(file) {
  const resolved = path.resolve(file);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw error;
      throw new Error('Case reference could not be verified.');
    }
    if (stat.isSymbolicLink()) throw new Error('Case references must not use symbolic links.');
  }
  return resolved;
}

function fingerprint(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function* markdownContentLines(text) {
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const info = marker ? line.slice(marker[0].length) : '';
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !info.trim()
      )
        fence = null;
      continue;
    }
    if (marker && (marker[1][0] === '~' || !info.includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    yield line;
  }
}

function documentCaseIds(bytes) {
  const ids = new Set();
  for (const line of markdownContentLines(bytes.toString('utf8'))) {
    const match = line.match(/^ {0,3}(?:#{1,6}[ \t]+|\|[ \t]*)((?:TC|OPT)-\d{1,6})\b/i);
    if (!match) continue;
    ids.add(match[1].toUpperCase());
    if (ids.size > 512) throw new Error('Case identifier limit exceeded.');
  }
  return [...ids].sort((left, right) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

function validateIndex(index) {
  requireShape(index, [
    'schemaVersion',
    'kind',
    'caseId',
    'primaryDocument',
    'documents',
    'validations',
    'evidence',
  ]);
  if (
    index.schemaVersion !== 1 ||
    index.kind !== 'case-index' ||
    typeof index.caseId !== 'string' ||
    !/^[a-z0-9][a-z0-9_.-]{0,79}$/i.test(index.caseId) ||
    !Array.isArray(index.documents) ||
    !Array.isArray(index.validations) ||
    !Array.isArray(index.evidence) ||
    index.documents.length + index.validations.length + index.evidence.length > MAX_REFERENCES
  )
    throw new Error('Invalid case index contract.');
  relativeReference(index.primaryDocument);
  const references = [];
  for (const document of index.documents) {
    requireShape(document, ['path', 'role', 'status', 'sha256']);
    references.push(relativeReference(document.path));
    if (
      !document.path.endsWith('.md') ||
      !DOCUMENT_ROLES.has(document.role) ||
      !['current', 'historical'].includes(document.status) ||
      (document.status === 'current' && !/^[a-f0-9]{64}$/i.test(document.sha256 || '')) ||
      (document.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(document.sha256))
    )
      throw new Error('Invalid case document.');
  }
  for (const validation of index.validations) references.push(relativeReference(validation));
  for (const evidence of index.evidence) references.push(evidenceReference(evidence));
  if (
    new Set(references).size !== references.length ||
    index.documents.filter(
      document => document.status === 'current' && document.role === 'test-plan'
    ).length > 1 ||
    !index.documents.some(
      document => document.path === index.primaryDocument && document.status === 'current'
    )
  )
    throw new Error('Case index requires one explicit current primary document.');
}

function evidenceReference(evidence) {
  requireShape(evidence, ['path', 'role', 'requirement']);
  if (
    !EVIDENCE_ROLES.has(evidence.role) ||
    (evidence.requirement !== undefined &&
      !['required', 'optional', 'planned'].includes(evidence.requirement))
  )
    throw new Error('Invalid case evidence requirement or role.');
  return relativeReference(evidence.path);
}

function indexExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function inspectDocument(document, root, budget, documentBytes, warn) {
  const entry = { path: document.path, role: document.role, status: document.status };
  try {
    const target = assertUnlinkedPath(safeWorkspacePath(root, document.path));
    if (!fs.statSync(target).isFile()) throw new Error('Not a regular document.');
    if (document.status === 'historical') {
      entry.freshness = 'historical';
      return entry;
    }
    const content = readBoundedFile(target, budget);
    documentBytes.set(document.path, content);
    entry.sha256 = fingerprint(content);
    if (['test-plan', 'overview'].includes(document.role)) entry.caseIds = documentCaseIds(content);
    entry.freshness = entry.sha256 === document.sha256.toLowerCase() ? 'verified' : 'stale';
    if (entry.freshness === 'stale') warn('DOCUMENT_CHANGED', document.path);
  } catch {
    entry.freshness = 'unverified';
    warn('DOCUMENT_UNVERIFIED', document.path);
  }
  return entry;
}

function compareCaseIds(documents, warn) {
  const primary = documents.find(
    document => document.role === 'test-plan' && document.status === 'current'
  );
  if (!primary?.caseIds) return;
  const expected = JSON.stringify(primary.caseIds);
  for (const document of documents) {
    if (
      document.status === 'current' &&
      document.role === 'overview' &&
      document.caseIds &&
      JSON.stringify(document.caseIds) !== expected
    )
      warn('CASE_IDS_DIFFER', document.path);
  }
}

function validationStatus(validation, document, documentBytes) {
  if (document.status === 'historical') return 'historical';
  if (!documentBytes.has(document.path)) return 'unverified';
  if (fingerprint(documentBytes.get(document.path)) !== validation.documentSha256.toLowerCase())
    return 'stale';
  return ['pass', 'passed'].includes(validation.status) ? 'verified' : 'failed';
}

function inspectValidation(reference, index, root, budget, documentBytes, warn) {
  const entry = { path: reference, status: 'unverified' };
  try {
    const content = readBoundedFile(safeWorkspacePath(root, reference), budget);
    entry.sha256 = fingerprint(content);
    const validation = JSON.parse(content.toString('utf8'));
    const document = index.documents.find(item => item.path === validation.document);
    if (!document || !/^[a-f0-9]{64}$/i.test(validation.documentSha256 || ''))
      throw new Error('Unverifiable document validation.');
    entry.document = document.path;
    entry.status = validationStatus(validation, document, documentBytes);
    if (!['verified', 'historical'].includes(entry.status))
      warn(
        'DOCUMENT_VALIDATION_NOT_CURRENT',
        reference,
        'warning',
        VALIDATION_MESSAGES[entry.status]
      );
  } catch {
    warn('DOCUMENT_VALIDATION_UNVERIFIED', reference);
  }
  return entry;
}

function inspectEvidence(evidence, root, warn) {
  const entry = { ...evidence, requirement: evidence.requirement ?? 'required', status: 'present' };
  try {
    const target = assertUnlinkedPath(safeWorkspacePath(root, evidence.path));
    if (!fs.statSync(target).isFile()) throw new Error('Not regular evidence.');
  } catch (error) {
    if (error.code === 'ENOENT' && entry.requirement !== 'required') {
      entry.status = entry.requirement === 'planned' ? 'planned' : 'missing';
      warn('EVIDENCE_NOT_REQUIRED', evidence.path, 'info');
    } else {
      entry.status = 'unverified';
      warn('EVIDENCE_UNVERIFIED', evidence.path);
    }
  }
  return entry;
}

function buildReadPlan(documents, primaryDocument, root, cwd) {
  const current = documents.filter(
    document => document.status === 'current' && document.freshness !== 'unverified'
  );
  current.sort((left, right) => {
    if (left.path === primaryDocument) return -1;
    if (right.path === primaryDocument) return 1;
    return 0;
  });
  return {
    readPlan: current.slice(0, 8).map(document => ({
      path: path.relative(cwd, path.join(root, document.path)).split(path.sep).join('/'),
      role: document.role,
      freshness: document.freshness,
    })),
    readPlanTruncated: current.length > 8,
  };
}

function inspectCaseIndex({ cwd = process.cwd(), out = null } = {}) {
  const result = {
    schemaVersion: 1,
    status: 'absent',
    indexPath: null,
    caseId: null,
    primaryDocument: null,
    documents: [],
    validations: [],
    evidence: [],
    readPlan: [],
    warnings: [],
    readOnly: true,
    executionStarted: false,
    approvalGranted: false,
  };
  const budget = { remaining: MAX_READ_BYTES };
  try {
    const root = safeWorkspacePath(cwd, out);
    if (!root) return result;
    const indexPath = path.join(root, CASE_INDEX_FILE);
    result.indexPath = path.relative(cwd, indexPath).split(path.sep).join('/');
    if (!indexExists(indexPath)) return result;
    const bytes = readBoundedFile(indexPath, budget);
    result.indexSha256 = fingerprint(bytes);
    const index = JSON.parse(bytes.toString('utf8'));
    validateIndex(index);
    result.caseId = index.caseId;
    result.primaryDocument = index.primaryDocument;
    const documentBytes = new Map();
    const warn = (code, reference, severity, message) =>
      result.warnings.push(caseWarning(code, reference, severity, message));
    result.documents = index.documents.map(document =>
      inspectDocument(document, root, budget, documentBytes, warn)
    );
    compareCaseIds(result.documents, warn);
    result.validations = index.validations.map(reference =>
      inspectValidation(reference, index, root, budget, documentBytes, warn)
    );
    result.evidence = index.evidence.map(evidence => inspectEvidence(evidence, root, warn));
    Object.assign(result, buildReadPlan(result.documents, index.primaryDocument, root, cwd));
    result.readBytes = MAX_READ_BYTES - budget.remaining;
    result.status = result.warnings.some(warning => warning.severity === 'warning')
      ? 'needs-attention'
      : 'ready';
    return result;
  } catch {
    result.status = 'invalid';
    result.warnings.push(caseWarning('CASE_INDEX_INVALID_OR_UNSAFE', result.indexPath));
    return result;
  }
}

module.exports = { CASE_INDEX_FILE, inspectCaseIndex };
