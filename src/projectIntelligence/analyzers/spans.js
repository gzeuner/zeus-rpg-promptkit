'use strict';

const path = require('path');
const CONTRACT_IDS = require('../contractIds');

/**
 * Convert scanner evidence (may include absolute paths) into ZPI source spans.
 * Paths are never stored as absolute host paths.
 */
function evidenceToSpan({ projectId, snapshotId, sourceUnitId, contentHash, evidence, index = 0 }) {
  if (!evidence || typeof evidence !== 'object') return null;
  const startLine = Number(evidence.line || evidence.startLine || 1);
  const endLine = Number(evidence.endLine || evidence.line || startLine);
  if (!Number.isInteger(startLine) || startLine < 1) return null;
  const spanId = `span:${sourceUnitId}:${startLine}-${endLine}:${index}`;
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-source-span',
    contractId: CONTRACT_IDS.SOURCE_SPAN,
    projectId,
    snapshotId,
    spanId,
    sourceUnitId,
    contentHash,
    start: { line: startLine },
    end: { line: Math.max(startLine, endLine) },
  };
}

function collectSpansFromEvidenceList(ctx, evidenceList) {
  const spans = [];
  const ids = [];
  (evidenceList || []).forEach((ev, i) => {
    const span = evidenceToSpan({ ...ctx, evidence: ev, index: i });
    if (span) {
      spans.push(span);
      ids.push(span.spanId);
    }
  });
  return { spans, ids };
}

/**
 * Safe display path for diagnostics — basename or relative only.
 */
function safePathLabel(filePath, fallbackRelative) {
  if (fallbackRelative) return String(fallbackRelative).replace(/\\/g, '/');
  if (!filePath) return '';
  const s = String(filePath);
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) {
    return path.basename(s);
  }
  return s.replace(/\\/g, '/');
}

module.exports = {
  evidenceToSpan,
  collectSpansFromEvidenceList,
  safePathLabel,
};
