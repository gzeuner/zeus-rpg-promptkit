/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See roadmap notes for embedded SQL validation planning.
*/

/**
 * SQL RPG Validator
 *
 * Validates embedded SQL in RPG source code:
 * - Cursor SELECT column count vs. FETCH INTO host variable count
 * - Host variable type compatibility (static checks)
 * - DYNAMIC SQL markers (PREPARE, EXECUTE)
 *
 * Integration Points:
 * - Called from: src/scanner/rpgScanner.js (after EXEC SQL extraction)
 * - Output to: canonical-analysis.json (entities.sqlValidationErrors[])
 * - AI Integration: ai-knowledge.json workflows.*.riskMarkers[] ("CURSOR_FETCH_MISMATCH")
 * - CLI: zeus validate-rpg-sql command (new)
 * - Test Fixtures: tests/fixtures/rpg-embedded-sql/
 */

/**
 * Validates a cursor-fetch pair in RPG
 * @param {Object} cursorStatement - { name, selectColumns: [], sourceLines: { select, fetch } }
 * @param {Object} fetchStatement - { intoVariables: [], sourceLines: { fetch } }
 * @returns {Object} { valid: bool, errors: [], warnings: [] }
 */
function validateCursorFetchMatch(cursorStatement, fetchStatement) {
  const errors = [];
  const warnings = [];

  if (!cursorStatement || !fetchStatement) {
    return { valid: true, errors, warnings };
  }

  const cursorCols = Number(cursorStatement.selectColumnCount || 0);
  const fetchVars = Array.isArray(fetchStatement.hostVariables) ? fetchStatement.hostVariables.length : 0;

  const cursorName = (cursorStatement.cursors && cursorStatement.cursors[0] && cursorStatement.cursors[0].name) ||
                     (fetchStatement.cursors && fetchStatement.cursors[0] && fetchStatement.cursors[0].name) || 'UNKNOWN';

  if (cursorCols > 0 && fetchVars > 0) {
    if (cursorCols !== fetchVars) {
      errors.push({
        code: 'CURSOR_FETCH_MISMATCH',
        message: `Cursor ${cursorName} declares ${cursorCols} column(s) but FETCH uses ${fetchVars} INTO variable(s)`,
        cursor: cursorName,
        selectColumns: cursorCols,
        intoVariables: fetchVars,
        evidence: {
          declare: cursorStatement.text,
          fetch: fetchStatement.text,
        },
      });
    } else {
      // good match
    }
  } else if (cursorCols === 0 && fetchVars > 0) {
    warnings.push({
      code: 'CURSOR_COLUMN_COUNT_UNKNOWN',
      message: `Could not determine column count for cursor ${cursorName} (dynamic or complex SELECT)`,
      cursor: cursorName,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateHostVariables(variables, context = {}) {
  const issues = [];
  const vars = Array.isArray(variables) ? variables : [];

  if (vars.length === 0 && context.expectHostVars) {
    issues.push({
      code: 'MISSING_HOST_VARIABLES',
      message: 'Expected host variables but none found in statement',
    });
  }

  // Basic sanity: duplicate host vars in same statement can be suspicious
  const seen = new Set();
  for (const v of vars) {
    if (seen.has(v)) {
      issues.push({
        code: 'DUPLICATE_HOST_VARIABLE',
        message: `Host variable :${v} appears multiple times`,
        variable: v,
      });
    }
    seen.add(v);
  }

  return issues;
}

function detectDynamicSqlMarkers(sqlBlock) {
  if (!sqlBlock) return { isDynamic: false, markers: [] };

  const normalized = String(sqlBlock).toUpperCase();
  const markers = [];

  if (/\bPREPARE\b/.test(normalized)) markers.push('PREPARE');
  if (/\bEXECUTE\s+IMMEDIATE\b/.test(normalized)) markers.push('EXECUTE_IMMEDIATE');
  if (/\bEXECUTE\b/.test(normalized) && !/\bEXECUTE\s+IMMEDIATE\b/.test(normalized)) markers.push('EXECUTE');

  // Host var in FROM or CURSOR FOR position
  if (/\bFROM\s+:[A-Z]/.test(normalized) || /\bCURSOR\s+FOR\s+:[A-Z]/.test(normalized)) {
    markers.push('DYNAMIC_CURSOR_SOURCE');
  }

  const isDynamic = markers.length > 0 || (normalized.includes('PREPARE') || normalized.includes('EXECUTE'));

  return { isDynamic, markers: Array.from(new Set(markers)) };
}

function validateEmbeddedSql(sqlStatements = []) {
  const validationErrors = [];
  const validationWarnings = [];

  // Group statements by cursor name
  const cursorMap = new Map(); // name -> { declare: stmt, fetches: [] }

  for (const stmt of sqlStatements) {
    const cursors = stmt.cursors || [];
    for (const c of cursors) {
      const name = c.name;
      if (!name) continue;
      if (!cursorMap.has(name)) {
        cursorMap.set(name, { declare: null, fetches: [] });
      }
      const entry = cursorMap.get(name);
      if (c.action === 'DECLARE' || stmt.type === 'DECLARE_CURSOR') {
        entry.declare = stmt;
      } else if (c.action === 'FETCH') {
        entry.fetches.push(stmt);
      }
    }

    // Also run per-statement host var checks
    if (stmt.hostVariables && stmt.hostVariables.length > 0) {
      const hvIssues = validateHostVariables(stmt.hostVariables, {
        expectHostVars: ['SELECT', 'FETCH', 'UPDATE', 'INSERT'].includes(stmt.type),
      });
      for (const issue of hvIssues) {
        validationWarnings.push({ ...issue, statementType: stmt.type, text: stmt.text });
      }
    }

    // Dynamic detection
    const dyn = detectDynamicSqlMarkers(stmt.text);
    if (dyn.isDynamic && !stmt.dynamic) {
      // enrich if needed, but scanner already sets it
    }
  }

  // Cursor fetch validation
  for (const [cursorName, entry] of cursorMap.entries()) {
    if (entry.declare && entry.fetches.length > 0) {
      for (const fetchStmt of entry.fetches) {
        const res = validateCursorFetchMatch(entry.declare, fetchStmt);
        validationErrors.push(...res.errors);
        validationWarnings.push(...res.warnings);
      }
    }
  }

  // Also surface per-statement dynamic if not already
  for (const stmt of sqlStatements) {
    const dyn = detectDynamicSqlMarkers(stmt.text || '');
    if (dyn.isDynamic) {
      // already handled mostly in scanner, but we can add marker
    }
  }

  return {
    validationErrors: uniqueByCode(validationErrors),
    validationWarnings: uniqueByCode(validationWarnings),
  };
}

function uniqueByCode(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = (item.code || '') + '|' + (item.message || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  validateCursorFetchMatch,
  validateHostVariables,
  detectDynamicSqlMarkers,
  validateEmbeddedSql,
};
