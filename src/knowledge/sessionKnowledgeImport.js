'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MarkdownIt = require('markdown-it');
const { parse } = require('parse5');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');
const { sanitizeValue } = require('../security/secretMasking');
const { redactAgentText, buildExperienceIntelligence } = require('../agent/agentExperience');

const IMPORT_POLICY_VERSION = '1';
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const PRIVATE_ROOT = '.zeus/session-imports';
const markdown = new MarkdownIt('commonmark', { html: false, linkify: false, maxNesting: 24 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Session knowledge: ${message}`);
}

function safeLocation(cwd, rawPath) {
  const location = validateWorkspacePath(rawPath, { workspaceRoot: cwd, allowAbsolute: false });
  requireCondition(location.ok, 'workspace-relative, non-linked path required');
  requireCondition(
    redactAgentText(location.relativePath) === location.relativePath,
    'credential-like paths are forbidden'
  );
  requireCondition(
    !/(^|\/)\.local(\/|$)|^\.zeus\/knowledge(\/|$)/i.test(location.relativePath),
    'removed private archives cannot be imported'
  );
  let parent = path.resolve(cwd);
  for (const part of location.relativePath.split('/')) {
    parent = path.join(parent, part);
    if (fs.existsSync(parent))
      requireCondition(!fs.lstatSync(parent).isSymbolicLink(), 'linked paths are forbidden');
  }
  return location;
}

function readBounded(cwd, file, maxBytes = MAX_TOTAL_BYTES) {
  const location = safeLocation(cwd, file);
  const stat = fs.lstatSync(location.absolutePath);
  requireCondition(
    stat.isFile() && stat.size <= maxBytes,
    'file must be regular and within the byte limit'
  );
  const bytes = fs.readFileSync(location.absolutePath);
  requireCondition(bytes.length <= maxBytes, 'file exceeds the byte limit');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { ...location, text, bytes, hash: sha256(bytes) };
}

function identifier(value, label) {
  requireCondition(
    typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
      redactAgentText(value) === value,
    `${label} must be a safe identifier`
  );
  return value;
}

function normalizeScope(scope = {}) {
  return Object.fromEntries(
    ['projectId', 'systemAlias', 'toolVersion'].map(field => [
      field,
      identifier(scope[field], field),
    ])
  );
}

function parserVersion(name) {
  let directory = path.dirname(require.resolve(name));
  for (let depth = 0; depth < 5; depth += 1) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (metadata.name === name) return metadata.version;
    }
    directory = path.dirname(directory);
  }
  throw new Error('Document parser version unavailable');
}

function classifySection(heading) {
  const normalized = heading.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  if (/validated solution|validierte losung|bestatigte losung/.test(normalized))
    return 'validated-solution';
  if (/hypoth|vermut/.test(normalized)) return 'hypothesis';
  if (/failure|fehler|fehlversuch/.test(normalized)) return 'failure';
  return 'observation';
}

function extractChunks(text, format, sourceHash) {
  const chunks = [];
  let heading = '';
  function add(raw, startLine, endLine) {
    const original = raw.trim();
    if (!original) return;
    requireCondition(
      original.length <= 1400,
      'paragraph exceeds 1400 characters; split it into explicit sections'
    );
    const content = redactAgentText(original);
    requireCondition(chunks.length < 256, 'document exceeds 256 chunks');
    chunks.push({
      chunkId: sha256(JSON.stringify([sourceHash, startLine, endLine, content])).slice(0, 32),
      heading: redactAgentText(heading),
      classification: classifySection(heading),
      text: content,
      span: { startLine, endLine },
      redacted: content !== original,
    });
  }
  if (format === 'markdown') {
    const tokens = markdown.parse(text, {});
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== 'inline') continue;
      const content = (token.children || [])
        .filter(child => ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(child.type))
        .map(child => (child.type.endsWith('break') ? '\n' : child.content))
        .join('');
      if (tokens[index - 1]?.type === 'heading_open') heading = content;
      else add(content, token.map[0] + 1, token.map[1]);
    }
  } else {
    const excluded = new Set([
      'script',
      'style',
      'iframe',
      'object',
      'template',
      'head',
      'svg',
      'math',
      'noscript',
      'pre',
      'code',
    ]);
    function visible(node, depth = 0) {
      requireCondition(depth <= 64, 'HTML nesting limit exceeded');
      if (excluded.has(node.tagName)) return '';
      if (node.nodeName === '#text') return node.value;
      return (node.childNodes || [])
        .map(child => visible(child, depth + 1))
        .join(node.tagName === 'br' ? '\n' : ' ');
    }
    function visit(node, depth = 0) {
      requireCondition(depth <= 64, 'HTML nesting limit exceeded');
      if (excluded.has(node.tagName)) return;
      if (/^h[1-6]$/.test(node.tagName || '')) heading = visible(node);
      else if (['p', 'li', 'blockquote'].includes(node.tagName)) {
        const location = node.sourceCodeLocation;
        if (location) add(visible(node), location.startLine, location.endLine);
        return;
      }
      for (const child of node.childNodes || []) visit(child, depth + 1);
    }
    visit(parse(text, { sourceCodeLocationInfo: true }));
  }
  return chunks;
}

function previewSessionKnowledge({
  cwd = process.cwd(),
  files,
  sessionId,
  scope,
  now = new Date().toISOString(),
} = {}) {
  requireCondition(
    Array.isArray(files) &&
      files.length > 0 &&
      files.length <= 8 &&
      new Set(files).size === files.length,
    'select 1..8 unique files explicitly'
  );
  const normalizedScope = normalizeScope(scope);
  const sources = [];
  const chunks = [];
  let totalBytes = 0;
  for (const file of files) {
    const input = readBounded(cwd, file, MAX_FILE_BYTES);
    totalBytes += input.bytes.length;
    requireCondition(totalBytes <= MAX_TOTAL_BYTES, 'selected files exceed the total byte limit');
    const extension = path.extname(file).toLowerCase();
    requireCondition(
      ['.md', '.html', '.htm'].includes(extension),
      'only selected Markdown and HTML are supported'
    );
    const format = extension === '.md' ? 'markdown' : 'html';
    const parser = format === 'markdown' ? 'markdown-it' : 'parse5';
    const source = {
      path: input.relativePath,
      sha256: input.hash,
      format,
      parser,
      parserVersion: parserVersion(parser),
    };
    sources.push(source);
    chunks.push(
      ...extractChunks(input.text, format, input.hash).map(chunk => ({
        ...chunk,
        chunkId: sha256(JSON.stringify([input.relativePath, chunk.chunkId])).slice(0, 32),
        sourceHash: input.hash,
        sourcePath: input.relativePath,
      }))
    );
  }
  requireCondition(chunks.length > 0 && chunks.length <= 256, 'select 1..256 textual chunks');
  const identity = {
    sessionId: identifier(sessionId, 'sessionId'),
    scope: normalizedScope,
    sources,
    chunks,
  };
  const candidate = {
    schemaVersion: 1,
    kind: 'session-knowledge-candidate',
    policyVersion: IMPORT_POLICY_VERSION,
    candidateId: `session-${sha256(JSON.stringify(identity)).slice(0, 32)}`,
    createdAt: now,
    status: 'needs-review',
    privacy: 'sensitive-local',
    authority: 'advisory',
    ...identity,
  };
  return { ok: true, operation: 'session-preview', readOnly: true, candidate };
}

function artifactPath(candidateId, suffix) {
  requireCondition(/^session-[a-f0-9]{32}$/.test(candidateId), 'invalid candidate identity');
  return `${PRIVATE_ROOT}/${candidateId}.${suffix}.json`;
}

function writeArtifact(cwd, file, value) {
  const location = safeLocation(cwd, file);
  fs.mkdirSync(path.dirname(location.absolutePath), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  requireCondition(bytes.length <= MAX_TOTAL_BYTES, 'artifact exceeds the byte limit');
  const lock = `${location.absolutePath}.lock`;
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  const temporary = `${location.absolutePath}.${randomUUID()}.tmp`;
  try {
    requireCondition(!fs.existsSync(location.absolutePath), 'immutable artifact already exists');
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, location.absolutePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
  return { path: file, hash: sha256(bytes) };
}

function importSessionKnowledge(options) {
  const preview = previewSessionKnowledge(options);
  const file = artifactPath(preview.candidate.candidateId, 'candidate');
  const location = safeLocation(options.cwd || process.cwd(), file);
  const written = fs.existsSync(location.absolutePath)
    ? readBounded(options.cwd || process.cwd(), file)
    : null;
  if (written)
    return {
      ok: true,
      operation: 'session-import',
      path: file,
      candidateHash: written.hash,
      candidate: readCandidate(
        options.cwd || process.cwd(),
        preview.candidate.candidateId,
        written.hash
      ),
      duplicate: true,
    };
  const result = writeArtifact(options.cwd || process.cwd(), file, preview.candidate);
  return {
    ok: true,
    operation: 'session-import',
    path: result.path,
    candidateHash: result.hash,
    candidate: preview.candidate,
  };
}

function readCandidate(cwd, candidateId, expectedHash) {
  const file = readBounded(cwd, artifactPath(candidateId, 'candidate'));
  requireCondition(file.hash === expectedHash, 'candidate hash changed; review again');
  const candidate = JSON.parse(file.text);
  requireCondition(
    candidate.schemaVersion === 1 &&
      candidate.kind === 'session-knowledge-candidate' &&
      candidate.policyVersion === IMPORT_POLICY_VERSION &&
      candidate.candidateId === candidateId &&
      candidate.status === 'needs-review' &&
      candidate.privacy === 'sensitive-local' &&
      candidate.authority === 'advisory',
    'unsupported candidate contract'
  );
  const current = previewSessionKnowledge({
    cwd,
    files: candidate.sources.map(source => source.path),
    sessionId: candidate.sessionId,
    scope: candidate.scope,
  });
  requireCondition(
    current.candidate.candidateId === candidateId,
    'source content, parser or policy changed; import again'
  );
  requireCondition(
    JSON.stringify(current.candidate.chunks) === JSON.stringify(candidate.chunks),
    'candidate chunks differ from parsed source'
  );
  return candidate;
}

function readRegression(cwd, file, candidateHash, chunkIds) {
  const input = readBounded(cwd, file, 128 * 1024);
  const receipt = JSON.parse(input.text);
  requireCondition(
    receipt.schemaVersion === 1 &&
      receipt.kind === 'session-knowledge-regression' &&
      receipt.status === 'passed' &&
      receipt.candidateHash === candidateHash &&
      Array.isArray(receipt.chunkIds) &&
      JSON.stringify([...receipt.chunkIds].sort((left, right) => left.localeCompare(right))) ===
        JSON.stringify([...chunkIds].sort((left, right) => left.localeCompare(right))) &&
      Array.isArray(receipt.checks) &&
      receipt.checks.length > 0 &&
      receipt.checks.length <= 64 &&
      receipt.checks.every(
        check => check.passed === true && typeof check.name === 'string' && check.name.length > 0
      ),
    'matching passed regression receipt required'
  );
  requireCondition(
    sanitizeValue(input.text) === input.text,
    'regression receipt contains credential-like content'
  );
  return {
    path: input.relativePath,
    sha256: input.hash,
    verification: 'operator-reported; not executed by importer',
  };
}

function reviewSessionKnowledge({
  cwd = process.cwd(),
  candidateId,
  expectedHash,
  reviewer,
  chunkIds,
  regressionFile,
} = {}) {
  const candidate = readCandidate(cwd, candidateId, expectedHash);
  requireCondition(
    Array.isArray(chunkIds) &&
      chunkIds.length > 0 &&
      new Set(chunkIds).size === chunkIds.length &&
      chunkIds.every(id =>
        candidate.chunks.some(
          chunk => chunk.chunkId === id && chunk.classification === 'validated-solution'
        )
      ),
    'explicit validated-solution chunks required'
  );
  const regression = readRegression(cwd, regressionFile, expectedHash, chunkIds);
  const review = {
    schemaVersion: 1,
    kind: 'session-knowledge-review',
    candidateId,
    candidateHash: expectedHash,
    reviewer: identifier(reviewer, 'reviewer'),
    reviewedAt: new Date().toISOString(),
    chunkIds,
    regression,
    decision: 'approved-local-only',
  };
  const written = writeArtifact(cwd, artifactPath(candidateId, 'review'), review);
  return {
    ok: true,
    operation: 'session-review',
    review,
    path: written.path,
    reviewHash: written.hash,
  };
}

function verifyPublication(cwd, publication) {
  requireCondition(
    publication.schemaVersion === 1 && publication.kind === 'session-knowledge-publication',
    'unsupported publication contract'
  );
  const reviewFile = readBounded(cwd, artifactPath(publication.candidateId, 'review'));
  requireCondition(reviewFile.hash === publication.reviewHash, 'review hash changed');
  const review = JSON.parse(reviewFile.text);
  requireCondition(
    review.schemaVersion === 1 &&
      review.kind === 'session-knowledge-review' &&
      review.candidateId === publication.candidateId &&
      review.decision === 'approved-local-only',
    'unsupported review contract'
  );
  const candidate = readCandidate(cwd, publication.candidateId, review.candidateHash);
  requireCondition(
    JSON.stringify(candidate.scope) === JSON.stringify(publication.scope),
    'publication scope changed'
  );
  const regression = readRegression(
    cwd,
    review.regression.path,
    review.candidateHash,
    review.chunkIds
  );
  requireCondition(regression.sha256 === review.regression.sha256, 'regression receipt changed');
  requireCondition(
    review.chunkIds.every(id =>
      candidate.chunks.some(
        chunk => chunk.chunkId === id && chunk.classification === 'validated-solution'
      )
    ),
    'review selection changed'
  );
  return { candidate, review };
}

function publishSessionKnowledge({
  cwd = process.cwd(),
  candidateId,
  expectedReviewHash,
  expiresAt,
  now = new Date().toISOString(),
} = {}) {
  const reviewFile = readBounded(cwd, artifactPath(candidateId, 'review'));
  requireCondition(reviewFile.hash === expectedReviewHash, 'review hash changed');
  const review = JSON.parse(reviewFile.text);
  const candidate = readCandidate(cwd, candidateId, review.candidateHash);
  const ttl = Date.parse(expiresAt) - Date.parse(now);
  requireCondition(
    Number.isFinite(ttl) && ttl > 0 && ttl <= 365 * 86400000,
    'expiry must be within 365 days'
  );
  const publication = {
    schemaVersion: 1,
    kind: 'session-knowledge-publication',
    candidateId,
    reviewHash: expectedReviewHash,
    scope: candidate.scope,
    status: 'active',
    publishedAt: now,
    expiresAt: new Date(expiresAt).toISOString(),
  };
  verifyPublication(cwd, publication);
  const written = writeArtifact(cwd, artifactPath(candidateId, 'published'), publication);
  return {
    ok: true,
    operation: 'session-publish',
    publication,
    path: written.path,
    publicationHash: written.hash,
  };
}

function revokeSessionKnowledge({ cwd = process.cwd(), candidateId, expectedHash, reason } = {}) {
  const file = artifactPath(candidateId, 'published');
  const input = readBounded(cwd, file);
  requireCondition(input.hash === expectedHash, 'publication hash changed');
  const publication = JSON.parse(input.text);
  requireCondition(
    publication.schemaVersion === 1 &&
      publication.kind === 'session-knowledge-publication' &&
      publication.candidateId === candidateId,
    'unsupported publication contract'
  );
  requireCondition(
    typeof reason === 'string' && reason.trim() && reason.length <= 1400,
    'bounded revocation reason required'
  );
  const lock = `${input.absolutePath}.lock`;
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  const temporary = `${input.absolutePath}.${randomUUID()}.tmp`;
  try {
    requireCondition(readBounded(cwd, file).hash === expectedHash, 'publication hash changed');
    fs.writeFileSync(
      temporary,
      `${JSON.stringify({ ...publication, status: 'revoked', reason: redactAgentText(reason) })}\n`,
      { flag: 'wx', mode: 0o600 }
    );
    fs.renameSync(temporary, input.absolutePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
  return { ok: true, operation: 'session-revoke', candidateId };
}

function querySessionKnowledge({
  cwd = process.cwd(),
  goal,
  scope,
  limit = 8,
  now = new Date().toISOString(),
} = {}) {
  const normalizedScope = normalizeScope(scope);
  requireCondition(
    typeof goal === 'string' && goal.trim() && goal.length <= 1400,
    'bounded search goal required'
  );
  const nowTimestamp = Date.parse(now);
  requireCondition(Number.isFinite(nowTimestamp), 'valid lookup timestamp required');
  const location = safeLocation(cwd, PRIVATE_ROOT);
  if (!fs.existsSync(location.absolutePath)) return { ok: true, suggestions: [], excluded: [] };
  const files = fs
    .readdirSync(location.absolutePath)
    .filter(file => file.endsWith('.published.json'))
    .sort((left, right) => left.localeCompare(right));
  requireCondition(
    files.length <= 128,
    'explicitly archive publications before exceeding 128 records'
  );
  const events = [];
  const provenance = new Map();
  const excluded = [];
  let totalBytes = 0;
  for (const file of files) {
    try {
      const input = readBounded(cwd, `${PRIVATE_ROOT}/${file}`);
      totalBytes += input.bytes.length;
      requireCondition(totalBytes <= 16 * 1024 * 1024, 'publication read budget exceeded');
      const publication = JSON.parse(input.text);
      const expiry = Date.parse(publication.expiresAt);
      if (
        publication.status !== 'active' ||
        !Number.isFinite(expiry) ||
        expiry <= nowTimestamp ||
        Object.keys(normalizedScope).some(
          field => publication.scope?.[field] !== normalizedScope[field]
        )
      )
        continue;
      const { candidate, review } = verifyPublication(cwd, publication);
      for (const chunk of candidate.chunks.filter(value =>
        review.chunkIds.includes(value.chunkId)
      )) {
        const eventId = `${candidate.candidateId}:${chunk.chunkId}`;
        const source = candidate.sources.find(value => value.path === chunk.sourcePath);
        provenance.set(eventId, {
          candidateId: candidate.candidateId,
          chunkId: chunk.chunkId,
          sessionId: candidate.sessionId,
          sourcePath: chunk.sourcePath,
          sourceHash: chunk.sourceHash,
          span: chunk.span,
          parser: source.parser,
          parserVersion: source.parserVersion,
          candidateHash: review.candidateHash,
          reviewHash: publication.reviewHash,
          regressionHash: review.regression.sha256,
        });
        events.push({
          eventId,
          recordedAt: publication.publishedAt,
          outcome: 'success',
          failureCode: 'NONE',
          ...candidate.scope,
          lesson: chunk.text,
          goal: chunk.heading,
          tags: ['reviewed-local-lesson'],
          expiresAt: publication.expiresAt,
        });
      }
    } catch {
      excluded.push({ file, reason: 'unverified-or-stale-publication' });
    }
  }
  const intelligence = buildExperienceIntelligence(events, {
    goal,
    ...normalizedScope,
    limit,
    now,
  });
  return {
    ok: true,
    operation: 'session-lessons',
    authority: 'advisory',
    privacy: 'sensitive-local',
    suggestions: intelligence.suggestions.map(item => ({
      ...item,
      provenance: provenance.get(item.eventId),
    })),
    excluded,
  };
}

module.exports = {
  previewSessionKnowledge,
  importSessionKnowledge,
  reviewSessionKnowledge,
  publishSessionKnowledge,
  revokeSessionKnowledge,
  querySessionKnowledge,
};
