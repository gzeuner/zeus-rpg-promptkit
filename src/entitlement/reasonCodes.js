'use strict';

/** Aligns with public core display codes; enforcement lives only here. */
const REASON_CODES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  ENTITLEMENT_EXPIRED: 'ENTITLEMENT_EXPIRED',
  ENTITLEMENT_INVALID: 'ENTITLEMENT_INVALID',
  POLICY_DENIED: 'POLICY_DENIED',
});

module.exports = { REASON_CODES };
