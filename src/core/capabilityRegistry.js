/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

/**
 * Unified Capability Registry (package 05 foundation).
 *
 * A capability is a versioned, self-describing operation with:
 * - identity + aliases
 * - safety classification
 * - input/output contracts (references to schema contracts where possible)
 * - availability matrix
 * - documentation metadata
 * - execute function that receives explicit context
 *
 * This registry lives in core and is the future source of truth.
 * It does not replace existing registries yet (additive).
 */

const { createSchemaRegistry } = require('./contracts');

function validateSafety(safety) {
  if (!safety || typeof safety !== 'object') {
    throw new Error('capability safety metadata is required');
  }
  const level = String(safety.level || '').trim();
  if (!['S0', 'S1', 'S2', 'S3', 'S4'].includes(level)) {
    throw new Error(`invalid safety level: ${level}`);
  }
  if (!Array.isArray(safety.sideEffects)) {
    throw new Error('safety.sideEffects must be an array');
  }
  return {
    level,
    sideEffects: [...safety.sideEffects],
    requiresExplicitApproval: !!safety.requiresExplicitApproval,
  };
}

function validateAvailability(availability) {
  const defaults = { cli: false, mcp: false, api: false, viewer: false, vscode: false };
  if (!availability || typeof availability !== 'object') {
    return { ...defaults };
  }
  return {
    ...defaults,
    cli: !!availability.cli,
    mcp: !!availability.mcp,
    api: !!availability.api,
    viewer: !!availability.viewer,
    vscode: !!availability.vscode,
  };
}

function validateContracts(ref, kind) {
  if (ref === null || ref === undefined) {
    return null; // allowed for legacy/tiny during foundation
  }
  if (typeof ref !== 'object' || !ref.id || typeof ref.version !== 'number') {
    throw new Error(`${kind} must be {id, version} or null`);
  }
  return { id: String(ref.id), version: Number(ref.version) };
}

function normalizeDescriptor(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('capability descriptor must be an object');
  }
  const id = String(raw.id || '').trim();
  if (!id) {
    throw new Error('capability id is required');
  }
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('capability version must be positive integer');
  }

  const aliases = Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map(String))] : [];

  return {
    id,
    version,
    title: raw.title ? String(raw.title) : id,
    description: raw.description ? String(raw.description) : '',
    category: raw.category ? String(raw.category) : 'core',
    safety: validateSafety(raw.safety),
    aliases,
    inputContract: validateContracts(raw.inputContract, 'inputContract'),
    outputContract: validateContracts(raw.outputContract, 'outputContract'),
    availability: validateAvailability(raw.availability),
    docs: raw.docs && typeof raw.docs === 'object' ? { ...raw.docs } : { examples: [], notes: [] },
    execute: typeof raw.execute === 'function' ? raw.execute : null,
    registeredAt: new Date().toISOString(),
  };
}

function createCapabilityRegistry() {
  const byId = new Map();
  const aliasToId = new Map();
  let sealed = false;

  function register(rawDescriptor) {
    if (sealed) {
      throw new Error('capability registry is sealed; registration after seal is not allowed');
    }
    const desc = normalizeDescriptor(rawDescriptor);

    if (byId.has(desc.id)) {
      throw new Error(`duplicate capability id: ${desc.id}`);
    }

    for (const alias of desc.aliases) {
      if (aliasToId.has(alias)) {
        throw new Error(`duplicate alias "${alias}" (already maps to ${aliasToId.get(alias)})`);
      }
    }

    byId.set(desc.id, desc);
    aliasToId.set(desc.id, desc.id);
    for (const alias of desc.aliases) {
      aliasToId.set(alias, desc.id);
    }

    return desc;
  }

  function get(idOrAlias) {
    const id = aliasToId.get(idOrAlias);
    return id ? byId.get(id) || null : null;
  }

  function list(filter = {}) {
    let list = Array.from(byId.values());
    if (filter.category) {
      const cat = String(filter.category);
      list = list.filter(d => d.category === cat);
    }
    if (filter.safetyLevel) {
      const lvl = String(filter.safetyLevel);
      list = list.filter(d => d.safety.level === lvl);
    }
    if (filter.availableIn) {
      const key = String(filter.availableIn);
      list = list.filter(d => d.availability[key]);
    }
    // deterministic order by id
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }

  function resolve(idOrAlias) {
    const id = aliasToId.get(idOrAlias);
    if (!id) return null;
    return byId.get(id) || null;
  }

  async function execute(idOrAlias, context = {}, input = {}) {
    const desc = resolve(idOrAlias);
    if (!desc) {
      const err = new Error(`unknown capability: ${idOrAlias}`);
      err.code = 'UNKNOWN_CAPABILITY';
      throw err;
    }
    if (typeof desc.execute !== 'function') {
      const err = new Error(`capability ${desc.id} has no execute handler`);
      err.code = 'NO_EXECUTE';
      throw err;
    }

    // Provide a safe context envelope
    const execContext = {
      ...context,
      capability: { id: desc.id, version: desc.version },
      safety: { ...desc.safety },
    };

    try {
      const result = await desc.execute(execContext, input);
      return {
        ok: true,
        capability: { id: desc.id, version: desc.version },
        result,
      };
    } catch (e) {
      let safeMessage = e && e.message ? String(e.message) : 'execution failed';
      // Aggressive redaction for secrets/tokens (long alphanum or known secret patterns)
      safeMessage = safeMessage
        .replace(/([A-Za-z0-9+/=]{12,})/g, '[REDACTED]')
        .replace(/\b(secret|token|key|password|credential)\S*/gi, '[REDACTED]');
      return {
        ok: false,
        capability: { id: desc.id, version: desc.version },
        error: {
          code: e.code || 'EXECUTION_ERROR',
          message: safeMessage,
        },
      };
    }
  }

  function seal() {
    sealed = true;
  }

  function isSealed() {
    return sealed;
  }

  return {
    register,
    get,
    list,
    resolve,
    execute,
    seal,
    isSealed,
    // for tests / introspection
    _size: () => byId.size,
  };
}

// Pre-seed a tiny internal capability for foundation testing (non-invasive)
const TINY_VERSION_CAPABILITY = {
  id: 'system.version',
  version: 1,
  title: 'System Version',
  description: 'Returns package version information.',
  category: 'system',
  safety: {
    level: 'S0',
    sideEffects: [],
    requiresExplicitApproval: false,
  },
  aliases: ['version', 'ver'],
  inputContract: null,
  outputContract: { id: 'system.version', version: 1 },
  availability: {
    cli: false, // not wired to CLI yet
    mcp: false,
    api: true,
    viewer: false,
    vscode: false,
  },
  docs: {
    examples: ['registry.execute("system.version")'],
    notes: ['Foundation registration only. Full CLI exposure in later package.'],
  },
  execute: async ctx => {
    const pkg = require('../../package.json');
    return {
      name: pkg.name,
      version: pkg.version,
      engines: pkg.engines || {},
    };
  },
};

module.exports = {
  createCapabilityRegistry,
  TINY_VERSION_CAPABILITY,
};
