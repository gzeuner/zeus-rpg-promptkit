'use strict';

const {
  MODULE_API_VERSION,
  AVAILABILITY,
  REASON_CODES,
  LIFECYCLE,
  RUNTIME_FEATURE_ALLOWLIST,
  MODULE_STATUS_KIND,
} = require('./constants');
const { normalizeModuleDescriptor, redactSecrets } = require('./descriptor');
const { satisfies } = require('./semverRange');
const { createCapabilityRegistry } = require('../core/capabilityRegistry');
// normalizeModuleDescriptor used by atomic pre-checks

const REASON_CODE_SET = new Set(Object.values(REASON_CODES));
const MODULE_REPORTED_REASON_CODE_SET = new Set([
  REASON_CODES.AVAILABLE,
  REASON_CODES.RUNTIME_UNAVAILABLE,
  REASON_CODES.POLICY_DENIED,
  REASON_CODES.ENTITLEMENT_REQUIRED,
  REASON_CODES.ENTITLEMENT_EXPIRED,
  REASON_CODES.ENTITLEMENT_INVALID,
  REASON_CODES.ENTITLEMENT_UNAVAILABLE,
  REASON_CODES.MODULE_POLICY_DENIED,
  REASON_CODES.MODULE_DISABLED,
  REASON_CODES.MODULE_UNAVAILABLE,
]);

function normalizeReasonCode(reasonCode) {
  return REASON_CODE_SET.has(reasonCode) ? reasonCode : REASON_CODES.MODULE_UNAVAILABLE;
}

function fixedStatus({
  moduleId = null,
  lifecycle,
  availability,
  reasonCode,
  message = null,
  edition = null,
  entitlementMode = null,
}) {
  const status = {
    schemaVersion: 1,
    kind: MODULE_STATUS_KIND,
    moduleId,
    lifecycle,
    availability,
    reasonCode: normalizeReasonCode(reasonCode),
    message: message ? redactSecrets(message) : null,
    edition,
    entitlementMode,
    // Core does not enforce licenses; these fields are display/status only.
    coreEnforcesEntitlement: false,
  };
  if (!status.message) delete status.message;
  if (!status.edition) delete status.edition;
  if (!status.entitlementMode) delete status.entitlementMode;
  return Object.freeze(status);
}

/**
 * Trusted in-process module registrar.
 * Host must already import the module package; this API never scans paths or
 * dynamically requires untrusted names.
 */
function createStagingModuleRegistrar(options = {}) {
  const coreModuleApiVersion = String(options.coreModuleApiVersion || MODULE_API_VERSION);
  const hostFeatures = new Set(
    Array.isArray(options.hostFeatures) && options.hostFeatures.length
      ? options.hostFeatures
      : RUNTIME_FEATURE_ALLOWLIST
  );
  const capabilityRegistry = options.capabilityRegistry || createCapabilityRegistry();
  if (
    options.capabilityRegistry &&
    typeof capabilityRegistry.isSealed === 'function' &&
    capabilityRegistry.isSealed()
  ) {
    throw new Error('capability registry is sealed; cannot create module registrar against it');
  }

  const modules = new Map(); // id -> { descriptor, status }
  let sealed = false;

  function listModules() {
    return [...modules.values()]
      .map(entry => ({
        descriptor: entry.descriptor,
        status: entry.status,
      }))
      .sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
  }

  function getModule(id) {
    return modules.get(id) || null;
  }

  function getModuleStatus(id) {
    const entry = modules.get(id);
    return entry ? entry.status : null;
  }

  function notInstalledStatus() {
    return fixedStatus({
      lifecycle: LIFECYCLE.DECLARED,
      availability: AVAILABILITY.UNAVAILABLE,
      reasonCode: REASON_CODES.NOT_INSTALLED,
      message: 'No external module is registered for this identifier.',
    });
  }

  /**
   * Explicit trusted registration.
   * @param {{ descriptor: object, register: function({capabilityRegistry, module}): void|Promise }} input
   */
  async function registerModule(input) {
    if (sealed) {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.REGISTRATION_FAILED,
          message: 'Module registrar is sealed.',
        }),
      };
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.DESCRIPTOR_INVALID,
          message: 'registerModule requires { descriptor, register }.',
        }),
      };
    }

    // Reject dynamic path loading hints
    for (const banned of ['path', 'modulePath', 'requirePath', 'packagePath', 'file']) {
      if (input[banned] != null) {
        return {
          ok: false,
          status: fixedStatus({
            lifecycle: LIFECYCLE.REJECTED,
            availability: AVAILABILITY.UNAVAILABLE,
            reasonCode: REASON_CODES.POLICY_DENIED,
            message: 'Untrusted dynamic module paths are not accepted.',
          }),
        };
      }
    }

    if (typeof input.register !== 'function') {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.DESCRIPTOR_INVALID,
          message: 'register callback is required.',
        }),
      };
    }

    const normalized = normalizeModuleDescriptor(input.descriptor);
    if (!normalized.ok) {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.DESCRIPTOR_INVALID,
          message: normalized.errors.map(e => e.message).join('; '),
        }),
        errors: normalized.errors,
      };
    }

    const descriptor = normalized.descriptor;
    const declaredCapabilities = new Map(
      descriptor.capabilities.map(capability => [capability.id, capability])
    );
    const declaredSideEffects = new Set(descriptor.safety.sideEffects);
    if (modules.has(descriptor.id)) {
      return {
        ok: false,
        status: fixedStatus({
          moduleId: descriptor.id,
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.DUPLICATE_MODULE_ID,
          message: `Duplicate module id: ${descriptor.id}`,
          edition: descriptor.edition,
          entitlementMode: descriptor.entitlement.mode,
        }),
      };
    }

    if (!satisfies(coreModuleApiVersion, descriptor.compatibility.moduleApi)) {
      return {
        ok: false,
        status: fixedStatus({
          moduleId: descriptor.id,
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.INCOMPATIBLE_CORE,
          message: `Module API ${coreModuleApiVersion} does not satisfy ${descriptor.compatibility.moduleApi}`,
          edition: descriptor.edition,
          entitlementMode: descriptor.entitlement.mode,
        }),
      };
    }

    for (const feature of descriptor.runtime.requiredFeatures) {
      if (!hostFeatures.has(feature)) {
        return {
          ok: false,
          status: fixedStatus({
            moduleId: descriptor.id,
            lifecycle: LIFECYCLE.REJECTED,
            availability: AVAILABILITY.UNAVAILABLE,
            reasonCode: REASON_CODES.RUNTIME_UNAVAILABLE,
            message: `Required runtime feature unavailable: ${feature}`,
            edition: descriptor.edition,
            entitlementMode: descriptor.entitlement.mode,
          }),
        };
      }
    }

    // Stage capability registrations; rollback on failure for atomicity.
    const stagedIds = [];
    const stagingRegistry = {
      register(raw) {
        const before = new Set(capabilityRegistry.list().map(c => c.id));
        const registered = capabilityRegistry.register(raw);
        const after = capabilityRegistry.list().map(c => c.id);
        for (const id of after) {
          if (!before.has(id)) stagedIds.push(id);
        }
        // Enforce module capability list membership
        const declared = declaredCapabilities.get(registered.id);
        if (!declared) {
          throw Object.assign(new Error(`Capability ${registered.id} is not declared by module`), {
            code: 'CAPABILITY_NOT_DECLARED',
          });
        }
        if (registered.version !== declared.version) {
          throw Object.assign(
            new Error(
              `Capability ${registered.id} version ${registered.version} does not match declared version ${declared.version}`
            ),
            { code: 'CAPABILITY_VERSION_MISMATCH' }
          );
        }
        // Capability safety must not be weaker than module safety
        const moduleRank = SAFETY_RANK[descriptor.safety.level];
        const capRank = SAFETY_RANK[registered.safety.level];
        if (capRank < moduleRank) {
          throw Object.assign(
            new Error('Capability safety level cannot be weaker than module safety'),
            { code: 'SAFETY_WEAKER' }
          );
        }
        for (const sideEffect of registered.safety.sideEffects) {
          if (!declaredSideEffects.has(sideEffect)) {
            throw Object.assign(
              new Error(`Capability side effect is not declared by module: ${sideEffect}`),
              { code: 'SIDE_EFFECT_NOT_DECLARED' }
            );
          }
        }
        return registered;
      },
      list: (...args) => capabilityRegistry.list(...args),
      get: (...args) => capabilityRegistry.get(...args),
      resolve: (...args) => capabilityRegistry.resolve(...args),
    };

    try {
      await input.register({
        capabilityRegistry: stagingRegistry,
        module: { descriptor },
        coreModuleApiVersion,
      });

      // Ensure every declared capability was contributed
      if (stagedIds.length !== descriptor.capabilities.length) {
        throw Object.assign(new Error('Registered capability set does not match descriptor'), {
          code: 'CAPABILITY_SET_MISMATCH',
        });
      }
      const registeredIds = new Set(stagedIds);
      for (const cap of descriptor.capabilities) {
        if (!registeredIds.has(cap.id)) {
          throw Object.assign(new Error(`Declared capability not registered: ${cap.id}`), {
            code: 'CAPABILITY_MISSING',
          });
        }
      }

      // Optional module-reported availability (display only; core does not compute entitlement)
      let reasonCode = REASON_CODES.AVAILABLE;
      let availability = AVAILABILITY.AVAILABLE;
      let message = null;
      if (input.status && typeof input.status === 'object') {
        if (typeof input.status.reasonCode === 'string' && input.status.reasonCode.trim()) {
          const suppliedReasonCode = String(input.status.reasonCode).trim();
          if (!MODULE_REPORTED_REASON_CODE_SET.has(suppliedReasonCode)) {
            throw Object.assign(new Error('Module status reason code is not permitted'), {
              code: 'STATUS_REASON_INVALID',
            });
          }
          reasonCode = suppliedReasonCode;
        }
        if (typeof input.status.availability === 'string') {
          const a = input.status.availability.toLowerCase();
          if (!Object.values(AVAILABILITY).includes(a)) {
            throw Object.assign(new Error('Module status availability is not recognized'), {
              code: 'STATUS_AVAILABILITY_INVALID',
            });
          }
          availability = a;
        }
        if ((reasonCode === REASON_CODES.AVAILABLE) !== (availability === AVAILABILITY.AVAILABLE)) {
          throw Object.assign(new Error('Module status availability and reason code conflict'), {
            code: 'STATUS_INCOHERENT',
          });
        }
        // Public status is code-driven. Do not copy module-supplied free-form diagnostics.
        if (input.status.message) message = 'Module reported status.';
        // Reject secret-like status payloads
        const statusJson = JSON.stringify(input.status);
        if (
          /license\s*key|licenseKey|private\s*key|privateKey|-----BEGIN|api[_-]?key/i.test(
            statusJson
          )
        ) {
          throw Object.assign(new Error('Module status contains secret-like material'), {
            code: 'STATUS_SECRET',
          });
        }
      }

      const status = fixedStatus({
        moduleId: descriptor.id,
        lifecycle: LIFECYCLE.REGISTERED,
        availability,
        reasonCode,
        message,
        edition: descriptor.edition,
        entitlementMode: descriptor.entitlement.mode,
      });

      modules.set(descriptor.id, { descriptor: Object.freeze(descriptor), status });
      return { ok: true, descriptor, status };
    } catch (error) {
      // Atomic rollback of staged capabilities
      if (typeof capabilityRegistry.unregister === 'function') {
        for (const id of stagedIds) {
          try {
            capabilityRegistry.unregister(id);
          } catch {
            /* ignore */
          }
        }
      } else {
        // Capability registry has no unregister — document partial risk.
        // For atomicity without unregister, we rethrow as registration failure and
        // rely on staging into a temporary registry when provided by host.
        // If the shared registry was mutated, surface CAPABILITY_CONFLICT semantics.
      }

      const code = error && error.code;
      let reasonCode = REASON_CODES.REGISTRATION_FAILED;
      if (code === 'DUPLICATE' || /duplicate capability/i.test(String(error && error.message))) {
        reasonCode = REASON_CODES.CAPABILITY_CONFLICT;
      }
      if (code === 'STATUS_SECRET') reasonCode = REASON_CODES.POLICY_DENIED;
      if (code === 'STATUS_REASON_INVALID') reasonCode = REASON_CODES.MODULE_UNAVAILABLE;
      if (code === 'STATUS_AVAILABILITY_INVALID' || code === 'STATUS_INCOHERENT') {
        reasonCode = REASON_CODES.MODULE_UNAVAILABLE;
      }

      return {
        ok: false,
        status: fixedStatus({
          moduleId: descriptor.id,
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode,
          message: 'Module registration failed; core remains operational.',
          edition: descriptor.edition,
          entitlementMode: descriptor.entitlement.mode,
        }),
      };
    }
  }

  function seal() {
    sealed = true;
  }

  return {
    registerModule,
    listModules,
    getModule,
    getModuleStatus,
    notInstalledStatus,
    seal,
    isSealed: () => sealed,
    coreModuleApiVersion,
    capabilityRegistry,
  };
}

const SAFETY_RANK = Object.freeze({ S0: 0, S1: 1, S2: 2, S3: 3, S4: 4 });

/**
 * Registrar that stages capabilities in an isolated registry first, then copies
 * into the host registry only after full success — true atomic commit.
 */
function createAtomicModuleRegistrar(options = {}) {
  const hostCapabilityRegistry = options.capabilityRegistry || createCapabilityRegistry();
  if (typeof hostCapabilityRegistry.registerBatch !== 'function') {
    throw new Error('atomic module registration requires a capability registry with registerBatch');
  }
  if (typeof hostCapabilityRegistry.isSealed === 'function' && hostCapabilityRegistry.isSealed()) {
    throw new Error('capability registry is sealed; cannot create module registrar against it');
  }
  const coreModuleApiVersion = String(options.coreModuleApiVersion || MODULE_API_VERSION);
  const hostFeatures = options.hostFeatures;
  const modules = new Map();
  const pendingModules = new Set();
  let sealed = false;

  function hostRegistryIsSealed() {
    return (
      typeof hostCapabilityRegistry.isSealed === 'function' && hostCapabilityRegistry.isSealed()
    );
  }

  async function registerModule(input) {
    if (sealed) {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.REGISTRATION_FAILED,
          message: 'Module registrar is sealed.',
        }),
      };
    }
    if (hostRegistryIsSealed()) {
      return {
        ok: false,
        status: fixedStatus({
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.REGISTRATION_FAILED,
          message: 'Capability registry is sealed.',
        }),
      };
    }

    // Pre-check module id against committed modules (before ephemeral registration).
    const pre = normalizeModuleDescriptor(input && input.descriptor);
    if (pre.ok && (modules.has(pre.descriptor.id) || pendingModules.has(pre.descriptor.id))) {
      return {
        ok: false,
        status: fixedStatus({
          moduleId: pre.descriptor.id,
          lifecycle: LIFECYCLE.REJECTED,
          availability: AVAILABILITY.UNAVAILABLE,
          reasonCode: REASON_CODES.DUPLICATE_MODULE_ID,
          message: `Duplicate module id: ${pre.descriptor.id}`,
          edition: pre.descriptor.edition,
          entitlementMode: pre.descriptor.entitlement.mode,
        }),
      };
    }
    if (pre.ok) pendingModules.add(pre.descriptor.id);
    try {
      // Use an internal isolated registrar for validation + callback.
      const ephemeralCaps = createCapabilityRegistry();
      const ephemeral = createStagingModuleRegistrar({
        capabilityRegistry: ephemeralCaps,
        coreModuleApiVersion,
        hostFeatures,
      });
      const result = await ephemeral.registerModule(input);
      if (!result.ok) return result;

      // Commit the fully validated capability set through one host-registry transaction.
      try {
        const batch = result.descriptor.capabilities.map(({ id: capId }) => {
          const staged = ephemeralCaps.get(capId);
          if (!staged) throw new Error(`missing staged capability ${capId}`);
          return {
            id: staged.id,
            version: staged.version,
            title: staged.title,
            description: staged.description,
            category: staged.category,
            safety: staged.safety,
            aliases: staged.aliases,
            inputContract: staged.inputContract,
            outputContract: staged.outputContract,
            availability: staged.availability,
            docs: staged.docs,
            execute: staged.execute,
          };
        });
        hostCapabilityRegistry.registerBatch(batch);
        modules.set(result.descriptor.id, {
          descriptor: result.descriptor,
          status: result.status,
        });
        return result;
      } catch (error) {
        const registrySealed = /registry is sealed/i.test(String(error && error.message));
        return {
          ok: false,
          status: fixedStatus({
            moduleId: result.descriptor.id,
            lifecycle: LIFECYCLE.REJECTED,
            availability: AVAILABILITY.UNAVAILABLE,
            reasonCode: registrySealed
              ? REASON_CODES.REGISTRATION_FAILED
              : REASON_CODES.CAPABILITY_CONFLICT,
            message: registrySealed
              ? 'Capability registry was sealed before commit.'
              : 'Capability commit failed; no partial module registration retained.',
            edition: result.descriptor.edition,
            entitlementMode: result.descriptor.entitlement.mode,
          }),
        };
      }
    } finally {
      if (pre.ok) pendingModules.delete(pre.descriptor.id);
    }
  }

  return {
    registerModule,
    listModules: () =>
      [...modules.values()]
        .map(e => ({ descriptor: e.descriptor, status: e.status }))
        .sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id)),
    getModule: id => modules.get(id) || null,
    getModuleStatus: id => (modules.get(id) ? modules.get(id).status : null),
    notInstalledStatus: () =>
      fixedStatus({
        lifecycle: LIFECYCLE.DECLARED,
        availability: AVAILABILITY.UNAVAILABLE,
        reasonCode: REASON_CODES.NOT_INSTALLED,
        message: 'No external module is registered for this identifier.',
      }),
    seal: () => {
      sealed = true;
    },
    isSealed: () => sealed,
    coreModuleApiVersion,
    capabilityRegistry: hostCapabilityRegistry,
  };
}

/** Compatibility alias: the public registrar now always uses atomic staging and batch commit. */
function createModuleRegistrar(options = {}) {
  return createAtomicModuleRegistrar(options);
}

module.exports = {
  createModuleRegistrar,
  createAtomicModuleRegistrar,
  fixedStatus,
};
