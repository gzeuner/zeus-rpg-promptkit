function extractSqlState(error) {
  const text = String(error && error.message ? error.message : error || '');
  const match = text.match(/\b(SQL\d{4}|SQLSTATE\s*[=:]?\s*([0-9A-Z]{5}))\b/i);
  if (!match) {
    return '';
  }
  if (match[2]) {
    return String(match[2]).toUpperCase();
  }
  return String(match[1]).toUpperCase();
}

/**
 * Catalog columns that may or may not exist depending on IBM i version
 */
const SYSTABLES_COLUMN_VARIANTS = [
  {
    name: 'complete',
    columns: ['TABLE_SCHEMA', 'TABLE_NAME', 'ROW_COUNT', 'CREATE_TIMESTAMP'],
    minVersion: '7.4'
  },
  {
    name: 'standard',
    columns: ['TABLE_SCHEMA', 'TABLE_NAME', 'CREATE_TIMESTAMP'],
    minVersion: '7.2'
  },
  {
    name: 'minimal',
    columns: ['TABLE_SCHEMA', 'TABLE_NAME'],
    minVersion: '7.0'
  }
];

/**
 * Build a query for SYSTABLES with column adaptation
 * 
 * @param {Object} options
 * @param {string} options.tableName - Table to query
 * @param {Array<string>} options.preferredColumns - Columns to try first
 * @param {boolean} options.verbose - Log attempts
 * @returns {Array} Queries in priority order
 */
function buildSystablesQueries(options) {
  const { tableName, preferredColumns = [], verbose = false } = options;
  
  const queries = [];
  
  // 1. Try with preferred columns first
  if (preferredColumns.length > 0) {
    const cols = preferredColumns.join(', ');
    queries.push({
      name: 'preferred',
      sql: `SELECT ${cols} FROM QSYS2.SYSTABLES WHERE TABLE_NAME = '${tableName}'`,
      expectedColumns: preferredColumns
    });
  }
  
  // 2. Try standard variants in order
  for (const variant of SYSTABLES_COLUMN_VARIANTS) {
    const cols = variant.columns.join(', ');
    queries.push({
      name: `variant_${variant.name}`,
      sql: `SELECT ${cols} FROM QSYS2.SYSTABLES WHERE TABLE_NAME = '${tableName}'`,
      expectedColumns: variant.columns,
      minVersion: variant.minVersion
    });
  }
  
  // 3. Fallback: absolute minimal
  queries.push({
    name: 'fallback_minimal',
    sql: `SELECT TABLE_SCHEMA FROM QSYS2.SYSTABLES WHERE TABLE_NAME = '${tableName}' FETCH FIRST 1 ROW ONLY`,
    expectedColumns: ['TABLE_SCHEMA']
  });
  
  return queries;
}

/**
 * Adaptive query executor with SQLSTATE-aware recovery
 * 
 * @param {Function} queryExecutor - Function that executes SQL and throws on error
 * @param {Array} queryVariants - Array of { name, sql, expectedColumns }
 * @param {Object} options
 * @param {boolean} options.verbose - Log attempts
 * @returns {Object} Query result or degraded mode indicator
 */
function executeWithAdaptiveRetry(queryExecutor, queryVariants, options = {}) {
  const { verbose = false, onError } = options;
  
  let lastError = null;
  const sqlStateErrors = {};
  const attempts = Array.isArray(queryVariants) ? [...queryVariants] : [];
  
  for (let index = 0; index < attempts.length; index += 1) {
    const variant = attempts[index];
    try {
      if (verbose) {
        console.log(`[adaptive-query] Attempting: ${variant.name}`);
      }
      
      const result = queryExecutor(variant);
      
      if (verbose) {
        console.log(`[adaptive-query] ✅ Success with ${variant.name}`);
      }
      
      return {
        success: true,
        result,
        usedVariant: variant.name,
        degradedMode: false
      };
    } catch (error) {
      const sqlState = extractSqlState(error);
      lastError = error;
      
      if (sqlState) {
        if (!sqlStateErrors[sqlState]) {
          sqlStateErrors[sqlState] = [];
        }
        sqlStateErrors[sqlState].push(variant.name);
      }
      
      if (verbose) {
        console.log(`[adaptive-query] ❌ ${variant.name} failed: ${sqlState || 'unknown'}`);
      }

      if (typeof onError === 'function') {
        onError({
          error,
          sqlState,
          attempts,
          variant,
          nextIndex: index + 1,
        });
      }
    }
  }
  
  // All attempts failed — analyze and return degraded mode
  return {
    success: false,
    sqlStateErrors,
    lastError,
    degradedMode: shouldEnterDegradedMode(sqlStateErrors),
    recommendations: generateRecoveryRecommendations(sqlStateErrors, lastError)
  };
}

function normalizeSqlState(sqlState) {
  const normalized = String(sqlState || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'SQL0204') return '42704';
  if (normalized === 'SQL0206') return '42703';
  if (normalized === 'SQL0551') return '42501';
  return normalized;
}

/**
 * Determine if we should enter degraded mode (skip metadata, use source-only analysis)
 */
function shouldEnterDegradedMode(sqlStateErrors) {
  // SQL0551 = No authority → degraded mode OK
  if (sqlStateErrors['42501']) {
    return true;
  }
  
  // SQL0204 = Table not found AND all variants failed → degraded mode
  if (sqlStateErrors['42704'] && Object.keys(sqlStateErrors).length === 1) {
    return true;
  }
  
  return false;
}

/**
 * Generate user-friendly recovery recommendations
 */
function generateRecoveryRecommendations(sqlStateErrors, lastError) {
  const recommendations = [];
  
  // SQL0206 = Column doesn't exist
  if (sqlStateErrors['42703']) {
    recommendations.push(
      '⚠️  Your IBM i version lacks QSYS2 catalog columns. This is expected on older versions.',
      '   Recommendation: Upgrade to IBM i 7.4+ or use source-only analysis (--skip-metadata)'
    );
  }
  
  // SQL0204 = Table not found
  if (sqlStateErrors['42704']) {
    recommendations.push(
      '⚠️  Metadata table not found. Possible causes:',
      '   1. Table is in a different schema (not in QSYS2)',
      '   2. Table has been deleted',
      '   Recommendation: Explicitly specify schema with --default-schema or check table exists'
    );
  }
  
  // SQL0551 = No authority
  if (sqlStateErrors['42501']) {
    recommendations.push(
      '⚠️  Read-only user lacks authority to query system catalog (QSYS2).',
      '   Continuing with source-only analysis (no metadata export).',
      '   Recommendation: Ask system admin to grant SELECT on QSYS2 views, or use privileged account'
    );
  }
  
  return recommendations;
}

/**
 * Schema discovery helper — find which schema contains a table
 */
async function discoverTableSchema(tableName, knownSchemas, queryExecutor, options = {}) {
  const { verbose = false } = options;
  
  if (verbose) {
    console.log(`[schema-discovery] Searching for ${tableName} in ${knownSchemas.length} known schemas...`);
  }
  
  // Try each schema
  for (const schema of knownSchemas) {
    try {
      const sql = `SELECT 1 FROM ${schema}.${tableName} FETCH FIRST 1 ROW ONLY`;
      await queryExecutor(sql);
      
      if (verbose) {
        console.log(`[schema-discovery] ✅ Found ${tableName} in schema: ${schema}`);
      }
      
      return { found: true, schema };
    } catch (error) {
      const sqlState = extractSqlState(error);
      
      // Not a "not found" error? Real problem.
      if (sqlState !== '42704' && sqlState !== '00000') {
        if (verbose) {
          console.log(`[schema-discovery] Real error in ${schema}: ${sqlState}`);
        }
        throw error;
      }
      
      if (verbose) {
        console.log(`[schema-discovery] Not in schema: ${schema}`);
      }
    }
  }
  
  // Try catalog as last resort
  if (verbose) {
    console.log(`[schema-discovery] Querying catalog as fallback...`);
  }
  
  try {
    const catalogQuery = `
      SELECT TABLE_SCHEMA 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_NAME = '${tableName}'
      ORDER BY TABLE_SCHEMA
      FETCH FIRST 1 ROW ONLY
    `;
    
    const result = await queryExecutor(catalogQuery);
    
    if (result.rows && result.rows.length > 0) {
      const schema = result.rows[0].TABLE_SCHEMA;
      if (verbose) {
        console.log(`[schema-discovery] ✅ Catalog found ${tableName} in schema: ${schema}`);
      }
      return { found: true, schema };
    }
  } catch (error) {
    if (verbose) {
      console.log(`[schema-discovery] Catalog query also failed: ${extractSqlState(error)}`);
    }
  }
  
  return { found: false, schema: null };
}

module.exports = {
  buildSystablesQueries,
  executeWithAdaptiveRetry,
  extractSqlState,
  normalizeSqlState,
  shouldEnterDegradedMode,
  generateRecoveryRecommendations,
  discoverTableSchema,
  SYSTABLES_COLUMN_VARIANTS
};
