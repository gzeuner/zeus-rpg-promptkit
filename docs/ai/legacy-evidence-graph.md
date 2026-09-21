---
Title: Confidential Legacy Evidence Graph
Description: Local-only contract for the anonymized cross-language legacy evidence graph.
Last Updated: 2026-09-21
---

# Confidential Legacy Evidence Graph

Iteration 29 adds one technical projection after the local-only inventory:
`legacy-source graph`. It connects parser evidence across RPG/RPGLE, CL, DDS,
binder, and SQL files without exporting the names that the local scanners see.

## Canonical CLI route

The inventory must be created first. Then run:

```text
node cli/zeus.js legacy-source graph \
  --source-root <approved-local-root> \
  --inventory .local/legacy-source-inventory/inventory.json \
  --out .local/legacy-source-inventory/evidence-graph.json \
  --json
```

The source root and inventory are local inputs. The source root is read-only,
the output is restricted to `.local/legacy-source-inventory/`, and MCP is not
required.

## Graph contract

The graph contains:

- HMAC-SHA256 IDs for source-file and technical entity nodes;
- generic source-family and source-type labels;
- whitelisted technical edge kinds such as calls, includes, bindings, data
  references, SQL intents, and native-file access;
- bounded node/edge counts, parser warning codes, and stable fingerprints;
- an explicit `complete` flag that is false when a scanner or graph limit warns.

It never contains source text, original paths, entity names, SQL text,
credentials, business terms, or reversible private-to-anonymous mappings. The
graph does not infer process names, process descriptions, ownership, or business
meaning. It is evidence linkage only.

The graph validates that the inventory is the privacy-safe artifact for the
same HMAC-bound source root. A missing, unsafe, or mismatched inventory fails
closed with a stable reason code. A parser failure produces a bounded warning;
it does not print the failing source or error text.

## Review handoff

Treat `evidence-graph.json` as local technical evidence. Do not commit it,
publish it, or use it as a process catalog. Any later process-candidate work
must consume a separate sanitized fixture, preserve uncertainty, link only to
anonymized evidence IDs, and pass the repository privacy, credential,
portability, tracked-fixture, and release-integrity checks.
