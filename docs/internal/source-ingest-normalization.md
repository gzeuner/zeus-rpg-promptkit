# Source Ingest And Source-Type Scanning

Zeus analyzes local source through an internal normalized text contract before scanner passes run.

This keeps fetch-time UTF-8 guarantees intact while allowing `zeus analyze` to handle a limited set of non-UTF-8 local inputs explicitly.

## Supported Analyze-Time Input Handling

Zeus currently supports these local source cases ahead of scanning:

- UTF-8 without BOM
- UTF-8 with BOM
- UTF-16LE with BOM
- UTF-16BE with BOM

For analyze-time ingestion:

- BOM markers are removed before scanning
- line endings are normalized to LF in memory
- raw files are not rewritten on disk

Unsupported encodings fail with explicit per-file diagnostics in the analyze collect stage.

## Diagnostics And Manifests

Analyze emits per-file diagnostics such as:

- `SOURCE_BOM_REMOVED`
- `SOURCE_ENCODING_CONVERTED`
- `SOURCE_LINE_ENDINGS_NORMALIZED`
- `INVALID_UTF8`
- `MIXED_NEWLINES`
- `LEGACY_CR_NEWLINES`

Normalization outcomes are exposed through:

- `context.json` source-file metadata
- `canonical-analysis.json` source-file metadata and enrichments
- `analyze-run-manifest.json` collect-stage metadata and diagnostics
- `report.md` source ingest summary

## Source-Type Classification

Zeus classifies local source before scanner dispatch.

Current scanner families:

- RPG family: `.rpg`, `.rpgle`, `.sqlrpgle`, `.rpgile`, binder-source extensions
- CL family: `.clp`, `.clle`
- DDS family: `.dds`, `.dspf`, `.prtf`, `.pf`, `.lf`

## Current CL Coverage

CL scanning currently contributes:

- command inventory
- `CALL PGM(...)` program-call discovery
- file-oriented object usage from `FILE(...)`, `TOFILE(...)`, and `FROMFILE(...)`
- additional object usage hints for `MSGF`, `DTAARA`, `OUTQ`, and `JOBQ`

File-oriented CL object usage is projected into shared dependency findings so graph output can remain useful for CL-driven workflows.

## Current DDS Coverage

DDS scanning currently contributes:

- display/printer/disk-style file classification
- record-format names
- referenced file hints from `PFILE`, `REF`, and `JFILE`

These findings feed shared context and reporting without forcing DDS through RPG-only heuristics.

## Current Limits

- no general-purpose transcoding is attempted for arbitrary non-UTF encodings without BOM markers
- CL command parsing is heuristic and focused on program calls and object/file usage, not full CL syntax
- DDS parsing is metadata-oriented and does not model every keyword or compile-time object rule yet
- ambiguous duplicate member names remain explicit in cross-program and impact outputs instead of being silently guessed
