'use strict';

/**
 * Advanced commercial validator packs.
 * Deterministic offline checks only. They NEVER remove or weaken public required validators.
 */

const ADVANCED_PACK_ID = 'zeus-pro.advanced-pack.basic';
const ADVANCED_PACK_ALIAS_BASIC = 'basic';

/** Known advanced pack identifiers. Unknown ids fail closed. */
const KNOWN_ADVANCED_PACK_IDS = Object.freeze([ADVANCED_PACK_ID, ADVANCED_PACK_ALIAS_BASIC]);

const KNOWN_ADVANCED_PACK_SET = new Set(KNOWN_ADVANCED_PACK_IDS);

function isKnownAdvancedPackId(id) {
  return KNOWN_ADVANCED_PACK_SET.has(String(id || ''));
}

/**
 * Resolve requested advanced pack ids.
 * Absent/undefined => default basic pack (deterministic).
 * Explicit empty array => no advanced packs.
 * Unknown ids => fail closed.
 */
function resolveAdvancedValidatorIds(requested) {
  if (requested == null) {
    return { ok: true, ids: [ADVANCED_PACK_ID], defaulted: true };
  }
  if (!Array.isArray(requested)) {
    return {
      ok: false,
      code: 'ADVANCED_VALIDATORS_INVALID',
      message: 'advancedValidatorIds must be an array when provided',
    };
  }
  if (requested.length > 32) {
    return {
      ok: false,
      code: 'ADVANCED_VALIDATORS_INVALID',
      message: 'advancedValidatorIds exceeds bound',
    };
  }
  const ids = [];
  const seen = new Set();
  for (const raw of requested) {
    const id = String(raw || '');
    if (!isKnownAdvancedPackId(id)) {
      return {
        ok: false,
        code: 'ADVANCED_VALIDATORS_INVALID',
        message: `unknown advancedValidatorId: ${id || '<empty>'}`,
      };
    }
    // Normalize alias to canonical pack id for enablement
    const canonical = id === ADVANCED_PACK_ALIAS_BASIC ? ADVANCED_PACK_ID : id;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      ids.push(canonical);
    }
  }
  return { ok: true, ids, defaulted: false };
}

function createAdvancedValidators(options = {}) {
  const resolved = resolveAdvancedValidatorIds(
    options.enabledIds === undefined ? null : options.enabledIds
  );
  if (!resolved.ok) {
    const error = new Error(resolved.message);
    error.code = resolved.code;
    throw error;
  }
  const enabled = new Set(resolved.ids);
  const validators = [];

  if (enabled.has(ADVANCED_PACK_ID)) {
    validators.push({
      id: 'pro-free-form-style',
      version: 1,
      order: 900,
      title: 'Commercial free-form style pack (additive)',
      description:
        'Adds deterministic free-form RPG style hints. Does not replace public validators.',
      blocking: false,
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          const content = file && typeof file.content === 'string' ? file.content : '';
          const language = String((file && file.language) || '').toLowerCase();
          const path = file && file.path ? String(file.path) : null;
          if (
            (language === 'rpgle' || language === 'sqlrpgle' || /\.rpgle$/i.test(String(path))) &&
            content.includes('\t')
          ) {
            out.push({
              id: 'PRO.STYLE_TAB_CHAR',
              severity: 'warning',
              path,
              message: 'Tab characters in free-form RPG are discouraged (commercial style pack).',
            });
          }
          if (content.length > 0 && !content.endsWith('\n')) {
            out.push({
              id: 'PRO.STYLE_MISSING_FINAL_NEWLINE',
              severity: 'info',
              path,
              message: 'Proposed file content should end with a newline (commercial style pack).',
            });
          }
        }
        return out;
      },
    });

    validators.push({
      id: 'pro-rationale-presence',
      version: 1,
      order: 910,
      title: 'Commercial rationale presence pack (additive)',
      description: 'Warns when modify/create entries omit rationale. Additive only.',
      blocking: false,
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          const action = String((file && file.action) || 'modify');
          if (action === 'delete') continue;
          if (!file || typeof file.rationale !== 'string' || !file.rationale.trim()) {
            out.push({
              id: 'PRO.RATIONALE_MISSING',
              severity: 'warning',
              path: file && file.path ? String(file.path) : null,
              message: 'Proposed change is missing a human rationale (commercial pack).',
            });
          }
        }
        return out;
      },
    });
  }

  // Requested packs are required — if a known pack id was requested but produced no validators, fail.
  if (resolved.ids.length > 0 && validators.length === 0) {
    const error = new Error('requested advanced validators produced no registrations');
    error.code = 'ADVANCED_VALIDATORS_INVALID';
    throw error;
  }

  return validators;
}

/**
 * Create a validator registry that includes all public required validators plus advanced packs.
 * Advanced packs only add; required public ids remain mandatory.
 * Requested advanced packs are required (never silently ignored).
 */
function createAssuranceValidatorRegistry(generationValidation, options = {}) {
  const { createDefaultValidatorRegistry, createValidatorRegistry, createBuiltInValidators } =
    generationValidation;

  const resolved = resolveAdvancedValidatorIds(options.advancedValidatorIds);
  if (!resolved.ok) {
    const error = new Error(resolved.message);
    error.code = resolved.code;
    throw error;
  }

  let registry;
  if (typeof createDefaultValidatorRegistry === 'function') {
    registry = createDefaultValidatorRegistry(options.validatorOptions || {});
  } else {
    registry = createValidatorRegistry({
      requiredIds: [
        'schema',
        'contract-version',
        'workspace-path',
        'file-type',
        'size-limits',
        'duplicate-target',
        'scope',
        'evidence-reference',
        'policy',
      ],
    });
    for (const validator of createBuiltInValidators(options.validatorOptions || {})) {
      registry.register(validator);
    }
  }

  const advanced = createAdvancedValidators({
    enabledIds: resolved.ids,
  });
  for (const validator of advanced) {
    if (!registry.has(validator.id)) {
      registry.register(validator);
    }
  }

  // Ensure every requested pack actually contributed validators when non-empty.
  if (resolved.ids.length > 0 && advanced.length === 0) {
    const error = new Error('requested advanced validators were not registered');
    error.code = 'ADVANCED_VALIDATORS_INVALID';
    throw error;
  }

  return registry;
}

module.exports = {
  ADVANCED_PACK_ID,
  ADVANCED_PACK_ALIAS_BASIC,
  KNOWN_ADVANCED_PACK_IDS,
  isKnownAdvancedPackId,
  resolveAdvancedValidatorIds,
  createAdvancedValidators,
  createAssuranceValidatorRegistry,
};
