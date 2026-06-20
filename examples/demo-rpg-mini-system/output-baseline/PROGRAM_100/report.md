# Zeus RPG Analysis Report

## Overview
- Program: PROGRAM_100
- Scanned At: 2000-01-01T00:00:00.000Z
- Source Root: SOURCE_ROOT
- Source File Count: 5
- Table Count: 4
- Program Call Count: 3
- Copy Member Count: 0
- SQL Statement Count: 2
- Summary: Program PROGRAM_100 references 4 tables, calls 3 programs, includes 0 copy members, contains 2 SQL statements (1 read, 1 write, 0 dynamic), exposes 3 procedures with 0 procedure call sites, uses 3 native files (1 mutating, 0 interactive), and models 3 modules, 0 service programs, and 0 binding directories (0 unresolved bindings).

## AI Context Optimization
- Enabled: true
- Context Tokens: 3041
- Optimized Tokens: 8693
- Reduction: 0%
- Soft Token Limit: 10000

## Source Files
- QCLLESRC/DRIVER_100.clle (36 bytes, 5 lines, CLLE, normalization: ok)
- QDDSSRC/FILE_100.pf (118 bytes, 6 lines, PF, normalization: ok)
- QRPGLESRC/PROGRAM_100.rpgle (140 bytes, 11 lines, RPGLE, normalization: ok)
- QRPGLESRC/PROGRAM_200.sqlrpgle (266 bytes, 19 lines, SQLRPGLE, normalization: ok)
- QRPGLESRC/PROGRAM_300.rpgle (148 bytes, 11 lines, RPGLE, normalization: ok)

## Source Ingest
- Files Seen: 6
- Converted Encodings: 0
- Normalized Files: 0
- BOM Removed: 0
- Line Endings Normalized: 0
- Invalid Files: 0
- Warnings: 0

## Source Type Analysis
### Source Types
- CLLE: 1
- PF: 1
- RPGLE: 2
- SQLRPGLE: 1

### CL Commands
- CALL: CALL PGM(PROGRAM_100)
- ENDPGM: ENDPGM
- PGM: PGM

### CL Object Usage
- None detected

### DDS Metadata
- FILE_100 [DISK] formats: REC100

## IFS Path Usage
IFS path scanning was not enabled for this run.

## Full-Text Search
No search terms were configured for this run.

## Diagnostic Query Packs
No diagnostic packs were selected for this run.

## Known Facts
- Enabled: false
- Status: disabled
- Mode: local-only
- Profile: n/a
- Fact Count: 0
- Updated At: n/a
- Expires At: n/a

## Analysis Cache
- Enabled: true
- Source Scan Hits: 0
- Source Scan Memory Hits: 0
- Source Scan Persistent Hits: 0
- Source Scan Misses: 5
- Source Scan Invalidations: 0
- Source Scan Writes: 5
- DB2 Metadata Cache: disabled
- Test Data Cache: disabled
- Source Scan Cache Dir: OUTPUT_ROOT/.zeus-cache/source-scans
- Artifact Cache Manifest: analysis-cache.json

## Tables
- ETCH (FILE)
- FILE_100 (DISK)
- FILE_200 (DISK)
- TABLE_100 (SQL)

## Program Calls
- PROGRAM_100 (PROGRAM)
- PROGRAM_200 (PROGRAM)
- PROGRAM_300 (PROGRAM)

## Copy Members
- None detected

## Procedure Semantics
- Procedures: 3
- Prototypes: 0
- Procedure Calls: 0
- Internal Calls: 0
- External Calls: 0
- Dynamic Calls: 0
- Unresolved Calls: 0
- Catalog-Resolved Calls: 0

## RPG Language Features
- BIF usages: 0 (n/a)
- Indicator usages: 1 (*INLR)
- Data Structures: 0 (n/a)
- Standalone fields (DCL-S): 1 (ID_001)
- Note: Structures, fields, *INxx and %BIF are key evidence for safe RPG development and modernization.

## Binding Analysis
- Modules: 3
- NoMain Modules: 0
- Service Programs: 0
- Binder Sources: 0
- Binding Directories: 0
- Bound Modules: 0
- Unresolved Bindings: 0
- Exported Symbols: 0

### Modules
- PROGRAM_100 (PROGRAM_MODULE)
- PROGRAM_200 (PROGRAM_MODULE)
- PROGRAM_300 (PROGRAM_MODULE)

### Service Programs
- None detected

## Native File I/O
- Native Files: 3
- Read-Only Files: 1
- Mutating Files: 1
- Interactive Files: 0
- Workstation Files: 0
- Printer Files: 0
- Keyed Files: 1
- Record Formats: 0

- ETCH [FILE]
- FILE_100 [DISK, READ, KEYED]
- FILE_200 [DISK, READ, UPDATE, MUTATING]

## SQL Statements
- SQL Statements: 2
- Read Statements: 1
- Write Statements: 1
- Dynamic Statements: 0
- Unresolved Statements: 0
- Cursor Statements: 1
- Host Variables: 1
- Cursors: 1

- [SELECT/READ] exec sql select ID into :ID_001 from TABLE_100 fetch first 1 row only; tables: TABLE_100 host vars: ID_001 cursors: FIRST/FETCH
- [UPDATE/WRITE] exec sql update TABLE_100 set STATUS = 'READY' where ID = :ID_001; tables: TABLE_100 host vars: ID_001

## DB2 Metadata
DB2 metadata export was skipped because no DB2 connection configuration was available.

## Test Data Extract
Test data extraction was skipped because no DB2 connection configuration was available.

- Allowlist entries: 2
- Denylist entries: 1
- Mask rules: 1

## Dependency Graph
Dependency graph generated for PROGRAM_100.

- Nodes: 10
- Edges: 10
- Tables: 4
- Programs Called: 3
- Copy Members: 0
- Modules: 3
- Service Programs: 0
- Binding Directories: 0
- Bind Relationships: 3

See files:
- dependency-graph.json
- dependency-graph.mmd
- dependency-graph.md

## Cross Program Dependency Graph
A recursive program dependency graph was generated for PROGRAM_100.

- Programs discovered: 3
- Ambiguous program calls: 0
- Ambiguous list: None
- Unresolved program calls: 0
- Unresolved list: None
- Truncated by safety limits: No

See:
- program-call-tree.json
- program-call-tree.mmd
- program-call-tree.md

## Impact Analysis
Impact analysis can identify affected programs if a component changes.

See:
- impact-analysis.json
- impact-analysis.md

## Interactive Architecture Viewer
An interactive architecture visualization has been generated.

Open:
- architecture.html

in your browser to explore program dependencies visually.

## Architecture
- See architecture-report.md for a full architecture overview.

## Next Steps
- Validate detected dependencies with the application design and naming standards.
- Use canonical-analysis.json as the semantic source and context.json or optimized-context.json as prompt-ready projections.
- Enrich with DB metadata, search results, sample test data, and explicit local known facts when available to improve reasoning.
- Create a portable bundle with `zeus bundle --program PROGRAM_100`.
