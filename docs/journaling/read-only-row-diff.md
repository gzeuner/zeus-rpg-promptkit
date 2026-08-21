# Read-only Journal Row Diff

`journal-row-diff` compares before/after row images from IBM i `QSYS2.DISPLAY_JOURNAL` and reports aggregate counts for no-op updates versus updates with content changes. It is intentionally generic: the operator supplies the journal, the physical row layout, the business-key columns, and an independent audit query for cross-validation.

The command never writes to IBM i. It also does not emit journal bytes, decoded row values, job details, or audit rows. The Java helper keeps those values inside the process and returns only counts, column names, validation statistics, and bounded warnings.

## Example

```powershell
node cli/zeus.js journal-row-diff `
  --profile readonly-db2 `
  --journal-library APPDATA `
  --journal-name APPJRN `
  --layout "ID:P:3:0,STATUS:C:1:0,AMOUNT:P:4:2" `
  --key-columns "ID" `
  --ignore-columns "STATUS" `
  --audit-query "SELECT ID, CHANGED_AT FROM APPDATA.AUDIT_LOG" `
  --start "2026-08-21-10.00.00" `
  --end "2026-08-21-11.00.00" `
  --json
```

The example names are placeholders. Replace them only at runtime; do not commit production system names, journal names, source layouts derived from private systems, audit output, or credentials.

## Layout format

`--layout` is a comma-separated list of `NAME:TYPE:LENGTH[:SCALE]` entries:

- `P`: packed decimal; `LENGTH` is the physical byte length.
- `C`: EBCDIC character data; `LENGTH` is the physical byte length.
- `B`: four-byte big-endian integer.

The layout must come from an authoritative source definition for the journaled object. It must not be guessed from the journal output. Key and ignored columns must be present in the supplied layout.

## Independent validation

`--audit-query` must be a single `SELECT` or `WITH` statement. It must return one column per key column followed by a timestamp column. The analyzer compares the decoded key and journal timestamp with that independent audit result. If the match rate is below the validation threshold, the command returns `VALIDATION_FAILED`; its diff counts must then be treated as untrusted until the layout, CCSID, timestamp window, and audit query are corrected.

## Safety boundaries

- Use a read-only profile and verify the active system before every remote run.
- Credentials are resolved from the existing runtime secret path and are never placed in Java command-line arguments.
- The command accepts only simple IBM i identifiers for journal names and libraries.
- Timestamp literals, layout dimensions, key references, result limits, and audit SQL are validated before any connection is opened.
- `--save` writes the aggregate result locally. Review and sanitize that artifact before sharing it.

This feature is an analysis aid, not a claim that a journal layout or audit source is correct. The validation result is part of the evidence and must remain visible in downstream reports.
