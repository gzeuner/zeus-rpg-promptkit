'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTRACT_IDS = require('../contractIds');
const { PROCESS_STATUSES } = require('../constants');
const { processQueryResultSchema } = require('./contracts');

const STATUS_RANK = Object.freeze({
  [PROCESS_STATUSES.PUBLISHED]: 5,
  [PROCESS_STATUSES.REVIEWED]: 4,
  [PROCESS_STATUSES.CANDIDATE]: 3,
  [PROCESS_STATUSES.STALE]: 2,
  [PROCESS_STATUSES.UNKNOWN]: 1,
});

const CONFIDENCE_RANK = Object.freeze({ high: 4, medium: 3, low: 2, unknown: 1 });

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'einem',
  'einen',
  'für',
  'im',
  'in',
  'interface',
  'ist',
  'macht',
  'mit',
  'of',
  'the',
  'was',
  'wie',
  'wo',
  'zu',
  'über',
  'process',
  'prozess',
  'program',
  'programm',
  'schnittstelle',
]);

function clip(value, max = 1800) {
  const text = String(value == null ? '' : value).trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function uniqueStrings(values) {
  return [
    ...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)),
  ].sort();
}

function uniqueById(values, idSelector) {
  const seen = new Set();
  return (values || []).filter(value => {
    if (!value || typeof value !== 'object') return false;
    const id = String(idSelector(value) || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(token => token && !QUERY_STOP_WORDS.has(token));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function referenceKey(reference) {
  return `${String(reference && reference.id ? reference.id : '')}|${String(
    reference && reference.kind ? reference.kind : ''
  )}`;
}

function uniqueReferences(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    if (!value || typeof value !== 'object' || !String(value.id || '').trim()) continue;
    const reference = {
      id: String(value.id).trim(),
      ...(value.kind ? { kind: String(value.kind).trim() } : {}),
      ...(value.name ? { name: String(value.name).trim() } : {}),
    };
    const key = referenceKey(reference);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(reference);
    }
  }
  return output.sort((a, b) => referenceKey(a).localeCompare(referenceKey(b)));
}

function normalizeFreshness(catalog, options = {}) {
  const supplied = options.freshness || catalog.freshness || catalog.snapshot || {};
  const status = String(
    supplied.status ||
      supplied.state ||
      catalog.snapshotStatus ||
      catalog.freshnessStatus ||
      'unknown'
  )
    .trim()
    .toLowerCase();
  const freshness = {
    status: status || 'unknown',
    snapshotId:
      String(options.snapshotId || catalog.snapshotId || supplied.snapshotId || '').trim() || null,
  };
  for (const field of ['asOf', 'checkedAt', 'sourceHash', 'reason']) {
    if (supplied[field] != null && String(supplied[field]).trim()) {
      freshness[field] = String(supplied[field]).trim();
    }
  }
  if (freshness.status === 'unknown' && !freshness.reason) {
    freshness.reason = 'catalog-freshness-not-supplied';
  }
  return freshness;
}

function assertCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('a process catalog object is required');
  }
  if (catalog.kind && catalog.kind !== 'process-candidate-catalog') {
    throw new Error('process catalog kind must be process-candidate-catalog');
  }
  return catalog;
}

function normalizeCatalog(catalog) {
  assertCatalog(catalog);
  const candidates = Array.isArray(catalog.candidates) ? catalog.candidates : [];
  const processes = uniqueById(
    [
      ...(Array.isArray(catalog.processes) ? catalog.processes : []),
      ...candidates.map(candidate => candidate && candidate.process),
    ],
    value => value.processId
  );
  const versions = uniqueById(
    [
      ...(Array.isArray(catalog.versions) ? catalog.versions : []),
      ...candidates.map(candidate => candidate && candidate.version),
    ],
    value => value.processVersionId
  );
  const steps = uniqueById(
    [
      ...(Array.isArray(catalog.steps) ? catalog.steps : []),
      ...candidates.flatMap(candidate => (candidate && candidate.steps) || []),
    ],
    value => value.stepId
  );
  const claims = uniqueById(
    [
      ...(Array.isArray(catalog.claims) ? catalog.claims : []),
      ...candidates.flatMap(candidate => (candidate && candidate.claims) || []),
    ],
    value => value.claimId
  );
  const relationships = uniqueById(
    [
      ...(Array.isArray(catalog.relationships) ? catalog.relationships : []),
      ...candidates.flatMap(candidate => (candidate && candidate.relationships) || []),
    ],
    value => value.relationshipId
  );
  return { catalog, candidates, processes, versions, steps, claims, relationships };
}

function versionStatus(version, process) {
  return String(
    (version && version.status) || (process && process.status) || PROCESS_STATUSES.UNKNOWN
  )
    .trim()
    .toLowerCase();
}

function versionSort(a, b) {
  const statusDelta = (STATUS_RANK[versionStatus(b)] || 0) - (STATUS_RANK[versionStatus(a)] || 0);
  if (statusDelta !== 0) return statusDelta;
  return String(b.processVersionId || '').localeCompare(String(a.processVersionId || ''));
}

function findRecord(normalized, requestedId) {
  const requested = String(requestedId || '').trim();
  if (!requested) return null;
  const process = normalized.processes.find(value => value.processId === requested);
  const version = normalized.versions.find(value => value.processVersionId === requested);
  const processId = process ? process.processId : version ? version.processId : null;
  if (!processId) return null;
  const processValue =
    process || normalized.processes.find(value => value.processId === processId) || null;
  const matchingVersions = normalized.versions
    .filter(value => value.processId === processId)
    .sort(versionSort);
  const selectedVersion = version || matchingVersions[0] || null;
  const versionId = selectedVersion && selectedVersion.processVersionId;
  const filterByVersion = value =>
    value.processId === processId && (!versionId || value.processVersionId === versionId);
  return {
    process: processValue,
    version: selectedVersion,
    versions: matchingVersions,
    steps: normalized.steps.filter(filterByVersion).sort((a, b) => a.sequence - b.sequence),
    claims: normalized.claims
      .filter(filterByVersion)
      .sort((a, b) => a.claimId.localeCompare(b.claimId)),
    relationships: normalized.relationships
      .filter(filterByVersion)
      .sort((a, b) => a.relationshipId.localeCompare(b.relationshipId)),
  };
}

function recordReferences(record) {
  return uniqueReferences([
    ...(record.process && record.process.evidenceReferences
      ? record.process.evidenceReferences
      : []),
    ...(record.version && record.version.evidenceReferences
      ? record.version.evidenceReferences
      : []),
    ...record.steps.flatMap(step => step.evidenceReferences || []),
    ...record.claims.flatMap(claim => claim.evidenceReferences || []),
    ...record.relationships.flatMap(relationship => relationship.evidenceReferences || []),
  ]);
}

function recordUnknowns(record) {
  return uniqueStrings([
    ...((record.process && record.process.unknowns) || []),
    ...((record.version && record.version.uncertainty) || []),
    ...((record.version && record.version.openQuestions) || []),
  ]);
}

function recordStatus(record) {
  return versionStatus(record.version, record.process);
}

function recordConfidence(record) {
  return String(
    (record.version && record.version.confidence) ||
      (record.process && record.process.confidence) ||
      'unknown'
  ).toLowerCase();
}

function listProcesses(catalog, options = {}) {
  const normalized = normalizeCatalog(catalog);
  const statusFilter = options.status ? String(options.status).trim().toLowerCase() : null;
  const rows = normalized.processes
    .map(process => findRecord(normalized, process.processId))
    .filter(Boolean)
    .filter(record => !statusFilter || recordStatus(record) === statusFilter)
    .map(record => ({
      processId: record.process.processId,
      processVersionId: record.version
        ? record.version.processVersionId
        : record.process.processVersionId,
      name: record.process.name,
      title: record.version ? record.version.title : record.process.name,
      status: recordStatus(record),
      confidence: recordConfidence(record),
      stepCount: record.steps.length,
      evidenceCount: recordReferences(record).length,
      unknownCount: recordUnknowns(record).length,
    }))
    .sort(
      (a, b) =>
        String(a.processId).localeCompare(String(b.processId)) ||
        String(a.processVersionId).localeCompare(String(b.processVersionId))
    );
  return {
    schemaVersion: 1,
    kind: 'process-list-result',
    operation: 'list',
    projectId: String(catalog.projectId || '').trim() || null,
    snapshotId: String(catalog.snapshotId || '').trim() || null,
    freshness: normalizeFreshness(catalog, options),
    total: rows.length,
    processes: rows,
    unknowns: rows.length === 0 ? ['No process projection matched the requested filter.'] : [],
  };
}

function describeProcess(catalog, requestedId, options = {}) {
  const normalized = normalizeCatalog(catalog);
  const record = findRecord(normalized, requestedId);
  if (!record) {
    return {
      ok: false,
      operation: 'describe',
      reasonCode: 'PROCESS_NOT_FOUND',
      message: `No process or process version matched the exact id "${String(requestedId || '').trim()}".`,
      nextSafeStep:
        'Run process list --catalog <relative-path> --json and choose an exact processId or processVersionId.',
    };
  }
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'process-description-result',
    operation: 'describe',
    projectId: String(catalog.projectId || record.process.projectId || '').trim() || null,
    snapshotId: String(catalog.snapshotId || record.process.snapshotId || '').trim() || null,
    freshness: normalizeFreshness(catalog, options),
    status: recordStatus(record),
    confidence: recordConfidence(record),
    process: record.process,
    version: record.version,
    steps: record.steps,
    claims: record.claims,
    relationships: record.relationships,
    evidenceReferences: recordReferences(record),
    unknowns: recordUnknowns(record),
  };
}

function searchableFields(record) {
  const fields = [];
  const add = (field, value, weight, identifier = false) => {
    if (value == null || String(value).trim() === '') return;
    fields.push({ field, value: String(value), weight, identifier });
  };
  const process = record.process || {};
  const version = record.version || {};
  add('processId', process.processId, 1000, true);
  add('processVersionId', process.processVersionId, 950, true);
  add('name', process.name, 520);
  add('title', version.title, 500);
  for (const entry of process.entryPoints || []) {
    add('entryPointId', entry.id, 900, true);
    add('entryPointName', entry.name, 650, true);
  }
  for (const collection of [
    ['interface', version.interfaces, 850],
    ['dataObject', version.dataObjects, 820],
    ['system', version.systems, 700],
    ['actor', version.actors, 650],
    ['decision', version.decisions, 650],
    ['exception', version.exceptions, 650],
  ]) {
    const [field, entries, weight] = collection;
    for (const entry of entries || []) {
      add(`${field}Id`, entry.id, weight, true);
      add(`${field}Name`, entry.name, weight - 80, true);
    }
  }
  for (const step of record.steps) {
    add('stepId', step.stepId, 900, true);
    add('stepTitle', step.title, 720);
    add('stepDescription', step.description, 200);
    for (const ref of step.technicalRefs || []) add('technicalRef', ref, 900, true);
  }
  for (const claim of record.claims) {
    add('claimId', claim.claimId, 900, true);
    add('claimText', claim.text, 260);
    for (const ref of claim.supportingRefs || []) add('supportingRef', ref, 850, true);
  }
  for (const relationship of record.relationships) {
    add('relationshipId', relationship.relationshipId, 700, true);
    add('relationshipFrom', relationship.fromId, 700, true);
    add('relationshipTo', relationship.toId, 700, true);
  }
  return fields;
}

function scoreRecord(record, question) {
  const normalizedQuestion = normalizeText(question);
  const queryTokens = tokenize(question);
  if (!normalizedQuestion || queryTokens.length === 0) return null;
  let score = (STATUS_RANK[recordStatus(record)] || 0) * 100;
  const matchedFields = new Set();
  let exactIdentifier = false;
  for (const field of searchableFields(record)) {
    const normalizedValue = normalizeText(field.value);
    if (!normalizedValue) continue;
    const valueTokens = new Set(tokenize(field.value));
    if (field.identifier && normalizedValue === normalizedQuestion) {
      score += 10000 + field.weight;
      exactIdentifier = true;
      matchedFields.add(field.field);
      continue;
    }
    if (
      field.identifier &&
      normalizedQuestion.includes(normalizedValue) &&
      normalizedValue.length >= 3
    ) {
      score += 3000 + field.weight;
      matchedFields.add(field.field);
    }
    const overlap = queryTokens.filter(token => valueTokens.has(token));
    if (overlap.length > 0) {
      score += overlap.length * field.weight;
      matchedFields.add(field.field);
    } else if (normalizedValue.includes(normalizedQuestion)) {
      score += Math.min(field.weight, 400);
      matchedFields.add(field.field);
    }
  }
  if (matchedFields.size === 0) return null;
  score += Math.min(recordReferences(record).length, 20) * 5;
  score += (CONFIDENCE_RANK[recordConfidence(record)] || 0) * 3;
  return {
    record,
    score,
    exactIdentifier,
    matchedFields: [...matchedFields].sort(),
  };
}

function queryProcesses(catalog, question, options = {}) {
  const normalized = normalizeCatalog(catalog);
  const query = clip(question, 1800);
  const scored = normalized.processes
    .map(process => findRecord(normalized, process.processId))
    .filter(Boolean)
    .map(record => scoreRecord(record, query))
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.record.process.processId).localeCompare(String(b.record.process.processId))
    );
  const limit = Math.max(1, Math.min(20, Number(options.limit || 5)));
  const matches = scored.slice(0, limit);
  const evidenceReferences = uniqueReferences([
    ...matches.flatMap(match => recordReferences(match.record)),
    {
      id: `query:${stableHash(`${catalog.projectId || ''}|${catalog.snapshotId || ''}|${query}`)}`,
      kind: 'derived-reference',
    },
  ]);
  const freshness = normalizeFreshness(catalog, options);
  const unknowns = uniqueStrings(matches.flatMap(match => recordUnknowns(match.record)));
  let answer;
  let status = PROCESS_STATUSES.UNKNOWN;
  let confidence = 'unknown';
  const nextQuestions = [];
  if (matches.length === 0) {
    answer = `No evidence-backed process projection matched "${query}". The catalog does not establish an answer.`;
    unknowns.push(
      'The requested process, interface, or legacy term is not represented in this catalog.'
    );
    nextQuestions.push(
      'Provide an exact processId, processVersionId, interface id, or program identifier.'
    );
  } else {
    const top = matches[0].record;
    status = recordStatus(top);
    confidence = recordConfidence(top);
    const labels = matches.map(
      match => `${match.record.process.name} (${match.record.process.processId})`
    );
    answer = `The strongest evidence-backed process match is ${labels[0]}. ${
      matches.length > 1 ? `Additional matches: ${labels.slice(1).join(', ')}. ` : ''
    }It has ${top.steps.length} documented technical step(s) and ${recordReferences(top).length} evidence reference(s). This is an advisory projection, not source of truth.`;
    if (freshness.status === 'unknown' || freshness.status === 'stale') {
      unknowns.push(
        `Catalog freshness is ${freshness.status}; verify the referenced source snapshot before treating this as current.`
      );
    }
    if (recordStatus(top) === PROCESS_STATUSES.CANDIDATE) {
      unknowns.push(
        'The strongest match is still a candidate and has not received explicit domain review.'
      );
      nextQuestions.push(
        'Review the candidate with a domain owner before publishing business meaning.'
      );
    }
  }
  const result = {
    schemaVersion: 1,
    kind: 'project-knowledge-process-query-result',
    contractId: CONTRACT_IDS.PROCESS_QUERY_RESULT,
    projectId: String(catalog.projectId || '').trim() || 'unknown-project',
    snapshotId: String(catalog.snapshotId || '').trim() || 'unknown-snapshot',
    queryId: `query:${stableHash(`${catalog.projectId || ''}|${catalog.snapshotId || ''}|${query}`).slice(0, 16)}`,
    question: query,
    answer: clip(answer),
    status,
    confidence,
    sourceOfTruth: false,
    advisory: true,
    evidenceReferences,
    matches: matches.map(match => ({
      id: match.record.process.processId,
      kind: 'business-process',
      name: match.record.process.name,
      evidenceReferences: recordReferences(match.record),
      score: match.score,
      exactIdentifier: match.exactIdentifier,
      matchedFields: match.matchedFields,
    })),
    unknowns: uniqueStrings(unknowns),
    nextQuestions: uniqueStrings(nextQuestions),
    freshness,
  };
  const validationErrors = processQueryResultSchema(result);
  if (validationErrors.length > 0) {
    const error = new Error('process query result failed contract validation');
    error.code = 'PROCESS_QUERY_RESULT_INVALID';
    error.validationErrors = validationErrors;
    throw error;
  }
  return result;
}

function impactProcess(catalog, requestedId, options = {}) {
  const normalized = normalizeCatalog(catalog);
  const record = findRecord(normalized, requestedId);
  if (!record) return describeProcess(catalog, requestedId, options);
  const ids = new Set([
    record.process.processId,
    record.process.processVersionId,
    ...(record.version ? [record.version.processVersionId] : []),
    ...record.steps.map(step => step.stepId),
    ...record.claims.map(claim => claim.claimId),
  ]);
  const relationships = normalized.relationships.filter(
    relationship => ids.has(relationship.fromId) || ids.has(relationship.toId)
  );
  const relatedIds = uniqueStrings(
    relationships
      .flatMap(relationship => [relationship.fromId, relationship.toId])
      .filter(id => !ids.has(id))
  );
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'process-impact-result',
    operation: 'impact',
    projectId: String(catalog.projectId || record.process.projectId || '').trim() || null,
    snapshotId: String(catalog.snapshotId || record.process.snapshotId || '').trim() || null,
    freshness: normalizeFreshness(catalog, options),
    processId: record.process.processId,
    processVersionId: record.version && record.version.processVersionId,
    status: recordStatus(record),
    confidence: recordConfidence(record),
    relationships,
    affectedElements: {
      steps: record.steps.map(step => step.stepId),
      claims: record.claims.map(claim => claim.claimId),
      relatedIds,
    },
    evidenceReferences: recordReferences(record),
    unknowns: recordUnknowns(record),
  };
}

function comparable(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      out[key] = comparable(value[key]);
      return out;
    }, {});
}

function diffCollection(current, baseline, idField, fields) {
  const currentById = new Map((current || []).map(value => [value[idField], value]));
  const baselineById = new Map((baseline || []).map(value => [value[idField], value]));
  const added = [...currentById.keys()].filter(id => !baselineById.has(id)).sort();
  const removed = [...baselineById.keys()].filter(id => !currentById.has(id)).sort();
  const changed = [...currentById.keys()]
    .filter(id => baselineById.has(id))
    .filter(id =>
      fields.some(
        field =>
          JSON.stringify(comparable(currentById.get(id)[field])) !==
          JSON.stringify(comparable(baselineById.get(id)[field]))
      )
    )
    .sort();
  return { added, removed, changed };
}

function diffProcess(catalog, requestedId, options = {}) {
  const normalized = normalizeCatalog(catalog);
  const current = findRecord(normalized, requestedId);
  if (!current) return describeProcess(catalog, requestedId, options);
  const baselineVersion = current.versions.find(
    version => version.processVersionId !== (current.version && current.version.processVersionId)
  );
  if (!baselineVersion) {
    return {
      ok: true,
      schemaVersion: 1,
      kind: 'process-diff-result',
      operation: 'diff',
      projectId: String(catalog.projectId || current.process.projectId || '').trim() || null,
      snapshotId: String(catalog.snapshotId || current.process.snapshotId || '').trim() || null,
      freshness: normalizeFreshness(catalog, options),
      processId: current.process.processId,
      currentVersionId: current.version && current.version.processVersionId,
      baselineVersionId: null,
      status: PROCESS_STATUSES.UNKNOWN,
      reason: 'no-baseline-version-in-catalog',
      changes: null,
      unknowns: [
        'A second process version is required before a deterministic diff can be produced.',
      ],
    };
  }
  const baseline = findRecord(normalized, baselineVersion.processVersionId);
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'process-diff-result',
    operation: 'diff',
    projectId: String(catalog.projectId || current.process.projectId || '').trim() || null,
    snapshotId: String(catalog.snapshotId || current.process.snapshotId || '').trim() || null,
    freshness: normalizeFreshness(catalog, options),
    processId: current.process.processId,
    currentVersionId: current.version && current.version.processVersionId,
    baselineVersionId: baseline.version && baseline.version.processVersionId,
    status: current.version && current.version.status,
    changes: {
      process: {
        changed:
          JSON.stringify(comparable(current.process)) !==
          JSON.stringify(comparable(baseline.process)),
      },
      version: {
        changed:
          JSON.stringify(comparable(current.version)) !==
          JSON.stringify(comparable(baseline.version)),
      },
      steps: diffCollection(current.steps, baseline.steps, 'stepId', [
        'sequence',
        'stepKind',
        'title',
        'description',
        'status',
        'confidence',
        'technicalRefs',
      ]),
      claims: diffCollection(current.claims, baseline.claims, 'claimId', [
        'claimType',
        'text',
        'status',
        'confidence',
        'supportingRefs',
      ]),
      relationships: diffCollection(
        current.relationships,
        baseline.relationships,
        'relationshipId',
        ['relationshipType', 'fromId', 'toId', 'status', 'confidence']
      ),
    },
    evidenceReferences: uniqueReferences([
      ...recordReferences(current),
      ...recordReferences(baseline),
    ]),
    unknowns: uniqueStrings([...recordUnknowns(current), ...recordUnknowns(baseline)]),
  };
}

function resolveCatalogPath(filePath, cwd = process.cwd()) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    const error = new Error('--catalog is required');
    error.code = 'PROCESS_CATALOG_REQUIRED';
    throw error;
  }
  if (path.isAbsolute(raw)) {
    const error = new Error('--catalog must be a workspace-relative path');
    error.code = 'PROCESS_CATALOG_PATH_UNSAFE';
    throw error;
  }
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, raw);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('--catalog must stay within the current workspace');
    error.code = 'PROCESS_CATALOG_PATH_UNSAFE';
    throw error;
  }
  return resolved;
}

function readProcessCatalog(filePath, options = {}) {
  const resolved = resolveCatalogPath(filePath, options.cwd || process.cwd());
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    const wrapped = new Error(
      `could not read process catalog: ${error.code === 'ENOENT' ? 'file not found' : 'invalid JSON or unreadable file'}`
    );
    wrapped.code =
      error.code === 'ENOENT' ? 'PROCESS_CATALOG_NOT_FOUND' : 'PROCESS_CATALOG_INVALID';
    throw wrapped;
  }
  try {
    assertCatalog(parsed);
  } catch (error) {
    error.code = 'PROCESS_CATALOG_INVALID';
    throw error;
  }
  return parsed;
}

module.exports = {
  listProcesses,
  describeProcess,
  queryProcesses,
  impactProcess,
  diffProcess,
  readProcessCatalog,
  resolveCatalogPath,
};
