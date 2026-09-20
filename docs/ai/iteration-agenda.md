---
Title: Promptkit AI Iteration Agenda
Description: Living backlog for making Zeus immediately understandable and usable by CLI-based AI agents.
Last Updated: 2026-09-20
---

# Promptkit AI Iteration Agenda

This is the living agenda for improving the AI-facing Promptkit surface. The CLI
is canonical; MCP and the local viewer remain optional adapters. Each iteration
must preserve evidence-first behavior, explicit scope, safety levels, secret
hygiene, and recoverable experience records.

## Completed

### Iteration 0 — CLI-first foundation

- CLI agent bootstrap, live tool discovery, workflow suggestions, failure
  playbook, and local sanitized experience log exist.
- Session guidance explicitly treats MCP as optional.
- Spoolfile reading is available as a bounded IBM-i read-only route.
- Secret hygiene and safe-sharing checks are part of the repository contract.

### Iteration 1 — Agent entrypoint

- `agent preflight --goal "<goal>" --json` summarizes local readiness,
  effective context, visible profiles, capabilities, prior lessons, and the
  goal-based route without executing work.
- `agent prompt --goal "<goal>" --json` creates a copy-ready prompt enriched
  with the same preflight context and sanitized experience lessons.
- The AI documentation and session start sequence point to preflight first.

### Iteration 2 — Stable agent response contract

- All `agent ... --json` operations now expose the same versioned envelope with
  status, safety, scope, evidence, artifacts, warnings, next commands, and
  approval state.
- JSON failures preserve a non-zero exit code while emitting a machine-readable
  recovery envelope with stable failure code, lesson, and next safe step.
- The contract sanitizes text and paths before returning them to an agent.

### Iteration 3 — Experience intelligence

- `agent log summary --json` reports bounded recurring failures, reusable
  lessons, and recent outcomes.
- `agent log suggest --goal "<goal>" --json` ranks sanitized workarounds and
  next safe steps for the current goal.
- Preflight and generated prompts consume the intelligence while the JSONL log
  remains local, bounded, redacted, and Git-ignored.

### Iteration 4 — Contract and documentation drift tests

- Shared response-field metadata feeds the live AI orientation and is checked
  against the session prompt, start-here guide, CLI guide, and generated tool
  catalog.
- Tests verify the CLI-first entrypoint, the learning routes, catalog actions,
  safety documentation, and the optional nature of MCP.
- The catalog is regenerated from declarative command metadata as part of the
  verified change.

### Iteration 5 — Agent evaluation corpus

- A sanitized corpus covers local analysis, missing profiles, stale artifacts,
  spoolfile evidence, network failures, unresolved references, and unapproved
  mutations.
- `agent evaluate --list` discovers scenarios and
  `agent evaluate --scenario <id> --response-file <path>` scores command
  selection, scope, evidence, safety gating, and experience logging.
- Response files are workspace-contained and size-bounded; evaluation never
  executes the drafted response.

### Iteration 6 — Legacy-system usability

- Suggestions recognize RPG/RPGLE, CL/CLLE, DDS, Db2, IBM i jobs, spoolfiles,
  libraries, schemas, source files, and members.
- Preflight returns explicit `legacyConcepts` and `inputRequirements` instead of
  silently relying on placeholders or guessed values.
- Existing `analyze-run-manifest.json` files produce bounded, relative resume
  commands after manifest inspection.

### Iteration 7 — Cross-platform polish

- CLI stdout/stderr are explicitly configured for UTF-8, including Windows help.
- Bootstrap exposes portable, PowerShell, and POSIX invocation forms while
  generated agent commands remain portable by default.
- Deterministic platform invocation fixtures protect the three forms.

### Iteration 8 — Feedback-to-contract loop

- `agent feedback --json` turns repeated sanitized experience codes into
  reviewable candidates with affected surface, rationale, and regression
  scenario; it never changes contracts automatically.
- `agent feedback --scenario <id> --response-file <path> --json` exposes failed
  evaluation dimensions as observed findings without persisting raw responses.
- Optional `.zeus/agent-feedback.json` output is workspace-contained, bounded,
  redacted, and local-only.
- The CLI metadata, bootstrap, start-here guide, session prompt, and detailed
  guide all expose the same feedback route.

### Iteration 9 — Promotion fixtures and contract diff

- `agent feedback review` compares workspace-contained before/after contract
  files and returns a bounded, hashed, sanitized diff summary.
- Reviewable feedback candidates must have a non-empty contract diff and a
  matching sanitized regression fixture for every regression scenario.
- Fixture metadata explicitly declares sanitization, credential absence, and
  absence of private project identifiers.
- The review is read-only by default, never auto-promotes a candidate, and
  exposes stable blocker codes plus a machine-readable eligibility result.
- Agent bootstrap, command metadata, generated catalogs, start-here guidance,
  session prompt, and the detailed CLI guide expose the review route.

## Next iterations

### Delivered in the current process-intelligence iteration set

Iterations 10–12 are implemented in the existing Project Intelligence
foundation and are ready for pipeline verification:

- Iteration 10 adds seven versioned process contracts, neutral fixtures, core
  registry integration, provenance/evidence validation, and explicit review
  lifecycle rules.
- Iteration 11 adds deterministic discovery from canonical analysis or typed
  evidence graphs, stable candidate identifiers, technical flow grouping,
  source/derived evidence references, and unresolved-dependency diagnostics.
- Iteration 12 adds schema-constrained descriptions, a provider-neutral AI
  prompt, candidate-only generation, explicit review, and explicit publish
  gates. No process is published automatically.

Implementation and tests: `src/projectIntelligence/process/`,
`tests/project-intelligence-process.test.js`, and
`docs/ai/process-intelligence.md`. Delivered in PR #316 after protected-branch
verification.

### Iteration 13 — Process retrieval and query contract

- Added the deterministic read-only process retrieval service for list,
  describe, query, impact, and version diff operations.
- Added the workspace-relative CLI entrypoint `zeus process ...` and the
  machine-readable `PROCESS_QUERY_RESULT` response with evidence, freshness,
  confidence, lifecycle status, unknowns, and next questions.
- Added exact-identifier-first ranking, candidate/reviewed/published ordering,
  bounded relationship expansion, no-baseline diff behavior, and CLI/API tests.
- Updated the process-intelligence guide, agent start sequence, command
  metadata, generated tool catalog, test inventory, and orientation assertions.

Implementation and tests: `src/projectIntelligence/process/retrieval.js`,
`src/cli/commands/processCommand.js`, and
`tests/project-intelligence-process-retrieval.test.js`. Delivered in PR #317
after protected-branch verification; Iteration 14 was the next roadmap item and is now documented below as completed.

### Iteration 14 — Business glossary and legacy vocabulary

- Added a versioned `process-glossary-catalog` with reusable global,
  environment, organization, project, and task scopes.
- Added deterministic resolution for business terms, abbreviations, legacy
  names, aliases, and technical references with explicit `resolved`,
  `ambiguous`, and `unknown` outcomes.
- Integrated only unambiguous glossary mappings into process retrieval;
  ambiguous mappings remain visible and are never used to guess a process.
- Preserved glossary freshness, lifecycle, provenance, evidence, and related
  process references in the API and CLI response.
- Updated the CLI help, command metadata, generated tool catalog, AI guides,
  test inventory, and deterministic contract/CLI regression tests.

Implementation: `src/projectIntelligence/process/vocabulary.js`,
`src/projectIntelligence/process/retrieval.js`,
`src/cli/commands/processCommand.js`, and
`tests/project-intelligence-process-vocabulary.test.js`. Delivered in PR #318
after protected-branch verification. No credentials, private system
identifiers, or environment-specific values are part of the implementation.
The public release candidate [`v0.3.0-rc.1`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.3.0-rc.1)
was published from main SHA `7435637…` after PR #321; the release workflow and
fresh-download verification completed successfully. The next active roadmap
item at that time was Iteration 18; it is now completed in PR #328.

## Business Process Intelligence roadmap

The following iterations extend the existing Project Intelligence foundation.
They do not create a second, parallel knowledge system: technical evidence,
snapshots, provenance, freshness gates, the SQLite store, and the hybrid
retriever remain the foundation. The new layer adds a durable, domain-oriented
process model above the existing technical graph.

### Iteration 10 — Business-process contracts and provenance

Define and validate versioned contracts for:

- business process and process version
- process step, decision, actor, system, interface, data object, and exception
- evidence-backed process claim and process relationship
- glossary entry and process query result

Every claim must carry a snapshot reference, evidence references, derivation
class, confidence, and lifecycle status (`candidate`, `reviewed`, `published`,
`stale`, or `unknown`). Add neutral fixtures and contract tests without
system-specific names, credentials, host paths, or private runtime values.

### Iteration 11 — Deterministic process discovery

Derive process candidates from the existing technical graph and evidence:

- identify jobs, APIs, files, queues, and user-facing entry points
- group call and data-flow neighborhoods into candidate processes
- detect reads, writes, interfaces, decisions, and error paths
- record unresolved references and missing evidence explicitly

The output is a reviewable candidate catalog, not an automatically published
business truth.

### Iteration 12 — AI-assisted process description and review

Add a strict, schema-constrained description workflow that turns a candidate
into a readable process view containing trigger, goal, steps, decisions, data,
interfaces, exceptions, roles, evidence, uncertainty, and open questions.

The AI may summarize and classify evidence, but may not invent unsupported
steps. Publishing requires a deterministic validation result, an evidence
check, and an explicit review diff from candidate to published version.

### Iteration 13 — Process retrieval and query contract

Add a canonical read-only service and CLI routes such as:

```text
zeus process list
zeus process describe --id <process-id>
zeus process query --question "Was macht Schnittstelle XY?"
zeus process impact --id <process-id>
zeus process diff --id <process-id>
```

Retrieval should rank exact identifiers and confirmed process facts ahead of
derived summaries, expand through process relationships, verify sources, and
return process version, freshness, evidence, confidence, and unknowns in a
stable machine-readable response.

### Iteration 14 — Business glossary and legacy vocabulary (completed in PR #318)

Connect technical identifiers with business terms, synonyms, abbreviations,
legacy names, and interface aliases. Glossary changes must be versioned and
evidence-backed. Query expansion may improve discovery, but must never hide an
ambiguous mapping; ambiguous terms require clarification or an explicit
uncertainty in the answer. The implementation is complete; follow-up work
belongs to Iteration 15 and must reuse this glossary and process-query
contract.

### Cross-cutting knowledge slice — completed in current integration round

The project-neutral Display UI knowledge path now supports recursive `.dds` batch
extraction, controlled structural widget categories, deterministic read-only
catalog filtering, and an additive `zeus.queryKnowledge()` API. Batch mode
requires separate general and local-only output roots. The local inventory may
contain source-relative paths, hashes, and decoded projections for review, but
it is sensitive project data and is never committed, packaged, exposed through
MCP, or promoted into the final catalog. Only synthetic fixtures and
project-neutral contracts belong in the public repository.

### Cross-cutting hardening — concurrent analysis registry writers

- Protected every registry mutation's read-modify-write sequence with a local,
  cross-process lock while keeping list/read operations unchanged.
- Used a bounded wait and stable `REGISTRY_BUSY` recovery code instead of
  silently overwriting another writer's update.
- Added dead-owner reclamation after a stale threshold; active locks are never
  reclaimed solely because they are old.
- Added a narrow ignore rule for temporary registry lock directories and
  cross-process regression tests using only synthetic workspaces.

Implementation: `src/workspace/analysisRegistryService.js` and
`tests/analysis-registry-service.test.js`. No credentials, private paths, or
project-specific identifiers are part of the implementation. Iteration 18
followed this hardening work and is now completed in PR #328.

### Iterations 15–17 — completed in the current integration block

The three iterations were implemented consecutively on one feature branch,
with neutral fixtures, contract validation, CLI/API coverage, documentation,
and secret/private-content checks:

- Iteration 15 adds `process view` for `product-owner`, `architect`,
  `developer`, and `tester`, plus the local read-only `process chat` adapter.
  All views reuse the same process facts, evidence, lifecycle, freshness, and
  unknowns; they do not invent role-specific business meaning.
- Iteration 16 compares recorded catalog identity with a current snapshot id or
  SHA-256 source hash. Mismatches become stale, incomparable signals become
  unknown, and process impact explicitly reports whether reanalysis is needed.
- Iteration 17 adds `process evaluate` and the
  `PROCESS_EVALUATION_RESULT` contract. Deterministic metrics cover process
  coverage, evidence ratio, unresolved relationships, unknowns, freshness,
  review needs, and optional query scenarios without persisting question text.

Implementation: `src/projectIntelligence/process/views.js`,
`freshness.js`, `evaluation.js`, the process CLI, and
`tests/project-intelligence-process-agent-views.test.js`. Delivered in PR #327
after protected-branch verification. No credentials, private system
identifiers, host paths, or environment-specific values are part of it.

### Iteration 15 — Role-based views and optional chat adapter (completed)

Build role-specific projections from the same process facts:

- Product Owner: goal, outcome, rules, roles, and business exceptions
- Architect: systems, interfaces, dependencies, and data flows
- Developer: programs, symbols, source spans, and implementation details
- Tester: decisions, scenarios, error paths, and acceptance evidence

Expose an optional local chat adapter over the same query service. CLI remains
the canonical and testable interface; MCP or a UI must not become the source
of truth.

### Iteration 16 — Change impact, freshness, and process versions (completed)

When a source snapshot changes, identify affected process claims and mark the
corresponding process versions as fresh, stale, or unknown. Provide a bounded
process diff and impact view. The answer service must refuse to present stale
or unverified process knowledge as current without clearly saying so.

### Iteration 17 — Process quality and evaluation corpus (completed)

Add deterministic fixtures and evaluation scenarios for:

- process discovery and boundary quality
- evidence coverage and citation correctness
- unresolved dependencies and incomplete process paths
- interface and data-flow questions
- stale-knowledge refusal
- role-specific answer quality
- protection against credentials and private project content

Track coverage, evidence ratio, unresolved count, freshness, and answer
reproducibility as reviewable metrics. The first deterministic evaluation
surface is now available through `process evaluate`; the experience-driven
scenario and improvement loop was delivered in Iteration 18.

### Iteration 18 — Experience-driven process improvement (completed in PR #328)

Extend the existing sanitized experience loop to record process questions that
were blocked, ambiguous, incomplete, stale, or corrected. Produce reviewable
improvement candidates for glossary entries, extraction rules, prompts, and
contracts. No experience record may directly publish process knowledge or
modify authoritative contracts.

Implementation: `src/agent/processExperience.js`, the `process experience` and
`process improvements` CLI routes, and
`tests/project-intelligence-process-experience.test.js`. The implementation
reuses the local `.zeus/agent-experience.jsonl` log, applies secret/path
hygiene, groups repeated signals deterministically, and requires human review
plus a sanitized regression fixture before promotion. Delivered in PR #328
after protected-branch verification. No process experience can publish
knowledge or modify an authoritative contract automatically.

### Iteration 19 — Cross-catalog learning and promotion readiness (completed in PR #330)

Use review-only process-improvement reports as bounded learning inputs across
separate catalogs or environments. Combine only stable candidate dimensions and
short catalog fingerprints; never copy raw catalog names, source content, or
private runtime values into a shared readiness artifact.

The `process promotion-check` CLI route requires at least two distinct catalog
fingerprints and an explicitly sanitized regression fixture before reporting a
candidate as `ready-for-human-review`. Missing evidence produces stable blocker
codes. The result is read-only, keeps `automaticPromotion` and
`promotionAllowed` false, and still requires domain-owner review plus an
explicit change to the authoritative glossary, extraction rule, prompt, or
contract.

Implementation: `src/agent/processPromotion.js`, the `process
promotion-check` CLI route, the anonymized catalog fingerprint projection in
`src/agent/processExperience.js`, and
`tests/project-intelligence-process-promotion.test.js`. The implementation
combines bounded local reports, validates sanitized regression-fixture
metadata, emits stable blockers, and never publishes or promotes process
knowledge automatically. Delivered in PR #330 after protected-branch
verification; all required checks passed.

### Iteration 20 — Versioned process-answer regression gate (completed in PR #333)

Build a versioned, sanitized process-answer regression corpus and explicit
reviewer decisions so repeated business-process questions can be evaluated
before a catalog or prompt change is accepted. Keep catalog fingerprints,
scenario outcomes, evidence expectations, freshness limits, and reviewer
decisions bound to the exact corpus and evaluation run. The result is
review-only: it must never publish process knowledge or promote a change by
itself.

Implementation: `src/agent/processAnswerRegression.js`, the
`process regression-check` CLI route, the neutral corpus and reviewer-decision
templates under `docs/ai/`, and
`tests/project-intelligence-process-answer-regression.test.js`. The feature
provides deterministic scenario checks, bounded catalog fingerprints, stable
evaluation identifiers, explicit sanitized reviewer decisions, and safe
`.zeus/` output handling. The existing `adm-zip` production dependency was
also raised to `0.6.1` while closing the CI audit gate. Delivered in PR #333
after local verification, secret/private-content scanning, protected-branch
verification, and a green main pipeline at merge commit `0e3ae94`.

Iteration 21 is completed in PR #335 after local verification, secret/private-
content scanning, protected-branch verification, and a green PR pipeline. The
merge commit is `627ff7e`.

### Iteration 21 — Process-answer drift reports (completed in PR #335)

Compare two versioned process-answer regression results across catalog
revisions and produce a bounded, review-only drift report. The report keeps
catalog, corpus, evaluation, and review identities separate; detects scenario
set changes, regressions, evidence/freshness/status/match drift, answer
contract changes, reproducibility changes, and pending review; emits stable
blocker codes; and provides the smallest safe follow-up command.

Implementation: `src/agent/processAnswerDrift.js`, the `process drift-check`
CLI route, generated tool-catalog metadata, and
`tests/project-intelligence-process-answer-drift.test.js`. The output is
workspace-relative, bounded, hashed where scenario identity is needed, and
does not expose questions, answer text, matched process identifiers, source
content, absolute paths, credentials, or private runtime values.

Iteration 22 is completed in PR #337 after local verification, secret/private-
content scanning, protected-branch verification, and a green main pipeline.
The merge commit is `bb58cdd`.

### Iteration 22 — Reviewer explanations and approval history (completed in PR #337)

Add the read-only `process drift-review` projection on top of a persisted
`process-answer-drift-result`. The projection explains stable blocker codes in
bounded reviewer language, links optional sanitized decisions to the exact
hashed `driftId`, hashes reviewer identities, and keeps raw questions, answer
content, process IDs, source content, and free-text notes out of the shared
result. Explicit `approve`, `reject`, and `defer` decisions remain evidence of
review only; `automaticPromotion` and `promotionAllowed` stay false.

Implementation: `src/agent/processAnswerReview.js`, the `process drift-review`
CLI route, generated tool-catalog metadata, the AI workflow documentation,
and `tests/project-intelligence-process-answer-review.test.js`. Delivered in
PR #337 with 966 passing tests, 3 skipped tests, a clean dependency audit, and
no credentials or private runtime values in the staged change.

The next active roadmap item is Iteration 23: validate approval-history
consistency across repeated reviews. It should detect contradictory or stale
decisions for the same drift identity, keep the latest decision explainable,
and remain a bounded read-only diagnostic without changing catalog or review
state automatically.

Iteration 23 is completed in PR #339 after local verification, secret/private-
content scanning, protected-branch verification, and a green PR and main
pipeline. The merge commit is `1a7153d`.

### Iteration 23 — Approval-history consistency (completed in PR #339)

Extend `process drift-review` with a deterministic `approval.consistency`
projection. It distinguishes missing history, no matching decision, consistent
repeated decisions, and contradictory decisions for the exact drift identity.
Older opposing decisions are counted as stale, the latest bounded decision
remains explainable, and conflicts keep the result in `needs-review`. The
projection stays read-only; `automaticPromotion` and `promotionAllowed` remain
false.

Implementation: `src/agent/processAnswerReview.js`,
`tests/project-intelligence-process-answer-review.test.js`, and the reviewer
projection documentation. Delivered with 967 passing tests, a clean dependency
audit, and no credentials or private runtime values in the staged change.

The next active roadmap item is Iteration 24: add a bounded review-history
summary that lets an agent find unresolved conflicts and stale decisions across
multiple drift identities without exposing questions, answers, source content,
or private project identifiers.

### Iteration 24 — Review-history summary (completed in PR #341)

Add the read-only `process drift-review-summary` operation for a sanitized
review history. It aggregates bounded conflict and stale-decision findings
across multiple hashed drift identities, exposes the latest bounded decision
for each identity, and keeps questions, answers, source content, process IDs,
private identifiers, and automatic promotion out of the result.

Implementation: `src/agent/processAnswerReview.js`, the `process
drift-review-summary` CLI route, generated tool-catalog metadata, the AI
workflow documentation, and
`tests/project-intelligence-process-answer-review.test.js`. Delivered in PR
#341 with 968 passing tests, 3 skipped tests, a clean dependency audit, a
green PR and main pipeline, and no credentials or private runtime values in
the staged change. The merge commit is `df5c60f`.

The next active roadmap item is Iteration 25: make review-history freshness
and retention explicit, so an agent can distinguish current evidence from
bounded historical context and receive a safe local cleanup/review step
without deleting or mutating review records automatically.

### Iteration 25 — Review-history retention preview (completed in PR #343)

Add the read-only `process drift-review-retention` operation for a sanitized
review history. It classifies decisions as `fresh`, `aging`, `historical`, or
`future` using explicit reproducible policy inputs, reports bounded freshness
metrics, and exposes only superseded historical decisions as retention
candidates. The latest historical decision and every future-dated decision
remain review-required. Automatic deletion and promotion are explicitly
disabled, and output contains only hashed identities and reason codes.

Implementation: `src/agent/processAnswerReview.js`, the `process
drift-review-retention` CLI route, generated tool-catalog metadata, the AI
workflow documentation, and
`tests/project-intelligence-process-answer-review.test.js`. Delivered in PR
#343 with 969 passing tests, 3 skipped contract tests, a clean dependency
audit, a green PR and main pipeline, and no credentials or private runtime
values in the staged change. The merge commit is `6bd14fc`.

### Iteration 26 — Reproducible review receipts (completed in PR #345)

Add the read-only `process drift-review-receipt` operation for a sanitized
review history. It recomputes the retention projection, records a stable
receipt identifier and history fingerprint, preserves the explicit policy and
inspection timestamp, and exposes only bounded metrics, hashed candidates,
and reason codes. The receipt deliberately records no decision: automatic
deletion and promotion remain disabled, and the safe next step is an explicit
human or agent review.

Implementation: `src/agent/processAnswerReview.js`, the `process
drift-review-receipt` CLI route, generated tool-catalog metadata, the AI
workflow documentation, and
`tests/project-intelligence-process-answer-review.test.js`. Delivered in PR
#345 with 969 passing tests, 3 skipped contract tests, a clean dependency
audit, a green PR and main pipeline, and no credentials or private runtime
values in the staged change. The merge commit is `d6a59f9`.

The roadmap is paused after Iteration 26 until an explicit follow-up. The
following naming iteration is now being prepared locally; it is not yet
committed or published.

### Iteration 27 — Neutral display-UI terminology (release candidate 0.3.0-rc.2)

Replace vendor-specific abbreviations and product labels in the public
Promptkit surface with neutral display-file UI terminology while preserving the
technical behavior:

- canonical CLI and MCP names describe display-file UI inspection and editing;
- internal modules, paths, schemas, result fields, tests, generated catalogs,
  examples, and documentation use neutral names consistently;
- local parsing and editing behavior remains unchanged, including the ability
  to read and write the supported display-file UI format;
- no product affiliation, sponsorship, endorsement, or ownership is implied;
- the public surface contains no vendor-specific product name or abbreviation;
- generated artifacts and privacy checks are regenerated and verified;
- the change is treated as a public naming change and requires release-note and
  migration documentation before publication.

The implementation is prepared for the `0.3.0-rc.2` release candidate. The
release workflow remains the final source-of-truth gate for the merged `main`
commit, package artifact, provenance, and fresh-download verification.

### Iteration 28 — Confidential legacy-source boundary and inventory (planned, not started)

The next proposed iteration uses real legacy source material only as a local
learning input. It must establish a hard confidentiality boundary before any
process discovery is attempted:

- source files are read-only inputs and never leave the local workspace;
- standard output contains no source lines, original paths, source identifiers,
  business names, or environment-specific values;
- the local inventory exposes only bounded counts, language/type coverage,
  parser status, anonymized evidence identifiers, and stable reason codes;
- private-to-anonymized mappings remain local, are not exportable, and are not
  committed to the public Promptkit repository;
- supported evidence patterns cover RPGLE/RPGLE includes, CLLE orchestration,
  DDS structures, SQL objects/statements, copy/include edges, calls, file
  access, transactions, and error handling;
- inventory is deterministic and incremental, using local fingerprints so a
  multi-million-line source set does not need full reprocessing every time;
- unsupported syntax, decoding failures, unresolved references, and parser
  limitations are reported explicitly instead of being silently guessed;
- export and fixture guards reject raw source content, source names, private
  paths, credentials, and project-specific identifiers before an artifact can
  be shared or committed.

The iteration produces an anonymized, machine-readable source inventory and a
bounded evidence manifest only. It does not publish process knowledge, infer
business meaning without evidence, or modify source files. Completion requires
local-only tests with synthetic canaries, secret/private-content scanning,
portable path checks, deterministic rerun verification, and documentation of
the safe handoff to the next iteration.

Possible follow-up iterations, still inactive until explicitly approved, are:

1. a cross-language legacy evidence graph;
2. process-candidate extraction from job, program, data, and transaction flows;
3. reviewed process descriptions and safe process-query answers built only from
   anonymized, evidence-linked artifacts.

The roadmap remains paused after Iteration 26. Iteration 28 is a planning item
only and must not be implemented without explicit follow-up.

## Business Process Intelligence vertical slice

Iterations 10–13 should first deliver one complete neutral example process:

1. technical evidence and graph references
2. process candidate
3. reviewed process version
4. `process describe` output
5. `process query` answer with evidence and freshness

This vertical slice is the acceptance gate before broad extraction across a
legacy ERP system. It keeps the work reversible and proves that discovery,
storage, review, retrieval, and agent consumption use the same contracts.

## Agenda maintenance rules

- Move an iteration to **Completed** only after implementation, tests,
  documentation, secret scan, and pipeline verification are complete.
- Record the merge or release reference and update `Last Updated` in the same
  change.
- Keep candidate process knowledge separate from published process knowledge.
- Add a sanitized regression fixture whenever a failure changes a prompt,
  contract, extractor, retrieval rule, or glossary mapping.
- Never commit credentials, secrets, private runtime values, host paths, or
  project-specific identifiers into fixtures, examples, prompts, or reports.

## Definition of done for each iteration

- A first-time AI can discover the capability without reading the whole tree.
- The default path is local and read-only until a higher safety level is needed.
- The result is machine-readable and includes the next smallest safe command.
- Scope, provenance, uncertainty, and approval requirements are explicit.
- Failures produce a stable recovery path and one sanitized experience record.
- Tests cover the new contract and no credential or private runtime value is
  committed.
