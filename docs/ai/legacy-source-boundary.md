---
Title: Confidential Legacy Source Boundary
Description: Local-only contract for anonymized legacy-source inventory and evidence.
Last Updated: 2026-09-21
---

# Confidential Legacy Source Boundary

Iteration 28 establishes the boundary between local legacy-source material and
the public Promptkit repository. The source root is an explicitly supplied local
directory. It is read-only input; it is never copied, published, committed, or
included in a public process catalog.

## Canonical CLI route

Use the CLI as the only required entrypoint:

```text
node cli/zeus.js legacy-source inventory \
  --source-root <approved-local-root> \
  --out .local/legacy-source-inventory/inventory.json \
  --json
```

The source root may be outside the repository, but it is read-only. The output
must stay below `.local/legacy-source-inventory/`. MCP is not required.

## Export contract

The inventory artifact contains only:

- generic source-type and language-family counts;
- bounded size and line counts;
- aggregate parser feature counts and safe SQL statement categories;
- anonymized HMAC-based evidence identifiers;
- deterministic inventory and source-boundary fingerprints;
- stable warning codes for decoding, parser, or unsupported-input limits.

It contains no raw source text, original paths, file names, business terms,
credentials, environment values, or reversible private-to-anonymous mapping.
The local salt and cache are ignored local state and are never public artifacts.

## Parser and cache behavior

Known RPG/RPGLE/include, CLLE, DDS, binder, and SQL extensions are classified
locally. Existing scanners may contribute aggregate counts only. A scanner
failure is isolated to that file and becomes a bounded warning; it never causes
the agent to print the source or guess missing meaning. Strict UTF-8 decoding,
symlink avoidance, and source/output non-overlap are enforced.

The persisted inventory is deterministic for identical source bytes and salt.
Incremental cache entries contain only an anonymized file ID, a content hash,
source type, parser version, and aggregate summary. Cache hit/reprocess metrics
remain transient CLI evidence and are not part of the persisted artifact.

## Safe handoff

The artifact is an inventory and evidence boundary, not a process description.
Do not infer or publish business processes from it. Any later extraction must
use a separate sanitized fixture, preserve evidence and unknowns, and pass an
explicit review gate. Before sharing or committing any derived artifact, run
the repository privacy, credential, portability, tracked-fixture, and release
integrity checks.

If the command returns `needs-attention`, inspect only the stable warning codes
and record one sanitized experience event. Do not retry an invalid command with
raw source values or paste parser output into a prompt or issue.
