/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const crypto = require('node:crypto');
const { validateTechnicalEvidenceContext } = require('../context/technicalEvidenceContext');

const TECHNICAL_EVIDENCE_PROMPT_SCHEMA_VERSION = 1;
const TECHNICAL_EVIDENCE_PROMPT_CONTRACT_ID = 'zeus.technical-evidence-prompt';
const MAX_PROMPT_TOKENS = 100000;
const SAFE_OBJECTIVE_CODES = new Set([
  'architecture',
  'dependency-impact',
  'context-recall',
  'schema-review',
  'unknown',
]);
const SAFE_CLAIMS = new Set([
  'technical-relationships-only',
  'no-source-text',
  'no-private-mapping',
  'no-business-meaning',
]);

class TechnicalEvidencePromptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TechnicalEvidencePromptError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TechnicalEvidencePromptError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeToken(value, maxLength = 96) {
  return (
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && value.length <= maxLength
  );
}

function isOpaqueId(value) {
  return (
    typeof value === 'string' &&
    (/^[a-f0-9]{64}$/i.test(value) || /^opaque-[a-z0-9_-]{8,128}$/i.test(value))
  );
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function assertObject(value, label) {
  if (!isObject(value)) fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', `${label} must be an object`);
}

function assertSafeToken(value, label) {
  if (!isSafeToken(value))
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', `${label} must be a safe token`);
}

function assertOpaqueId(value, label) {
  if (!isOpaqueId(value)) fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', `${label} must be opaque`);
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean')
    fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', `${label} must be boolean`);
}

function assertStringArray(values, label, validator = isSafeToken) {
  if (!Array.isArray(values))
    fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', `${label} must be an array`);
  for (const value of values) {
    if (!validator(value))
      fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', `${label} contains an unsafe value`);
  }
}

function validateNode(node, index) {
  assertObject(node, `evidence.nodes[${index}]`);
  const allowed = new Set(['id', 'kind', 'sourceType', 'family', 'confidence']);
  if (Object.keys(node).some(key => !allowed.has(key)))
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'evidence node contains an unsupported field');
  assertOpaqueId(node.id, 'evidence node id');
  assertSafeToken(node.kind, 'evidence node kind');
  for (const field of ['sourceType', 'family', 'confidence']) {
    if (node[field] !== undefined) assertSafeToken(node[field], `evidence node ${field}`);
  }
}

function validateEdge(edge, index) {
  assertObject(edge, `evidence.edges[${index}]`);
  const allowed = new Set(['id', 'kind', 'from', 'to', 'count', 'confidence']);
  if (Object.keys(edge).some(key => !allowed.has(key)))
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'evidence edge contains an unsupported field');
  for (const field of ['id', 'from', 'to']) assertOpaqueId(edge[field], `evidence edge ${field}`);
  assertSafeToken(edge.kind, 'evidence edge kind');
  if (edge.count !== undefined && (!Number.isSafeInteger(edge.count) || edge.count < 0))
    fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', 'evidence edge count must be bounded');
  if (edge.confidence !== undefined) assertSafeToken(edge.confidence, 'evidence edge confidence');
}

function validatePromptContext(context) {
  const baseErrors = validateTechnicalEvidenceContext(context);
  if (baseErrors.length > 0)
    fail('TECHNICAL_EVIDENCE_PROMPT_INPUT_INVALID', 'technical evidence context is invalid');
  assertObject(context.objective, 'objective');
  if (!SAFE_OBJECTIVE_CODES.has(context.objective.code))
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'objective code is not approved');
  assertObject(context.privacy, 'privacy');
  for (const field of [
    'containsRawSource',
    'containsSourcePaths',
    'containsSourceNames',
    'containsCredentials',
    'containsBusinessTerms',
  ]) {
    if (context.privacy[field] !== false)
      fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'privacy boundary is not closed');
  }
  assertObject(context.input, 'input');
  if (context.input.format !== 'anonymized-technical-evidence-graph')
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'input format is not anonymized');
  assertBoolean(context.input.complete, 'input.complete');
  assertStringArray(context.input.warnings, 'input.warnings');
  assertObject(context.evidence, 'evidence');
  if (!Array.isArray(context.evidence.nodes) || !Array.isArray(context.evidence.edges))
    fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', 'evidence nodes and edges must be arrays');
  context.evidence.nodes.forEach(validateNode);
  context.evidence.edges.forEach(validateEdge);
  const nodeIds = new Set(context.evidence.nodes.map(node => node.id));
  for (const edge of context.evidence.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
      fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', 'evidence edge endpoint is unknown');
  }
  assertObject(context.selection, 'selection');
  assertStringArray(context.selection.omissions, 'selection.omissions');
  if (context.selection.targets !== undefined)
    assertStringArray(context.selection.targets, 'selection.targets', isOpaqueId);
  assertObject(context.uncertainty, 'uncertainty');
  assertBoolean(context.uncertainty.complete, 'uncertainty.complete');
  assertStringArray(context.uncertainty.warningCodes, 'uncertainty.warningCodes');
  assertStringArray(context.uncertainty.claims, 'uncertainty.claims', value =>
    SAFE_CLAIMS.has(value)
  );
  if (!isFingerprint(context.contextFingerprint))
    fail('TECHNICAL_EVIDENCE_PROMPT_UNSAFE', 'context fingerprint is invalid');
}

function normalizeLimit(value) {
  const candidate = value === undefined ? 4000 : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 128 || candidate > MAX_PROMPT_TOKENS)
    fail('TECHNICAL_EVIDENCE_PROMPT_INVALID', 'maxTokens is outside the approved bound');
  return candidate;
}

function nodeLine(node) {
  return `NODE id=${node.id} kind=${node.kind} sourceType=${node.sourceType || '-'} family=${node.family || '-'} confidence=${node.confidence || '-'}`;
}

function edgeLine(edge) {
  return `EDGE id=${edge.id} kind=${edge.kind} from=${edge.from} to=${edge.to} count=${edge.count === undefined ? '-' : edge.count} confidence=${edge.confidence || '-'}`;
}

function buildPromptText(context, maxTokens) {
  const lines = [
    'ZEUS TECHNICAL EVIDENCE REVIEW',
    'Use only the bounded technical relationships below.',
    'Do not infer private mappings, source text, names, paths, credentials, business meaning, or unstated behavior.',
    'Preserve incompleteness, warning codes, and omissions in every response.',
    `OBJECTIVE code=${context.objective.code}`,
    `COMPLETE value=${context.uncertainty.complete ? 'true' : 'false'}`,
    `WARNING_CODES values=${context.uncertainty.warningCodes.join(',') || '-'}`,
    `OMISSIONS values=${context.selection.omissions.join(',') || '-'}`,
    'NODES',
  ];
  const includedNodes = [];
  const includedEdges = [];
  const limit = maxTokens * 4;
  let length = lines.join('\n').length;
  for (const node of context.evidence.nodes) {
    const line = nodeLine(node);
    if (length + line.length + 1 > limit) break;
    lines.push(line);
    includedNodes.push(node);
    length += line.length + 1;
  }
  lines.push('EDGES');
  length += 6;
  const includedNodeIds = new Set(includedNodes.map(node => node.id));
  for (const edge of context.evidence.edges) {
    if (!includedNodeIds.has(edge.from) || !includedNodeIds.has(edge.to)) continue;
    const line = edgeLine(edge);
    if (length + line.length + 1 > limit) break;
    lines.push(line);
    includedEdges.push(edge);
    length += line.length + 1;
  }
  return {
    text: `${lines.join('\n')}\n`,
    includedNodes,
    includedEdges,
    omittedNodes: context.evidence.nodes.length - includedNodes.length,
    omittedEdges: context.evidence.edges.length - includedEdges.length,
  };
}

function buildTechnicalEvidencePrompt({ context, maxTokens } = {}) {
  validatePromptContext(context);
  const normalizedMaxTokens = normalizeLimit(maxTokens);
  const rendered = buildPromptText(context, normalizedMaxTokens);
  const omitted = [...context.selection.omissions];
  if (rendered.omittedNodes > 0) omitted.push('PROMPT_NODE_LIMIT_REACHED');
  if (rendered.omittedEdges > 0) omitted.push('PROMPT_EDGE_LIMIT_REACHED');
  const result = {
    schemaVersion: TECHNICAL_EVIDENCE_PROMPT_SCHEMA_VERSION,
    kind: 'zeus-technical-evidence-prompt',
    contractId: TECHNICAL_EVIDENCE_PROMPT_CONTRACT_ID,
    contractVersion: TECHNICAL_EVIDENCE_PROMPT_SCHEMA_VERSION,
    readOnly: true,
    localOnly: true,
    privacy: {
      containsRawSource: false,
      containsSourcePaths: false,
      containsSourceNames: false,
      containsCredentials: false,
      containsBusinessTerms: false,
      promptBoundary: 'anonymized-technical-evidence-only',
    },
    contextFingerprint: context.contextFingerprint,
    objective: { code: context.objective.code },
    uncertainty: {
      complete: context.uncertainty.complete,
      warningCodes: [...context.uncertainty.warningCodes],
      omissions: [...new Set(omitted)].sort(),
    },
    limits: { maxTokens: normalizedMaxTokens },
    included: {
      nodeCount: rendered.includedNodes.length,
      edgeCount: rendered.includedEdges.length,
    },
    prompt: rendered.text,
  };
  result.promptFingerprint = digest({
    contractId: result.contractId,
    contractVersion: result.contractVersion,
    contextFingerprint: result.contextFingerprint,
    objective: result.objective,
    uncertainty: result.uncertainty,
    limits: result.limits,
    included: result.included,
    prompt: result.prompt,
  });
  return result;
}

function validateTechnicalEvidencePrompt(value) {
  const errors = [];
  if (!isObject(value)) return ['prompt must be an object'];
  if (value.schemaVersion !== TECHNICAL_EVIDENCE_PROMPT_SCHEMA_VERSION)
    errors.push('schemaVersion is unsupported');
  if (value.kind !== 'zeus-technical-evidence-prompt') errors.push('kind is invalid');
  if (value.contractId !== TECHNICAL_EVIDENCE_PROMPT_CONTRACT_ID)
    errors.push('contractId is invalid');
  if (value.readOnly !== true || value.localOnly !== true)
    errors.push('prompt must be local-only and read-only');
  if (!isFingerprint(value.contextFingerprint)) errors.push('contextFingerprint is invalid');
  if (!isFingerprint(value.promptFingerprint)) errors.push('promptFingerprint is invalid');
  if (typeof value.prompt !== 'string' || value.prompt.length === 0)
    errors.push('prompt text is required');
  if (errors.length === 0) {
    const expected = digest({
      contractId: value.contractId,
      contractVersion: value.contractVersion,
      contextFingerprint: value.contextFingerprint,
      objective: value.objective,
      uncertainty: value.uncertainty,
      limits: value.limits,
      included: value.included,
      prompt: value.prompt,
    });
    if (expected !== value.promptFingerprint)
      errors.push('promptFingerprint does not match content');
  }
  return errors;
}

module.exports = {
  MAX_PROMPT_TOKENS,
  TECHNICAL_EVIDENCE_PROMPT_CONTRACT_ID,
  TECHNICAL_EVIDENCE_PROMPT_SCHEMA_VERSION,
  TechnicalEvidencePromptError,
  buildTechnicalEvidencePrompt,
  validateTechnicalEvidencePrompt,
};
