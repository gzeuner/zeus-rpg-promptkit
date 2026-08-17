'use strict';

const {
  REQUEST_CONTRACT_ID,
  REQUEST_CONTRACT_VERSION,
  REASON_CODES,
  LIMITS,
  FORBIDDEN_ROW_LIKE_KEYS,
  FRAMEWORK_IDS,
  PINNED_COMMUNITY_SHA,
} = require('./constants');
const {
  inspectUntrustedOwnProperties,
  inspectUntrustedArray,
  readOwnData,
  utf8ByteLength,
  strcmp,
  stableSortBy,
  estimateSerializedBytes,
  sha256Text,
  canonicalize,
} = require('./util');

const FORBIDDEN_SET = new Set(FORBIDDEN_ROW_LIKE_KEYS.map(k => k.toLowerCase()));
const FRAMEWORK_SET = new Set(FRAMEWORK_IDS);

function fail(code, message) {
  return {
    ok: false,
    reasonCode: code,
    message: String(message),
  };
}

function isPlainDataObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  let proto;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    // Proxy getPrototypeOf trap → fixed invalid, never raw/internal failure.
    return false;
  }
  return proto === Object.prototype || proto === null;
}

/**
 * Inspect own properties without invoking getters; reject accessors, dangerous
 * keys, and forbidden row-like keys at every untrusted object level.
 * Captured descriptor values are available via `.values` for zero-get reads.
 */
function inspectObjectKeys(object) {
  const inspected = inspectUntrustedOwnProperties(object);
  if (!inspected.ok) {
    return fail(
      inspected.code === 'BOUNDS_EXCEEDED'
        ? REASON_CODES.BOUNDS_EXCEEDED
        : REASON_CODES.INPUT_INVALID,
      inspected.message
    );
  }
  for (const key of inspected.keys) {
    if (FORBIDDEN_SET.has(String(key).toLowerCase())) {
      return fail(REASON_CODES.INPUT_INVALID, 'Input contains a forbidden row-like property.');
    }
  }
  return { ok: true, keys: inspected.keys, values: inspected.values };
}

/**
 * Confirm value is a safe untrusted array. Returns captured dense elements
 * from descriptors only — never array.length / array[i] / for...of on input.
 */
function requireSafeArray(value, message) {
  if (!Array.isArray(value)) {
    return fail(REASON_CODES.INPUT_INVALID, message || 'Expected an array.');
  }
  const inspected = inspectUntrustedArray(value);
  if (!inspected.ok) {
    return fail(
      inspected.code === 'BOUNDS_EXCEEDED'
        ? REASON_CODES.BOUNDS_EXCEEDED
        : REASON_CODES.INPUT_INVALID,
      inspected.message
    );
  }
  return {
    ok: true,
    length: inspected.length,
    elements: inspected.elements,
  };
}

/**
 * Optional own-data field without property get.
 * Missing → present false. Accessor / descriptor trap → fixed INPUT_INVALID.
 */
function optionalOwnData(object, key) {
  const read = readOwnData(object, key);
  if (read.ok) return { ok: true, present: true, value: read.value };
  if (read.reason === 'not-own-data' || read.reason === 'not-object') {
    return { ok: true, present: false, value: undefined };
  }
  return fail(REASON_CODES.INPUT_INVALID, 'Input property is not a plain data field.');
}

/** Required own-data field (descriptor value only). */
function requireOwnData(object, key, message) {
  const read = readOwnData(object, key);
  if (!read.ok) {
    return fail(REASON_CODES.INPUT_INVALID, message || 'Required field is missing or invalid.');
  }
  return { ok: true, value: read.value };
}

function readRequiredString(object, key, maxChars) {
  const read = readOwnData(object, key);
  if (!read.ok || typeof read.value !== 'string') return { ok: false };
  if (read.value.length === 0 || read.value.length > maxChars) return { ok: false };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(read.value)) return { ok: false };
  return { ok: true, value: read.value };
}

function readOptionalString(object, key, maxChars) {
  const read = readOwnData(object, key);
  if (!read.ok) {
    // Missing key is optional; accessors/descriptor traps are hard failures.
    if (read.reason === 'not-own-data') return { ok: true, value: null };
    return { ok: false };
  }
  if (read.value == null) return { ok: true, value: null };
  if (typeof read.value !== 'string') return { ok: false };
  if (read.value.length > maxChars) return { ok: false };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(read.value)) return { ok: false };
  return { ok: true, value: read.value };
}

function readOptionalBoolean(object, key) {
  const read = readOwnData(object, key);
  if (!read.ok) {
    if (read.reason === 'not-own-data') return { ok: true, value: null };
    return { ok: false };
  }
  if (read.value == null) return { ok: true, value: null };
  if (typeof read.value !== 'boolean') return { ok: false };
  return { ok: true, value: read.value };
}

function readOptionalInteger(object, key, min, max) {
  const read = readOwnData(object, key);
  if (!read.ok) {
    if (read.reason === 'not-own-data') return { ok: true, value: null };
    return { ok: false };
  }
  if (read.value == null) return { ok: true, value: null };
  if (!Number.isInteger(read.value)) return { ok: false };
  if (read.value < min || read.value > max) return { ok: false };
  return { ok: true, value: read.value };
}

function readIdentifier(object, key, required) {
  const result = required
    ? readRequiredString(object, key, LIMITS.maxIdentifierChars)
    : readOptionalString(object, key, LIMITS.maxIdentifierChars);
  if (!result.ok) return result;
  if (result.value == null) return result;
  // Technical identifiers only — no whitespace control
  if (
    !/^[A-Za-z0-9_$#@.]+$/.test(result.value) &&
    !/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(result.value)
  ) {
    // Allow dotted schema.table style via separate fields; single token identifiers.
    if (!/^[A-Za-z0-9_$#]+$/.test(result.value)) {
      return { ok: false };
    }
  }
  return result;
}

function projectSourceEvidence(rawList, visitState) {
  if (rawList == null) return { ok: true, value: [] };
  const listInsp = requireSafeArray(rawList, 'sourceEvidence must be an array.');
  if (!listInsp.ok) return listInsp;
  if (listInsp.length > LIMITS.maxSourceEvidencePerTable) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Too many source evidence entries for a table.');
  }
  const out = [];
  for (let i = 0; i < listInsp.length; i += 1) {
    visitState.visits += 1;
    if (visitState.visits > LIMITS.maxPropertyVisits) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input property visit limit exceeded.');
    }
    const item = listInsp.elements[i];
    if (!isPlainDataObject(item)) {
      return fail(REASON_CODES.INPUT_INVALID, 'sourceEvidence entries must be plain objects.');
    }
    const keyInsp = inspectObjectKeys(item);
    if (!keyInsp.ok) return keyInsp;
    const keys = keyInsp.keys;
    const kind = readOptionalString(item, 'kind', 64);
    const ref = readOptionalString(item, 'ref', 256);
    const note = readOptionalString(item, 'note', 256);
    if (!kind.ok || !ref.ok || !note.ok) {
      return fail(REASON_CODES.INPUT_INVALID, 'Malformed sourceEvidence entry.');
    }
    // Only technical provenance metadata — never sample payloads
    for (const k of keys) {
      if (!['kind', 'ref', 'note'].includes(k)) {
        return fail(REASON_CODES.INPUT_INVALID, 'Unknown sourceEvidence field.');
      }
    }
    out.push({
      kind: kind.value || 'source',
      ref: ref.value || '',
      note: note.value || '',
    });
  }
  // Deterministic sort + semantic dedupe (kind|ref|note) for byte-stable output.
  const sorted = stableSortBy(out, e => `${e.kind}|${e.ref}|${e.note}`);
  const deduped = [];
  const seen = new Set();
  for (let i = 0; i < sorted.length; i += 1) {
    const key = `${sorted[i].kind}|${sorted[i].ref}|${sorted[i].note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(sorted[i]);
  }
  return { ok: true, value: deduped };
}

function projectColumn(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Column must be a plain object.');
  }
  visitState.visits += 1;
  if (visitState.visits > LIMITS.maxPropertyVisits) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input property visit limit exceeded.');
  }
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;

  const allowed = new Set([
    'name',
    'systemName',
    'type',
    'length',
    'precision',
    'scale',
    'nullable',
    'primaryKey',
    'ccsid',
    'collation',
  ]);
  for (const k of keys) {
    // Reject catalog-default surface entirely (not provided by pinned Community evidence).
    if (k === 'default' || k === 'hasDefault') {
      return fail(
        REASON_CODES.INPUT_INVALID,
        'Column defaults are not part of the supported canonical evidence surface.'
      );
    }
    if (!allowed.has(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown column field.');
    }
  }

  const name = readIdentifier(raw, 'name', true);
  if (!name.ok) return fail(REASON_CODES.INPUT_INVALID, 'Column name is required.');
  const systemName = readIdentifier(raw, 'systemName', false);
  if (!systemName.ok) return fail(REASON_CODES.INPUT_INVALID, 'Column systemName is invalid.');
  const type = readRequiredString(raw, 'type', 64);
  if (!type.ok) return fail(REASON_CODES.INPUT_INVALID, 'Column type is required.');

  const length = readOptionalInteger(raw, 'length', 0, 1_000_000);
  const precision = readOptionalInteger(raw, 'precision', 0, 63);
  const scale = readOptionalInteger(raw, 'scale', 0, 63);
  const nullable = readOptionalBoolean(raw, 'nullable');
  const primaryKey = readOptionalBoolean(raw, 'primaryKey');
  const ccsid = readOptionalString(raw, 'ccsid', 32);
  const collation = readOptionalString(raw, 'collation', 64);
  if (
    !length.ok ||
    !precision.ok ||
    !scale.ok ||
    !nullable.ok ||
    !primaryKey.ok ||
    !ccsid.ok ||
    !collation.ok
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Malformed column value.');
  }

  const typeUpper = type.value.toUpperCase();
  const isDecimal =
    typeUpper === 'DECIMAL' ||
    typeUpper === 'DEC' ||
    typeUpper === 'NUMERIC' ||
    typeUpper === 'PACKED';
  if (isDecimal) {
    // Reject invalid DECIMAL/PACKED metadata before any generation work.
    if (precision.value == null || !Number.isInteger(precision.value) || precision.value <= 0) {
      return fail(
        REASON_CODES.INPUT_INVALID,
        'DECIMAL/PACKED precision must be a positive integer.'
      );
    }
    if (scale.value == null || !Number.isInteger(scale.value) || scale.value < 0) {
      return fail(
        REASON_CODES.INPUT_INVALID,
        'DECIMAL/PACKED scale must be a non-negative integer.'
      );
    }
    if (scale.value > precision.value) {
      return fail(REASON_CODES.INPUT_INVALID, 'DECIMAL/PACKED scale must not exceed precision.');
    }
  }

  return {
    ok: true,
    value: {
      name: name.value,
      systemName: systemName.value,
      type: typeUpper,
      length: length.value,
      precision: precision.value,
      scale: scale.value,
      nullable: nullable.value === true,
      primaryKey: primaryKey.value === true,
      ccsid: ccsid.value,
      collation: collation.value,
    },
  };
}

function projectForeignKey(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Foreign key must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  const allowed = new Set([
    'name',
    'columns',
    'referencedSchema',
    'referencedTable',
    'referencedColumns',
  ]);
  for (const k of keys) {
    if (!allowed.has(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown foreign key field.');
    }
  }
  const name = readOptionalString(raw, 'name', LIMITS.maxIdentifierChars);
  if (!name.ok) return fail(REASON_CODES.INPUT_INVALID, 'Foreign key name is invalid.');

  const colsRead = requireOwnData(raw, 'columns', 'Foreign key columns are required.');
  if (!colsRead.ok) return colsRead;
  const colsArr = requireSafeArray(colsRead.value, 'Foreign key columns must be an array.');
  if (!colsArr.ok) return colsArr;
  // Only single-column FKs are supported by current evidence surface.
  if (colsArr.length !== 1) {
    return fail(REASON_CODES.INPUT_INVALID, 'Only single-column foreign keys are supported.');
  }
  const colName = colsArr.elements[0];
  if (
    typeof colName !== 'string' ||
    colName.length === 0 ||
    colName.length > LIMITS.maxIdentifierChars
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Foreign key column name is invalid.');
  }

  const refSchema = readIdentifier(raw, 'referencedSchema', false);
  const refTable = readIdentifier(raw, 'referencedTable', true);
  if (!refSchema.ok || !refTable.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Foreign key referenced table is invalid.');
  }
  const refColsRead = requireOwnData(
    raw,
    'referencedColumns',
    'Foreign key referencedColumns are required.'
  );
  if (!refColsRead.ok) return refColsRead;
  const refColsArr = requireSafeArray(
    refColsRead.value,
    'Foreign key referencedColumns must be a single-column array.'
  );
  if (!refColsArr.ok) return refColsArr;
  if (refColsArr.length !== 1) {
    return fail(
      REASON_CODES.INPUT_INVALID,
      'Foreign key referencedColumns must be a single-column array.'
    );
  }
  const refCol = refColsArr.elements[0];
  if (
    typeof refCol !== 'string' ||
    refCol.length === 0 ||
    refCol.length > LIMITS.maxIdentifierChars
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Foreign key referenced column is invalid.');
  }

  return {
    ok: true,
    value: {
      name: name.value,
      columns: [colName],
      referencedSchema: refSchema.value,
      referencedTable: refTable.value,
      referencedColumns: [refCol],
    },
  };
}

function _projectUniqueKey(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unique key must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  for (const k of keys) {
    if (k !== 'name' && k !== 'columns') {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown unique key field.');
    }
  }
  const name = readOptionalString(raw, 'name', LIMITS.maxIdentifierChars);
  if (!name.ok) return fail(REASON_CODES.INPUT_INVALID, 'Unique key name is invalid.');
  const colsRead = requireOwnData(raw, 'columns', 'Unique key columns are required.');
  if (!colsRead.ok) return colsRead;
  const ukColsArr = requireSafeArray(
    colsRead.value,
    'Unique key columns must be a non-empty array.'
  );
  if (!ukColsArr.ok) return ukColsArr;
  if (ukColsArr.length === 0) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unique key columns must be a non-empty array.');
  }
  if (ukColsArr.length > LIMITS.maxColumnsPerTable) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Unique key column count exceeded.');
  }
  const columns = [];
  for (let i = 0; i < ukColsArr.length; i += 1) {
    const c = ukColsArr.elements[i];
    if (typeof c !== 'string' || c.length === 0 || c.length > LIMITS.maxIdentifierChars) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unique key column name is invalid.');
    }
    columns.push(c);
  }
  return {
    ok: true,
    value: {
      name: name.value,
      columns,
    },
  };
}

function _projectCheckConstraint(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Check constraint must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  for (const k of keys) {
    if (k !== 'name' && k !== 'expression') {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown check constraint field.');
    }
  }
  const name = readOptionalString(raw, 'name', LIMITS.maxIdentifierChars);
  const expression = readOptionalString(raw, 'expression', LIMITS.maxExpressionUtf8Bytes);
  if (!name.ok || !expression.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Check constraint fields are invalid.');
  }
  if (
    expression.value != null &&
    utf8ByteLength(expression.value) > LIMITS.maxExpressionUtf8Bytes
  ) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Check expression exceeds UTF-8 byte bound.');
  }
  return {
    ok: true,
    value: {
      name: name.value,
      expression: expression.value,
    },
  };
}

function projectTable(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Table must be a plain object.');
  }
  visitState.visits += 1;
  if (visitState.visits > LIMITS.maxPropertyVisits) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input property visit limit exceeded.');
  }
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  const allowed = new Set([
    'schema',
    'name',
    'systemName',
    'columns',
    'foreignKeys',
    'sourceEvidence',
  ]);
  for (const k of keys) {
    // Catalog unique keys and CHECK constraints are not a supported evidence surface.
    if (k === 'uniqueKeys' || k === 'checkConstraints') {
      return fail(
        REASON_CODES.INPUT_INVALID,
        'Catalog uniqueKeys/checkConstraints are not part of the supported evidence surface.'
      );
    }
    if (!allowed.has(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown table field.');
    }
  }

  const schema = readIdentifier(raw, 'schema', false);
  const name = readIdentifier(raw, 'name', true);
  const systemName = readIdentifier(raw, 'systemName', false);
  if (!schema.ok || !name.ok || !systemName.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Table identity is invalid.');
  }

  const colsRead = requireOwnData(raw, 'columns', 'Table columns are required.');
  if (!colsRead.ok) return colsRead;
  const tableColsArr = requireSafeArray(colsRead.value, 'Table columns must be an array.');
  if (!tableColsArr.ok) return tableColsArr;
  if (tableColsArr.length === 0) {
    return fail(REASON_CODES.INPUT_INVALID, 'Table must have at least one column.');
  }
  if (tableColsArr.length > LIMITS.maxColumnsPerTable) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Column count per table exceeded.');
  }
  // +1 bound already covered by length check before expensive per-column work.

  const columns = [];
  const seenCols = new Set();
  for (let i = 0; i < tableColsArr.length; i += 1) {
    const projected = projectColumn(tableColsArr.elements[i], visitState, depth + 1);
    if (!projected.ok) return projected;
    const key = projected.value.name.toUpperCase();
    if (seenCols.has(key)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Duplicate column name in table.');
    }
    seenCols.add(key);
    columns.push(projected.value);
  }
  columns.sort((a, b) => strcmp(a.name.toUpperCase(), b.name.toUpperCase()));

  let foreignKeys = [];
  {
    const fkOpt = optionalOwnData(raw, 'foreignKeys');
    if (!fkOpt.ok) return fkOpt;
    if (fkOpt.present) {
      const fkArr = requireSafeArray(fkOpt.value, 'foreignKeys must be an array.');
      if (!fkArr.ok) return fkArr;
      for (let i = 0; i < fkArr.length; i += 1) {
        const projected = projectForeignKey(fkArr.elements[i], visitState, depth + 1);
        if (!projected.ok) return projected;
        // Local FK column must resolve against this table's columns.
        const local = projected.value.columns[0];
        if (!seenCols.has(String(local).toUpperCase())) {
          return fail(
            REASON_CODES.INPUT_INVALID,
            'Foreign key local column is not present on the table.'
          );
        }
        foreignKeys.push(projected.value);
      }
      foreignKeys = stableSortBy(
        foreignKeys,
        fk => `${(fk.name || '').toUpperCase()}|${fk.columns.join(',')}|${fk.referencedTable}`
      );
    }
  }

  let sourceEvidence = [];
  {
    const seOpt = optionalOwnData(raw, 'sourceEvidence');
    if (!seOpt.ok) return seOpt;
    if (seOpt.present) {
      const projected = projectSourceEvidence(seOpt.value, visitState);
      if (!projected.ok) return projected;
      sourceEvidence = projected.value;
    }
  }

  return {
    ok: true,
    value: {
      schema: schema.value,
      name: name.value,
      systemName: systemName.value,
      columns,
      foreignKeys,
      sourceEvidence,
    },
  };
}

/**
 * Complete normalized identity for manualRules sort + manualRulesSha256.
 * Must include every field present in the hashed payload so caller permutation
 * of tied id|expression|table rows cannot reorder hash/result.
 * Locale-independent via canonicalize (key-sorted, no localeCompare).
 */
function manualRuleHashIdentity(mr) {
  return {
    id: mr.id == null ? null : mr.id,
    expression: mr.expression,
    table: mr.table == null ? null : mr.table,
    schema: mr.schema == null ? null : mr.schema,
    note: mr.note == null ? null : mr.note,
    literalsAreSynthetic: mr.literalsAreSynthetic === true,
  };
}

function manualRuleSortKey(mr) {
  return canonicalize(manualRuleHashIdentity(mr));
}

/**
 * Complete normalized identity for codeConditions sort (all projected fields).
 */
function codeConditionHashIdentity(cc) {
  return {
    id: cc.id == null ? null : cc.id,
    expression: cc.expression,
    source: cc.source == null ? null : cc.source,
    table: cc.table == null ? null : cc.table,
    schema: cc.schema == null ? null : cc.schema,
    column: cc.column == null ? null : cc.column,
    literalsAreSynthetic: cc.literalsAreSynthetic === true,
  };
}

function codeConditionSortKey(cc) {
  return canonicalize(codeConditionHashIdentity(cc));
}

function projectCodeCondition(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Code condition must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  for (const k of keys) {
    if (
      !['id', 'expression', 'source', 'table', 'schema', 'column', 'literalsAreSynthetic'].includes(
        k
      )
    ) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown code condition field.');
    }
  }
  const id = readOptionalString(raw, 'id', 128);
  const expression = readRequiredString(raw, 'expression', LIMITS.maxExpressionUtf8Bytes);
  const source = readOptionalString(raw, 'source', 256);
  const table = readIdentifier(raw, 'table', false);
  const schema = readIdentifier(raw, 'schema', false);
  const column = readIdentifier(raw, 'column', false);
  const litSyn = readOptionalBoolean(raw, 'literalsAreSynthetic');
  if (
    !id.ok ||
    !expression.ok ||
    !source.ok ||
    !table.ok ||
    !schema.ok ||
    !column.ok ||
    !litSyn.ok
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'Malformed code condition.');
  }
  if (utf8ByteLength(expression.value) > LIMITS.maxExpressionUtf8Bytes) {
    return fail(
      REASON_CODES.BOUNDS_EXCEEDED,
      'Code condition expression exceeds UTF-8 byte bound.'
    );
  }
  return {
    ok: true,
    value: {
      id: id.value,
      expression: expression.value,
      source: source.value,
      table: table.value,
      schema: schema.value,
      column: column.value,
      literalsAreSynthetic: litSyn.value === true,
    },
  };
}

function projectManualRule(raw, visitState, depth) {
  if (depth > LIMITS.maxTraversalDepth) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Input traversal depth exceeded.');
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Manual rule must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  for (const k of keys) {
    if (!['id', 'expression', 'table', 'schema', 'note', 'literalsAreSynthetic'].includes(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown manual rule field.');
    }
  }
  const id = readOptionalString(raw, 'id', 128);
  const expression = readRequiredString(raw, 'expression', LIMITS.maxExpressionUtf8Bytes);
  const table = readIdentifier(raw, 'table', false);
  const schema = readIdentifier(raw, 'schema', false);
  const note = readOptionalString(raw, 'note', 256);
  const litSyn = readOptionalBoolean(raw, 'literalsAreSynthetic');
  if (!id.ok || !expression.ok || !table.ok || !schema.ok || !note.ok || !litSyn.ok) {
    return fail(REASON_CODES.INPUT_INVALID, 'Malformed manual rule.');
  }
  if (utf8ByteLength(expression.value) > LIMITS.maxExpressionUtf8Bytes) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manual rule expression exceeds UTF-8 byte bound.');
  }
  return {
    ok: true,
    value: {
      id: id.value,
      expression: expression.value,
      table: table.value,
      schema: schema.value,
      note: note.value,
      provenance: 'manual',
      literalsAreSynthetic: litSyn.value === true,
    },
  };
}

function projectOptions(raw, visitState) {
  if (raw == null) {
    return {
      ok: true,
      value: {
        runId: null,
        frameworks: [],
        writeArtifacts: false,
      },
    };
  }
  if (!isPlainDataObject(raw)) {
    return fail(REASON_CODES.INPUT_INVALID, 'options must be a plain object.');
  }
  visitState.visits += 1;
  const keyInsp = inspectObjectKeys(raw);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;
  for (const k of keys) {
    if (!['runId', 'frameworks', 'writeArtifacts'].includes(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown options field.');
    }
  }
  const runId = readOptionalString(raw, 'runId', LIMITS.maxRunIdChars);
  if (!runId.ok) return fail(REASON_CODES.INPUT_INVALID, 'options.runId is invalid.');
  let frameworks = [];
  {
    const fwOpt = optionalOwnData(raw, 'frameworks');
    if (!fwOpt.ok) return fwOpt;
    if (fwOpt.present) {
      const fwArr = requireSafeArray(fwOpt.value, 'options.frameworks must be an array.');
      if (!fwArr.ok) return fwArr;
      for (let i = 0; i < fwArr.length; i += 1) {
        const fw = fwArr.elements[i];
        if (typeof fw !== 'string' || !FRAMEWORK_SET.has(fw)) {
          return fail(REASON_CODES.INPUT_INVALID, 'Unknown or disallowed framework export id.');
        }
        if (!frameworks.includes(fw)) frameworks.push(fw);
      }
      frameworks.sort(strcmp);
    }
  }
  let writeArtifacts = false;
  {
    const wOpt = optionalOwnData(raw, 'writeArtifacts');
    if (!wOpt.ok) return wOpt;
    if (wOpt.present) {
      if (typeof wOpt.value !== 'boolean') {
        return fail(REASON_CODES.INPUT_INVALID, 'options.writeArtifacts must be a boolean.');
      }
      writeArtifacts = wOpt.value === true;
    }
  }
  return {
    ok: true,
    value: {
      runId: runId.value,
      frameworks,
      writeArtifacts,
    },
  };
}

/**
 * Strict schema projection of the built-in request contract.
 * Rejects accessors, inherited fields, dangerous keys, cycles (via visit bound),
 * row-like fields, and malformed values. Never throws raw errors to callers.
 */
function projectRequest(input) {
  // Cheap size estimate before deep projection — fails +1 bounds early.
  const size = estimateSerializedBytes(input, LIMITS);
  if (!size.ok) {
    return fail(
      size.code === 'BOUNDS_EXCEEDED' ? REASON_CODES.BOUNDS_EXCEEDED : REASON_CODES.INPUT_INVALID,
      'Input size or structure is outside allowed bounds.'
    );
  }
  if (size.bytes > LIMITS.maxRawInputBytes) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Raw input exceeds 2 MiB bound.');
  }

  if (!isPlainDataObject(input)) {
    return fail(REASON_CODES.INPUT_INVALID, 'Request must be a plain object.');
  }

  const visitState = { visits: 0 };
  const keyInsp = inspectObjectKeys(input);
  if (!keyInsp.ok) return keyInsp;
  const keys = keyInsp.keys;

  const allowedTop = new Set([
    'contractId',
    'contractVersion',
    'schemaVersion',
    'kind',
    'evidence',
    'codeConditions',
    'manualRules',
    'options',
    'provenanceAnchor',
  ]);
  for (const k of keys) {
    if (!allowedTop.has(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown request field.');
    }
  }

  // Contract identity is required (never silently defaulted).
  const contractId = requireOwnData(input, 'contractId', 'contractId is required.');
  if (!contractId.ok) return contractId;
  if (contractId.value !== REQUEST_CONTRACT_ID) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported request contract id.');
  }
  const contractVersion = requireOwnData(input, 'contractVersion', 'contractVersion is required.');
  if (!contractVersion.ok) return contractVersion;
  if (contractVersion.value !== REQUEST_CONTRACT_VERSION) {
    return fail(REASON_CODES.INPUT_INVALID, 'Unsupported request contract version.');
  }

  // Required provenance anchor (technical only).
  const anchorRead = requireOwnData(input, 'provenanceAnchor', 'provenanceAnchor is required.');
  if (!anchorRead.ok) return anchorRead;
  if (!isPlainDataObject(anchorRead.value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'provenanceAnchor must be a plain object.');
  }
  const anchorInsp = inspectObjectKeys(anchorRead.value);
  if (!anchorInsp.ok) return anchorInsp;
  const anchorAllowed = new Set([
    'communitySha',
    'adapterId',
    'adapterVersion',
    'evidenceArtifactSha256',
    'sourceFingerprint',
  ]);
  for (const k of anchorInsp.keys) {
    if (!anchorAllowed.has(k)) {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown provenanceAnchor field.');
    }
  }
  const communitySha = requireOwnData(
    anchorRead.value,
    'communitySha',
    'communitySha is required.'
  );
  if (!communitySha.ok) return communitySha;
  if (typeof communitySha.value !== 'string' || communitySha.value !== PINNED_COMMUNITY_SHA) {
    return fail(REASON_CODES.INPUT_INVALID, 'communitySha must match the pinned Community commit.');
  }
  const adapterId = requireOwnData(anchorRead.value, 'adapterId', 'adapterId is required.');
  if (!adapterId.ok) return adapterId;
  if (
    typeof adapterId.value !== 'string' ||
    adapterId.value.length === 0 ||
    adapterId.value.length > LIMITS.maxAdapterIdChars ||
    !/^[A-Za-z0-9._:-]+$/.test(adapterId.value)
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'adapterId is invalid.');
  }
  const adapterVersion = requireOwnData(
    anchorRead.value,
    'adapterVersion',
    'adapterVersion is required.'
  );
  if (!adapterVersion.ok) return adapterVersion;
  if (
    typeof adapterVersion.value !== 'string' ||
    adapterVersion.value.length === 0 ||
    adapterVersion.value.length > LIMITS.maxAdapterVersionChars ||
    !/^[A-Za-z0-9._+-]+$/.test(adapterVersion.value)
  ) {
    return fail(REASON_CODES.INPUT_INVALID, 'adapterVersion is invalid.');
  }
  const evidenceSha = requireOwnData(
    anchorRead.value,
    'evidenceArtifactSha256',
    'evidenceArtifactSha256 is required.'
  );
  if (!evidenceSha.ok) return evidenceSha;
  if (typeof evidenceSha.value !== 'string' || !/^[a-f0-9]{64}$/.test(evidenceSha.value)) {
    return fail(
      REASON_CODES.INPUT_INVALID,
      'evidenceArtifactSha256 must be a lowercase SHA-256 hex digest.'
    );
  }
  let sourceFingerprint = null;
  {
    const fpOpt = optionalOwnData(anchorRead.value, 'sourceFingerprint');
    if (!fpOpt.ok) return fpOpt;
    if (fpOpt.present) {
      if (typeof fpOpt.value !== 'string' || !/^[a-f0-9]{64}$/.test(fpOpt.value)) {
        return fail(
          REASON_CODES.INPUT_INVALID,
          'sourceFingerprint must be a lowercase SHA-256 hex digest.'
        );
      }
      sourceFingerprint = fpOpt.value;
    }
  }

  const evidenceRead = requireOwnData(input, 'evidence', 'evidence is required.');
  if (!evidenceRead.ok) return evidenceRead;
  if (!isPlainDataObject(evidenceRead.value)) {
    return fail(REASON_CODES.INPUT_INVALID, 'evidence must be a plain object.');
  }
  const evidenceKeyInsp = inspectObjectKeys(evidenceRead.value);
  if (!evidenceKeyInsp.ok) return evidenceKeyInsp;
  const evidenceKeys = evidenceKeyInsp.keys;
  for (const k of evidenceKeys) {
    if (k !== 'tables') {
      return fail(REASON_CODES.INPUT_INVALID, 'Unknown evidence field.');
    }
  }
  const tablesRead = requireOwnData(evidenceRead.value, 'tables', 'evidence.tables is required.');
  if (!tablesRead.ok) return tablesRead;
  const tablesArr = requireSafeArray(tablesRead.value, 'evidence.tables must be an array.');
  if (!tablesArr.ok) return tablesArr;
  if (tablesArr.length === 0) {
    return fail(REASON_CODES.INPUT_INVALID, 'At least one table is required.');
  }
  if (tablesArr.length > LIMITS.maxTables) {
    return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Table count exceeded.');
  }

  const tables = [];
  let constraintCount = 0;
  for (let i = 0; i < tablesArr.length; i += 1) {
    const projected = projectTable(tablesArr.elements[i], visitState, 1);
    if (!projected.ok) return projected;
    constraintCount += projected.value.foreignKeys.length;
    if (constraintCount > LIMITS.maxConstraintsTotal) {
      return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Total constraint count exceeded.');
    }
    tables.push(projected.value);
  }
  tables.sort((a, b) => {
    const sa = `${(a.schema || '').toUpperCase()}|${a.name.toUpperCase()}`;
    const sb = `${(b.schema || '').toUpperCase()}|${b.name.toUpperCase()}`;
    return strcmp(sa, sb);
  });

  // When referenced tables are present in evidence, validate FK referenced columns.
  const tableByKey = new Map();
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    tableByKey.set(`${(t.schema || '').toUpperCase()}|${t.name.toUpperCase()}`, t);
  }
  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    for (let f = 0; f < t.foreignKeys.length; f += 1) {
      const fk = t.foreignKeys[f];
      const refKey = `${(fk.referencedSchema || '').toUpperCase()}|${String(fk.referencedTable).toUpperCase()}`;
      const refTable = tableByKey.get(refKey);
      if (refTable) {
        const colSet = new Set(refTable.columns.map(c => c.name.toUpperCase()));
        if (!colSet.has(String(fk.referencedColumns[0]).toUpperCase())) {
          return fail(
            REASON_CODES.INPUT_INVALID,
            'Foreign key referenced column is not present on the referenced table evidence.'
          );
        }
      }
    }
  }

  let codeConditions = [];
  {
    const ccOpt = optionalOwnData(input, 'codeConditions');
    if (!ccOpt.ok) return ccOpt;
    if (ccOpt.present) {
      const ccArr = requireSafeArray(ccOpt.value, 'codeConditions must be an array.');
      if (!ccArr.ok) return ccArr;
      if (ccArr.length > LIMITS.maxCodeConditions) {
        return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Code condition count exceeded.');
      }
      for (let i = 0; i < ccArr.length; i += 1) {
        const projected = projectCodeCondition(ccArr.elements[i], visitState, 1);
        if (!projected.ok) return projected;
        codeConditions.push(projected.value);
      }
      // Complete normalized identity (all projected fields that affect semantics).
      codeConditions = stableSortBy(codeConditions, codeConditionSortKey);
    }
  }

  let manualRules = [];
  {
    const mrOpt = optionalOwnData(input, 'manualRules');
    if (!mrOpt.ok) return mrOpt;
    if (mrOpt.present) {
      const mrArr = requireSafeArray(mrOpt.value, 'manualRules must be an array.');
      if (!mrArr.ok) return mrArr;
      if (mrArr.length > LIMITS.maxManualRules) {
        return fail(REASON_CODES.BOUNDS_EXCEEDED, 'Manual rule count exceeded.');
      }
      for (let i = 0; i < mrArr.length; i += 1) {
        const projected = projectManualRule(mrArr.elements[i], visitState, 1);
        if (!projected.ok) return projected;
        manualRules.push(projected.value);
      }
      // Sort key = complete normalized hashed identity (must match manualRulesSha256 payload).
      manualRules = stableSortBy(manualRules, manualRuleSortKey);
    }
  }

  // Deterministic SHA-256 of normalized manual-rule set (never trust a caller claim).
  // Payload fields must stay in lockstep with manualRuleSortKey.
  const manualRulesSha256 = sha256Text(canonicalize(manualRules.map(manualRuleHashIdentity)));

  let options = {
    runId: null,
    frameworks: [],
    writeArtifacts: false,
  };
  {
    const optOpt = optionalOwnData(input, 'options');
    if (!optOpt.ok) return optOpt;
    if (optOpt.present) {
      const projected = projectOptions(optOpt.value, visitState);
      if (!projected.ok) return projected;
      options = projected.value;
    }
  }

  const provenanceAnchor = {
    communitySha: PINNED_COMMUNITY_SHA,
    adapterId: adapterId.value,
    adapterVersion: adapterVersion.value,
    evidenceArtifactSha256: evidenceSha.value,
    manualRulesSha256,
    sourceFingerprint,
  };

  return {
    ok: true,
    value: {
      contractId: REQUEST_CONTRACT_ID,
      contractVersion: REQUEST_CONTRACT_VERSION,
      evidence: { tables },
      codeConditions,
      manualRules,
      options,
      provenanceAnchor,
    },
  };
}

module.exports = {
  projectRequest,
};
