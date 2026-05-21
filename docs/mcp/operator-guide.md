---
Title: MCP Operator Guide
Description: Local-first MCP startup, policy boundaries, and troubleshooting for Zeus RPG PromptKit.
Last Updated: 2026-05-21
---

# MCP Operator Guide

## Purpose

Expose a safe, local-only subset of Zeus capabilities over MCP stdio for AI clients and automation.

## Security Posture

- Transport: stdio only (local process boundary)
- Default behavior: read-only tool exposure
- Policy: allowlist gate (`--allow-tools`) for explicit tool surface control
- Redaction: response/error masking for common secret patterns
- Audit: append-only local JSONL audit trail for `tools/call`

Out of scope for MVP:
- write/mutation commands (`insert`, `update`, `upsert*`)
- remote apply/compile style operations

## Start MCP Server

```bash
node cli/zeus.js mcp serve --stdio true --verbose
```

Restrict exposed tools (recommended):

```bash
node cli/zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.query-table,zeus.query-sql,zeus.search-source
```

## Supported MCP Tools (Current)

- `zeus.health`
- `zeus.version`
- `zeus.doctor`
- `zeus.workflow`
- `zeus.bundle`
- `zeus.analyze`
- `zeus.impact`
- `zeus.assess-risk`
- `zeus.query-table`
- `zeus.query-sql`
- `zeus.search-source`
- `zeus.field-search`
- `zeus.joblog`
- `zeus.inspect-object`

## Cursor Contract

Cursor-enabled tools currently:

- `zeus.search-source`
- `zeus.field-search`
- `zeus.impact`

Behavior:

- responses include `cursor`, `cursorOffset`, and `nextCursor`
- `nextCursor` is an opaque versioned token
- clients should treat cursor values as opaque and only replay them back to the same tool
- legacy numeric cursor input remains accepted during the transition window
- deterministic ordering is preserved across pages for a stable request shape

## Deterministic Error Mapping

- Parse error: `-32700`
- Invalid request / invalid params: `-32600` / `-32602`
- Method/tool not found or policy refusal: `-32601`
- Tool runtime failure: `-32000`

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
