---
Title: Onboarding to a New IBM i / AS400 System
Description: Step-by-step guide to connect Zeus to a fresh IBM i system, discover sources, objects, metadata and data.
Last Updated: 2026-06-20
---

# Onboarding to a New IBM i System with Zeus RPG PromptKit

This guide helps you get Zeus working against a **new or unknown IBM i (AS/400 / Power Systems)** environment quickly and safely.

**Core principle:** Evidence first. Use `doctor` early and often. Never guess library names, schemas, or credentials.

## 1. Prerequisites

- Node.js >= 20
- Java 11+ (required for fetch via JT400, DB2 queries, metadata export)
- Network access to the IBM i (SSH/SFTP or JT400 for fetch, JDBC for queries)
- Read-only service account (recommended for first connection)
- Credentials for:
  - Fetch (SFTP / FTP / JT400)
  - DB2 queries (for metadata + data)

## 2. Initial Project Setup

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
```

Copy the example profile:

```bash
cp config/profiles.example.json config/local-only/profiles.json
# Windows: Copy-Item config/profiles.example.json config/local-only/profiles.json
```

## 3. Environment Variables & Profiles (How to Connect)

Load environment **explicitly** every time (shell session):

```bash
# Linux / macOS
source ./config/load-env.sh project

# Windows PowerShell
. .\config\load-env.ps1 -Environment project
```

**Essential variables for a new system** (set in your shell or `.env` style file before loading):

### Fetch (Source Code Download)
```bash
ZEUS_FETCH_HOST=your-ibmi.example.com
ZEUS_FETCH_USER=YOURUSER
ZEUS_FETCH_PASSWORD=yourpassword
ZEUS_FETCH_SOURCE_LIB=QRPGLESRC          # or the source library
ZEUS_FETCH_IFS_DIR=/home/YOURUSER/zeus-export
ZEUS_FETCH_OUT=./rpg_sources
```

### DB2 / Metadata & Data
```bash
ZEUS_DB_HOST=your-ibmi.example.com
ZEUS_DB_USER=YOURUSER
ZEUS_DB_PASSWORD=yourpassword
ZEUS_DB_DEFAULT_SCHEMA=APPDATA           # common business schema
ZEUS_DB_DEFAULT_LIBRARY=APPLIB
```

**Recommended separation for safety** (use different hosts/users):
- `ZEUS_METADATA_DB_*` → for catalog / schema discovery (read-only privileged)
- `ZEUS_TESTDATA_DB_*` → for sampling real data (often same as metadata)

### Profiles

Edit `config/local-only/profiles.json`. Start with a minimal profile:

```json
{
  "new-system": {
    "outputRoot": "${env:ZEUS_OUTPUT_ROOT}",
    "extensions": [".rpgle", ".sqlrpgle", ".clle", ".dds", ".pf", ".lf"],
    "db": {
      "host": "${env:ZEUS_DB_HOST}",
      "user": "${env:ZEUS_DB_USER}",
      "password": "${env:ZEUS_DB_PASSWORD}",
      "defaultSchema": "${env:ZEUS_DB_DEFAULT_SCHEMA}"
    },
    "fetch": {
      "host": "${env:ZEUS_FETCH_HOST}",
      "user": "${env:ZEUS_FETCH_USER}",
      "password": "${env:ZEUS_FETCH_PASSWORD}",
      "sourceLib": "${env:ZEUS_FETCH_SOURCE_LIB}",
      "ifsDir": "${env:ZEUS_FETCH_IFS_DIR}"
    }
  }
}
```

**Load the profile** with every `zeus` command via `--profile new-system`.

## 4. First Command: Doctor (Verify Connection)

Always run this **first**:

```bash
node cli/zeus.js doctor --profile new-system --show-resolved
node cli/zeus.js doctor --profile new-system --probe --show-resolved   # performs live checks
```

`--probe` executes safe read-only tests (CL commands, DB2 catalog access, fetch probe).

Common outputs:
- `[PASS]` for Java + config
- Warnings for missing env vars (profiles provide fallbacks)
- Remote probes show whether fetch / DB2 actually work

## 5. Where to Search for Source Code

Common IBM i source file types / libraries:

| Object Type | Typical Library | Description |
|-------------|------------------|-------------|
| QRPGLESRC   | MYLIB / APPLIB   | RPGLE / free-form sources |
| QCLSRC / QCLLESRC | ...         | CL, CLLE |
| QDDSSRC     | ...              | DDS (PF/LF/DSPF/PRTF) |
| QCPYSRC     | ...              | Copy books |
| QSQLSRC     | ...              | Pure SQL scripts |
| QSRVSRC     | ...              | Service program exports / binder |
| IFS         | /home/user/... or /QSYS.LIB/... | Stream files, sometimes source |

**Discovery commands**:

```bash
# Resolve object names (system vs SQL name)
node cli/zeus.js resolve-object --profile new-system --table MYTABLE --require-column ID

# Inspect PGM or *SRVPGM objects
node cli/zeus.js inspect-object --profile new-system --lib MYLIB --name MYPGM --type *PGM

# Search local sources after fetch or in existing tree
node cli/zeus.js search-source --source-root ./rpg_sources --search-term "CHAIN" --max-results 20

# Cross reference fields
node cli/zeus.js field-search --profile new-system --field CUSTOMER_ID --mode all
```

Use `zeus fetch` with `--source-lib` or profile `fetch.sourceLib` to pull members.

After fetch: sources land in `./rpg_sources` (or your `ZEUS_FETCH_OUT`).

## 6. Discovering Objects (PGM, Tables, etc.)

### PGM / *SRVPGM Objects
```bash
node cli/zeus.js inspect-object --profile new-system --lib PRODLIB --name ORDERPGM --type *PGM --journal
```

### Tables / Files (Physical / Logical)
```bash
# High-level table metadata
node cli/zeus.js query-table --profile new-system --table ORDERS --schema APPDATA

# Full catalog discovery
node cli/zeus.js query-sql --profile new-system \
  --sql "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'APPDATA' ORDER BY TABLE_NAME" \
  --max-rows 100
```

### DDL Generation / Structure
Use catalog queries or the internal metadata export (part of analyze when DB configured):

- `QSYS2.SYSCOLUMNS`
- `QSYS2.SYSKEYS`
- `QSYS2.SYSCST` (constraints)
- `QSYS2.SYSTRIG` (triggers)

See `docs/sql/system-environment-discovery.sql` for a ready-made set of discovery queries. Copy and adapt the library/schema lists.

## 7. Obtaining Metadata and Data

**Metadata** (schema, columns, keys, programs):
- `doctor --probe`
- `query-table`
- `query-sql` against QSYS2.*
- `analyze ...` (enriches with DB2 metadata when profile has `db`)
- `resolve-object`

**Data** (sample rows):
- During analyze: `--test-data-limit 25`
- Direct: `query-sql` with `FETCH FIRST n ROWS ONLY`
- Test data export is controlled by profile `testData.*` (masking, allow/deny lists)

**Example safe data peek**:
```bash
node cli/zeus.js query-sql --profile new-system \
  --sql "SELECT * FROM APPDATA.CUSTOMERS FETCH FIRST 5 ROWS ONLY" \
  --max-rows 5
```

## 8. Recommended First Workflow for a New System

The easiest way is the built-in **zeus-onboarding-wizard**:

```bash
source ./config/load-env.sh project
node cli/zeus.js onboarding
# aliases: wizard | onboard | zeus-onboarding-wizard
```

Manual steps (if you prefer full control):

```bash
# 1. Load env + verify
source ./config/load-env.sh project
node cli/zeus.js doctor --profile new-system --probe --show-resolved

# 2. Discover interesting objects
node cli/zeus.js resolve-object --profile new-system --table CUSTOMERS
node cli/zeus.js inspect-object --profile new-system --lib PRODLIB --name ORDERPGM --type *PGM

# 3. Fetch or point to source
node cli/zeus.js fetch --profile new-system
# or use existing local tree

# 4. Analyze a key program
node cli/zeus.js analyze --profile new-system --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context

# 5. Onboarding-focused analysis
node cli/zeus.js workflow --preset onboarding --profile new-system --source ./rpg_sources --program ORDERPGM --out ./output

# 6. Bundle for sharing / AI
node cli/zeus.js bundle --program ORDERPGM --source-output-root ./output --include-md --include-json
```

Use the generated `ai_prompt_documentation.md` or `report.md` + `canonical-analysis.json` with your AI.

## 9. Common Pitfalls & Tips

- Always load env in the **current shell** before running zeus.
- Separate credentials for fetch vs. metadata vs. test data when possible.
- Start with read-only profiles.
- Use `--probe` liberally.
- Source files are often in `*SRC` libraries. Tables/files in data libraries.
- For multi-system: use `ZEUS_METADATA_DB_HOST=...` overrides without changing profiles.
- Run `zeus analyses list` after analyze to track runs.

## Next Steps After Basic Connection

- Read [`docs/tool-catalog.md`](../tool-catalog.md) for the authoritative command list.
- Try the `onboarding` workflow preset.
- Use MCP with a minimal allowlist for AI agents:
  ```bash
  node cli/zeus.js mcp serve --verbose --allow-tools zeus.doctor,zeus.resolve-object,zeus.query-table,zeus.search-source,zeus.validate-rpg-sql
  ```

For deeper dives see:
- `docs/sql/index.md`
- `docs/workflows/investigation-workflows.md`
- `docs/safety/best-practice-guide.md`

**You are now connected. Everything from here is evidence-driven analysis.**

---

*This guide is intentionally tool- and command-first. Zeus does not store connections permanently — you control them via shell environment + profiles.*