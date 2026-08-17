'use strict';

const { ALLOWED_OPERATIONS, ALLOWED_TEMPLATES, REASON_CODES } = require('./constants');

function deny(reasonCode, message) {
  return { ok: false, reasonCode, message };
}

function normalizeOperation(operation) {
  return String(operation || '')
    .trim()
    .toLowerCase();
}

function assertOperationAllowed(operation) {
  const normalized = normalizeOperation(operation);
  if (!ALLOWED_OPERATIONS.includes(normalized)) {
    return deny(
      REASON_CODES.OPERATION_DENIED,
      'operation is outside the closed allowlist (no free-form commands).'
    );
  }
  return { ok: true, operation: normalized };
}

function assertTemplateAllowed(templateId, packAllowlist) {
  const normalized = String(templateId || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return deny(REASON_CODES.TEMPLATE_DENIED, 'template id is required.');
  }
  if (!ALLOWED_TEMPLATES.includes(normalized)) {
    return deny(REASON_CODES.TEMPLATE_DENIED, 'template id is unknown.');
  }
  const allow = Array.isArray(packAllowlist) ? packAllowlist : [];
  if (!allow.includes(normalized)) {
    return deny(REASON_CODES.TEMPLATE_DENIED, 'template is not on the owner command allowlist.');
  }
  return { ok: true, templateId: normalized };
}

/**
 * Reject any free-form command text. Only template ids are acceptable.
 */
function assertNoCommandText(commandText) {
  if (commandText == null || commandText === '') {
    return { ok: true };
  }
  if (typeof commandText === 'string' && commandText.trim() === '') {
    return { ok: true };
  }
  return deny(
    REASON_CODES.COMMAND_DENIED,
    'free-form command text is denied; use allowlisted templates only.'
  );
}

module.exports = {
  assertOperationAllowed,
  assertTemplateAllowed,
  assertNoCommandText,
  normalizeOperation,
};
