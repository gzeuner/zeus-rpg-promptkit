# Zeus Metadata Extraction Challenges & Optimizations

**Status**: Analysis & Optimization Recommendations for v0.3

---

## 1. Root Causes: Metadaten-Probleme

### Problem A: DB2 Catalog API Inconsistencies

#### Challenge 1a: ROW_COUNT / NUMBER_ROWS Missing

**Problem:**
```sql
-- ❌ FAILS on some IBM i versions
SELECT ROW_COUNT FROM QSYS2.SYSTABLES WHERE TABLE_NAME = 'APP_TABLE_00'
-- Result: SQL0206 (column ROW_COUNT doesn't exist)
```

**Root Cause:**
- `ROW_COUNT` and `NUMBER_ROWS` are **not universally available** across IBM i versions
- Different PASE/DB2 versions expose different column sets
- Leads to **schema discovery failures** (can't estimate table size)

**Current Workaround:**
```sql
-- ✅ WORKS (but limited info)
SELECT TABLE_NAME, TABLE_SCHEMA FROM QSYS2.SYSTABLES 
WHERE TABLE_NAME = 'APP_TABLE_00'
```

**Impact**: 
- Cannot estimate metadata extraction time
- Cannot warn user of large tables before export
- Batch operation planning is blind

---

#### Challenge 1b: SQLSTATE 0206 Column Not Found

**Problem:**
```
Error: SQL0206 (Column not found: ROW_COUNT)
Recovery: ???
```

**Root Cause:**
- Different IBM i PTF levels expose different QSYS2 columns
- Query must adapt at runtime

**Current Workaround:**
```javascript
// src/db2/readOnlyQueryService.js
function extractSqlState(error) {
  const match = error.message.match(/\b(SQL\d{4}|SQLSTATE\s*[=:]?\s*([0-9A-Z]{5}))\b/i);
  // Extract SQL state but don't use for intelligent fallback
}
```

**Issues:**
1. SQL State is extracted but **not used for adaptive queries**
2. Error message is just thrown (no retry strategy)
3. User gets cryptic JDBC error

---

#### Challenge 1c: SQLSTATE 0204 Table Not Found

**Problem:**
```
Error: SQLSTATE 42704 (Object not found: LIBDEV/APP_STAGING_00)
```

**Root Cause:**
- Table **exists** but in a **different schema** than queried
- `resolveDefaultSchema()` doesn't check alternative schemas
- Query fails because it queries `LIBDEV.APP_STAGING_00` but table is in `APPDATA.APP_STAGING_00`

**Current Workaround:**
```javascript
// Hardcoded to one schema — no fallback
const schema = resolveDefaultSchema(dbConfig); // → 'LIBDEV'
```

**Impact**: 
- Cross-schema tables not discoverable
- User must manually specify schema (UX friction)

---

#### Challenge 1d: Column Name Aliases (Short Names)

**Problem:**
```sql
-- Catalog shows short names
SELECT COLNAME, COLTYPE FROM SYSCOLUMNS
WHERE TBNAME = 'APP_TABLE_00'
-- Result: COLNAME='NEUE_MOD' (truncated to 10 chars)

-- But the DDL defined longer names
CREATE TABLE APP_TABLE_00 (
  neue_modul_nr packed(3,0)  -- ← 14 chars, but COLNAME='NEUE_MOD'
)
```

**Root Cause:**
- IBM i catalog truncates column names to 10 characters by default
- Logical column names (>10 chars) map to shortened aliases
- Map between logical ↔ physical names is not automated

**Current Workaround:**
```javascript
// Manual column name resolution
const resolveColumn = (logicalName, catalogName) => {
  if (logicalName.length <= 10) return logicalName;
  // Otherwise: user must know the alias
};
```

**Impact**: 
- Complex columns not matched to definitions
- Schema documentation incomplete
- Metadata analysis misses new fields (like neue_modul_nr)

---

#### Challenge 1e: Schema Discovery Ambiguity

**Problem:**
```sql
-- Query ambiguous: which APP_STAGING_00?
SELECT * FROM APP_STAGING_00;
-- Result: SQL0205 (Ambiguous reference)
-- Because APP_STAGING_00 exists in both LIBDEV and APPDATA libraries
```

**Root Cause:**
- No default library in SQL context at query time
- Query doesn't specify schema qualifier
- Falls back to `*LIBL` (library list) resolution

**Current Workaround:**
```javascript
// Must always qualify
SELECT * FROM LIBDEV.APP_STAGING_00;  // explicit
```

**Impact**: 
- Metadata discovery requires full qualification
- Adds complexity to analyzer queries
- Performance slower (full table scans possible)

---

### Problem B: Metadata API Permission Gaps

#### Challenge 1f: SQLSTATE 0551 — No Authority

**Problem:**
```
Error: SQLSTATE 42501 — User MYADMIN has no authority to QSYS2.SYSTABLES
```

**Root Cause:**
- User has *USE on library but not *OBJMGT
- QSYS2 views require elevated permissions
- Read-only user can't access catalog metadata

**Current Workaround:**
```javascript
// No intelligent fallback — just fail
if (result.status !== 0) {
  throw new Error(result.stderr); // user sees raw JDBC error
}
```

**Impact**: 
- Analyze fails for read-only users
- No graceful degradation (e.g., skip metadata, use source-only analysis)

---

#### Challenge 1g: CCSID Encoding Issues

**Problem:**
```
SELECT COLNAME FROM SYSCOLUMNS
-- Result: COLNAME = "NEUE_MOD\x00\x00\x00\x00" (binary zeros)
-- Expected: COLNAME = "NEUE_MOD" (clean)
```

**Root Cause:**
- Metadata extracted with wrong CCSID
- DB2 returns fixed-length VARCHAR padded with EBCDIC spaces
- Node.js UTF-8 conversion leaves garbage

**Current Workaround:**
```javascript
// Manual trimming
const cleanName = name.replace(/\x00/g, '').trim();
```

**Impact**: 
- Column names corrupted in output
- Analysis artifacts contain garbage data
- Diff reports hard to read

---

## 2. Current Architecture Gaps

### Gap A: No Adaptive Query Strategy

**Current:**
```
Query QSYS2.SYSTABLES
  ↓ (SQL0206: Column not found)
  ↓ (Error thrown)
  ↓ (User sees exception)
```

**Optimal:**
```
Query QSYS2.SYSTABLES with ROW_COUNT
  ↓ (SQL0206: Column not found)
  ↓ (Catch → Retry without ROW_COUNT)
  ↓ (Success with fallback columns)
  ↓ (User gets degraded but usable data)
```

### Gap B: No Schema Resolution

**Current:**
```
Query "SELECT * FROM APP_STAGING_00"
  ↓ (SQL0205: Ambiguous)
  ↓ (Error thrown)
```

**Optimal:**
```
Query "SELECT * FROM APP_STAGING_00"
  ↓ (SQL0205: Ambiguous)
  ↓ (Retry with SCHEMA.TABLE)
  ↓ (If still ambiguous: try all known schemas)
  ↓ (Return first successful result)
```

### Gap C: No Permission Fallback

**Current:**
```
Query QSYS2.SYSTABLES
  ↓ (SQL0551: No authority)
  ↓ (Metadata extraction fails entirely)
```

**Optimal:**
```
Query QSYS2.SYSTABLES
  ↓ (SQL0551: No authority)
  ↓ (Fallback to source-only analysis)
  ↓ (Skip metadata, use scanner + relationships)
  ↓ (User gets schema-independent artifacts)
```

---

## 3. Fetch Transport Issues

### Problem C: Transport Selection is Blind

**Current `transport=auto` Strategy:**

```javascript
const strategies = transport === 'auto'
  ? ['sftp', 'jt400', 'ftp']  // ← Fixed order
  : [transport];

for (const strategy of strategies) {
  try {
    // Try strategy...
  } catch (error) {
    // Silent fallback, no diagnostics
  }
}
```

**Issues:**
1. **No transport diagnostics** — User doesn't know which failed and why
2. **No priority hints** — All transports treated equally
3. **Slow fallback** — SFTP timeout (30s) → JT400 attempt → FTP attempt = 60-90s total
4. **No user control** — `--transport=auto` is opaque

### Problem D: Why SFTP/FTP Aren't Explicitly Used

**Root Cause 1: SFTP Implementation is Incomplete**

```javascript
// src/fetch/sftpDownloader.js
const downloadDirectory = async (options) => {
  // Implementation present but:
  // - No connection pooling
  // - No keepalive
  // - No resume support for interrupted downloads
};
```

**Issue**: SFTP can fail mid-transfer with no recovery

**Root Cause 2: FTP Has Legacy Issues**

```javascript
// src/fetch/ftpDownloader.js
// FTP = unencrypted (security issue)
// FTP passive mode = firewall complications
// FTP PORT mode = requires outbound data connection (blocked in many networks)
```

**Issue**: FTP is unreliable over internet-facing connections

**Root Cause 3: JT400 (JDBC) is Most Reliable**

```javascript
// src/fetch/jt400Downloader.js
// Uses native IBM i APIs via JDBC
// - Built-in error recovery
// - Automatic retry on network glitches
// - Direct EBCDIC ↔ UTF-8 conversion
// - Connection pooling via jt400 library
```

**Issue**: JT400 is heaviest but most robust

---

## 4. Optimization Recommendations (v0.3)

### Optimization A: Adaptive Metadata Queries

**File**: `src/db2/readOnlyQueryService.js`

**New Feature: Query Adaptation Strategy**

```javascript
// BEFORE:
function runReadOnlyDb2Query({ dbConfig, query, maxRows = 50 }) {
  validateReadOnlySql(query);
  // Direct execution, no fallback
  return executeQuery(query);
}

// AFTER:
function runReadOnlyDb2Query({ 
  dbConfig, 
  query, 
  maxRows = 50,
  retryStrategies = []  // ← NEW
}) {
  validateReadOnlySql(query);
  
  // Try primary query
  try {
    return executeQuery(query);
  } catch (error) {
    const sqlState = extractSqlState(error);
    
    // SQL0206: Column not found → try fallback
    if (sqlState === '42703') {
      for (const fallback of retryStrategies) {
        try {
          return executeQuery(fallback.query);
        } catch (fallbackError) {
          continue;
        }
      }
    }
    
    // SQL0204: Table not found → try schema variants
    if (sqlState === '42704') {
      return trySchemalizedQuery(query, dbConfig.schemaVariants || []);
    }
    
    // SQL0551: No authority → fallback to degraded mode
    if (sqlState === '42501') {
      return { degradedMode: true, rows: [] };
    }
    
    throw error;  // Unknown error, re-throw
  }
}
```

**Benefit**: Metadata queries auto-adapt to IBM i version variations

---

### Optimization B: Transport Diagnostics

**File**: `src/fetch/fetchService.js`

**New Feature: Verbose Transport Selection**

```javascript
// BEFORE:
for (const strategy of strategies) {
  try {
    downloadResult = await downloadDirectoryFn(...);
    break;  // Silent success
  } catch (error) {
    summary.notes.push(`Download via ${strategy} failed: ${error.message}`);
  }
}

// AFTER:
for (const strategy of strategies) {
  try {
    if (options.verbose) {
      console.log(`[transport] Attempting ${strategy}...`);
    }
    
    const startTime = Date.now();
    downloadResult = await downloadDirectoryFn(...);
    
    if (options.verbose) {
      const elapsed = Date.now() - startTime;
      console.log(`[transport] ✅ ${strategy} succeeded (${elapsed}ms)`);
    }
    
    summary.transportUsed = strategy;
    break;  // Success
  } catch (error) {
    if (options.verbose) {
      console.log(`[transport] ❌ ${strategy} failed: ${error.message}`);
    }
    summary.notes.push(`[${strategy}] ${error.message}`);
  }
}
```

**Benefit**: User sees which transport failed and why

---

### Optimization C: Explicit Transport Priority Hints

**File**: `src/fetch/fetchService.js`

**New Feature: Transport Strategy Based on Environment**

```javascript
// Detect network/platform characteristics
function selectTransportStrategy(options) {
  const strategies = [];
  
  // If local network: JT400 is fastest (direct IBM i native APIs)
  if (options.networkType === 'local' || options.preferJt400) {
    strategies.push('jt400');
    strategies.push('sftp');
    strategies.push('ftp');
  }
  
  // If internet-facing: SFTP preferred (encrypted, reliable)
  else if (options.preferSftp || options.encrypted === true) {
    strategies.push('sftp');
    strategies.push('jt400');
    // Skip FTP (unencrypted)
  }
  
  // If legacy/restricted: FTP only (last resort)
  else if (options.ftpOnly) {
    strategies.push('ftp');
  }
  
  // Default auto
  else {
    strategies.push('sftp', 'jt400', 'ftp');
  }
  
  return strategies;
}
```

**Usage:**
```bash
# Use JT400 preferentially (local network)
node cli/zeus.js fetch --program MYLIB \
  --transport auto \
  --network-type local

# Use SFTP (encrypted, internet-safe)
node cli/zeus.js fetch --program MYLIB \
  --transport auto \
  --prefer-sftp

# Skip FTP entirely
node cli/zeus.js fetch --program MYLIB \
  --transport auto \
  --no-ftp
```

**Benefit**: User can steer transport selection based on network characteristics

---

### Optimization D: Schema Discovery Service

**File**: `src/db2/schemaDiscoveryService.js` (NEW)

**New Module: Intelligent Schema Resolution**

```javascript
async function discoverTableSchema(tableName, knownSchemas, db2Config) {
  // Try explicit schema first
  for (const schema of knownSchemas) {
    try {
      const query = `SELECT 1 FROM ${schema}.${tableName}`;
      await runReadOnlyDb2Query({ dbConfig: db2Config, query });
      return schema;  // Found it
    } catch (error) {
      if (extractSqlState(error) !== '42704') {
        throw error;  // Real error, not just "not found"
      }
    }
  }
  
  // If not found, query catalog for it
  const catalogQuery = `
    SELECT TABLE_SCHEMA 
    FROM QSYS2.SYSTABLES 
    WHERE TABLE_NAME = '${tableName}'
    FETCH FIRST 1 ROW ONLY
  `;
  
  try {
    const result = await runReadOnlyDb2Query({ 
      dbConfig: db2Config, 
      query: catalogQuery 
    });
    
    if (result.rows.length > 0) {
      return result.rows[0].TABLE_SCHEMA;
    }
  } catch (error) {
    // Catalog query failed, skip
  }
  
  throw new Error(`Table ${tableName} not found in any known schema`);
}

module.exports = { discoverTableSchema };
```

**Benefit**: Cross-schema tables automatically discovered

---

### Optimization E: Degraded Mode for Read-Only Users

**File**: `src/db2/readOnlyQueryService.js`

**New Feature: Permission-Aware Fallback**

```javascript
function handlePermissionError(error, analysis) {
  const sqlState = extractSqlState(error);
  
  if (sqlState === '42501') {  // No authority
    // Log warning but continue with degraded analysis
    console.warn('[WARN] Read-only user lacks QSYS2 access. Using source-only analysis.');
    
    return {
      metadata: null,  // Metadata not available
      degradedMode: true,
      analysis: analysis,  // Continue with scanner-only analysis
      recommendation: 'Grant user SELECT authority on QSYS2 views for complete metadata export'
    };
  }
  
  throw error;
}
```

**Benefit**: Analyze command works for restricted users (skips metadata, uses scanner)

---

## 5. Implementation Plan

### Phase 1: Diagnostics (Immediate)
- [ ] Add verbose transport logging to fetchService.js
- [ ] Extract SQLSTATE but don't use yet (foundation)
- [ ] Document known IBM i versions + their catalog column availability

### Phase 2: Adaptive Queries (v0.3)
- [ ] Implement query retry strategies for SQLSTATE 0206, 0204
- [ ] Create schemaDiscoveryService.js
- [ ] Add degraded-mode support for permission errors

### Phase 3: Transport Intelligence (v0.3)
- [ ] Add `--network-type` and `--prefer-*` flags
- [ ] Implement `selectTransportStrategy()`
- [ ] Document transport selection in help text

### Phase 4: User Experience (v0.4+)
- [ ] Interactive transport selection (`--transport=interactive`)
- [ ] Pre-flight diagnostics (`zeus fetch --diagnose`)
- [ ] Transport performance benchmarking

---

## 6. Known Constraints

| Constraint | Reason | Workaround |
|-----------|--------|-----------|
| Can't change IBM i CCSID | System-level configuration | Always convert to UTF-8 locally |
| Can't bypass permission checks | Security feature | Use privileged account for metadata, separate for code |
| Can't force SFTP over FTP | Protocol availability | Use `--transport sftp` or `--prefer-sftp` |
| Can't auto-detect schema | QSYS2 may not be accessible | Allow explicit `--default-schema` override |

---

## Summary

**Metadaten-Probleme** entstehen aus:
1. Nicht-universelle DB2 Catalog APIs (ROW_COUNT, NUMBER_ROWS)
2. Fehlende Adaptive Query Strategien
3. Keine Permission-Fallbacks
4. Fehlende Schema Discovery

**Fetch Transport-Probleme** entstehen aus:
1. Blinde Transport-Auswahl (keine Diagnostik)
2. Keine Priorisierung basierend auf Netzwerk-Typ
3. SFTP/FTP Zuverlässigkeitsprobleme
4. Fehlende User Control

**Empfohlene Reihenfolge der Optimierungen**:
1. Transport Diagnostik (v0.3, ~2 Tage)
2. Adaptive Queries (v0.3, ~3 Tage)
3. Schema Discovery (v0.3, ~2 Tage)
4. User Experience (v0.4+, ~5 Tage)
