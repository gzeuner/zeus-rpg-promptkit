---
Title: Promptkit AI Iteration Agenda
Description: Living backlog for making Zeus immediately understandable and usable by CLI-based AI agents.
Last Updated: 2026-09-06
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

## Next iterations

### Iteration 8 — Feedback-to-contract loop

Turn repeated evaluation findings and experience codes into a small, reviewable
set of prompt, documentation, and command-contract improvements. Keep the
feedback corpus sanitized, explain why a rule changed, and add a regression
fixture for every promoted lesson.

## Definition of done for each iteration

- A first-time AI can discover the capability without reading the whole tree.
- The default path is local and read-only until a higher safety level is needed.
- The result is machine-readable and includes the next smallest safe command.
- Scope, provenance, uncertainty, and approval requirements are explicit.
- Failures produce a stable recovery path and one sanitized experience record.
- Tests cover the new contract and no credential or private runtime value is
  committed.
