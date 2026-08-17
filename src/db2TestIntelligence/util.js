'use strict';

const crypto = require('node:crypto');
const { DANGEROUS_KEYS, LIMITS } = require('./constants');

/**
 * Locale-independent string compare (UTF-16 code unit order).
 * Never use localeCompare — sort order must be clock/locale stable.
 */
function strcmp(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

function stableSortStrings(list) {
  return list.slice().sort(strcmp);
}

function stableSortBy(list, keyFn) {
  return list
    .map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((a, b) => {
      const c = strcmp(a.key, b.key);
      return c !== 0 ? c : a.index - b.index;
    })
    .map(entry => entry.item);
}

function sha256Text(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''), 'utf8')
    .digest('hex');
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function utf8ByteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

/**
 * Descriptor-only check (no property get). Used by trusted helpers and optional presence checks.
 */
function isOwnDataProperty(object, key) {
  if (object == null || (typeof object !== 'object' && typeof object !== 'function')) {
    return false;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return false;
  }
  if (!descriptor) return false;
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(descriptor, 'value');
}

/**
 * Single guarded descriptor read for untrusted data.
 * Returns descriptor.value only — never performs a subsequent property get
 * (object[key] / Proxy get traps are never invoked).
 *
 * @returns {{ ok: true, value: * } | { ok: false, reason: string }}
 */
function readOwnData(object, key) {
  if (object == null || (typeof object !== 'object' && typeof object !== 'function')) {
    return { ok: false, reason: 'not-object' };
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return { ok: false, reason: 'descriptor-failed' };
  }
  if (!descriptor) {
    return { ok: false, reason: 'not-own-data' };
  }
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    return { ok: false, reason: 'accessor' };
  }
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    return { ok: false, reason: 'no-value' };
  }
  // Capture value from the descriptor object itself — no property get on `object`.
  return { ok: true, value: descriptor.value };
}

/**
 * Trusted-only key listing for module-produced plain data.
 * Silently skips dangerous keys and accessors — never use on untrusted input.
 * (Untrusted input must use inspectUntrustedOwnProperties, which fails closed.)
 */
function ownDataKeys(object) {
  if (object == null || typeof object !== 'object') return [];
  let names;
  try {
    names = Object.getOwnPropertyNames(object);
  } catch {
    return [];
  }
  const keys = [];
  for (const key of names) {
    if (DANGEROUS_KEYS.includes(key)) continue;
    if (!isOwnDataProperty(object, key)) continue;
    keys.push(key);
  }
  return stableSortStrings(keys);
}

/**
 * Safe own-property inspection for untrusted request objects.
 * Enumerates own names and captures descriptor.value for each data property.
 * Never invokes property getters / Proxy get traps.
 *
 * @returns {{ ok: true, keys: string[], values: Object } | { ok: false, code: string, message: string }}
 */
function inspectUntrustedOwnProperties(object) {
  if (object == null || (typeof object !== 'object' && typeof object !== 'function')) {
    return { ok: false, code: 'INPUT_INVALID', message: 'Value must be an object.' };
  }
  let names;
  try {
    names = Object.getOwnPropertyNames(object);
  } catch {
    return {
      ok: false,
      code: 'INPUT_INVALID',
      message: 'Property enumeration failed.',
    };
  }
  const values = Object.create(null);
  const keys = [];
  for (const key of names) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(object, key);
    } catch {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Property descriptor inspection failed.',
      };
    }
    if (!descriptor) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Property descriptor missing after enumeration.',
      };
    }
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Accessor properties are not allowed.',
      };
    }
    if (DANGEROUS_KEYS.includes(key)) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Input contains a dangerous property key.',
      };
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Unsupported property descriptor.',
      };
    }
    keys.push(key);
    values[key] = descriptor.value;
  }
  return { ok: true, keys: stableSortStrings(keys), values };
}

const INDEX_KEY_RE = /^(0|[1-9]\d*)$/;

/**
 * For untrusted arrays: capture `length` and every dense index from data
 * descriptors only. Never reads array.length, array[i], Symbol.iterator, or for...of.
 *
 * @returns {{ ok: true, length: number, elements: *[] } | { ok: false, code: string, message: string }}
 */
function inspectUntrustedArray(array) {
  if (!Array.isArray(array)) {
    return { ok: false, code: 'INPUT_INVALID', message: 'Expected an array.' };
  }

  let names;
  try {
    names = Object.getOwnPropertyNames(array);
  } catch {
    return {
      ok: false,
      code: 'INPUT_INVALID',
      message: 'Property enumeration failed.',
    };
  }

  let lengthDesc;
  try {
    lengthDesc = Object.getOwnPropertyDescriptor(array, 'length');
  } catch {
    return {
      ok: false,
      code: 'INPUT_INVALID',
      message: 'Property descriptor inspection failed.',
    };
  }
  if (
    !lengthDesc ||
    typeof lengthDesc.get === 'function' ||
    typeof lengthDesc.set === 'function' ||
    !Object.prototype.hasOwnProperty.call(lengthDesc, 'value') ||
    !Number.isInteger(lengthDesc.value) ||
    lengthDesc.value < 0 ||
    lengthDesc.value > Number.MAX_SAFE_INTEGER
  ) {
    return {
      ok: false,
      code: 'INPUT_INVALID',
      message: 'Array length descriptor is invalid.',
    };
  }
  const length = lengthDesc.value;

  /** @type {Map<number, *>} */
  const byIndex = new Map();
  for (const key of names) {
    if (key === 'length') continue;
    if (!INDEX_KEY_RE.test(key)) {
      if (DANGEROUS_KEYS.includes(key)) {
        return {
          ok: false,
          code: 'INPUT_INVALID',
          message: 'Input contains a dangerous property key.',
        };
      }
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Array has unexpected own properties.',
      };
    }
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, key);
    } catch {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Property descriptor inspection failed.',
      };
    }
    if (!descriptor) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Property descriptor missing after enumeration.',
      };
    }
    if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Accessor properties are not allowed.',
      };
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Unsupported property descriptor.',
      };
    }
    const index = Number(key);
    if (index >= length) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Array index is outside declared length.',
      };
    }
    byIndex.set(index, descriptor.value);
  }

  // Dense 0..length-1 required — no holes, no reliance on array[i] / iteration.
  const elements = new Array(length);
  for (let i = 0; i < length; i += 1) {
    if (!byIndex.has(i)) {
      return {
        ok: false,
        code: 'INPUT_INVALID',
        message: 'Array is sparse or missing a required index.',
      };
    }
    elements[i] = byIndex.get(i);
  }

  return { ok: true, length, elements };
}

/**
 * Deterministic canonical JSON: sorted object keys, no whitespace variance,
 * finite numbers only, no undefined/functions.
 */
function canonicalize(value) {
  return stringifyCanonical(value);
}

function stringifyCanonical(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('non-finite number');
    }
    // Decimal integer form for integers; otherwise JSON number (never locale).
    if (Number.isInteger(value)) return String(value);
    return JSON.stringify(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint' || t === 'symbol' || t === 'function' || t === 'undefined') {
    throw new Error('unsupported type');
  }
  if (Array.isArray(value)) {
    const parts = value.map(item => stringifyCanonical(item));
    return `[${parts.join(',')}]`;
  }
  if (t === 'object') {
    const keys = ownDataKeys(value);
    // Fallback for plain objects created with defineProperty data props only
    // already covered; also accept Object.keys for pure plain data objects
    // produced by this module (always own data).
    const useKeys = keys.length ? keys : stableSortStrings(Object.keys(value));
    const parts = [];
    for (const key of useKeys) {
      if (DANGEROUS_KEYS.includes(key)) continue;
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      if (child === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${stringifyCanonical(child)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error('unsupported type');
}

/**
 * Pretty canonical JSON for artifacts (stable key order, 2-space indent, trailing newline).
 */
function prettyCanonical(value, space = 2) {
  const indentUnit = typeof space === 'number' ? ' '.repeat(space) : String(space);
  function walk(node, depth) {
    if (node === null) return 'null';
    const t = typeof node;
    if (t === 'boolean') return node ? 'true' : 'false';
    if (t === 'number') {
      if (!Number.isFinite(node)) throw new Error('non-finite number');
      if (Number.isInteger(node)) return String(node);
      return JSON.stringify(node);
    }
    if (t === 'string') return JSON.stringify(node);
    if (Array.isArray(node)) {
      if (node.length === 0) return '[]';
      const pad = indentUnit.repeat(depth + 1);
      const close = indentUnit.repeat(depth);
      const items = node.map(item => `${pad}${walk(item, depth + 1)}`);
      return `[\n${items.join(',\n')}\n${close}]`;
    }
    if (t === 'object') {
      const keys = stableSortStrings(Object.keys(node).filter(k => !DANGEROUS_KEYS.includes(k)));
      if (keys.length === 0) return '{}';
      const pad = indentUnit.repeat(depth + 1);
      const close = indentUnit.repeat(depth);
      const items = [];
      for (const key of keys) {
        const child = node[key];
        if (child === undefined) continue;
        items.push(`${pad}${JSON.stringify(key)}: ${walk(child, depth + 1)}`);
      }
      if (items.length === 0) return '{}';
      return `{\n${items.join(',\n')}\n${close}}`;
    }
    throw new Error('unsupported type');
  }
  return `${walk(value, 0)}\n`;
}

function boundString(value, maxChars) {
  const text = String(value == null ? '' : value);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function assertUtf8Bound(text, maxBytes, code = 'BOUNDS_EXCEEDED') {
  const bytes = utf8ByteLength(text);
  if (bytes > maxBytes) {
    return { ok: false, code, bytes, maxBytes };
  }
  return { ok: true, bytes };
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function closedFailure(reasonCode, message) {
  return {
    ok: false,
    reasonCode: String(reasonCode),
    message: String(message || 'Request failed.'),
  };
}

/**
 * Measure raw serialized size of an untrusted input without walking getters
 * when a pre-serialized bound is supplied; otherwise uses JSON.stringify which
 * may invoke toJSON only — callers should prefer byteLength of a caller buffer
 * when available. For object inputs we use a guarded walk that only reads own
 * data properties.
 */
function estimateSerializedBytes(value, limits = LIMITS) {
  let visits = 0;
  let bytes = 0;

  function walk(node, depth) {
    visits += 1;
    if (visits > limits.maxPropertyVisits) {
      const err = new Error('visit-limit');
      err.code = 'BOUNDS_EXCEEDED';
      throw err;
    }
    if (depth > limits.maxTraversalDepth) {
      const err = new Error('depth-limit');
      err.code = 'BOUNDS_EXCEEDED';
      throw err;
    }
    if (node === null || node === undefined) {
      bytes += 4;
      return;
    }
    const t = typeof node;
    if (t === 'boolean') {
      bytes += node ? 4 : 5;
      return;
    }
    if (t === 'number') {
      bytes += 24;
      return;
    }
    if (t === 'string') {
      bytes += utf8ByteLength(node) + 2;
      return;
    }
    if (t === 'bigint' || t === 'symbol' || t === 'function') {
      const err = new Error('invalid-type');
      err.code = 'INPUT_INVALID';
      throw err;
    }
    if (Array.isArray(node)) {
      const arrInsp = inspectUntrustedArray(node);
      if (!arrInsp.ok) {
        const err = new Error(arrInsp.message || 'array-invalid');
        err.code = arrInsp.code || 'INPUT_INVALID';
        throw err;
      }
      bytes += 2;
      // Walk captured descriptor values only — never node[i] / node.length / iteration.
      for (let i = 0; i < arrInsp.length; i += 1) {
        walk(arrInsp.elements[i], depth + 1);
        bytes += 1;
      }
      return;
    }
    // Fail closed on accessors / dangerous keys; use captured descriptor values only.
    const inspected = inspectUntrustedOwnProperties(node);
    if (!inspected.ok) {
      const err = new Error(inspected.message || 'object-invalid');
      err.code = inspected.code || 'INPUT_INVALID';
      throw err;
    }
    bytes += 2;
    for (const key of inspected.keys) {
      bytes += utf8ByteLength(key) + 3;
      walk(inspected.values[key], depth + 1);
    }
  }

  try {
    walk(value, 0);
    return { ok: true, bytes, visits };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : 'INPUT_INVALID',
      bytes,
      visits,
    };
  }
}

module.exports = {
  strcmp,
  stableSortStrings,
  stableSortBy,
  sha256Text,
  sha256Buffer,
  utf8ByteLength,
  isOwnDataProperty,
  ownDataKeys,
  inspectUntrustedOwnProperties,
  inspectUntrustedArray,
  readOwnData,
  canonicalize,
  prettyCanonical,
  boundString,
  assertUtf8Bound,
  deepFreeze,
  closedFailure,
  estimateSerializedBytes,
};
