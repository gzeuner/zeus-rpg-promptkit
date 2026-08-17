'use strict';

const {
  RESULT_CONTRACT_ID,
  RESULT_CONTRACT_VERSION,
  RESULT_CONTRACT_REF,
  REASON_CODES,
  SUPPORT_STATUS,
  GAP_KINDS,
  VECTOR_CATEGORIES,
  EXPECTED_OUTCOMES,
  PROVENANCE_KINDS,
  NON_CLAIMS,
  LIMITS,
} = require('./constants');
const {
  sha256Text,
  canonicalize,
  stableSortBy,
  stableSortStrings,
  utf8ByteLength,
} = require('./util');
const {
  parseExpression,
  deriveVectorsFromAst,
  PARSE_REASONS,
  collectIdentifiers,
} = require('./parser');
const {
  isCharType,
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
} = require('./values');
const { scanAssignmentsForLiterals, astHasAnyLiteral } = require('./literalPolicy');

function tableKey(table) {
  const schema = table.schema ? String(table.schema).toUpperCase() : '';
  return `${schema}|${String(table.name).toUpperCase()}`;
}

function columnRef(table, columnName) {
  const schema = table.schema ? `${table.schema}.` : '';
  return `${schema}${table.name}.${columnName}`;
}

function normalizeAssignmentValue(raw) {
  if (raw === null) return null;
  if (typeof raw === 'object' && raw !== null && raw.kind) {
    if (raw.kind === 'decimal-string' || raw.kind === 'number') {
      return { kind: 'decimal-string', value: String(raw.value) };
    }
    return { kind: String(raw.kind), value: raw.value == null ? null : String(raw.value) };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Avoid float path for generation outputs — generator should pass strings.
    return { kind: 'decimal-string', value: String(raw) };
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw };
  }
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw ? 'true' : 'false' };
  }
  return { kind: 'string', value: String(raw) };
}

function stableAssignmentsObject(assignments) {
  const out = {};
  const keys = stableSortStrings(Object.keys(assignments || {}));
  for (const key of keys) {
    out[key] = normalizeAssignmentValue(assignments[key]);
  }
  return out;
}

function _assignmentIdentity(assignments) {
  return canonicalize(stableAssignmentsObject(assignments));
}

function _expectationIdentity(expectation) {
  return canonicalize({
    outcome: expectation.outcome,
    technical: expectation.technical || null,
  });
}

function buildVectorId({ category, table, assignments, expectation }) {
  const payload = canonicalize({
    category,
    table: table ? tableKey(table) : '',
    assignments: stableAssignmentsObject(assignments),
    expectation: {
      outcome: expectation.outcome,
      technical: expectation.technical || null,
    },
  });
  return sha256Text(payload).slice(0, 32);
}

function semanticDedupeKey({ category, table, assignments, expectation }) {
  // Ignores provenance — merges provenance reasons only for same expected outcome.
  return canonicalize({
    category,
    table: table ? tableKey(table) : '',
    assignments: stableAssignmentsObject(assignments),
    expectation: {
      outcome: expectation.outcome,
      technical: expectation.technical || null,
    },
  });
}

/**
 * Bound generator-produced technical strings without silent semantic drop of
 * distinct identity: oversize values become a stable content hash.
 * (Caller free-text rationale/expression is enforced separately as hard fail.)
 */
function boundGeneratorString(text, maxLen) {
  const s = String(text);
  if (s.length <= maxLen) return s;
  return `h:${sha256Text(s)}`;
}

/** Generator-internal provenance — kinds/reasons are fixed templates + technical ids. */
function makeProvenance(kind, reason, source = null) {
  return {
    ok: true,
    value: {
      kind: String(kind),
      reason: boundGeneratorString(reason, 512),
      source: source == null ? null : boundGeneratorString(source, 256),
    },
  };
}

function makeGap({ kind, message, table = null, column = null, detail = null }) {
  return {
    ok: true,
    value: {
      kind: String(kind),
      message: boundGeneratorString(message, 512),
      table: table ? tableKey(table) : null,
      column: column == null ? null : boundGeneratorString(column, LIMITS.maxIdentifierChars),
      detail: detail == null ? null : boundGeneratorString(detail, 256),
    },
  };
}

function makeDiagnostic(code, message) {
  return {
    ok: true,
    value: {
      code: boundGeneratorString(code, 128),
      message: boundGeneratorString(message, 512),
    },
  };
}

const OVERFLOW_RESULT = Object.freeze({
  ok: false,
  reasonCode: REASON_CODES.SEMANTIC_OVERFLOW,
  message: 'Semantic overflow; generation rejected without truncated result.',
});

/**
 * Core deterministic generator. Same normalized evidence/rules/options →
 * byte-identical canonical result (via stable ordering and hashing).
 * Semantic overflow fails closed — never returns a truncated ok:true result.
 */
function generateVectorSet(projectedRequest) {
  const vectorsByKey = new Map();
  const gaps = [];
  const diagnostics = [];
  let overflowed = false;

  function markOverflow() {
    overflowed = true;
  }

  function addDiagnostic(diagResult) {
    if (overflowed) return false;
    if (!diagResult || diagResult.overflow || !diagResult.ok) {
      markOverflow();
      return false;
    }
    if (diagnostics.length >= LIMITS.maxDiagnostics) {
      markOverflow();
      return false;
    }
    diagnostics.push(diagResult.value);
    return true;
  }

  function addGap(gapResult) {
    if (overflowed) return false;
    if (!gapResult || gapResult.overflow || !gapResult.ok) {
      markOverflow();
      return false;
    }
    if (gaps.length >= LIMITS.maxGaps) {
      markOverflow();
      return false;
    }
    gaps.push(gapResult.value);
    return true;
  }

  function addVector(partial) {
    if (overflowed) return false;

    const assignments = stableAssignmentsObject(partial.assignments || {});
    const expectation = {
      outcome: partial.expectation.outcome,
      technical: partial.expectation.technical || null,
    };
    const category = partial.category;
    const table = partial.table || null;
    const key = semanticDedupeKey({ category, table, assignments, expectation });

    const provenanceIn = Array.isArray(partial.provenance) ? partial.provenance : [];
    // Resolve provenance entries that may still be makeProvenance results
    const provenance = [];
    for (let i = 0; i < provenanceIn.length; i += 1) {
      const p = provenanceIn[i];
      if (p && p.ok === true && p.value) {
        provenance.push(p.value);
      } else if (p && p.overflow) {
        markOverflow();
        return false;
      } else if (p && typeof p.kind === 'string') {
        provenance.push(p);
      } else {
        markOverflow();
        return false;
      }
    }
    if (provenance.length > LIMITS.maxProvenanceReasonsPerVector) {
      markOverflow();
      return false;
    }

    const assumptionsRaw = Array.isArray(partial.assumptions) ? partial.assumptions : [];
    const assumptions = [];
    for (let i = 0; i < assumptionsRaw.length; i += 1) {
      const a = String(assumptionsRaw[i]);
      // Fixed generator strings only; oversize is overflow, never silent truncate.
      if (a.length > 256) {
        markOverflow();
        return false;
      }
      assumptions.push(a);
    }
    if (assumptions.length > 32) {
      markOverflow();
      return false;
    }

    const rationale = String(partial.rationale || '');
    if (utf8ByteLength(rationale) > LIMITS.maxRationaleUtf8Bytes) {
      markOverflow();
      return false;
    }

    const supportStatus = partial.supportStatus || SUPPORT_STATUS.SUPPORTED;

    if (vectorsByKey.has(key)) {
      const existing = vectorsByKey.get(key);
      // Never merge different expected outcomes (key includes expectation).
      const seen = new Set(existing.provenance.map(p => canonicalize(p)));
      for (let i = 0; i < provenance.length; i += 1) {
        const p = provenance[i];
        const ck = canonicalize(p);
        if (seen.has(ck)) continue;
        if (existing.provenance.length >= LIMITS.maxProvenanceReasonsPerVector) {
          markOverflow();
          return false;
        }
        seen.add(ck);
        existing.provenance.push(p);
      }
      existing.provenance = stableSortBy(
        existing.provenance,
        p => `${p.kind}|${p.reason}|${p.source || ''}`
      );

      const aSet = new Set(existing.assumptions);
      for (let i = 0; i < assumptions.length; i += 1) {
        const a = assumptions[i];
        if (aSet.has(a)) continue;
        if (existing.assumptions.length >= 32) {
          markOverflow();
          return false;
        }
        aSet.add(a);
        existing.assumptions.push(a);
      }
      existing.assumptions = stableSortStrings(existing.assumptions);
      return true;
    }

    if (vectorsByKey.size >= LIMITS.maxVectors) {
      markOverflow();
      return false;
    }

    const id = buildVectorId({ category, table, assignments, expectation });
    const vector = {
      id,
      category,
      table: table
        ? {
            schema: table.schema || null,
            name: table.name,
          }
        : null,
      input: {
        assignments,
      },
      expectation: {
        outcome: expectation.outcome,
        technical: expectation.technical,
        // Business validity always unknown for generated technical vectors
        business: 'unknown',
      },
      rationale,
      provenance: stableSortBy(provenance, p => `${p.kind}|${p.reason}|${p.source || ''}`),
      assumptions: stableSortStrings(assumptions),
      supportStatus,
    };
    vectorsByKey.set(key, vector);
    return true;
  }

  const tables = projectedRequest.evidence.tables;

  tableLoop: for (const table of tables) {
    if (overflowed) break;
    // Column-level technical vectors
    for (const column of table.columns) {
      const colRef = columnRef(table, column.name);

      // CCSID / collation gaps — never invent behavior
      if (column.ccsid) {
        addGap(
          makeGap({
            kind: GAP_KINDS.UNSUPPORTED_CCSID,
            message: 'CCSID is present in evidence but encoding behavior is not simulated.',
            table,
            column: column.name,
            detail: column.ccsid,
          })
        );
      }
      if (column.collation) {
        addGap(
          makeGap({
            kind: GAP_KINDS.UNSUPPORTED_COLLATION,
            message: 'Collation is present in evidence but comparison behavior is not simulated.',
            table,
            column: column.name,
            detail: column.collation,
          })
        );
      }

      // Defaults are never evidenced by the pinned Community surface — always a gap.
      addGap(
        makeGap({
          kind: GAP_KINDS.MISSING_DEFAULT,
          message: 'No evidenced default for column; default behavior not inferred.',
          table,
          column: column.name,
        })
      );

      // Nullability
      if (column.nullable) {
        addVector({
          category: VECTOR_CATEGORIES.NULLABILITY,
          table,
          assignments: { [colRef]: null },
          expectation: {
            outcome: EXPECTED_OUTCOMES.ACCEPT,
            technical: 'nullable-accepts-null',
          },
          rationale: `Nullable column ${colRef} accepts null.`,
          provenance: [
            makeProvenance(PROVENANCE_KINDS.CATALOG, `nullable=true for ${column.name}`, colRef),
          ],
          assumptions: [],
          supportStatus: SUPPORT_STATUS.SUPPORTED,
        });
      } else {
        addVector({
          category: VECTOR_CATEGORIES.NULLABILITY,
          table,
          assignments: { [colRef]: null },
          expectation: {
            outcome: EXPECTED_OUTCOMES.REJECT,
            technical: 'not-null-rejects-null',
          },
          rationale: `Non-null column ${colRef} rejects null.`,
          provenance: [
            makeProvenance(PROVENANCE_KINDS.CATALOG, `nullable=false for ${column.name}`, colRef),
          ],
          assumptions: [],
          supportStatus: SUPPORT_STATUS.SUPPORTED,
        });
      }

      // String boundaries
      if (isCharType(column.type)) {
        const sb = stringBoundaryCases(column);
        if (sb.materializationGap) {
          addGap(
            makeGap({
              kind: GAP_KINDS.MATERIALIZATION_LIMIT,
              message:
                'Declared string length exceeds materialization bound; max+1 reject not claimed.',
              table,
              column: column.name,
              detail: String(sb.declaredLength),
            })
          );
        }
        for (const c of sb.cases) {
          addVector({
            category: VECTOR_CATEGORIES.STRING_LENGTH,
            table,
            assignments: { [colRef]: assignmentValue('string', c.value) },
            expectation: {
              outcome:
                c.expected === 'accept'
                  ? EXPECTED_OUTCOMES.ACCEPT
                  : c.expected === 'reject'
                    ? EXPECTED_OUTCOMES.REJECT
                    : EXPECTED_OUTCOMES.UNKNOWN,
              technical: c.label,
            },
            rationale: `String length case ${c.label} for ${colRef}.`,
            provenance: [
              makeProvenance(
                PROVENANCE_KINDS.CATALOG,
                `type=${column.type} length=${column.length == null ? 'unknown' : column.length}`,
                colRef
              ),
            ],
            assumptions: ['CCSID/collation not applied.'],
            supportStatus: SUPPORT_STATUS.SUPPORTED,
          });
        }
      } else if (isDecimalType(column.type)) {
        for (const c of decimalBoundaryCases(column)) {
          const outcome =
            c.expected === 'accept'
              ? EXPECTED_OUTCOMES.ACCEPT
              : c.expected === 'reject'
                ? EXPECTED_OUTCOMES.REJECT
                : EXPECTED_OUTCOMES.UNKNOWN;
          addVector({
            category: VECTOR_CATEGORIES.DECIMAL_BOUNDARY,
            table,
            assignments: { [colRef]: assignmentValue('decimal', c.value) },
            expectation: {
              outcome,
              technical: c.label,
            },
            rationale: c.note || `Decimal boundary ${c.label} for ${colRef}.`,
            provenance: [
              makeProvenance(
                PROVENANCE_KINDS.CATALOG,
                `type=${column.type} precision=${column.precision} scale=${column.scale}`,
                colRef
              ),
            ],
            assumptions: [
              'Decimal values are lossless strings; no floating-point arithmetic.',
              'Business rounding mode is unknown.',
            ],
            supportStatus:
              outcome === EXPECTED_OUTCOMES.UNKNOWN
                ? SUPPORT_STATUS.UNKNOWN_BUSINESS_VALIDITY
                : SUPPORT_STATUS.SUPPORTED,
          });
        }
      } else if (isIntegerType(column.type)) {
        const b = integerBounds(column.type);
        const cases = [
          { label: 'zero', value: '0', expected: EXPECTED_OUTCOMES.ACCEPT },
          { label: 'max', value: b.max, expected: EXPECTED_OUTCOMES.ACCEPT },
          { label: 'min', value: b.min, expected: EXPECTED_OUTCOMES.ACCEPT },
          { label: 'overflow', value: b.overflow, expected: EXPECTED_OUTCOMES.REJECT },
          { label: 'underflow', value: b.underflow, expected: EXPECTED_OUTCOMES.REJECT },
        ];
        for (const c of cases) {
          addVector({
            category: VECTOR_CATEGORIES.TYPE_BOUNDARY,
            table,
            assignments: { [colRef]: assignmentValue('integer', c.value) },
            expectation: { outcome: c.expected, technical: c.label },
            rationale: `Integer boundary ${c.label} for ${colRef}.`,
            provenance: [makeProvenance(PROVENANCE_KINDS.CATALOG, `type=${column.type}`, colRef)],
            assumptions: [],
            supportStatus: SUPPORT_STATUS.SUPPORTED,
          });
        }
      } else if (
        isDateType(column.type) ||
        isTimeType(column.type) ||
        isTimestampType(column.type)
      ) {
        const tb = temporalBoundaryCases(column);
        if (tb.fractionalPrecisionGap) {
          addGap(
            makeGap({
              kind: GAP_KINDS.TEMPORAL_PRECISION,
              message:
                'Timestamp fractional precision not evidenced; only zero-fraction boundaries claimed.',
              table,
              column: column.name,
            })
          );
        }
        for (const c of tb.cases) {
          const kind = isDateType(column.type)
            ? 'date'
            : isTimeType(column.type)
              ? 'time'
              : 'timestamp';
          addVector({
            category: VECTOR_CATEGORIES.TEMPORAL_BOUNDARY,
            table,
            assignments: { [colRef]: assignmentValue(kind, c.value) },
            expectation: {
              outcome:
                c.expected === 'accept' ? EXPECTED_OUTCOMES.ACCEPT : EXPECTED_OUTCOMES.REJECT,
              technical: c.label,
            },
            rationale: `Temporal boundary ${c.label} for ${colRef} (locale-independent literal).`,
            provenance: [makeProvenance(PROVENANCE_KINDS.CATALOG, `type=${column.type}`, colRef)],
            assumptions: ['No timezone conversion; literals are fixed technical forms.'],
            supportStatus: SUPPORT_STATUS.SUPPORTED,
          });
        }
      } else {
        addGap(
          makeGap({
            kind: GAP_KINDS.UNSUPPORTED_TYPE,
            message: 'Column type has no specialized boundary generator.',
            table,
            column: column.name,
            detail: column.type,
          })
        );
      }

      // Always note unknown business validity for the column domain
      addGap(
        makeGap({
          kind: GAP_KINDS.UNKNOWN_BUSINESS,
          message: 'Business validity of column values is unknown.',
          table,
          column: column.name,
        })
      );
    }

    // Primary key: only independent single-column PK scenarios.
    // Multiple primaryKey flags are NOT treated as a composite key.
    const pkCols = table.columns.filter(c => c.primaryKey).map(c => c.name);
    if (pkCols.length > 1) {
      addGap(
        makeGap({
          kind: GAP_KINDS.MISSING_COMPOSITE_KEY,
          message:
            'Multiple primaryKey flags present without composite-key evidence; composite scenarios not inferred.',
          table,
          detail: pkCols.join(','),
        })
      );
    }
    for (let p = 0; p < pkCols.length; p += 1) {
      const colRef = columnRef(table, pkCols[p]);
      addVector({
        category: VECTOR_CATEGORIES.PRIMARY_KEY,
        table,
        assignments: { [colRef]: assignmentValue('string', '1') },
        expectation: {
          outcome: EXPECTED_OUTCOMES.ACCEPT,
          technical: 'pk-non-null-value',
        },
        rationale: `Single-column primary key flag on ${colRef} requires a non-null technical value.`,
        provenance: [
          makeProvenance(PROVENANCE_KINDS.CATALOG, `primaryKey on ${pkCols[p]}`, colRef),
        ],
        assumptions: [
          'No real-row existence claim or uniqueness lookup against a database.',
          'Synthetic technical value only.',
          'Independent single-column PK flag; not a composite key claim.',
        ],
        supportStatus: SUPPORT_STATUS.SUPPORTED,
      });
      addVector({
        category: VECTOR_CATEGORIES.PRIMARY_KEY,
        table,
        assignments: { [colRef]: null },
        expectation: {
          outcome: EXPECTED_OUTCOMES.REJECT,
          technical: 'pk-rejects-null',
        },
        rationale: `Primary key flag on ${colRef} rejects null.`,
        provenance: [
          makeProvenance(PROVENANCE_KINDS.CATALOG, `primaryKey on ${pkCols[p]}`, colRef),
        ],
        assumptions: ['No real-row lookup performed.'],
        supportStatus: SUPPORT_STATUS.SUPPORTED,
      });
    }

    // Foreign keys — single-column only (enforced at projection)
    for (const fk of table.foreignKeys) {
      const local = fk.columns[0];
      const colRef = columnRef(table, local);
      addVector({
        category: VECTOR_CATEGORIES.FOREIGN_KEY,
        table,
        assignments: { [colRef]: assignmentValue('string', '1') },
        expectation: {
          outcome: EXPECTED_OUTCOMES.UNKNOWN,
          technical: 'fk-value-without-parent-lookup',
        },
        rationale: `Foreign key ${colRef} → ${fk.referencedTable}.${fk.referencedColumns[0]} has catalog evidence but parent existence is not looked up.`,
        provenance: [
          makeProvenance(
            PROVENANCE_KINDS.CATALOG,
            `FK ${local} references ${fk.referencedSchema || ''}.${fk.referencedTable}.${fk.referencedColumns[0]}`,
            colRef
          ),
        ],
        assumptions: [
          'No database execution or parent-row lookup.',
          'Synthetic technical value only; not a customer identifier payload.',
        ],
        supportStatus: SUPPORT_STATUS.UNKNOWN_BUSINESS_VALIDITY,
      });
      addVector({
        category: VECTOR_CATEGORIES.FOREIGN_KEY,
        table,
        assignments: { [colRef]: null },
        expectation: {
          outcome: EXPECTED_OUTCOMES.UNKNOWN,
          technical: 'fk-null-depends-on-nullability',
        },
        rationale: `Null FK value depends on column nullability; referential action not executed.`,
        provenance: [
          makeProvenance(PROVENANCE_KINDS.CATALOG, `FK null scenario for ${local}`, colRef),
        ],
        assumptions: ['Referential integrity not enforced by this generator.'],
        supportStatus: SUPPORT_STATUS.UNKNOWN_BUSINESS_VALIDITY,
      });
    }

    // Unique keys are not part of the supported evidence surface.
    addGap(
      makeGap({
        kind: GAP_KINDS.MISSING_UNIQUE,
        message: 'No unique key evidence on the supported surface; unique scenarios not inferred.',
        table,
      })
    );

    // Catalog CHECK is not part of the supported evidence surface.
    addGap(
      makeGap({
        kind: GAP_KINDS.MISSING_CHECK,
        message:
          'No catalog CHECK on the supported evidence surface; CHECK vectors require codeConditions or manualRules.',
        table,
      })
    );

    // Source evidence is technical provenance only
    for (const se of table.sourceEvidence) {
      if (overflowed) break tableLoop;
      if (
        !addDiagnostic(
          makeDiagnostic(
            'SOURCE_EVIDENCE',
            `Recorded technical source evidence ${se.kind || 'source'}:${se.ref || ''}`
          )
        )
      ) {
        break tableLoop;
      }
    }
  }

  // Code conditions (CHECK only; provenance code — never catalog)
  for (const cc of projectedRequest.codeConditions) {
    if (overflowed) break;
    const table =
      tables.find(
        t =>
          (!cc.table || t.name.toUpperCase() === String(cc.table).toUpperCase()) &&
          (!cc.schema || (t.schema || '').toUpperCase() === String(cc.schema).toUpperCase())
      ) || null;
    processParsedRule({
      expression: cc.expression,
      table,
      category: VECTOR_CATEGORIES.CODE_CONDITION,
      provenanceKind: PROVENANCE_KINDS.CODE,
      source: cc.source || cc.id || 'code',
      literalsAreSynthetic: cc.literalsAreSynthetic === true,
      addVector,
      addGap,
      addDiagnostic,
      manual: false,
    });
  }

  // Manual rules (CHECK only; provenance manual)
  for (const mr of projectedRequest.manualRules) {
    if (overflowed) break;
    const table =
      tables.find(
        t =>
          (!mr.table || t.name.toUpperCase() === String(mr.table).toUpperCase()) &&
          (!mr.schema || (t.schema || '').toUpperCase() === String(mr.schema).toUpperCase())
      ) || null;
    processParsedRule({
      expression: mr.expression,
      table,
      category: VECTOR_CATEGORIES.MANUAL_RULE,
      provenanceKind: PROVENANCE_KINDS.MANUAL,
      source: mr.id || 'manual',
      literalsAreSynthetic: mr.literalsAreSynthetic === true,
      addVector,
      addGap,
      addDiagnostic,
      manual: true,
    });
  }

  if (overflowed) {
    return { ...OVERFLOW_RESULT };
  }

  // Stable vector order by id — no silent truncation of collections
  const vectors = stableSortBy([...vectorsByKey.values()], v => v.id);

  if (
    vectors.length > LIMITS.maxVectors ||
    gaps.length > LIMITS.maxGaps ||
    diagnostics.length > LIMITS.maxDiagnostics
  ) {
    return { ...OVERFLOW_RESULT };
  }

  const qualityReport = buildQualityReport(vectors, gaps);

  const sortedGaps = stableSortBy(
    gaps,
    g => `${g.kind}|${g.table || ''}|${g.column || ''}|${g.message}`
  );

  const result = {
    contractId: RESULT_CONTRACT_ID,
    contractVersion: RESULT_CONTRACT_VERSION,
    contractRef: RESULT_CONTRACT_REF,
    provenanceAnchor: projectedRequest.provenanceAnchor
      ? { ...projectedRequest.provenanceAnchor }
      : null,
    vectors,
    qualityReport,
    gaps: sortedGaps,
    diagnostics,
    nonClaims: { ...NON_CLAIMS },
    notes: [
      'Canonical technical test vectors only; not production-validated.',
      'Business validity is unknown for every vector.',
      'No database, program, compile, deploy, or network execution was performed.',
      'Manual/code CHECK rules remain non-catalog provenance and do not override catalog silently.',
      'Defaults, unique keys, and catalog CHECK are not on the supported evidence surface.',
    ],
  };

  return {
    ok: true,
    reasonCode: REASON_CODES.OK,
    result,
  };
}

function isUnsupportedGapKind(kind) {
  return (
    kind === GAP_KINDS.UNSUPPORTED_CHECK ||
    kind === GAP_KINDS.UNSUPPORTED_LITERAL ||
    kind === GAP_KINDS.UNSUPPORTED_TYPE ||
    kind === GAP_KINDS.UNSUPPORTED_CCSID ||
    kind === GAP_KINDS.UNSUPPORTED_COLLATION ||
    kind === GAP_KINDS.LIMIT_EXCEEDED ||
    kind === GAP_KINDS.MATERIALIZATION_LIMIT ||
    kind === GAP_KINDS.UNKNOWN_COLUMN ||
    kind === GAP_KINDS.INVALID_DECIMAL_META ||
    kind === GAP_KINDS.MALFORMED_FK
  );
}

function isMissingEvidenceGapKind(kind) {
  return (
    kind === GAP_KINDS.MISSING_DEFAULT ||
    kind === GAP_KINDS.MISSING_CHECK ||
    kind === GAP_KINDS.MISSING_UNIQUE ||
    kind === GAP_KINDS.MISSING_COMPOSITE_KEY ||
    kind === GAP_KINDS.MISSING_EVIDENCE ||
    kind === GAP_KINDS.TEMPORAL_PRECISION
  );
}

function buildQualityReport(vectors, gaps) {
  let supported = 0;
  let unsupportedVectors = 0;
  let missingEvidenceVectors = 0;
  let unknownBizVectors = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    const s = vectors[i].supportStatus;
    if (s === SUPPORT_STATUS.SUPPORTED) supported += 1;
    else if (s === SUPPORT_STATUS.UNSUPPORTED) unsupportedVectors += 1;
    else if (s === SUPPORT_STATUS.MISSING_EVIDENCE) missingEvidenceVectors += 1;
    else if (s === SUPPORT_STATUS.UNKNOWN_BUSINESS_VALIDITY) unknownBizVectors += 1;
  }
  let unsupportedGaps = 0;
  let missingGaps = 0;
  let unknownBizGaps = 0;
  for (let i = 0; i < gaps.length; i += 1) {
    const k = gaps[i].kind;
    if (isUnsupportedGapKind(k)) unsupportedGaps += 1;
    else if (isMissingEvidenceGapKind(k)) missingGaps += 1;
    else if (k === GAP_KINDS.UNKNOWN_BUSINESS) unknownBizGaps += 1;
  }
  return {
    supported,
    unsupported: unsupportedVectors + unsupportedGaps,
    missingEvidence: missingEvidenceVectors + missingGaps,
    unknownBusinessValidity: unknownBizVectors + unknownBizGaps,
    gapCount: gaps.length,
    vectorCount: vectors.length,
  };
}

function processParsedRule({
  expression,
  table,
  category,
  provenanceKind,
  source,
  literalsAreSynthetic,
  addVector,
  addGap,
  addDiagnostic,
  manual = false,
}) {
  // provenanceKind must be code or manual — never catalog for CHECK rules.
  if (provenanceKind !== PROVENANCE_KINDS.CODE && provenanceKind !== PROVENANCE_KINDS.MANUAL) {
    addGap(
      makeGap({
        kind: GAP_KINDS.UNSUPPORTED_CHECK,
        message: 'CHECK vectors require code or manual provenance.',
        table,
        detail: source,
      })
    );
    addDiagnostic(
      makeDiagnostic('UNSUPPORTED_PROVENANCE', 'CHECK rule provenance must be code or manual.')
    );
    return;
  }

  if (utf8ByteLength(expression) > LIMITS.maxExpressionUtf8Bytes) {
    addGap(
      makeGap({
        kind: GAP_KINDS.LIMIT_EXCEEDED,
        message: 'Expression exceeds UTF-8 byte bound; no vectors guessed.',
        table,
        detail: source,
      })
    );
    addDiagnostic(makeDiagnostic('EXPRESSION_OVERSIZE', 'Expression exceeds UTF-8 byte bound.'));
    return;
  }
  const parsed = parseExpression(expression);
  if (!parsed.ok || !parsed.supported) {
    addGap(
      makeGap({
        kind: GAP_KINDS.UNSUPPORTED_CHECK,
        message: `Expression unsupported (${parsed.reason || PARSE_REASONS.UNEXPECTED_TOKEN}); no vectors guessed.`,
        table,
        detail: source,
      })
    );
    addDiagnostic(
      makeDiagnostic(
        parsed.reason || 'UNSUPPORTED_EXPRESSION',
        'Expression not supported by conservative parser.'
      )
    );
    return;
  }

  // Resolve identifiers against selected table columns before generation.
  const idents = collectIdentifiers(parsed.ast);
  if (table) {
    const colSet = new Set(table.columns.map(c => c.name.toUpperCase()));
    for (const id of idents) {
      if (!colSet.has(String(id).toUpperCase())) {
        addGap(
          makeGap({
            kind: GAP_KINDS.UNKNOWN_COLUMN,
            message: 'Rule references a column not present on the selected table.',
            table,
            column: String(id),
            detail: source,
          })
        );
        addDiagnostic(
          makeDiagnostic('UNKNOWN_COLUMN', 'Rule column does not resolve to table evidence.')
        );
        return;
      }
    }
  } else if (idents.size > 0) {
    addGap(
      makeGap({
        kind: GAP_KINDS.UNKNOWN_COLUMN,
        message: 'Rule identifiers cannot be resolved without a matching table.',
        table: null,
        detail: source,
      })
    );
    addDiagnostic(
      makeDiagnostic('UNKNOWN_COLUMN', 'Rule column does not resolve to table evidence.')
    );
    return;
  }

  // Any literal kind requires explicit synthetic declaration (caller attestation).
  // Without/false: fixed redacted unsupported-literal gap; no rule vectors; no raw echo.
  if (astHasAnyLiteral(parsed.ast) && literalsAreSynthetic !== true) {
    addGap(
      makeGap({
        kind: GAP_KINDS.UNSUPPORTED_LITERAL,
        message: 'Rule literals require literalsAreSynthetic=true and pass synthetic policy.',
        table,
        detail: source,
      })
    );
    addDiagnostic(makeDiagnostic('LITERAL_POLICY', 'Rule literals require synthetic declaration.'));
    return;
  }

  const derived = deriveVectorsFromAst(parsed.ast, table);
  if (derived.length === 0) {
    addGap(
      makeGap({
        kind: GAP_KINDS.UNSUPPORTED_CHECK,
        message: 'Expression parsed but no conservative vectors derived.',
        table,
        detail: source,
      })
    );
    addDiagnostic(
      makeDiagnostic('NO_DERIVED_VECTORS', 'No conservative vectors derived from expression.')
    );
    return;
  }

  for (const d of derived) {
    const assignments = {};
    for (const [col, val] of Object.entries(d.assignments || {})) {
      const colRef = table ? columnRef(table, col) : col;
      if (val === null) {
        assignments[colRef] = null;
      } else if (typeof val === 'object' && val.kind) {
        assignments[colRef] = normalizeAssignmentValue(val);
      } else {
        assignments[colRef] = normalizeAssignmentValue(val);
      }
    }

    // Literal policy on assignment string values (never echo rejected literals).
    const litScan = scanAssignmentsForLiterals(assignments);
    if (!litScan.ok) {
      addGap(
        makeGap({
          kind: GAP_KINDS.UNSUPPORTED_LITERAL,
          message: 'Manual/code literal rejected by synthetic-literal policy.',
          table,
          detail: source,
        })
      );
      addDiagnostic(
        makeDiagnostic('LITERAL_POLICY', 'Literal rejected by synthetic-literal policy.')
      );
      // Skip remaining derived vectors for this rule.
      return;
    }

    const outcome =
      d.expected === 'accept'
        ? EXPECTED_OUTCOMES.ACCEPT
        : d.expected === 'reject'
          ? EXPECTED_OUTCOMES.REJECT
          : EXPECTED_OUTCOMES.UNKNOWN;

    if (
      !addVector({
        category,
        table,
        assignments,
        expectation: {
          outcome,
          technical: manual ? 'manual-rule' : 'code-condition',
        },
        rationale: d.rationale || 'Derived from parsed expression.',
        provenance: [
          makeProvenance(
            provenanceKind,
            manual ? `manual rule ${source}` : `code condition ${source}`,
            source
          ),
        ],
        assumptions: manual
          ? [
              'Rule provenance is manual.',
              'Manual rules cannot silently override catalog or code provenance.',
              'Literals are bounded synthetic domain values only.',
            ]
          : [
              'Rule provenance is code.',
              'Expression evaluated only by conservative offline parser; not executed on Db2.',
            ],
        supportStatus: SUPPORT_STATUS.SUPPORTED,
      })
    ) {
      return;
    }
  }
}

module.exports = {
  generateVectorSet,
  buildVectorId,
  semanticDedupeKey,
  stableAssignmentsObject,
  tableKey,
  columnRef,
};
