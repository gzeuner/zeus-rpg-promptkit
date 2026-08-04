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

function resolveFinalCatalogPath({ catalogPath, outputRoot, runId } = {}) {
  if (typeof catalogPath === 'string' && catalogPath.trim()) {
    const resolved = path.resolve(catalogPath.trim());
    if (path.basename(resolved) !== 'project-neutral-knowledge.json') {
      throw new Error('catalogPath must point to project-neutral-knowledge.json');
    }
    return resolved;
  }
  if (typeof outputRoot === 'string' && outputRoot.trim() && runId !== undefined) {
    return path.resolve(finalCatalogPath(outputRoot.trim(), runId));
  }
  return null;
}

function readFinalKnowledgeCatalog(options = {}) {
  const targetPath = resolveFinalCatalogPath(options);
  if (!targetPath) {
    return {
      available: false,
      status: 'disabled',
      reason: 'Knowledge access requires an explicit privacy-gated project-neutral catalog path.',
    };
  }

  if (!fs.existsSync(targetPath)) {
    return {
      available: false,
      status: 'missing',
      path: targetPath,
      reason: 'Final project-neutral knowledge catalog was not found.',
    };
  }

  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return {
      available: false,
      status: 'failed',
      path: targetPath,
      reason: 'Final project-neutral knowledge catalog is not valid JSON.',
    };
  }

  const privacy = evaluateFinalCatalogPrivacy(catalog);
  if (!privacy.passed) {
    return {
      available: false,
      status: 'failed',
      path: targetPath,
      reason: 'Final project-neutral knowledge catalog failed schema or privacy validation.',
      reasons: privacy.reasons.map(reason => reason.code),
    };
  }

  return {
    available: true,
    status: 'ready',
    path: targetPath,
    catalog,
  };
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

module.exports = {
  finalCatalogPath,
  persistFinalKnowledgeCatalog,
  readFinalKnowledgeCatalog,
  resolveFinalCatalogPath,
};
