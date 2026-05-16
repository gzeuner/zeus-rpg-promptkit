# Import Manifest Contract

`zeus fetch` writes `zeus-import-manifest.json` into the local fetch root.

This file is the public machine-readable provenance contract for imported IBM i source members.

## Schema

Current schema version: `2`

Top-level fields:

- `schemaVersion`
- `tool`
- `fetchedAt`
- `remote`
- `request`
- `localDestination`
- `transportRequested`
- `transportUsed`
- `streamFileCcsid`
- `encodingPolicy`
- `normalizationPolicy`
- `summary`
- `files`
- `notes`

## File Records

Each `files[]` entry represents one attempted member export.

Stable provenance fields:

- `sourceLib`
- `sourceFile`
- `member`
- `memberPath`
- `remotePath`
- `localPath`
- `sourceType`

Nested provenance blocks:

- `origin`
  - canonical imported-member identity and paths
- `export`
  - export status, requested/used transport, fallback usage, command, CCSID, encoding policy, normalization policy, and export diagnostics
- `validation`
  - local file existence, checksum, UTF-8 validity, newline style, validation status, and validation messages

Backward-compatible flat aliases remain on each file record for the core identity, export, and validation fields.

## Summary Semantics

`summary` includes:

- `exportedSuccess`
- `exportedFailed`
- `exportedTotal`
- `downloadedCount`
- `fileCount`
- `exportedFileCount`
- `failedFileCount`
- `invalidFileCount`
- `warningCount`

`failedFileCount` tracks member exports that produced a manifest entry but did not complete successfully.

## Downstream Usage

`zeus analyze` reads this manifest to:

- validate imported source files before scanning
- attach imported-member provenance to `canonical-analysis.json`
- expose import-manifest summary metadata in `analyze-run-manifest.json`

`zeus bundle` reuses the analyze-run summary to surface source provenance in `bundle-manifest.json` and `README.txt`.

This keeps later stages tied to the original imported-member identity without re-deriving it from basenames alone.
