---
Title: MCP Operator Guide
Description: Local-first MCP startup, policy boundaries, and troubleshooting for Zeus RPG PromptKit.
Last Updated: 2026-05-25
---

# MCP Operator Guide

## Purpose

Expose a safe, local-only subset of Zeus capabilities over MCP stdio for AI clients and automation.

## Security Posture

- Transport: stdio only (local process boundary)
- Default behavior: minimal safe default surface (`zeus.health`, `zeus.version`, `zeus.doctor`)
- Policy: explicit allowlist gate (`--allow-tools`) for any broader tool surface
- Curated discovery surfaces: first-class MCP `resources/*` and `prompts/*` for safe docs/metadata/prompt access
- Redaction: response/error masking for common secret patterns
- Audit: append-only local JSONL audit trail for `tools/call`
- Runtime guardrails: per-tool timeout and maximum response-size limits with deterministic `-32000` failures
- Local path policy: local path inputs for local source-root tools must resolve inside the current workspace root, including absolute paths

Out of scope for MVP:
- remote apply/compile style operations
- ungated write execution
- bridge mutation execution (`apply` / non-dry-run compile paths)

## Start MCP Server

```bash
node cli/zeus.js mcp serve --stdio true --verbose
```

Without `--allow-tools`, MCP exposes only `zeus.health`, `zeus.version`, and `zeus.doctor`.

Restrict exposed tools explicitly for real workflows (recommended):

```bash
# Minimal safe set for onboarding + discovery
node cli/zeus.js mcp serve --verbose \
  --allow-tools zeus.health,zeus.version,zeus.doctor,zeus.profiles,zeus.resolve-object,zeus.query-table,zeus.query-sql,zeus.search-source,zeus.validate-rpg-sql,zeus.inspect-object,zeus.docs-generate-catalog
```

For full agentic analysis add: `zeus.analyze,zeus.workflow,zeus.impact,zeus.assess-risk,zeus.bundle,zeus.generate-test,zeus.generate-checklist,zeus.validate-rpg-sql`

**Recommended minimal allow-list for onboarding a new system (discovery + validation):**
`zeus.health,zeus.doctor,zeus.profiles,zeus.onboarding,zeus.resolve-object,zeus.inspect-object,zeus.query-table,zeus.query-sql,zeus.search-source,zeus.validate-rpg-sql,zeus.field-search,zeus.docs-generate-catalog`

See also the new onboarding guide: `docs/quickstart/onboarding-new-ibm-i.md` (covers connection, source location, PGM/Table objects, metadata & data discovery).

## Supported MCP Methods (Current)

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

Curated resources expose authoritative docs and structured metadata only.

Curated prompts expose the standard Zeus session bootstrap prompt plus prompt-template entries from the internal prompt registry.

## Supported MCP Tools (Current)

The default safe surface (S0/S1 local evidence, config, searches, and bounded catalog regen) is exposed automatically for AI agents. Remote or higher-risk tools require explicit `--allow-tools`.

Default (no --allow-tools needed):
- `zeus.health`, `zeus.version`, `zeus.doctor`, `zeus.profiles`
- `zeus.search-source`, `zeus.field-search`
- `zeus.docs-generate-catalog`
- `zeus.analyze`, `zeus.impact`, `zeus.assess-risk`
- `zeus.generate-test`, `zeus.generate-checklist`, `zeus.qa`
- `zeus.workflow`, `zeus.bundle`

Everything else (fetch*, query*, write*, bridge, joblog, inspect, etc.) requires explicit allowlist.

Example with a profile (recommended for real-target agent sessions):
```bash
source ./config/load-env.sh myenv
node cli/zeus.js doctor --profile my-profile
# MCP server with safe local surface + some read
./.local/mcp/start-zeus-mcp-myenv.sh
# or
node cli/zeus.js mcp serve --stdio true --allow-tools zeus.health,zeus.profiles,zeus.search-source,zeus.analyze,zeus.workflow,zeus.bundle,zeus.docs-generate-catalog,...
```

## Perfect AI Agent Interaction Pattern (Example)

An AI can bootstrap and operate fully via MCP without prior hard-coded knowledge beyond the protocol:

1. `initialize`
2. `resources/list` then `resources/read` for `zeus://docs/ai/session-prompt.md`, `zeus://docs/tool-catalog.json`, `zeus://metadata/mcp-tools.json`, `zeus://metadata/workflow-presets.json`
3. `prompts/get` `zeus.session.start` with goal describing the task (e.g. "Perform local analysis of the RPG sources in this workspace and prepare a modernization review bundle")
4. `tools/call` `zeus.doctor` + `zeus.profiles`
5. `tools/call` `zeus.help` (for self-service guidance) or `zeus.search-source`
6. `tools/call` `zeus.analyze` with `source` pointing to local sources + `program`
7. Use `resources/list` / `resources/read` `zeus://runs/PROGRAM/...` to fetch manifests, reports and generated `ai_prompt_*.md` files
8. `tools/call` `zeus.bundle` or `zeus.impact` etc.
9. `tools/call` `zeus.help` "bundle" for usage.

All via stdio, all outputs structured + enveloped, all bounded to workspace, secrets redacted. Use the default allowlist for pure local evidence work.
```

Curated resources currently include:

- authoritative docs such as `tool-catalog.md`, `tool-catalog.json`, `cli/reference.md`, `ai/session-prompt.md`, and this operator guide
- structured metadata for command catalog, MCP tool inventory, workflow presets, and prompt contracts

Curated prompts currently include:

- `zeus.session.start`
- `zeus.prompt.documentation`
- `zeus.prompt.error-analysis`
- `zeus.prompt.defect-analysis`
- `zeus.prompt.modernization`
- `zeus.prompt.architecture-review`
- `zeus.prompt.refactoring-plan`
- `zeus.prompt.test-generation`
- `zeus.prompt.security-analysis`

`zeus.joblog` note:

- prefers `QSYS2.JOBLOG_INFO` when available
- falls back to `QSYS2.HISTORY_LOG_INFO` on older or limited systems
- when fallback is used, the MCP payload includes `backend = HISTORY_LOG_INFO`
- severity filtering in fallback mode is best-effort and may not exactly match `JOBLOG_INFO` semantics

`zeus.write-sql` guardrails:

- `operation=plan` is non-mutating (validation + readiness preview)
- `operation=apply` is blocked unless `ZEUS_MCP_ENABLE_WRITES=true`
- `operation=apply` requires `ZEUS_MCP_WRITE_CONFIRM_TOKEN` and matching `confirmToken` input
- production profiles (`productionSystem=true`) remain hard-blocked for apply
- if `testData.allowTables` is configured for the profile/global config, `operation=apply` is allowed only when SQL targets an allowlisted table
- `operation=apply` rejects `UPDATE`/`DELETE` without a top-level `WHERE` clause
- `operation=apply` also rejects trivial always-true `WHERE` predicates (for example `WHERE 1=1`)
- `operation=apply` rejects additional weak broad predicates (for example single-condition `IS NOT NULL` or `OR 1=1`)
- row-safety limits are configurable via `testData.writeSafety` (`enabled`, `maxRowsAffected`, `maxRowsByStatement`, `blockWhenCountUnavailable`)
- callers can pass optional `maxRowsAffected` per request to tighten limits further (never loosen profile policy)

Bridge status note:

- MCP `zeus.bridge` is exposed as guarded preview tool
- allowed operations: `plan`, `report`, `stage` (dry-run only), `compile-run` (dry-run only)
- mutation/apply semantics are blocked by MCP policy with deterministic refusal errors
- CLI `bridge` remains experimental/opt-in and non-dry-run mutation paths stay intentionally unimplemented/fail-closed

## Cursor Contract

Cursor-enabled tools currently:

- `zeus.search-source`
- `zeus.field-search`
- `zeus.impact`
- `zeus.fetch` (operation=`files`)
- `zeus.copy-to-workspace` (operation=`plan`)

Behavior:

- responses include `cursor`, `cursorOffset`, and `nextCursor`
- `nextCursor` is an opaque versioned token
- clients should treat cursor values as opaque and only replay them back to the same tool
- legacy numeric cursor input is rejected and no longer supported
- deterministic ordering is preserved across pages for a stable request shape

## Deterministic Error Mapping

- Parse error: `-32700`
- Invalid request / invalid params: `-32600` / `-32602`
- Method/tool not found or policy refusal: `-32601`
- Tool runtime failure: `-32000`

Runtime failure notes:

- DB-backed runtime failures from `zeus.joblog` and `zeus.inspect-object` are normalized to stable operator guidance (raw provider internals are not surfaced)
- timed-out tools return deterministic timeout errors (`-32000`)
- oversized tool payloads return deterministic response-size errors (`-32000`)

## Local Audit Trail

Default path:

```text
.local/mcp/audit/mcp-audit.jsonl
```

Event contract highlights:

- append-only JSONL
- `eventType: "mcp.tools.call"`
- `schemaVersion` explicitly included
- policy/status/result code fields included for success/refusal/error

## Troubleshooting

1. Startup fails with unknown `--allow-tools`:
   Use only known MCP tool names from `tools/list`.
2. Tool call refused:
   Check current allowlist and policy message in MCP error payload.
3. Missing DB-backed results:
   Validate profile configuration with `doctor` first.
4. Suspected sensitive output:
   Prefer narrower allowlist and verify redaction in both response and audit output.
