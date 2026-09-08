---
Title: Promptkit AI Iteration Agenda
Description: Living backlog for making Zeus immediately understandable and usable by CLI-based AI agents.
Last Updated: 2026-09-08
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
after protected-branch verification; the next active roadmap item is Iteration 14.

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

### Iteration 14 — Business glossary and legacy vocabulary

Connect technical identifiers with business terms, synonyms, abbreviations,
legacy names, and interface aliases. Glossary changes must be versioned and
evidence-backed. Query expansion may improve discovery, but must never hide an
ambiguous mapping; ambiguous terms require clarification or an explicit
uncertainty in the answer.

### Iteration 15 — Role-based views and optional chat adapter

Build role-specific projections from the same process facts:

- Product Owner: goal, outcome, rules, roles, and business exceptions
- Architect: systems, interfaces, dependencies, and data flows
- Developer: programs, symbols, source spans, and implementation details
- Tester: decisions, scenarios, error paths, and acceptance evidence

Expose an optional local chat adapter over the same query service. CLI remains
the canonical and testable interface; MCP or a UI must not become the source
of truth.

### Iteration 16 — Change impact, freshness, and process versions

When a source snapshot changes, identify affected process claims and mark the
corresponding process versions as fresh, stale, or unknown. Provide a bounded
process diff and impact view. The answer service must refuse to present stale
or unverified process knowledge as current without clearly saying so.

### Iteration 17 — Process quality and evaluation corpus

Add deterministic fixtures and evaluation scenarios for:

- process discovery and boundary quality
- evidence coverage and citation correctness
- unresolved dependencies and incomplete process paths
- interface and data-flow questions
- stale-knowledge refusal
- role-specific answer quality
- protection against credentials and private project content

Track coverage, evidence ratio, unresolved count, freshness, and answer
reproducibility as reviewable metrics.

### Iteration 18 — Experience-driven process improvement

Extend the existing sanitized experience loop to record process questions that
were blocked, ambiguous, incomplete, stale, or corrected. Produce reviewable
improvement candidates for glossary entries, extraction rules, prompts, and
contracts. No experience record may directly publish process knowledge or
modify authoritative contracts.

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
