'use strict';

const { OBJECT_NAME_PATTERN, REASON_CODES } = require('./constants');

function fail(reasonCode, message) {
  return { ok: false, reasonCode, message };
}

function normalizeObjectName(value, label) {
  if (value == null || typeof value !== 'string') {
    return fail(REASON_CODES.NAME_INVALID, `${label} must be a string.`);
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return fail(REASON_CODES.NAME_INVALID, `${label} is required.`);
  }
  if (!OBJECT_NAME_PATTERN.test(normalized)) {
    return fail(
      REASON_CODES.NAME_INVALID,
      `${label} must match IBM i object name rules (1-10 chars, A-Z start).`
    );
  }
  return { ok: true, value: normalized };
}

function assertOwnedLibrary(library, ownedLibraries) {
  const name = normalizeObjectName(library, 'library');
  if (!name.ok) return name;
  const owned = Array.isArray(ownedLibraries)
    ? ownedLibraries.map(entry =>
        String(entry || '')
          .trim()
          .toUpperCase()
      )
    : [];
  if (!owned.includes(name.value)) {
    return fail(
      REASON_CODES.TARGET_DENIED,
      'library is outside the owner-approved owned library set.'
    );
  }
  return name;
}

function normalizeMemberRef(input, ownedLibraries) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail(REASON_CODES.INPUT_INVALID, 'member reference must be an object.');
  }
  const library = assertOwnedLibrary(input.library, ownedLibraries);
  if (!library.ok) return library;
  const sourceFile = normalizeObjectName(input.sourceFile, 'sourceFile');
  if (!sourceFile.ok) return sourceFile;
  const member = normalizeObjectName(input.member, 'member');
  if (!member.ok) return member;
  const object = normalizeObjectName(input.object || input.member, 'object');
  if (!object.ok) return object;
  let memberType = '';
  if (input.memberType != null && input.memberType !== '') {
    const typed = normalizeObjectName(input.memberType, 'memberType');
    if (!typed.ok) return typed;
    memberType = typed.value;
  }
  return {
    ok: true,
    value: {
      library: library.value,
      sourceFile: sourceFile.value,
      member: member.value,
      object: object.value,
      memberType,
    },
  };
}

module.exports = {
  normalizeObjectName,
  assertOwnedLibrary,
  normalizeMemberRef,
};
