'use strict';

const { verifyOfflineEntitlement } = require('../entitlement/verify');
const { REASON_CODES, NON_CLAIMS, RESULT_CONTRACT_REF } = require('./constants');
const { projectRequest } = require('./project');
const { generateVectorSet } = require('./generator');
const { writeArtifacts } = require('./artifactWriter');
const { prettyCanonical, utf8ByteLength } = require('./util');
const { LIMITS } = require('./constants');
const { exportMarkdown, exportFramework } = require('./exporters');
const { sanitizeRunId } = require('./paths');

function denialResult(reasonCode, message) {
  return {
    ok: false,
    commercial: true,
    advisory: true,
    reasonCode,
    message: String(message || 'Request denied.'),
    result: null,
    artifacts: { written: false, files: [] },
    claims: { ...NON_CLAIMS },
  };
}

function successResult(vectorSet, artifacts) {
  return {
    ok: true,
    commercial: true,
    advisory: true,
    reasonCode: REASON_CODES.OK,
    message: 'Db2 test vectors generated.',
    contractRef: RESULT_CONTRACT_REF,
    result: vectorSet,
    artifacts: artifacts || { written: false, files: [] },
    claims: { ...NON_CLAIMS },
  };
}

/**
 * Run generation after entitlement has already been verified by the caller.
 * Used by the capability execute path once entitlement is confirmed with zero
 * prior input access.
 *
 * @param {object} input projected-ready caller input (still projected here)
 * @param {object} trusted trusted registration closure options
 */
function runGenerateAfterEntitlement(input, trusted = {}) {
  try {
    const projected = projectRequest(input);
    if (!projected.ok) {
      return denialResult(projected.reasonCode, projected.message);
    }

    const generated = generateVectorSet(projected.value);
    if (!generated.ok) {
      return denialResult(generated.reasonCode, generated.message);
    }

    const vectorSet = generated.result;
    const canonicalText = prettyCanonical(vectorSet, 2);
    if (utf8ByteLength(canonicalText) > LIMITS.maxCanonicalJsonBytes) {
      return denialResult(REASON_CODES.BOUNDS_EXCEEDED, 'Canonical result exceeds size bound.');
    }

    // Deterministic in-memory projections (optional frameworks from projected options)
    const projections = {};
    const md = exportMarkdown(vectorSet);
    if (md.ok) projections.markdown = md.text;
    for (const fw of projected.value.options.frameworks) {
      const exp = exportFramework(vectorSet, fw);
      if (exp.ok) projections[fw] = exp.text;
    }

    let artifacts = { written: false, files: [] };
    if (projected.value.options.writeArtifacts === true) {
      if (!trusted.artifactRoot || !trusted.workspaceRoot) {
        return denialResult(
          REASON_CODES.ARTIFACT_PATH_INVALID,
          'Artifact writing requires trusted workspaceRoot and artifactRoot.'
        );
      }
      const runId = projected.value.options.runId || 'run';
      const written = writeArtifacts({
        workspaceRoot: trusted.workspaceRoot,
        artifactRoot: trusted.artifactRoot,
        runId,
        vectorSet,
        frameworks: projected.value.options.frameworks,
      });
      if (!written.written) {
        return {
          ok: false,
          commercial: true,
          advisory: true,
          reasonCode: (written.error && written.error.code) || REASON_CODES.ARTIFACT_WRITE_FAILED,
          message: (written.error && written.error.message) || 'Artifact write failed.',
          result: vectorSet,
          artifacts: { written: false, files: [], error: written.error || null },
          claims: { ...NON_CLAIMS },
          projections,
        };
      }
      artifacts = {
        written: true,
        root: written.root,
        directory: written.directory,
        runId: written.runId,
        files: written.files,
        manifest: written.manifest,
      };
    }

    const result = successResult(vectorSet, artifacts);
    result.projections = projections;
    return result;
  } catch {
    return denialResult(
      REASON_CODES.INTERNAL_FAILURE,
      'Generation failed inside its isolated boundary.'
    );
  }
}

/**
 * Full engine entry used by tests: verify entitlement, then generate.
 * Capability path re-verifies entitlement before any input property access.
 *
 * IMPORTANT: Do not touch `input` before entitlement succeeds.
 */
function runDb2TestIntelligence(input, options = {}) {
  // Entitlement first — zero property access on input before this returns ok.
  const entitlement = verifyOfflineEntitlement(options.licenseDocument, {
    publicKeyPem: options.publicKeyPem,
    now: options.now,
    expectedProductId: options.expectedProductId,
    expectedEdition: options.expectedEdition || 'professional',
    organizationScope: options.organizationScope,
  });

  if (!entitlement.ok) {
    return denialResult(REASON_CODES.ENTITLEMENT_DENIED, 'Entitlement denied.');
  }

  return runGenerateAfterEntitlement(input, {
    workspaceRoot: options.workspaceRoot || null,
    artifactRoot: options.artifactRoot || null,
  });
}

module.exports = {
  runDb2TestIntelligence,
  runGenerateAfterEntitlement,
  denialResult,
  sanitizeRunId,
};
