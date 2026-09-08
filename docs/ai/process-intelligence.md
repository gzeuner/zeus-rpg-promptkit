---
Title: Zeus Process Intelligence — AI Contract
Description: How an AI agent discovers, reviews, and consumes evidence-backed legacy-system process knowledge.
---

# Process Intelligence — AI Contract

The process projection is an evidence-backed view above the existing Project
Intelligence graph. It does not replace source analysis, snapshots, freshness,
or technical evidence. CLI remains the canonical integration surface; the
library API exposes the same read-only retrieval service for integrations.

## Current vertical slice

The public package export is `zeus-rpg-promptkit/project-intelligence`:

- `discoverProcessCandidates(input, options)` creates deterministic candidate
  processes from a canonical analysis or an evidence graph.
- `buildProcessDescription(candidate)` creates a schema-constrained readable
  description without adding unsupported business facts.
- `reviewProcessDescription(candidate, review)` requires an explicit approved
  review and a reviewer identity.
- `publishProcessDescription(reviewed, publication)` requires a reviewed
  candidate and an explicit publication timestamp.
- `validateProcessCandidate(candidate)` validates the process, version, steps,
  claims, and relationships against the registered ZPI contracts.
- `listProcesses(catalog, options)` returns a deterministic process index.
- `describeProcess(catalog, id)` returns one process version with steps, claims,
  relationships, evidence, freshness, and unknowns.
- `queryProcesses(catalog, question, options)` returns the versioned
  `PROCESS_QUERY_RESULT` contract. Exact identifiers and reviewed/published
  facts rank ahead of derived summaries; a no-match answer remains explicit.
- `impactProcess(catalog, id)` expands the process relationships without
  changing the catalog.
- `diffProcess(catalog, id)` compares two versions when both are present and
  reports `unknown` when no baseline exists.

The contracts are exported as `BUSINESS_PROCESS`, `PROCESS_VERSION`,
`PROCESS_STEP`, `PROCESS_CLAIM`, `PROCESS_RELATIONSHIP`, `GLOSSARY_ENTRY`, and
`PROCESS_QUERY_RESULT` in the existing `CONTRACT_IDS` map. They are also
registered in the core schema registry.

## CLI retrieval

The CLI consumes an explicit, local `process-candidate-catalog` JSON artifact.
It never searches arbitrary directories and never publishes a candidate:

```text
node cli/zeus.js process list --catalog ./output/process-candidates.json --json
node cli/zeus.js process describe --catalog ./output/process-candidates.json --id <process-id> --json
node cli/zeus.js process query --catalog ./output/process-candidates.json --question "Was macht Schnittstelle XY?" --json
node cli/zeus.js process impact --catalog ./output/process-candidates.json --id <process-id> --json
node cli/zeus.js process diff --catalog ./output/process-candidates.json --id <process-id> --json
```

`--catalog` must be workspace-relative. Query JSON contains `projectId`,
`snapshotId`, `queryId`, lifecycle status, confidence, evidence references,
freshness, matches, unknowns, and next questions. If the catalog does not
declare freshness, the result says `unknown` instead of implying that the
process is current. A process identifier or interface/program identifier is
preferred over a vague natural-language question when available.

## Agent rules

1. Start with `agent preflight` and inspect the local analysis or published
   snapshot before deriving a process.
2. Treat every process as `candidate` until a domain owner explicitly reviews
   it. Candidate, reviewed, and published are separate lifecycle states.
3. Preserve `projectId`, `snapshotId`, `provenance`, `evidenceReferences`,
   confidence, uncertainty, and open questions in every answer.
4. Do not convert a technical program call, table access, unresolved symbol,
   or source name into a business goal, role, rule, or outcome without evidence.
5. Keep unresolved dependencies and missing source locations visible. A derived
   evidence reference is not the same as a source span.
6. Never publish automatically and never use a process projection as a license
   to change source, data, or a remote IBM i system.

When a process query is incomplete, record the sanitized failure or correction
with `agent log`; never copy credentials, private runtime values, or raw source
content into the experience record.
