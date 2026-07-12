const test = require('node:test');
const assert = require('node:assert/strict');

const { createFinalKnowledgeCatalog } = require('../src/knowledge/final/finalKnowledgeCatalog');
const { evaluateFinalCatalogPrivacy } = require('../src/knowledge/privacy/privacyGate');
const { createRawEvidenceEnvelope } = require('../src/knowledge/raw/rawEvidence');
const {
  createSanitizedCandidateEnvelope,
} = require('../src/knowledge/sanitized/sanitizedCandidate');

function buildGenericCatalog() {
  return createFinalKnowledgeCatalog({
    schemaVersion: '1.0.0',
    generatedAt: '2026-05-24T12:00:00.000Z',
    generatorName: 'zeus-rpg-promptkit',
    generatorVersion: '0.1.0',
    privacyMode: 'strict',
    taxonomyVersion: 'draft-1',
    patterns: [
      {
        id: 'pattern-001',
        kind: 'ui.grid',
        domain: 'ui',
        technology: ['ui-framework'],
        features: ['row-selection', 'action-column'],
        elements: [
          {
            role: 'grid',
            intent: 'list-records',
            layoutHints: ['tabular'],
            behaviorHints: ['supports-selection'],
          },
        ],
        confidence: {
          level: 'high',
          score: 0.91,
        },
        evidenceSummary: {
          category: 'ui-structure',
          signals: ['element-counts', 'interaction-shape'],
        },
        privacyAssessment: {
          status: 'passed',
          notes: ['synthetic fixture'],
        },
        limitations: ['synthetic sample only'],
      },
    ],
  });
}

function hasReasonCode(result, code) {
  return Array.isArray(result.reasons) && result.reasons.some(reason => reason.code === code);
}

test('privacy gate passes a minimal generic final catalog', () => {
  const result = evaluateFinalCatalogPrivacy(buildGenericCatalog());
  assert.equal(result.passed, true);
  assert.deepEqual(result.reasons, []);
});

test('privacy gate rejects all-caps member-like identifier', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].id = 'ORDERPGM';

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'SUSPICIOUS_IDENTIFIER'), true);
});

test('privacy gate rejects file path values', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].features.push('/home/zeus/private/source');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'FILE_PATH'), true);
});

test('privacy gate rejects URL or hostname values', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].limitations.push('https://customer.example.com/internal');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'URL_OR_HOST'), true);
});

test('privacy gate rejects SQL-like object names', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].technology.push('APPDATA.ORDERHDR');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'SQL_OBJECT_NAME'), true);
});

test('privacy gate rejects source-like RPG/DDS/CL syntax', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].limitations.push('**FREE DCL-F ORDERHDR DISK;');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'SOURCE_FRAGMENT'), true);
});

test('privacy gate rejects legacy .zeus knowledge path references', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].limitations.push('.zeus/knowledge/pui-dddl/templates/sample.json');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'LEGACY_KNOWLEDGE_PATH_REFERENCE'), true);
});

test('privacy gate rejects .local MCP audit/session-note path references', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].limitations.push('.local/mcp/audit/mcp-audit.jsonl');
  catalog.patterns[0].limitations.push(
    '.local/session-notes/2026-05-22-pui-pattern-import/docs/runbook.md'
  );

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'LEGACY_KNOWLEDGE_PATH_REFERENCE'), true);
});

test('privacy gate rejects removed unsafe module names', () => {
  const catalog = buildGenericCatalog();
  catalog.patterns[0].features.push('knowledgeBaseService');

  const result = evaluateFinalCatalogPrivacy(catalog);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'LEGACY_MODULE_REFERENCE'), true);
});

test('privacy gate fails closed for malformed catalog payload', () => {
  const result = evaluateFinalCatalogPrivacy({ patterns: 'not-an-array' });
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'MALFORMED_FINAL_CATALOG'), true);
});

test('sanitized candidates are not final-safe automatically', () => {
  const sanitized = createSanitizedCandidateEnvelope({
    candidates: [{ tokenized: true }],
  });

  const result = evaluateFinalCatalogPrivacy(sanitized);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'SANITIZED_NOT_FINAL'), true);
});

test('raw evidence is rejected by the final privacy gate', () => {
  const raw = createRawEvidenceEnvelope({
    evidence: [{ sample: 'sensitive' }],
  });

  const result = evaluateFinalCatalogPrivacy(raw);
  assert.equal(result.passed, false);
  assert.equal(hasReasonCode(result, 'RAW_EVIDENCE_NOT_ALLOWED'), true);
});
