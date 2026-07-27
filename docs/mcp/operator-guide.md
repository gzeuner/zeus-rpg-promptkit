---
Title: MCP Operator Guide
Description: Local-first MCP startup, policy boundaries, and troubleshooting for Zeus RPG PromptKit.
Last Updated: 2026-07-27
---

# MCP Operator Guide

## Purpose

Expose a safe, policy-gated subset of Zeus capabilities over MCP stdio for AI clients and automation.

## Security Posture

- Transport: stdio only (local process boundary)
- Default behavior: safe expanded default surface from `src/mcp/mcpPolicy.js` (`DEFAULT_MCP_SAFE_TOOL_NAMES`) â€” S0/S1 local tools **plus** selected S2 remote-read tools; start with `zeus.agent.bootstrap` when you want a live bootstrap payload; **not** S3/S4 writes or project-knowledge index/write
- Policy: `--allow-tools` **replaces** the allowlist (does not merge/extend). Omit it to use the full default safe list; pass a smaller list to restrict further
- Curated discovery surfaces: first-class MCP `resources/*` and `prompts/*` for safe docs/metadata/prompt access
- Redaction: response/error masking for common secret patterns
- Audit: append-only local JSONL audit trail for `tools/call`
- Runtime guardrails: per-tool timeout and maximum response-size limits with deterministic `-32000` failures
- Local path policy: local path inputs for local source-root tools must resolve inside the current workspace root, including absolute paths

**Live tool names for agents:** prefer MCP `tools/list`, `zeus.agent.bootstrap`, and `zeus.help` (overview) over hunting markdown. Catalog docs remain authoritative for purpose/safety levels but are secondary for â€œwhat is available right now.â€

Out of scope for MVP:

- remote apply/compile style operations
- ungated write execution
- bridge mutation execution (`apply` / non-dry-run compile paths)

## Start MCP Server

```bash
node cli/zeus.js mcp serve --stdio true --verbose
```

Without `--allow-tools`, MCP exposes the full default safe surface (`DEFAULT_MCP_SAFE_TOOL_NAMES` in `src/mcp/mcpPolicy.js`).

### Recommended default allowlist (must match runtime)

This CSV is the **same set** as the code default. Use it when you want an explicit, reproducible allowlist (equivalent to omitting `--allow-tools`). You may pass a **smaller** subset to restrict the agent.

```bash
node cli/zeus.js mcp serve --verbose \
  --allow-tools zeus.health,zeus.version,zeus.profiles,zeus.doctor,zeus.help,zeus.agent.bootstrap,zeus.onboarding,zeus.resources,zeus.discover-environment,zeus.analyze,zeus.workflow,zeus.bundle,zeus.search-source,zeus.field-search,zeus.investigation.start,zeus.investigation.focus,zeus.investigation.search,zeus.investigation.generate-prompt,zeus.resolve-object,zeus.inspect-object,zeus.query-table,zeus.query-sql,zeus.impact,zeus.assess-risk,zeus.generate-test,zeus.generate-checklist,zeus.qa,zeus.validate-rpg-sql,zeus.analyses,zeus.fetch-member,zeus.diff,zeus.copy-to-workspace,zeus.joblog,zeus.docs-generate-catalog,zeus.serve,zeus.test-run,zeus.project-knowledge.discover,zeus.project-knowledge.status
```

**Note:** `--allow-tools` replaces the default list. If you paste an incomplete CSV, tools such as `zeus.resources`, `zeus.investigation.*`, and `zeus.project-knowledge.*` disappear even though they are on the code default.

See also: `docs/quickstart/onboarding-new-ibm-i.md` (connection, source location, PGM/table objects, metadata & data discovery).

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

Source of truth for the default safe surface: `src/mcp/mcpPolicy.js` (`DEFAULT_MCP_SAFE_TOOL_NAMES` / `formatDefaultMcpAllowToolsCsv()`).

Includes among others:

- health / version / profiles / doctor / help / bootstrap / onboarding / resources / discover-environment
- analyze / workflow / bundle / searches / investigation.\*
- selected remote-read: resolve-object, inspect-object, query-table, query-sql, fetch-member, diff, joblog, test-run
- project-knowledge: **discover + status only** (index/query/write need explicit allow-tools + commercial module)

Example with a profile (recommended for real-target agent sessions):

```bash
source ./config/load-env.sh myenv
node cli/zeus.js doctor --profile my-profile
# MCP server with default safe surface (omit --allow-tools) or paste the full CSV above
./.local/mcp/start-zeus-mcp-myenv.sh
# or
node cli/zeus.js mcp serve --stdio true --verbose
```

## Perfect AI Agent Interaction Pattern (Example)

An AI can bootstrap and operate via MCP **without inventing tool names** and without multi-doc hunting:

1. `initialize`
2. `tools/call` `zeus.agent.bootstrap` (live bootstrap payload) **or** `tools/list` / `tools/call` `zeus.help` (overview + `defaultTools` + recommended sequence)
3. Optional: `prompts/get` `zeus.session.start` with the user goal (secondary; help is enough for local analysis)
4. `tools/call` `zeus.doctor` + `zeus.profiles`
5. `tools/call` `zeus.project-knowledge.discover` (present/absent; do not thrash commercial-only ops)
6. `tools/call` `zeus.analyze` with `source` + `program` (or `zeus.workflow` with a preset)
7. Optional deepen: `zeus.search-source`, `zeus.investigation.*`, allowlisted remote-read tools if needed
8. `tools/call` `zeus.bundle` or `zeus.impact` as needed
9. Optional: `resources/read` `zeus://runs/PROGRAM/...` for manifests and `ai_prompt_*.md`

Docs/resources (`zeus://docs/tool-catalog.json`, session-prompt, onboarding) remain available but are **secondary** after `tools/list` / `zeus.help`.

All via stdio, outputs structured + enveloped, workspace-bounded, secrets redacted.

````

Curated resources currently include:

- authoritative docs such as `tool-catalog.md`, `tool-catalog.json`, `cli/reference.md`, `ai/session-prompt.md`, `mcp/operator-guide.md`, `zeus://metadata/agent-bootstrap.json`
- `quickstart/onboarding-new-ibm-i.md` (step-by-step for new IBM i systems: connection, source search, PGM/table objects, metadata & data)
- `ai/rpg-agent-guidance.md` (RPG/ILE patterns for agents)
- `sql/system-environment-discovery.sql` (catalog queries)
- structured metadata for command catalog, agent bootstrap, MCP tool inventory, workflow presets, prompt contracts, and `onboarding/checklist.json` (agent-friendly onboarding steps + recommended resources)
- dynamic run artifacts under `zeus://runs/...` (summaries, views, reports, ai_prompt_*.md)

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
- semicolon-separated DML batches are accepted, with validation, target checks, preflight, backup handling, and row-safety limits applied per statement
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
````

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
