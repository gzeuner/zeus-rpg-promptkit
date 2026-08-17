'use strict';

const { MODES, REASON_CODES } = require('./constants');
const { assertOperationAllowed } = require('./operations');

/**
 * Offline synthetic transport — no network, no IBM i contact.
 * Records created objects in memory for refuse-if-exists and cleanup tests.
 */
function createOfflineTransport(options = {}) {
  const existing = new Set(
    (options.existingObjects || []).map(
      entry => `${String(entry.library).toUpperCase()}/${String(entry.object).toUpperCase()}`
    )
  );
  const members = new Set(
    (options.existingMembers || []).map(
      entry =>
        `${String(entry.library).toUpperCase()}/${String(entry.sourceFile).toUpperCase()}/${String(entry.member).toUpperCase()}`
    )
  );
  const created = [];

  return {
    kind: 'offline-synthetic',
    mode: MODES.OFFLINE,

    async preflight({ target }) {
      const op = assertOperationAllowed('preflight');
      if (!op.ok) return op;
      const key = `${target.library}/${target.object}`;
      if (existing.has(key)) {
        return {
          ok: false,
          reasonCode: REASON_CODES.OBJECT_EXISTS_REFUSED,
          message: 'object already exists; refuse-if-exists.',
        };
      }
      return { ok: true, target, exists: false };
    },

    async stageSource({ target, sources }) {
      const op = assertOperationAllowed('stage-source');
      if (!op.ok) return op;
      for (const source of sources || []) {
        const key = `${target.library}/${target.sourceFile}/${source.member}`;
        members.add(key);
      }
      return { ok: true, staged: (sources || []).length };
    },

    async compile({ target, templateId }) {
      const op = assertOperationAllowed('compile');
      if (!op.ok) return op;
      const key = `${target.library}/${target.object}`;
      if (existing.has(key)) {
        return {
          ok: false,
          reasonCode: REASON_CODES.OBJECT_EXISTS_REFUSED,
          message: 'object already exists; refuse-if-exists.',
          diagnostics: [],
        };
      }
      existing.add(key);
      created.push({ library: target.library, object: target.object, templateId });
      // Synthetic success diagnostics (redacted-safe).
      return {
        ok: true,
        diagnostics: [
          {
            id: 'RNF7031',
            severity: 'info',
            message: 'Synthetic compile completed for offline evidence.',
            source: target.member,
            line: 1,
          },
        ],
        objectCreated: { library: target.library, object: target.object },
      };
    },

    async captureDiagnostics() {
      const op = assertOperationAllowed('capture-diagnostics');
      if (!op.ok) return op;
      return { ok: true, diagnostics: [] };
    },

    async deleteObject({ library, object }) {
      const op = assertOperationAllowed('cleanup');
      if (!op.ok) return op;
      const key = `${String(library).toUpperCase()}/${String(object).toUpperCase()}`;
      existing.delete(key);
      return { ok: true, deleted: key };
    },

    async deleteMember({ library, sourceFile, member }) {
      const op = assertOperationAllowed('cleanup');
      if (!op.ok) return op;
      const key = `${String(library).toUpperCase()}/${String(sourceFile).toUpperCase()}/${String(member).toUpperCase()}`;
      members.delete(key);
      return { ok: true, deleted: key };
    },

    async executeProgram() {
      return {
        ok: false,
        reasonCode: REASON_CODES.OPERATION_DENIED,
        message: 'offline transport denies live program execution; use synthetic diff path.',
      };
    },

    listCreated() {
      return created.slice();
    },
  };
}

/**
 * Live transport factory — always fails closed unless owner unlock supplies a
 * real transport implementation. This module never embeds credentials or opens
 * sockets by itself.
 */
function createLiveTransportDenied(reason = 'live transport is not configured') {
  const deny = async () => ({
    ok: false,
    reasonCode: REASON_CODES.LIVE_DISABLED,
    message: reason,
  });
  return {
    kind: 'live-denied',
    mode: MODES.LIVE,
    preflight: deny,
    stageSource: deny,
    compile: deny,
    captureDiagnostics: deny,
    deleteObject: deny,
    deleteMember: deny,
    executeProgram: deny,
    listCreated: () => [],
  };
}

/**
 * Resolve transport for a requested mode. Live requires pack.liveAccessAuthorized
 * and an injected transport factory — never a default network client.
 */
function resolveTransport({ mode, pack, transport, liveTransportFactory }) {
  if (transport) {
    return { ok: true, transport };
  }
  if (mode === MODES.OFFLINE || mode === MODES.DRY_RUN) {
    return { ok: true, transport: createOfflineTransport() };
  }
  if (mode === MODES.LIVE) {
    if (!pack || pack.liveAccessAuthorized !== true) {
      return {
        ok: false,
        reasonCode: REASON_CODES.LIVE_DISABLED,
        message: 'live access is disabled until owner sets liveAccessAuthorized=true.',
      };
    }
    if (typeof liveTransportFactory !== 'function') {
      return {
        ok: false,
        reasonCode: REASON_CODES.LIVE_DISABLED,
        message: 'live transport factory was not supplied (no default IBM i client).',
      };
    }
    try {
      const live = liveTransportFactory({ pack });
      if (!live || typeof live.compile !== 'function') {
        return {
          ok: false,
          reasonCode: REASON_CODES.TRANSPORT_DENIED,
          message: 'live transport factory returned an invalid transport.',
        };
      }
      return { ok: true, transport: live };
    } catch {
      return {
        ok: false,
        reasonCode: REASON_CODES.TRANSPORT_DENIED,
        message: 'live transport factory failed closed.',
      };
    }
  }
  return {
    ok: false,
    reasonCode: REASON_CODES.INPUT_INVALID,
    message: 'unknown mode.',
  };
}

module.exports = {
  createOfflineTransport,
  createLiveTransportDenied,
  resolveTransport,
};
