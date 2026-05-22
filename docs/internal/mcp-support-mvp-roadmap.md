## Epic

### Title
MCP Support for Zeus RPG PromptKit (Secure Local-First MVP)

### Labels
`epic`, `enhancement`, `api`, `priority:P1`

### Description
Build a secure, local-first MCP server wrapper for Zeus RPG PromptKit that exposes high-value read-mostly workflows first, reuses existing CLI/core services, and enforces strict guardrails for sensitive environments.

## Current Status Snapshot (2026-05-22)

Completed (implemented + test-covered):
- MCP server skeleton (`initialize`, `tools/list`, `tools/call`) over stdio
- allowlist policy gate + known-name validation for `--allow-tools`
- read-mostly MCP tools: `zeus.health`, `zeus.version`, `zeus.doctor`, `zeus.workflow`, `zeus.bundle`, `zeus.analyze`, `zeus.impact`, `zeus.assess-risk`, `zeus.query-table`, `zeus.query-sql`, `zeus.search-source`, `zeus.field-search`, `zeus.diff`, `zeus.generate-test`, `zeus.generate-checklist`, `zeus.qa`, `zeus.analyses`, `zeus.fetch`, `zeus.test-run`, `zeus.copy-to-workspace`, `zeus.serve`, `zeus.joblog`, `zeus.inspect-object`
- guarded write MCP tool: `zeus.write-sql` with staged `operation=plan|apply` safety gates
- guarded bridge MCP preview tool: `zeus.bridge` with `plan|report` and dry-run-only `stage|compile-run`
- response/error redaction middleware (including seeded fuzz-style redaction regression tests)
- append-only local MCP audit trail with explicit `schemaVersion`
- audit compatibility reader for legacy JSONL entries without `schemaVersion`
- expanded MCP contract suite (error mapping, stdio framing, redaction invariants, audit schema stability)
- bridge readiness checkpoint completed: CLI `bridge` is safe-by-default and currently supports preview/dry-run flows; non-dry-run mutation paths remain intentionally unimplemented/fail-closed

Next prioritized topic:
- Continue `zeus.write-sql` hardening (statement-level constraints + confirmation ergonomics), then decide staged MCP exposure strategy for `upsert`/`insert`/`update`.

CLI-to-MCP parity snapshot:
- remaining CLI commands not exposed as direct MCP tools: `upsert`, `upsert-sql`, `insert`, `update`, `pui-edit`, `docs:generate-catalog`
- `workflow run` execution remains intentionally out of MCP scope; current MCP `zeus.workflow` is read-only introspection

Success Criteria:
- MCP server can execute a curated local toolset over stdio/local transport with explicit write gating.
- Existing Zeus validation/guardrails are reused (no duplicated policy logic).
- S3/S4 operations remain blocked or explicitly operator-gated.
- Tool responses are deterministic and schema-stable for AI clients.
- Auditability and redaction are available from day 1.

Out of Scope (MVP):
- Autonomous remote mutation via bridge/apply.
- Ungated write operations (`insert`, `update`, `upsert*`) through MCP.

## Issue Backlog

### 1) Define MCP Contract and Security Boundaries
Labels: `enhancement`, `api`, `priority:P1`

Create an Architecture Decision Record for MCP integration.

Include:
- transport model (`stdio` first, local runtime only)
- threat model (secrets, data leakage, profile misuse)
- allow/deny policy matrix for command classes (S0..S4)
- mandatory output redaction rules
- auditing requirements

Acceptance Criteria:
- ADR committed with explicit go/no-go boundaries.
- Security policy matrix approved by maintainers.
- Clear MVP non-goals documented.

### 2) Implement MCP Server Skeleton and Health Tool
Labels: `enhancement`, `api`, `priority:P1`

Create a minimal MCP server process under `src/mcp/` with:
- capability advertisement
- tool registry abstraction
- `health`/`version` tool
- structured error mapping (Zeus exit/error -> MCP error response)

Acceptance Criteria:
- Server starts locally and answers health/version tool calls.
- Base integration test for startup + one tool call passes.

### 3) Add Read-Only Tool Adapter Layer (Core Reuse)
Labels: `enhancement`, `api`, `priority:P1`

Implement adapter wrappers to existing command/core logic for:
- `doctor`
- `query-table`
- `query-sql` (read-only enforced)
- `analyze` (safe subset)
- `impact`

Requirements:
- No shelling out where core functions already exist.
- Input schema validation per tool.
- Stable JSON output envelope.

Acceptance Criteria:
- Each tool callable via MCP with validated args and deterministic JSON output.
- Existing command validations remain authoritative.

### 4) Enforce Policy Gate for S3/S4 Classes
Labels: `enhancement`, `api`, `priority:P1`, `tech-debt`

Introduce a central MCP policy gate:
- block write tools by default (`insert`, `update`, `upsert`, `upsert-sql`)
- block remote mutation paths by default (`bridge apply`, `compile-run` non-dry)
- allow explicit future opt-in only via profile-level flags + operator approval context

Acceptance Criteria:
- Forbidden tool calls return explicit policy refusal errors.
- Policy tests cover positive and negative cases.

### 5) Add Redaction and Secret Safety Middleware
Labels: `enhancement`, `api`, `priority:P1`

Add middleware that sanitizes:
- credentials
- host secrets/internal ids if configured as sensitive
- known secret env values before response emission

Acceptance Criteria:
- Automated tests prove secret-bearing payloads are masked.
- No raw secret appears in MCP response snapshots.

### 6) Add MCP Audit Trail
Labels: `enhancement`, `api`, `priority:P2`

Write append-only local audit events for every MCP tool call:
- timestamp
- tool name
- profile
- status/result code
- dry-run flag
- policy decision (allowed/refused)

Acceptance Criteria:
- Audit file written for successful and refused calls.
- Schema documented and test-covered.

### 7) Integration and Contract Test Suite
Labels: `enhancement`, `api`, `priority:P2`

Add MCP-focused tests:
- tool schema contract tests
- error mapping tests
- policy gate tests
- deterministic output tests

Acceptance Criteria:
- CI target for MCP contract tests added.
- Regression tests prevent accidental write exposure.

### 8) Docs and Rollout Playbook
Labels: `enhancement`, `api`, `priority:P2`

Create docs for:
- local startup
- supported tools
- policy limitations
- security posture
- upgrade path for future guarded write capabilities

Acceptance Criteria:
- `docs/mcp/` contains operator guide + troubleshooting.
- Explicit warning section for unsupported/destructive operations.

### 9) Optional Phase-2 Spike: Guarded Write Pilot
Labels: `tech-debt`, `api`, `priority:P3`

Design-only spike (no default enablement) for guarded write access:
- scoped table allowlists
- mandatory dual-approval artifacts
- replay-safe idempotency keys

Acceptance Criteria:
- Technical design document with risks and rollback strategy.
- No write enablement merged by default.
- Status update (2026-05-22): initial guarded pilot implemented for `zeus.write-sql` with default-off `apply` execution gates.
- Status update (2026-05-22): profile/global `testData.allowTables` is now enforced for `zeus.write-sql apply` when configured.
- Status update (2026-05-22): `zeus.write-sql apply` now rejects `UPDATE`/`DELETE` without top-level `WHERE`.
- Status update (2026-05-22): `zeus.write-sql apply` now rejects trivial always-true predicates (for example `WHERE 1=1`).
- Status update (2026-05-22): `zeus.write-sql apply` now enforces configurable row-safety preflight thresholds via `testData.writeSafety`.
- Status update (2026-05-22): `zeus.write-sql apply` now rejects weak broad predicates (for example single-condition `IS NOT NULL`, `OR 1=1`).
