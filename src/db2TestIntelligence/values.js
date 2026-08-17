'use strict';

/**
 * Deterministic type-boundary value construction.
 * Decimal/packed values use lossless decimal strings — never floating-point math.
 * Temporal values use fixed ISO-like literals (locale-independent).
 */

const { LIMITS } = require('./constants');

function repeatChar(ch, n) {
  if (n <= 0) return '';
  return String(ch).repeat(n);
}

/**
 * Build a decimal string with exact precision/scale using only string ops.
 * sign: '+' | '-' | ''
 * digits before decimal: precision - scale (at least 1 if scale < precision)
 */
function decimalString({ precision, scale, fillDigit = '9', sign = '' }) {
  const p = Number.isInteger(precision) ? precision : 5;
  const s = Number.isInteger(scale) ? scale : 0;
  const intDigits = Math.max(p - s, 0);
  const intPart = intDigits === 0 ? '0' : repeatChar(fillDigit, intDigits);
  if (s <= 0) {
    return `${sign}${intPart}`;
  }
  const frac = repeatChar(fillDigit, s);
  return `${sign}${intPart}.${frac}`;
}

function decimalZero(scale) {
  const s = Number.isInteger(scale) ? scale : 0;
  if (s <= 0) return '0';
  return `0.${repeatChar('0', s)}`;
}

function decimalMin(precision, scale) {
  return decimalString({ precision, scale, fillDigit: '9', sign: '-' });
}

function decimalMax(precision, scale) {
  return decimalString({ precision, scale, fillDigit: '9', sign: '' });
}

/**
 * One unit past max absolute magnitude for overflow (precision+1 nines before scale).
 * Represented as a string that would not fit the column.
 */
function decimalOverflow(precision, scale) {
  const p = Number.isInteger(precision) ? precision : 5;
  const s = Number.isInteger(scale) ? scale : 0;
  // precision+1 digits total magnitude
  const intDigits = Math.max(p - s, 0) + 1;
  const intPart = repeatChar('9', intDigits);
  if (s <= 0) return intPart;
  return `${intPart}.${repeatChar('9', s)}`;
}

/**
 * Underflow-ish tiny non-zero beyond scale: 0.000...01 with scale+1 fraction digits.
 */
function decimalUnderflow(scale) {
  const s = Number.isInteger(scale) ? scale : 0;
  return `0.${repeatChar('0', s)}1`;
}

/**
 * Rounding boundary: value with scale+1 fraction ending in 5 (ties).
 * Lossless string only — no float rounding performed here.
 */
function decimalRoundingBoundary(precision, scale) {
  const s = Number.isInteger(scale) ? scale : 0;
  const p = Number.isInteger(precision) ? precision : s + 1;
  const intDigits = Math.max(p - s, 1);
  // e.g. scale 2 → 1.225 (would round depending on mode — expectation unknown-business for mode)
  const intPart = `1${repeatChar('0', Math.max(intDigits - 1, 0))}`.slice(0, intDigits) || '1';
  if (s <= 0) return `${intPart}5`;
  return `${intPart}.${repeatChar('2', s)}5`.replace(/^(\d+)\.(\d{0,})5$/, (m, a, b) => {
    const frac = (b + '5').slice(0, s + 1);
    return `${a}.${frac}`;
  });
}

function isCharType(type) {
  const t = String(type || '').toUpperCase();
  return (
    t === 'CHAR' ||
    t === 'CHARACTER' ||
    t === 'VARCHAR' ||
    t === 'CHARACTER VARYING' ||
    t === 'CLOB'
  );
}

function isFixedChar(type) {
  const t = String(type || '').toUpperCase();
  return t === 'CHAR' || t === 'CHARACTER';
}

function isDecimalType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'DECIMAL' || t === 'DEC' || t === 'NUMERIC' || t === 'PACKED' || t === 'DECFLOAT';
}

function isIntegerType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'SMALLINT' || t === 'INTEGER' || t === 'INT' || t === 'BIGINT';
}

function isDateType(type) {
  return String(type || '').toUpperCase() === 'DATE';
}

function isTimeType(type) {
  return String(type || '').toUpperCase() === 'TIME';
}

function isTimestampType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'TIMESTAMP' || t === 'TIMESTMP';
}

function integerBounds(type) {
  const t = String(type || '').toUpperCase();
  if (t === 'SMALLINT')
    return { min: '-32768', max: '32767', overflow: '32768', underflow: '-32769' };
  if (t === 'BIGINT') {
    return {
      min: '-9223372036854775808',
      max: '9223372036854775807',
      overflow: '9223372036854775808',
      underflow: '-9223372036854775809',
    };
  }
  // INTEGER default
  return {
    min: '-2147483648',
    max: '2147483647',
    overflow: '2147483648',
    underflow: '-2147483649',
  };
}

/**
 * Canonical assignment value form for vectors (JSON-friendly, lossless).
 */
function assignmentValue(kind, value) {
  if (value === null) return null;
  if (kind === 'number' || kind === 'decimal' || kind === 'integer') {
    return { kind: 'decimal-string', value: String(value) };
  }
  if (kind === 'string') {
    return { kind: 'string', value: String(value) };
  }
  if (kind === 'date' || kind === 'time' || kind === 'timestamp') {
    return { kind, value: String(value) };
  }
  return { kind: 'string', value: String(value) };
}

/**
 * String boundary cases.
 * max+1 reject is emitted only when the assignment actually has declared length+1
 * characters (fully materialized). Longer columns get a materialization gap instead.
 *
 * @returns {{ cases: object[], materializationGap: boolean, declaredLength: number }}
 */
function stringBoundaryCases(column) {
  const len = Number.isInteger(column.length) && column.length > 0 ? column.length : 1;
  const maxMat = LIMITS.maxStringMaterializeChars;
  const cases = [
    { label: 'empty', value: '', expected: 'accept' },
    { label: 'blank', value: ' ', expected: 'accept' },
    {
      label: 'unicode-bmp',
      value: 'Ä',
      expected: 'accept',
    },
  ];
  let materializationGap = false;

  if (len <= maxMat) {
    cases.push({
      label: 'exact-length',
      value: repeatChar('A', len),
      expected: 'accept',
      meta: { logicalLength: len, materialized: len },
    });
    // Only claim max+1 reject when the payload truly has length+1 characters.
    cases.push({
      label: 'max-plus-one',
      value: repeatChar('A', len + 1),
      expected: 'reject',
      meta: { logicalLength: len + 1, materialized: len + 1 },
    });
  } else {
    materializationGap = true;
    // Bounded short cases only — no false max+1.
    cases.push({
      label: 'bounded-prefix',
      value: repeatChar('A', maxMat),
      expected: 'accept',
      meta: { logicalLength: maxMat, materialized: maxMat, declaredLength: len },
    });
  }

  if (isFixedChar(column.type) && len <= maxMat) {
    cases.push({
      label: 'fixed-pad-width',
      value: repeatChar('B', len),
      expected: 'accept',
    });
  } else if (!isFixedChar(column.type)) {
    cases.push({
      label: 'varying-short',
      value: 'X',
      expected: 'accept',
    });
  }
  return { cases, materializationGap, declaredLength: len };
}

function decimalBoundaryCases(column) {
  const precision = Number.isInteger(column.precision) ? column.precision : 5;
  const scale = Number.isInteger(column.scale) ? column.scale : 0;
  return [
    { label: 'zero', value: decimalZero(scale), expected: 'accept' },
    { label: 'positive-max', value: decimalMax(precision, scale), expected: 'accept' },
    { label: 'negative-min', value: decimalMin(precision, scale), expected: 'accept' },
    { label: 'overflow', value: decimalOverflow(precision, scale), expected: 'reject' },
    { label: 'underflow-scale', value: decimalUnderflow(scale), expected: 'reject' },
    {
      label: 'rounding-boundary',
      value: decimalRoundingBoundary(precision, scale),
      expected: 'unknown',
      note: 'Rounding mode is business/engine-specific; technical overflow of scale only.',
    },
    {
      label: 'positive-one',
      value: scale > 0 ? `1.${repeatChar('0', scale)}` : '1',
      expected: 'accept',
    },
    {
      label: 'negative-one',
      value: scale > 0 ? `-1.${repeatChar('0', scale)}` : '-1',
      expected: 'accept',
    },
  ];
}

/**
 * Temporal boundary cases.
 * Leap-day is always included for DATE/TIMESTAMP.
 * Timestamp fractional precision: when column.precision is null/unknown, caller
 * should record a gap; we still emit zero-fraction boundaries only.
 *
 * @returns {{ cases: object[], fractionalPrecisionGap: boolean }}
 */
function temporalBoundaryCases(column) {
  if (isDateType(column.type)) {
    return {
      cases: [
        { label: 'date-min', value: '0001-01-01', expected: 'accept' },
        { label: 'date-max', value: '9999-12-31', expected: 'accept' },
        { label: 'date-epoch', value: '1970-01-01', expected: 'accept' },
        { label: 'date-leap-day', value: '2020-02-29', expected: 'accept' },
        { label: 'date-invalid', value: '9999-99-99', expected: 'reject' },
        { label: 'date-invalid-leap', value: '2019-02-29', expected: 'reject' },
      ],
      fractionalPrecisionGap: false,
    };
  }
  if (isTimeType(column.type)) {
    return {
      cases: [
        { label: 'time-min', value: '00:00:00', expected: 'accept' },
        { label: 'time-max', value: '24:00:00', expected: 'accept' },
        { label: 'time-mid', value: '12:00:00', expected: 'accept' },
        { label: 'time-invalid', value: '25:00:00', expected: 'reject' },
      ],
      fractionalPrecisionGap: false,
    };
  }
  if (isTimestampType(column.type)) {
    const hasFrac = Number.isInteger(column.precision) && column.precision > 0;
    const cases = [
      { label: 'ts-min', value: '0001-01-01-00.00.00.000000', expected: 'accept' },
      { label: 'ts-max', value: '9999-12-31-24.00.00.000000', expected: 'accept' },
      { label: 'ts-epoch', value: '1970-01-01-00.00.00.000000', expected: 'accept' },
      { label: 'ts-leap-day', value: '2020-02-29-12.00.00.000000', expected: 'accept' },
      { label: 'ts-invalid', value: '9999-99-99-99.99.99.999999', expected: 'reject' },
    ];
    if (hasFrac) {
      const frac = '1'.repeat(Math.min(column.precision, 12));
      cases.push({
        label: 'ts-fractional',
        value: `2020-01-01-00.00.00.${frac.padEnd(6, '0').slice(0, 6)}`,
        expected: 'accept',
      });
    }
    return {
      cases,
      fractionalPrecisionGap: !hasFrac,
    };
  }
  return { cases: [], fractionalPrecisionGap: false };
}

module.exports = {
  repeatChar,
  decimalString,
  decimalZero,
  decimalMin,
  decimalMax,
  decimalOverflow,
  decimalUnderflow,
  decimalRoundingBoundary,
  isCharType,
  isFixedChar,
  isDecimalType,
  isIntegerType,
  isDateType,
  isTimeType,
  isTimestampType,
  integerBounds,
  assignmentValue,
  stringBoundaryCases,
  decimalBoundaryCases,
  temporalBoundaryCases,
};
