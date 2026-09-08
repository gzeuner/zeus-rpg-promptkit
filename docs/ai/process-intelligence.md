---
Title: Zeus Process Intelligence — AI Contract
Description: How an AI agent discovers, reviews, and consumes evidence-backed legacy-system process knowledge.
---

# Process Intelligence — AI Contract

The process projection is an evidence-backed view above the existing Project
Intelligence graph. It does not replace source analysis, snapshots, freshness,
or technical evidence. CLI remains the canonical integration surface; the
library API is the current read-only vertical-slice entrypoint until the
process CLI routes are delivered.

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

The contracts are exported as `BUSINESS_PROCESS`, `PROCESS_VERSION`,
`PROCESS_STEP`, `PROCESS_CLAIM`, `PROCESS_RELATIONSHIP`, `GLOSSARY_ENTRY`, and
`PROCESS_QUERY_RESULT` in the existing `CONTRACT_IDS` map. They are also
registered in the core schema registry.

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

The next planned iteration adds the read-only `process list`, `describe`,
`query`, `impact`, and `diff` CLI routes. Until then, do not invent command
names for process retrieval; use the live catalog and the library contract.
