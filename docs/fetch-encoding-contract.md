# Fetch Encoding Contract

Zeus guarantees one local source contract for Windows-readable analysis input:

- fetched source must arrive as UTF-8 stream files
- the guaranteed IBM i export CCSID is `1208`
- the guarantee is transport-independent across `sftp`, `jt400`, and `ftp`

## Contract Summary

When `zeus fetch` runs with the default `--streamfile-ccsid 1208`, Zeus guarantees that the local files written under `--out` are expected to be valid UTF-8 input for the analyze pipeline, regardless of whether the download step used:

- `sftp`
- `jt400`
- `ftp`

`zeus-import-manifest.json` records:

- `transportRequested`
- `transportUsed`
- `streamFileCcsid`
- `encodingPolicy`
- `normalizationPolicy`
- per-file `origin.memberPath`
- per-file `export.status`
- per-file `export.transportUsed`
- per-file `utf8Valid`
- per-file `newlineStyle`
- per-file `validationStatus`
- per-file `validationMessages`

See [docs/import-manifest-contract.md](/c:/Java/workspace-java/zeus-rpg-promptkit/docs/import-manifest-contract.md) for the full public fetch manifest schema.

## Failure Semantics

The fetch contract is explicit about failures:

- if a preferred transport fails in `auto` mode, Zeus records the failure in `notes` and tries the next transport
- if downloaded source is not valid UTF-8, the manifest records `utf8Valid: false` and `validationStatus: "invalid"`
- if newline style is mixed or legacy CR-only, the manifest records a warning instead of silently normalizing it

This keeps transport fallback separate from content validation. A successful download does not hide an invalid local analysis contract.

## Non-Default CCSIDs

Zeus allows other positive `--streamfile-ccsid` values for advanced or diagnostic workflows, but those values are not the guaranteed local analysis contract today.

For end-to-end Windows-readable analysis input, treat `CCSID 1208` as the supported contract until broader multi-CCSID handling is implemented across fetch, validation, and analysis.
