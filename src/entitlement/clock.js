'use strict';

/**
 * Deterministic clock injection for offline entitlement tests.
 * Production callers may omit now() to use real time.
 */
function createClock(options = {}) {
  if (typeof options.now === 'function') {
    return { now: () => new Date(options.now()) };
  }
  if (options.now instanceof Date) {
    const fixed = new Date(options.now.getTime());
    return { now: () => new Date(fixed.getTime()) };
  }
  if (typeof options.now === 'string' || typeof options.now === 'number') {
    const fixed = new Date(options.now);
    if (Number.isNaN(fixed.getTime())) {
      throw new Error('invalid fixed clock value');
    }
    return { now: () => new Date(fixed.getTime()) };
  }
  return { now: () => new Date() };
}

module.exports = { createClock };
