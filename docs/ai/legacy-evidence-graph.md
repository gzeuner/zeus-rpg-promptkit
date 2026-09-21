---
Title: Confidential Legacy Evidence Graph
Description: Local-only contract for the anonymized cross-language legacy evidence graph.
Last Updated: 2026-09-21
---

# Legacy Evidence Graph Contract

Iteration 29 adds one local technical projection after the inventory:
`legacy-source graph`. It connects parser evidence across supported source
families without exporting the identifiers that local scanners see.

## Canonical CLI discovery

The inventory must be created first. Discover the installed local options with
the CLI help routes:

```text
node cli/zeus.js legacy-source inventory --help
node cli/zeus.js legacy-source graph --help
```

All argument values are local-only operational inputs. The source boundary is
read-only, generated artifacts remain local ignored state, and MCP is not
required. Never copy local argument values into prompts, issues, documentation,
PRs, or releases.

## Graph contract

The graph contains:

- HMAC-SHA256 IDs for source-file and technical entity nodes;
- generic source-family and source-type labels;
- whitelisted technical edge kinds such as calls, includes, bindings, data
  references, SQL intents, and native-file access;
- bounded node/edge counts, parser warning codes, and stable fingerprints in
  local artifacts;
- an explicit `complete` flag that is false when a scanner or graph limit warns.

It never contains source text, original paths, entity names, SQL text,
credentials, business terms, or reversible private-to-anonymous mappings. The
graph does not infer process names, process descriptions, ownership, or business
meaning. It is evidence linkage only.

The local graph validates that the inventory is the privacy-safe artifact for the
same HMAC-bound source root. A missing, unsafe, or mismatched inventory fails
closed with a stable reason code. A parser failure produces a bounded warning;
it does not print the failing source or error text.

## Public artifact boundary

The public repository contains only this generic contract, synthetic fixtures,
and structural guards. Real-run graph data, metrics, fingerprints, warning
instances, and local references are not repository artifacts and are not
included in CI, commits, releases, or examples.

## Review handoff

Treat a generated evidence graph as local technical evidence. Do not commit it,
publish it, or use it as a process catalog. Any later process-candidate work
must consume a separate sanitized fixture, preserve uncertainty, link only to
anonymized evidence IDs, and pass the repository privacy, credential,
portability, tracked-fixture, and release-integrity checks.

For local prompt construction, use the generic handoff instead of passing graph
data directly to a prompt:

```text
node cli/zeus.js technical-evidence context --help
```

That contract accepts only an already-anonymized graph, applies deterministic
budgets, preserves uncertainty, and emits bounded local context. It never
turns technical relationships into business meaning.
