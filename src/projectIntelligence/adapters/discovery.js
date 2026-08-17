'use strict';

const { MODULE_ID, COMMERCIAL_CAPABILITY_IDS, PUBLIC_OPERATIONS } = require('./capabilityCatalog');
const { REASON_CODES } = require('../constants');

/**
 * Discover integrated Project Intelligence capability presence on a registry.
 * Thin public adapter — does not load external packages.
 *
 * @param {object|null} capabilityRegistry registry with get/list/resolve
 * @returns {{ moduleId: string, present: boolean, operations: object[], reasonCode: string|null }}
 */
function discoverProjectIntelligenceCapabilities(capabilityRegistry) {
  const operations = PUBLIC_OPERATIONS.map(op => {
    const present = Boolean(
      capabilityRegistry &&
      typeof capabilityRegistry.get === 'function' &&
      capabilityRegistry.get(op.capabilityId)
    );
    return {
      operation: op.operation,
      capabilityId: op.capabilityId,
      mcpTool: op.mcpTool,
      sideEffects: [...op.sideEffects],
      present,
      availability: present
        ? { cli: true, mcp: true, api: true }
        : { cli: false, mcp: false, api: false },
    };
  });

  const presentCount = operations.filter(o => o.present).length;
  return {
    moduleId: MODULE_ID,
    builtIn: true,
    commercial: true,
    present: presentCount > 0,
    presentCount,
    totalOperations: operations.length,
    operations,
    capabilityIds: Object.values(COMMERCIAL_CAPABILITY_IDS),
    reasonCode: presentCount > 0 ? null : REASON_CODES.CAPABILITY_UNAVAILABLE,
    message:
      presentCount > 0
        ? 'Integrated Project Intelligence capabilities are registered.'
        : 'Integrated Project Intelligence is not registered. Neutral engines remain usable via API; entitled operations require explicit built-in registration.',
    communityEnginesAvailable: true,
    nonClaims: Object.freeze([
      'Adapters contain no dynamically loaded implementation',
      'Capability presence requires explicit built-in registration',
      'Community analysis engines remain available independently of entitlement',
      'Not a live IBM i compile or deploy surface',
    ]),
  };
}

module.exports = {
  discoverProjectIntelligenceCapabilities,
};
