'use strict';

const fs = require('fs');
const path = require('path');

const { GLOSSARY_SCOPE_TYPES, PROCESS_STATUSES } = require('../constants');
const { glossaryEntrySchema } = require('./contracts');

const GLOSSARY_CATALOG_KIND = 'process-glossary-catalog';
const GLOSSARY_CATALOG_SCHEMA_VERSION = 1;

const SCOPE_RANK = Object.freeze({
  global: 1,
  environment: 2,
  organization: 3,
  project: 4,
  task: 5,
});

const STATUS_RANK = Object.freeze({
  [PROCESS_STATUSES.PUBLISHED]: 5,
  [PROCESS_STATUSES.REVIEWED]: 4,
  [PROCESS_STATUSES.CANDIDATE]: 3,
  [PROCESS_STATUSES.STALE]: 2,
  [PROCESS_STATUSES.UNKNOWN]: 1,
});

const CONFIDENCE_RANK = Object.freeze({ high: 4, medium: 3, low: 2, unknown: 1 });

function clip(value, max = 1800) {
  const text = String(value == null ? '' : value).trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeTerm(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function uniqueStrings(values) {
  return [
    ...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)),
  ].sort();
}

function entryScope(entry, catalog, context = {}) {
  const scopeType = String(entry.scopeType || 'project')
    .trim()
    .toLowerCase();
  const defaultProjectId = String(
    context.projectId || catalog.projectId || entry.projectId || ''
  ).trim();
  const scopeId = String(
    entry.scopeId || (scopeType === 'project' ? entry.projectId || defaultProjectId : '')
  ).trim();
  return { scopeType, scopeId: scopeId || null };
}

function contextIds(catalog, context = {}) {
  const supplied = context.scope && typeof context.scope === 'object' ? context.scope : {};
  return {
    globalId: 'global',
    environmentId: String(
      context.environmentId || supplied.environmentId || catalog.environmentId || ''
    ).trim(),
    organizationId: String(
      context.organizationId || supplied.organizationId || catalog.organizationId || ''
    ).trim(),
    projectId: String(context.projectId || supplied.projectId || catalog.projectId || '').trim(),
    taskId: String(context.taskId || supplied.taskId || '').trim(),
  };
}

function scopeApplies(entry, catalog, context = {}) {
  const scope = entryScope(entry, catalog, context);
  if (scope.scopeType === 'global') return true;
  const ids = contextIds(catalog, context);
  const expected = ids[`${scope.scopeType}Id`];
  return Boolean(expected && scope.scopeId && expected === scope.scopeId);
}

function scopeRank(entry, catalog, context = {}) {
  return scopeApplies(entry, catalog, context)
    ? SCOPE_RANK[entryScope(entry, catalog, context).scopeType] || 0
    : 0;
}

function freshness(catalog) {
  const supplied =
    catalog.freshness && typeof catalog.freshness === 'object' ? catalog.freshness : {};
  const status = String(supplied.status || catalog.freshnessStatus || 'unknown')
    .trim()
    .toLowerCase();
  const result = {
    status: status || 'unknown',
    snapshotId: String(catalog.snapshotId || supplied.snapshotId || '').trim() || null,
  };
  for (const field of ['asOf', 'checkedAt', 'sourceHash', 'reason']) {
    if (supplied[field] != null && String(supplied[field]).trim()) {
      result[field] = String(supplied[field]).trim();
    }
  }
  if (result.status === 'unknown' && !result.reason)
    result.reason = 'glossary-freshness-not-supplied';
  return result;
}

function assertCatalogShape(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    const error = new Error('a glossary catalog object is required');
    error.code = 'GLOSSARY_CATALOG_INVALID';
    throw error;
  }
  if (catalog.schemaVersion !== GLOSSARY_CATALOG_SCHEMA_VERSION) {
    const error = new Error('glossary catalog schemaVersion must be 1');
    error.code = 'GLOSSARY_CATALOG_INVALID';
    throw error;
  }
  if (catalog.kind !== GLOSSARY_CATALOG_KIND) {
    const error = new Error(`glossary catalog kind must be ${GLOSSARY_CATALOG_KIND}`);
    error.code = 'GLOSSARY_CATALOG_INVALID';
    throw error;
  }
  return catalog;
}

function validateGlossaryCatalog(catalog) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return { ok: false, errors: [{ path: '', message: 'expected an object' }] };
  }
  if (catalog.schemaVersion !== GLOSSARY_CATALOG_SCHEMA_VERSION) {
    errors.push({ path: '/schemaVersion', message: 'expected schemaVersion 1' });
  }
  if (catalog.kind !== GLOSSARY_CATALOG_KIND) {
    errors.push({ path: '/kind', message: `kind must be "${GLOSSARY_CATALOG_KIND}"` });
  }
  if (typeof catalog.projectId !== 'string' || !catalog.projectId.trim()) {
    errors.push({ path: '/projectId', message: 'non-empty string is required' });
  }
  if (typeof catalog.snapshotId !== 'string' || !catalog.snapshotId.trim()) {
    errors.push({ path: '/snapshotId', message: 'non-empty string is required' });
  }
  if (!Array.isArray(catalog.entries)) {
    errors.push({ path: '/entries', message: 'must be an array' });
  } else {
    const ids = new Set();
    catalog.entries.forEach((entry, index) => {
      const entryErrors = glossaryEntrySchema(entry);
      entryErrors.forEach(error =>
        errors.push({ ...error, path: `/entries/${index}${error.path}` })
      );
      const id = String(entry && entry.entryId ? entry.entryId : '').trim();
      if (id && ids.has(id))
        errors.push({ path: `/entries/${index}/entryId`, message: 'duplicate entryId' });
      if (id) ids.add(id);
      if (entry && entry.scopeType && !GLOSSARY_SCOPE_TYPES.includes(entry.scopeType)) {
        errors.push({ path: `/entries/${index}/scopeType`, message: 'unknown scopeType' });
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

function buildGlossaryCatalog(input, options = {}) {
  const inputObject = Array.isArray(input) ? {} : input || {};
  const entries = Array.isArray(input) ? input : inputObject.entries;
  if (!Array.isArray(entries)) {
    const error = new Error('glossary entries array is required');
    error.code = 'GLOSSARY_ENTRIES_REQUIRED';
    throw error;
  }
  const metadata = Array.isArray(input) ? options : { ...inputObject, ...options };
  const catalog = {
    schemaVersion: GLOSSARY_CATALOG_SCHEMA_VERSION,
    kind: GLOSSARY_CATALOG_KIND,
    projectId: String(metadata.projectId || '').trim(),
    snapshotId: String(metadata.snapshotId || '').trim(),
    ...(metadata.catalogId ? { catalogId: String(metadata.catalogId).trim() } : {}),
    ...(metadata.environmentId ? { environmentId: String(metadata.environmentId).trim() } : {}),
    ...(metadata.organizationId ? { organizationId: String(metadata.organizationId).trim() } : {}),
    ...(metadata.freshness ? { freshness: metadata.freshness } : {}),
    entries: [...entries].sort((a, b) =>
      String(a.entryId || '').localeCompare(String(b.entryId || ''))
    ),
    summary: { entryCount: entries.length },
  };
  const validation = validateGlossaryCatalog(catalog);
  if (!validation.ok) {
    const error = new Error('glossary catalog failed contract validation');
    error.code = 'GLOSSARY_CATALOG_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }
  return catalog;
}

function normalizedVariants(entry) {
  const variants = [
    { value: entry.term, matchType: 'term' },
    ...(entry.aliases || []).map(value => ({ value, matchType: 'alias' })),
    ...(entry.technicalRefs || []).map(value => ({ value, matchType: 'technical-ref' })),
    { value: entry.entryId, matchType: 'entry-id' },
  ];
  return variants
    .map(variant => ({ ...variant, normalized: normalizeTerm(variant.value) }))
    .filter(variant => variant.normalized.length > 0);
}

function scoreVariant(entry, variant, query, catalog, context) {
  const normalizedQuery = normalizeTerm(query);
  const normalizedVariant = variant.normalized;
  if (!normalizedQuery || !normalizedVariant) return null;
  const exact = normalizedQuery === normalizedVariant;
  const embedded =
    !exact && normalizedVariant.length >= 3 && normalizedQuery.includes(normalizedVariant);
  if (!exact && !embedded) return null;
  const base = exact
    ? variant.matchType === 'technical-ref'
      ? 3300
      : variant.matchType === 'term'
        ? 3200
        : variant.matchType === 'entry-id'
          ? 3150
          : 3000
    : variant.matchType === 'term'
      ? 1100
      : variant.matchType === 'alias'
        ? 1050
        : variant.matchType === 'technical-ref'
          ? 1000
          : 950;
  const scope = scopeRank(entry, catalog, context);
  if (!scope) return null;
  const status = STATUS_RANK[String(entry.status || PROCESS_STATUSES.UNKNOWN).toLowerCase()] || 0;
  const confidence = CONFIDENCE_RANK[String(entry.confidence || 'unknown').toLowerCase()] || 0;
  return {
    entry,
    score: base + scope * 100 + status * 20 + confidence * 5,
    matchType: variant.matchType,
    matchedValue: String(variant.value),
    exact,
    scope: entryScope(entry, catalog, context),
  };
}

function matchEntries(catalog, query, context = {}) {
  assertCatalogShape(catalog);
  const matches = [];
  for (const entry of catalog.entries || []) {
    for (const variant of normalizedVariants(entry)) {
      const scored = scoreVariant(entry, variant, query, catalog, context);
      if (scored) matches.push(scored);
    }
  }
  const bestByEntry = new Map();
  for (const match of matches) {
    const current = bestByEntry.get(match.entry.entryId);
    if (!current || match.score > current.score) bestByEntry.set(match.entry.entryId, match);
  }
  return [...bestByEntry.values()].sort(
    (a, b) => b.score - a.score || String(a.entry.entryId).localeCompare(String(b.entry.entryId))
  );
}

function publicMatch(match) {
  return {
    id: match.entry.entryId,
    term: match.entry.term,
    definition: match.entry.definition,
    status: match.entry.status,
    confidence: match.entry.confidence,
    scope: match.scope,
    matchType: match.matchType,
    matchedValue: match.matchedValue,
    exact: match.exact,
    score: match.score,
    aliases: uniqueStrings(match.entry.aliases),
    technicalRefs: uniqueStrings(match.entry.technicalRefs),
    relatedProcessIds: uniqueStrings(match.entry.relatedProcessIds),
    evidenceReferences: match.entry.evidenceReferences || [],
  };
}

function resolveGlossaryTerm(catalog, term, options = {}) {
  assertCatalogShape(catalog);
  const query = clip(term, 512);
  if (!query) {
    const error = new Error('glossary term is required');
    error.code = 'GLOSSARY_TERM_REQUIRED';
    throw error;
  }
  const context = { ...options, projectId: options.projectId || catalog.projectId };
  const matches = matchEntries(catalog, query, context);
  const topScore = matches.length > 0 ? matches[0].score : null;
  const topMatches = topScore == null ? [] : matches.filter(match => match.score === topScore);
  const result = {
    ok: true,
    schemaVersion: 1,
    kind: 'process-glossary-resolution-result',
    operation: 'glossary-resolve',
    projectId: catalog.projectId,
    snapshotId: catalog.snapshotId,
    freshness: freshness(catalog),
    query,
    scope: contextIds(catalog, context),
    status: matches.length === 0 ? 'unknown' : topMatches.length > 1 ? 'ambiguous' : 'resolved',
    matches: matches
      .slice(0, Math.max(1, Math.min(20, Number(options.limit || 10))))
      .map(publicMatch),
    selected: topMatches.length === 1 ? publicMatch(topMatches[0]) : null,
    unknowns: [],
    nextQuestions: [],
    sourceOfTruth: false,
    advisory: true,
  };
  if (result.status === 'unknown') {
    result.unknowns.push(`No glossary entry matched "${query}" in the supplied scope.`);
    result.nextQuestions.push('Provide a project-specific alias or an exact technical identifier.');
  } else if (result.status === 'ambiguous') {
    result.unknowns.push('Multiple glossary entries have the same best scope and match strength.');
    result.nextQuestions.push(
      'Specify the project, organization, environment, task, or exact technical identifier.'
    );
  } else if (result.freshness.status === 'unknown' || result.freshness.status === 'stale') {
    result.unknowns.push(
      `Glossary freshness is ${result.freshness.status}; verify its source snapshot.`
    );
  }
  return result;
}

function resolveGlossaryMentions(catalog, question, options = {}) {
  assertCatalogShape(catalog);
  const normalizedQuestion = normalizeTerm(question);
  if (!normalizedQuestion) return [];
  const candidates = [];
  for (const entry of catalog.entries || []) {
    for (const variant of normalizedVariants(entry)) {
      if (variant.normalized.length < 3 || !normalizedQuestion.includes(variant.normalized))
        continue;
      candidates.push({ phrase: variant.value, normalized: variant.normalized });
    }
  }
  const phrases = [
    ...new Map(candidates.map(candidate => [candidate.normalized, candidate])).values(),
  ].sort(
    (a, b) => b.normalized.length - a.normalized.length || a.normalized.localeCompare(b.normalized)
  );
  return phrases.map(candidate => ({
    phrase: candidate.phrase,
    resolution: resolveGlossaryTerm(catalog, candidate.phrase, options),
  }));
}

function listGlossaryEntries(catalog, options = {}) {
  assertCatalogShape(catalog);
  const context = { ...options, projectId: options.projectId || catalog.projectId };
  const entries = (catalog.entries || [])
    .filter(
      entry =>
        !options.scopeType || entryScope(entry, catalog, context).scopeType === options.scopeType
    )
    .filter(entry => !options.onlyApplicable || scopeApplies(entry, catalog, context))
    .sort((a, b) => String(a.entryId).localeCompare(String(b.entryId)));
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'process-glossary-list-result',
    operation: 'glossary-list',
    projectId: catalog.projectId,
    snapshotId: catalog.snapshotId,
    freshness: freshness(catalog),
    scope: contextIds(catalog, context),
    total: entries.length,
    entries,
    unknowns:
      entries.length === 0 ? ['No glossary entries matched the requested scope/filter.'] : [],
  };
}

function resolveGlossaryCatalogPath(filePath, cwd = process.cwd()) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    const error = new Error('--glossary is required');
    error.code = 'GLOSSARY_CATALOG_REQUIRED';
    throw error;
  }
  if (path.isAbsolute(raw)) {
    const error = new Error('--glossary must be a workspace-relative path');
    error.code = 'GLOSSARY_CATALOG_PATH_UNSAFE';
    throw error;
  }
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, raw);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('--glossary must stay within the current workspace');
    error.code = 'GLOSSARY_CATALOG_PATH_UNSAFE';
    throw error;
  }
  return resolved;
}

function readGlossaryCatalog(filePath, options = {}) {
  const resolved = resolveGlossaryCatalogPath(filePath, options.cwd || process.cwd());
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    const wrapped = new Error(
      `could not read glossary catalog: ${error.code === 'ENOENT' ? 'file not found' : 'invalid JSON or unreadable file'}`
    );
    wrapped.code =
      error.code === 'ENOENT' ? 'GLOSSARY_CATALOG_NOT_FOUND' : 'GLOSSARY_CATALOG_INVALID';
    throw wrapped;
  }
  const validation = validateGlossaryCatalog(parsed);
  if (!validation.ok) {
    const error = new Error('glossary catalog failed contract validation');
    error.code = 'GLOSSARY_CATALOG_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }
  return parsed;
}

module.exports = {
  GLOSSARY_CATALOG_KIND,
  GLOSSARY_CATALOG_SCHEMA_VERSION,
  buildGlossaryCatalog,
  validateGlossaryCatalog,
  listGlossaryEntries,
  resolveGlossaryTerm,
  resolveGlossaryMentions,
  readGlossaryCatalog,
  resolveGlossaryCatalogPath,
  normalizeTerm,
};
