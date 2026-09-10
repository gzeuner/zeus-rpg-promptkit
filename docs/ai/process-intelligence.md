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
- `buildProcessRoleView(catalog, id, role, options)` returns a versioned,
  read-only projection for `product-owner`, `architect`, `developer`, or
  `tester`. The projection changes the presentation, not the evidence or the
  lifecycle status.
- `chatProcess(catalog, question, options)` is a local chat-shaped adapter to
  the same deterministic query contract. It does not call a model, use a
  network, persist state, or invent an answer.
- `evaluateProcessCatalog(catalog, scenarios, options)` produces a deterministic
  quality result with evidence coverage, unresolved relationships, freshness,
  review needs, and optional query-scenario checks.
- `impactProcess(catalog, id)` expands the process relationships without
  changing the catalog.
- `diffProcess(catalog, id)` compares two versions when both are present and
  reports `unknown` when no baseline exists.
- `buildGlossaryCatalog(entries, options)` validates and deterministically
  orders a project-specific vocabulary catalog.
- `resolveGlossaryTerm(catalog, term, options)` resolves a business term,
  abbreviation, legacy name, alias, or technical reference with explicit
  `resolved`, `ambiguous`, or `unknown` status.

The contracts are exported as `BUSINESS_PROCESS`, `PROCESS_VERSION`,
`PROCESS_STEP`, `PROCESS_CLAIM`, `PROCESS_RELATIONSHIP`, `GLOSSARY_ENTRY`, and
`PROCESS_QUERY_RESULT` in the existing `CONTRACT_IDS` map. They are also
registered in the core schema registry. Role views use
`PROCESS_ROLE_VIEW`; quality checks use `PROCESS_EVALUATION_RESULT`.

## CLI retrieval

The CLI consumes an explicit, local `process-candidate-catalog` JSON artifact.
It never searches arbitrary directories and never publishes a candidate:

```text
node cli/zeus.js process list --catalog ./output/process-candidates.json --json
node cli/zeus.js process describe --catalog ./output/process-candidates.json --id <process-id> --json
node cli/zeus.js process query --catalog ./output/process-candidates.json --question "Was macht Schnittstelle XY?" --json
node cli/zeus.js process chat --catalog ./output/process-candidates.json --question "Was macht Schnittstelle XY?" --json
node cli/zeus.js process view --catalog ./output/process-candidates.json --id <process-id> --role architect --json
node cli/zeus.js process impact --catalog ./output/process-candidates.json --id <process-id> --changed-evidence-id <evidence-id> --json
node cli/zeus.js process diff --catalog ./output/process-candidates.json --id <process-id> --json
node cli/zeus.js process evaluate --catalog ./output/process-candidates.json --scenarios ./output/process-scenarios.json --json
node cli/zeus.js process glossary list --glossary ./output/process-glossary.json --only-applicable --json
node cli/zeus.js process glossary resolve --glossary ./output/process-glossary.json --term "<legacy-term>" --json
node cli/zeus.js process query --catalog ./output/process-candidates.json --glossary ./output/process-glossary.json --question "Was macht <legacy-term>?" --json
```

`--catalog` must be workspace-relative. Query JSON contains `projectId`,
`snapshotId`, `queryId`, lifecycle status, confidence, evidence references,
freshness, matches, unknowns, and next questions. If the catalog does not
declare freshness, the result says `unknown` instead of implying that the
process is current. A process identifier or interface/program identifier is
preferred over a vague natural-language question when available.

When the current source identity is available, add
`--current-snapshot-id <id>` or `--current-source-hash <sha256>` to `list`,
`describe`, `query`, `chat`, `view`, `impact`, `diff`, or `evaluate`. A changed
identity turns the result stale; an incomparable identity turns it unknown.
The agent must then re-analyze or confirm the source before treating the
projection as current. `impact` additionally reports whether the complete
process version is affected or only explicitly supplied evidence identifiers.

Role views are intentionally bounded and source-backed:

- `product-owner`: goal/trigger when explicitly described, actors, outcomes,
  decisions, exceptions, business claims, and open questions;
- `architect`: systems, interfaces, data objects, entry points, relationships,
  decisions, and exceptions;
- `developer`: ordered technical steps, claims, references, interfaces, data,
  relationships, and unresolved questions;
- `tester`: scenario-shaped steps, decision points, error paths, claims, and
  acceptance evidence.

An optional scenario file is a JSON array or `{ "scenarios": [...] }` with
`id`, `question`, optional `expectedProcessIds`, `requireEvidence`, and
`maxFreshness`. The evaluation output contains scenario ids and outcomes, not
the question text, so private questions do not become part of a committed
quality artifact.

## Scoped business glossary

The optional `process-glossary-catalog` connects a local environment's
business language with technical evidence. Each entry remains a normal,
versioned `GLOSSARY_ENTRY` with `projectId`, `snapshotId`, lifecycle status,
confidence, provenance, and evidence references. Optional fields add:

- `scopeType`: `global`, `environment`, `organization`, `project`, or `task`;
- `scopeId`: the identifier of the selected non-global scope;
- `aliases`: abbreviations, legacy names, and interface labels;
- `technicalRefs`: exact program, interface, table, job, or other identifiers;
- `relatedProcessIds`: process identifiers that may be used for deterministic
  query expansion;
- `domain`, `notes`, and `relatedEntityRefs` for local context.

Entries are applicable only when their scope matches the query context. The
resolver prefers the most specific applicable scope in this order:
`task` > `project` > `organization` > `environment` > `global`. Within the
same scope it uses exactness, lifecycle status, and confidence. If two entries
remain equally strong, the result is `ambiguous` with no selected entry. An
`ambiguous` entry is never used for process query expansion.

The catalog itself is supplied explicitly and must be workspace-relative. Do
not commit company names, host names, system aliases, credentials, or private
business values. Keep those entries in a local ignored artifact or an approved
sanitized project data package. The resolver reports catalog freshness and
keeps glossary evidence in the process query's `evidenceReferences`.

For a question such as “Was macht <legacy-term>?”, inspect
`glossaryResolutions`, `matches`, `selected`, `unknowns`, `nextQuestions`,
`freshness`, and `evidenceReferences` before answering. A resolved mapping is
still advisory and is not a source of truth.

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
7. Treat glossary mappings as evidence-backed vocabulary, not as permission to
   infer unsupported business meaning. Ask for scope or an exact identifier
   when resolution is ambiguous.

When a process query is incomplete, record the sanitized failure or correction
with `agent log`; never copy credentials, private runtime values, or raw source
content into the experience record.
