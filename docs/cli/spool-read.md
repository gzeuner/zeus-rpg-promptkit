---
Title: Read Existing IBM-i Spoolfiles
Description: CLI contract for bounded, read-only spoolfile evidence retrieval.
Last Updated: 2026-09-04
---

# Read Existing IBM-i Spoolfiles

`spool-read` reads the text of an existing IBM-i spoolfile through JT400. It is
a remote read-only (`S2`) operation: it does not create, change, delete, or
submit spoolfiles and it does not write a local artifact.

## Agent-safe sequence

```powershell
node .\cli\zeus.js tools describe spool-read --json
node .\cli\zeus.js doctor --profile <profile> --probe --show-resolved
node .\cli\zeus.js spool-read --profile <profile> --job-number <number> --job-user <user> --job-name <job> --spool-file <name> --json
```

Before execution, state the selected profile, IBM-i host/system, job identity,
spoolfile name/number, charset, and maximum bytes. Credentials must remain in
the configured environment or Secret Vault.

## Command contract

Required options:

- `--profile <name>`: Fetch profile used to resolve IBM-i host, user, and secret.
- `--job-number <number>`: IBM-i job number.
- `--job-user <user>`: IBM-i job user.
- `--job-name <name>`: IBM-i job name.
- `--spool-file <name>`: Spoolfile name, such as `QPRINT`.

Optional options:

- `--spool-number <number>`: Exact spoolfile number. Without it, Zeus lists
  visible spoolfiles and reads all matching entries.
- `--charset <name>`: Java charset for decoding the spool content; default `Cp037`.
- `--max-bytes <n>`: Per-spoolfile byte limit; default 1 MiB, maximum 4 MiB.
- `--json`: Return a machine-readable `{ found, matches }` result.

Example:

```powershell
node .\cli\zeus.js spool-read --profile default-fetch --job-number 000001 --job-user APPUSER --job-name BATCHJOB --spool-file QPRINT --spool-number 1 --json
```

## Result and limitations

Each match contains the job identity, spoolfile number, decoded `text`, and a
`truncated` flag. If the byte limit is reached, preserve that fact in the
evidence summary; the result is not the complete spoolfile. The default `Cp037`
is common for IBM-i output but must be changed when the spool content uses a
different encoding.

The IBM-i account must be allowed to see and open the target spoolfile. The
job/user filter is a selection filter, not an impersonation mechanism. A
catalog entry or job listing does not prove that the account can read its
content. If access fails, use `joblog` or `doctor` for lower-risk diagnostics,
record the sanitized failure with `agent log`, and do not repeat the same
invalid request.

The Node layer masks configured sensitive terms, URL credentials, and detected
credential assignments before printing. Do not pass raw stdout/stderr,
environment dumps, or credentials into prompts, logs, or generated artifacts.
