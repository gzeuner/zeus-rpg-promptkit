'use strict';

const { REASON_CODES } = require('./constants');

/**
 * Deterministic cleanup against a transport that understands delete-object /
 * delete-member. Residuals block approval even when compile diagnostics succeed.
 */
async function runCleanupManifest(pack, transport, createdObjects = []) {
  const residuals = [];
  const completed = [];

  for (const step of pack.cleanupManifest || []) {
    if (step.action === 'report-residual') {
      residuals.push({
        kind: 'reported',
        library: step.library,
        object: step.object,
        member: step.member,
      });
      continue;
    }

    if (
      typeof transport.deleteObject !== 'function' &&
      typeof transport.deleteMember !== 'function'
    ) {
      residuals.push({
        kind: 'transport-missing',
        action: step.action,
        library: step.library,
        object: step.object,
      });
      continue;
    }

    try {
      if (step.action === 'delete-member' && typeof transport.deleteMember === 'function') {
        const result = await transport.deleteMember({
          library: step.library,
          sourceFile: step.sourceFile,
          member: step.member,
        });
        if (!result || result.ok !== true) {
          residuals.push({
            kind: 'delete-failed',
            action: step.action,
            library: step.library,
            member: step.member,
          });
        } else {
          completed.push({ action: step.action, library: step.library, member: step.member });
        }
      } else if (step.action === 'delete-object' && typeof transport.deleteObject === 'function') {
        const result = await transport.deleteObject({
          library: step.library,
          object: step.object,
        });
        if (!result || result.ok !== true) {
          residuals.push({
            kind: 'delete-failed',
            action: step.action,
            library: step.library,
            object: step.object,
          });
        } else {
          completed.push({ action: step.action, library: step.library, object: step.object });
        }
      } else {
        residuals.push({
          kind: 'unsupported-action',
          action: step.action,
        });
      }
    } catch {
      residuals.push({
        kind: 'delete-threw',
        action: step.action,
        library: step.library,
        object: step.object || step.member,
      });
    }
  }

  // Any created object not covered by successful cleanup is residual.
  for (const created of createdObjects) {
    const cleaned = completed.some(
      step =>
        step.library === created.library &&
        (step.object === created.object || step.member === created.object)
    );
    if (!cleaned) {
      residuals.push({
        kind: 'created-not-cleaned',
        library: created.library,
        object: created.object,
      });
    }
  }

  const hasResidual = residuals.length > 0;
  return {
    ok: !hasResidual,
    reasonCode: hasResidual ? REASON_CODES.CLEANUP_RESIDUAL : REASON_CODES.OK,
    cleanup: {
      completed: !hasResidual,
      stepsCompleted: completed,
      residuals,
    },
  };
}

module.exports = {
  runCleanupManifest,
};
