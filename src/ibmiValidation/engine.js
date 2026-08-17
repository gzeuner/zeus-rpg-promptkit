'use strict';

const { LIMITS, MODES, PUB400_PROFILE_ID, REASON_CODES, NON_CLAIMS } = require('./constants');
const { validateActivationPack } = require('./ownerGate');
const { buildCompilePlan, validateConfirmationToken, hashCanonical } = require('./plan');
const { redactDiagnostics } = require('./redaction');
const { buildCompileEvidence, buildDiffEvidence } = require('./evidence');
const { runCleanupManifest } = require('./cleanup');
const { resolveTransport, createOfflineTransport } = require('./transport');
const { assertNoCommandText } = require('./operations');

function deny(reasonCode, message, extra = {}) {
  return {
    ok: false,
    reasonCode,
    message,
    claims: { ...NON_CLAIMS },
    ...extra,
  };
}

function resolveMode(rawMode) {
  const mode = String(rawMode || MODES.OFFLINE)
    .trim()
    .toLowerCase();
  if (mode === MODES.OFFLINE || mode === MODES.DRY_RUN || mode === MODES.LIVE) return mode;
  return null;
}

function resolveTimeoutMs(value) {
  if (value == null) return LIMITS.defaultTimeoutMs;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LIMITS.defaultTimeoutMs;
  return Math.min(Math.floor(n), LIMITS.maxTimeoutMs);
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${label} timed out`);
          err.reasonCode = REASON_CODES.TIMEOUT;
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Owner-gated compile validation.
 * Default mode is offline (synthetic). Live is fail-closed without activation.
 */
async function runCompileValidation(input = {}) {
  const mode = resolveMode(input.mode);
  if (!mode) {
    return deny(REASON_CODES.INPUT_INVALID, 'mode must be offline, dry-run, or live.');
  }

  const noCmd = assertNoCommandText(input.commandText);
  if (!noCmd.ok) return deny(noCmd.reasonCode, noCmd.message);

  const gate = validateActivationPack(input.activationPack);
  if (!gate.ok) {
    return deny(gate.reasonCode, gate.message, { missing: gate.missing });
  }
  const pack = gate.pack;

  // pub-400 profile binding when provided on the request
  if (input.profileId != null && String(input.profileId).trim() !== '') {
    if (String(input.profileId).trim() !== PUB400_PROFILE_ID) {
      return deny(REASON_CODES.PROFILE_DENIED, 'profileId is not authorized.');
    }
    if (pack.profileId !== PUB400_PROFILE_ID) {
      return deny(
        REASON_CODES.PROFILE_DENIED,
        'activation pack does not authorize profile pub-400.'
      );
    }
  }

  if (mode === MODES.LIVE && pack.liveAccessAuthorized !== true) {
    return deny(
      REASON_CODES.LIVE_DISABLED,
      'live mode denied: liveAccessAuthorized is not true on the activation pack.'
    );
  }

  const planResult = buildCompilePlan(input.request || {}, pack, mode);
  if (!planResult.ok) {
    return deny(planResult.reasonCode, planResult.message);
  }
  const { plan, planHash } = planResult;

  const confirm = validateConfirmationToken(input.confirmationToken, planHash);
  if (!confirm.ok) {
    return deny(confirm.reasonCode, confirm.message, { planHash });
  }

  const transportResult = resolveTransport({
    mode,
    pack,
    transport: input.transport,
    liveTransportFactory: input.liveTransportFactory,
  });
  if (!transportResult.ok) {
    return deny(transportResult.reasonCode, transportResult.message, { planHash });
  }
  const transport = transportResult.transport;
  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  // Dry-run: plan + preflight only (no compile, no mutate).
  if (mode === MODES.DRY_RUN) {
    try {
      const preflight = await withTimeout(
        transport.preflight({ target: plan.target, plan }),
        timeoutMs,
        'preflight'
      );
      if (!preflight || preflight.ok !== true) {
        return deny(
          (preflight && preflight.reasonCode) || REASON_CODES.TARGET_DENIED,
          (preflight && preflight.message) || 'preflight failed.',
          { planHash, plan }
        );
      }
      const evidence = buildCompileEvidence({
        plan,
        confirmationTokenFingerprint: confirm.confirmationTokenFingerprint,
        diagnostics: [],
        objectOutcomes: [{ object: plan.target.object, status: 'preflight-only' }],
        cleanup: { completed: true, residuals: [], stepsCompleted: [] },
        mode,
      });
      return {
        ok: true,
        reasonCode: REASON_CODES.OK,
        mode,
        planHash,
        plan,
        preflightOnly: true,
        evidence: evidence.ok ? evidence.evidence : null,
        claims: { ...NON_CLAIMS },
      };
    } catch (error) {
      return deny(
        error && error.reasonCode === REASON_CODES.TIMEOUT
          ? REASON_CODES.TIMEOUT
          : REASON_CODES.TRANSPORT_DENIED,
        'dry-run preflight failed closed.',
        { planHash }
      );
    }
  }

  const objectOutcomes = [];
  let rawDiagnostics = [];
  let createdObjects = [];

  try {
    const preflight = await withTimeout(
      transport.preflight({ target: plan.target, plan }),
      timeoutMs,
      'preflight'
    );
    if (!preflight || preflight.ok !== true) {
      return deny(
        (preflight && preflight.reasonCode) || REASON_CODES.OBJECT_EXISTS_REFUSED,
        (preflight && preflight.message) || 'preflight refused.',
        { planHash, plan }
      );
    }

    const staged = await withTimeout(
      transport.stageSource({ target: plan.target, sources: plan.sources, plan }),
      timeoutMs,
      'stage'
    );
    if (!staged || staged.ok !== true) {
      return deny(
        (staged && staged.reasonCode) || REASON_CODES.TRANSPORT_DENIED,
        (staged && staged.message) || 'stage failed.',
        { planHash }
      );
    }

    const compiled = await withTimeout(
      transport.compile({
        target: plan.target,
        templateId: plan.templateId,
        plan,
      }),
      timeoutMs,
      'compile'
    );
    if (!compiled || compiled.ok !== true) {
      return deny(
        (compiled && compiled.reasonCode) || REASON_CODES.TRANSPORT_DENIED,
        (compiled && compiled.message) || 'compile failed.',
        {
          planHash,
          diagnostics: [],
        }
      );
    }

    rawDiagnostics = Array.isArray(compiled.diagnostics) ? compiled.diagnostics : [];
    if (compiled.objectCreated) {
      createdObjects.push(compiled.objectCreated);
      objectOutcomes.push({
        library: compiled.objectCreated.library,
        object: compiled.objectCreated.object,
        status: 'created',
      });
    } else {
      objectOutcomes.push({
        library: plan.target.library,
        object: plan.target.object,
        status: 'compiled',
      });
    }
  } catch (error) {
    return deny(
      error && error.reasonCode === REASON_CODES.TIMEOUT
        ? REASON_CODES.TIMEOUT
        : REASON_CODES.TRANSPORT_DENIED,
      'compile path failed closed.',
      { planHash }
    );
  }

  const redacted = redactDiagnostics(rawDiagnostics);
  if (!redacted.ok) {
    return deny(redacted.reasonCode, redacted.message, { planHash });
  }

  let cleanupResult;
  try {
    cleanupResult = await withTimeout(
      runCleanupManifest(pack, transport, createdObjects),
      timeoutMs,
      'cleanup'
    );
  } catch {
    cleanupResult = {
      ok: false,
      reasonCode: REASON_CODES.CLEANUP_RESIDUAL,
      cleanup: { completed: false, residuals: [{ kind: 'cleanup-timeout' }], stepsCompleted: [] },
    };
  }

  const evidence = buildCompileEvidence({
    plan,
    confirmationTokenFingerprint: confirm.confirmationTokenFingerprint,
    diagnostics: redacted.diagnostics,
    objectOutcomes,
    cleanup: cleanupResult.cleanup,
    mode,
  });

  if (!cleanupResult.ok) {
    return {
      ok: false,
      reasonCode: REASON_CODES.CLEANUP_RESIDUAL,
      message: 'cleanup reported residuals; approval blocked.',
      planHash,
      plan,
      diagnostics: redacted.diagnostics,
      evidence: evidence.ok ? evidence.evidence : null,
      cleanup: cleanupResult.cleanup,
      claims: { ...NON_CLAIMS },
    };
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    mode,
    planHash,
    plan,
    diagnostics: redacted.diagnostics,
    objectOutcomes,
    evidence: evidence.ok ? evidence.evidence : null,
    cleanup: cleanupResult.cleanup,
    claims: { ...NON_CLAIMS },
  };
}

/**
 * Optional differential execution with synthetic inputs only.
 * Requires differential gates on the activation pack.
 */
async function runDifferentialExecution(input = {}) {
  const mode = resolveMode(input.mode) || MODES.OFFLINE;
  if (mode === MODES.LIVE) {
    return deny(
      REASON_CODES.LIVE_DISABLED,
      'differential live execution is not enabled in this package phase.'
    );
  }

  const gate = validateActivationPack(input.activationPack);
  if (!gate.ok) {
    return deny(gate.reasonCode, gate.message, { missing: gate.missing });
  }
  const pack = gate.pack;
  if (!pack.differential || pack.differential.enabled !== true) {
    return deny(
      REASON_CODES.OWNER_GATE_INCOMPLETE,
      'differential gates are not enabled on the activation pack.'
    );
  }

  const baseline = input.baselineOutputs;
  const candidate = input.candidateOutputs;
  if (!baseline || !candidate || typeof baseline !== 'object' || typeof candidate !== 'object') {
    return deny(
      REASON_CODES.INPUT_INVALID,
      'baselineOutputs and candidateOutputs objects are required (synthetic only).'
    );
  }
  if (baseline.synthetic !== true || candidate.synthetic !== true) {
    return deny(REASON_CODES.INPUT_INVALID, 'differential outputs must be marked synthetic:true.');
  }

  const inventoryHash = hashCanonical(pack.differential.sideEffectInventory);
  const differences = [];

  const baseReturn = baseline.returnCode;
  const candReturn = candidate.returnCode;
  if (baseReturn !== candReturn) {
    differences.push({
      category: REASON_CODES.OUTPUT_MISMATCH,
      field: 'returnCode',
      baseline: baseReturn,
      candidate: candReturn,
    });
  }

  const baseOut = Array.isArray(baseline.outputs) ? baseline.outputs : [];
  const candOut = Array.isArray(candidate.outputs) ? candidate.outputs : [];
  if (JSON.stringify(baseOut) !== JSON.stringify(candOut)) {
    differences.push({
      category: REASON_CODES.OUTPUT_MISMATCH,
      field: 'outputs',
    });
  }

  const baseFx = Array.isArray(baseline.sideEffects) ? baseline.sideEffects : [];
  const candFx = Array.isArray(candidate.sideEffects) ? candidate.sideEffects : [];
  const inventory = new Set(pack.differential.sideEffectInventory);
  for (const fx of [...baseFx, ...candFx]) {
    const cls = String(fx && fx.class ? fx.class : '').toLowerCase();
    if (cls && !inventory.has(cls)) {
      differences.push({
        category: REASON_CODES.INVENTORY_VIOLATION,
        field: cls,
      });
    }
  }
  for (const fx of candFx) {
    const match = baseFx.find(
      entry => entry && fx && entry.class === fx.class && entry.fingerprint === fx.fingerprint
    );
    if (!match) {
      differences.push({
        category: REASON_CODES.SIDE_EFFECT_EXTRA,
        field: fx && fx.class,
      });
    }
  }
  for (const fx of baseFx) {
    const match = candFx.find(
      entry => entry && fx && entry.class === fx.class && entry.fingerprint === fx.fingerprint
    );
    if (!match) {
      differences.push({
        category: REASON_CODES.SIDE_EFFECT_MISSING,
        field: fx && fx.class,
      });
    }
  }

  const evidence = buildDiffEvidence({
    planHash: input.planHash || null,
    confirmationTokenFingerprint: input.confirmationToken
      ? require('./plan').fingerprintToken(input.confirmationToken)
      : null,
    baseline: { returnCode: baseReturn, outputCount: baseOut.length },
    candidate: { returnCode: candReturn, outputCount: candOut.length },
    differences,
    inventoryHash,
    mode,
  });

  if (differences.length > 0) {
    return {
      ok: false,
      reasonCode: REASON_CODES.APPROVAL_BLOCKED,
      message: 'unexplained differences block approval.',
      differences,
      evidence: evidence.evidence,
      claims: { ...NON_CLAIMS },
    };
  }

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    differences: [],
    evidence: evidence.evidence,
    claims: { ...NON_CLAIMS },
  };
}

module.exports = {
  runCompileValidation,
  runDifferentialExecution,
  createOfflineTransport,
};
