'use strict';

const fs = require('fs');
const path = require('path');

const { evaluateFinalCatalogPrivacy } = require('./privacy/privacyGate');
const { validateFinalKnowledgeCatalog } = require('./final/finalKnowledgeCatalog');

function normalizeRunId(value) {
  const runId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(runId)) {
    throw new Error('runId must contain only letters, numbers, dots, underscores, or hyphens');
  }
  return runId;
}

function finalCatalogPath(outputRoot, runId) {
  return path.join(
    outputRoot,
    'knowledge',
    normalizeRunId(runId),
    'project-neutral-knowledge.json'
  );
}

function writeJsonAtomically(targetPath, value) {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

function persistFinalKnowledgeCatalog({ outputRoot, runId, catalog }) {
  if (!outputRoot || typeof outputRoot !== 'string') throw new Error('outputRoot is required');
  const validation = validateFinalKnowledgeCatalog(catalog);
  const privacy = evaluateFinalCatalogPrivacy(catalog);
  if (!validation.valid || !privacy.passed) {
    const reasons = privacy.reasons.map(reason => `${reason.code}: ${reason.message}`);
    const error = new Error(
      `Final knowledge catalog rejected${reasons.length ? `: ${reasons.join('; ')}` : ''}`
    );
    error.code = 'KNOWLEDGE_PRIVACY_GATE_REJECTED';
    error.reasons = privacy.reasons;
    throw error;
  }
  const targetPath = finalCatalogPath(outputRoot, runId);
  writeJsonAtomically(targetPath, catalog);
  return { path: targetPath, catalog };
}

module.exports = { finalCatalogPath, persistFinalKnowledgeCatalog };
