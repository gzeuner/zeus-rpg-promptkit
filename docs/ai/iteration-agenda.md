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

## Next iterations

### Iteration 2 — Stable agent response contract

Normalize all agent-facing JSON responses around `ok`, `status`, `safety`,
`scope`, `evidence`, `artifacts`, `warnings`, `nextCommands`, and
`approvalRequired`. Map command failures to stable `failureCode`, `lesson`, and
`nextSafeStep` fields.

### Iteration 3 — Experience intelligence

Add `agent log summary` and `agent log suggest --goal` with recurring failure
counts, reusable lessons, and safe workarounds. Keep records local, bounded,
sanitized, and excluded from Git. Add tests that reject secret-bearing lessons.

### Iteration 4 — Contract and documentation drift tests

Generate or verify the session prompt, AI orientation, CLI help, and tool
catalog from shared command metadata. Add an agent-contract test that checks
documented commands, safety levels, examples, and CLI-only operation without
MCP.

### Iteration 5 — Agent evaluation corpus

Create sanitized scenarios for local analysis, missing profiles, stale
artifacts, spoolfile evidence, network failure, unresolved references, and
unapproved mutation requests. Score command selection, scope discipline,
evidence citation, safety gating, and experience logging.

### Iteration 6 — Legacy-system usability

Improve intent routing and vocabulary for RPG, CL, DDS, Db2, IBM-i jobs,
spoolfiles, libraries, schemas, members, and source files. Prefer explicit
missing-input reports over guesses and expose resume commands from manifests.

### Iteration 7 — Cross-platform polish

Fix UTF-8 rendering in Windows CLI help, make PowerShell and POSIX examples
consistent, and add deterministic output fixtures for Windows and Linux.

## Definition of done for each iteration

- A first-time AI can discover the capability without reading the whole tree.
- The default path is local and read-only until a higher safety level is needed.
- The result is machine-readable and includes the next smallest safe command.
- Scope, provenance, uncertainty, and approval requirements are explicit.
- Failures produce a stable recovery path and one sanitized experience record.
- Tests cover the new contract and no credential or private runtime value is
  committed.
