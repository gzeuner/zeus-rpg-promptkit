'use strict';

const { MODULE_ID, COMMERCIAL_CAPABILITY_IDS, PUBLIC_OPERATIONS } = require('./capabilityCatalog');
const { REASON_CODES } = require('../constants');

/**
 * Discover commercial Project Intelligence capability presence on a registry.
 * Thin Community adapter — does not load commercial packages.
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
    commercial: true,
    present: presentCount > 0,
    presentCount,
    totalOperations: operations.length,
    operations,
    capabilityIds: Object.values(COMMERCIAL_CAPABILITY_IDS),
    reasonCode: presentCount > 0 ? null : REASON_CODES.CAPABILITY_UNAVAILABLE,
    message:
      presentCount > 0
        ? 'Commercial Project Intelligence capabilities are registered.'
        : 'Commercial Project Intelligence module is not registered. Community engines remain usable via API; entitled operations require the commercial module.',
    communityEnginesAvailable: true,
    nonClaims: Object.freeze([
      'Community adapters contain no paid implementation',
      'Capability presence requires explicit commercial module registration',
      'Not a live IBM i compile or deploy surface',
    ]),
  };
}

module.exports = {
  discoverProjectIntelligenceCapabilities,
};
