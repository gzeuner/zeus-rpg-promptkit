'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONTRACT_IDS } = require('./contracts');
const { STATUS } = require('./constants');
const { validateWorkspacePath } = require('./pathSafety');

function sha256Text(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''), 'utf8')
    .digest('hex');
}

function buildReviewDiff(extractedFiles) {
  const files = (extractedFiles || []).map(file => ({
    path: file.path,
    action: file.action,
    contentSha256: file.content == null ? null : sha256Text(file.content),
    byteLength: file.content == null ? 0 : Buffer.byteLength(file.content, 'utf8'),
  }));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 1,
    kind: 'generation-review-diff',
    files,
  };
}

function buildValidationReport({
  candidate,
  status,
  diagnostics,
  extractedFiles,
  evidenceChecked,
  policy,
}) {
  const reviewReady = status === STATUS.REVIEW_READY;
  const blockingCount = diagnostics.filter(
    d => d.severity === 'blocking' || d.severity === 'error'
  ).length;
  const summary = [
    `status=${status}`,
    `reviewReady=${reviewReady}`,
    `diagnostics=${diagnostics.length}`,
    `blockingOrError=${blockingCount}`,
    `files=${extractedFiles.length}`,
  ].join('; ');

  const report = {
    schemaVersion: 1,
    kind: 'generation-validation-report',
    contractId: CONTRACT_IDS.GENERATION_VALIDATION_REPORT,
    contractVersion: 1,
    candidateId: candidate && candidate.candidateId ? String(candidate.candidateId) : '',
    correlationId: candidate && candidate.correlationId ? String(candidate.correlationId) : null,
    status,
    reviewReady,
    diagnostics: diagnostics.map(d => ({
      id: d.id,
      severity: d.severity,
      validatorId: d.validatorId,
      validatorVersion: d.validatorVersion,
      path: d.path,
      message: redactMessage(d.message),
    })),
    evidenceChecked: Array.isArray(evidenceChecked) ? evidenceChecked : [],
    assumptions: Array.isArray(candidate && candidate.assumptions)
      ? [...candidate.assumptions].map(String)
      : [],
    uncertainties: Array.isArray(candidate && candidate.uncertainties)
      ? [...candidate.uncertainties].map(String)
      : [],
    policy: policy
      ? {
          denied: policy.deny === true,
          reason: policy.deny === true ? redactMessage(policy.reason || 'denied') : null,
        }
      : { denied: false, reason: null },
    providerIdentity:
      candidate && candidate.providerIdentity
        ? {
            providerId: candidate.providerIdentity.providerId || null,
            model: candidate.providerIdentity.model || null,
            advisoryOnly: true,
            sourceOfTruth: false,
          }
        : null,
    summary,
    notes: [
      'review-ready means structural/policy validation passed only.',
      'It does not mean compiled, functionally correct, IBM i tested, approved, or deployable.',
      'Provider/model identity is provenance only and is never treated as evidence.',
    ],
  };

  // Drop nulls for cleaner deterministic JSON
  if (report.correlationId == null) delete report.correlationId;
  if (report.providerIdentity == null) delete report.providerIdentity;
  return report;
}

function redactMessage(message) {
  return String(message || '')
    .replace(/[A-Za-z]:\\[^\s]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home)\/[^\s]+/g, '<redacted-path>')
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=<redacted>');
}

/**
 * Optionally persist review artifacts under an explicit review root.
 * Never writes into the analyzed source workspace.
 */
function writeReviewArtifacts({
  reviewArtifactRoot,
  sourceWorkspaceRoot,
  report,
  reviewDiff,
  candidateId,
}) {
  if (!reviewArtifactRoot) {
    return { written: false, files: [] };
  }
  const absReview = path.resolve(reviewArtifactRoot);
  if (sourceWorkspaceRoot) {
    const absSource = path.resolve(sourceWorkspaceRoot);
    const rel = path.relative(absSource, absReview);
    // Review root must not equal source workspace and must not be inside it.
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error('reviewArtifactRoot must not be inside the source workspace');
    }
  }

  const pathCheck = validateWorkspacePath(`${candidateId || 'candidate'}/validation-report.json`, {
    workspaceRoot: absReview,
    allowedRelativeRoots: ['.'],
  });
  if (!pathCheck.ok) {
    throw new Error(`unsafe review artifact path: ${pathCheck.message}`);
  }

  const dir = path.join(absReview, String(candidateId || 'candidate'));
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, 'validation-report.json');
  const diffPath = path.join(dir, 'review-diff.json');
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  const diffJson = `${JSON.stringify(reviewDiff, null, 2)}\n`;
  fs.writeFileSync(reportPath, reportJson, 'utf8');
  fs.writeFileSync(diffPath, diffJson, 'utf8');
  const manifest = {
    schemaVersion: 1,
    kind: 'generation-validation-manifest',
    candidateId: candidateId || null,
    artifacts: [
      {
        path: path.posix.join(String(candidateId || 'candidate'), 'validation-report.json'),
        sha256: sha256Text(reportJson),
        sizeBytes: Buffer.byteLength(reportJson, 'utf8'),
      },
      {
        path: path.posix.join(String(candidateId || 'candidate'), 'review-diff.json'),
        sha256: sha256Text(diffJson),
        sizeBytes: Buffer.byteLength(diffJson, 'utf8'),
      },
    ],
  };
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    written: true,
    files: [reportPath, diffPath, manifestPath],
    manifest,
  };
}

module.exports = {
  buildReviewDiff,
  buildValidationReport,
  writeReviewArtifacts,
  sha256Text,
  redactMessage,
};
