---
Title: Confidential Legacy Source Boundary
Description: Local-only contract for anonymized legacy-source inventory and evidence graphs.
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

After a successful inventory, the next bounded technical projection is:

```text
node cli/zeus.js legacy-source graph \
  --source-root <approved-local-root> \
  --inventory .local/legacy-source-inventory/inventory.json \
  --out .local/legacy-source-inventory/evidence-graph.json \
  --json
```

The graph command re-reads the same local source boundary only to obtain parser
evidence. It requires the matching anonymized inventory fingerprint and never
reuses a public or exported mapping.

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

The graph artifact contains only HMAC IDs for source-file and technical entity
nodes, generic edge kinds, bounded counts, source-family labels, parser warning
codes, and inventory/source fingerprints. It contains no entity names, SQL text,
source paths, or inferred process meaning. A graph with warnings is explicitly
incomplete and must not be treated as a process catalog.

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

Graph nodes and edges are sorted before persistence. Repeating the graph command
with identical source bytes, inventory, and local salt produces the same graph
fingerprint. The graph is bounded; a limit warning is a safe incomplete result,
not permission to emit additional source detail.

## Safe handoff

The artifact is an inventory and evidence boundary, not a process description.
The graph is a technical evidence projection, not a process description. Do not
infer or publish business processes from either artifact. Any later extraction
must use a separate sanitized fixture, preserve evidence and unknowns, and pass
an explicit review gate. Before sharing or committing any derived artifact, run
the repository privacy, credential, portability, tracked-fixture, and release
integrity checks.

If the command returns `needs-attention`, inspect only the stable warning codes
and record one sanitized experience event. Do not retry an invalid command with
raw source values or paste parser output into a prompt or issue.
