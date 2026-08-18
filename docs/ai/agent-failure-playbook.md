---
Title: Agent Failure Playbook
Description: Stable recovery guidance for AI agents when Zeus MCP tools refuse, miss prerequisites, or return incomplete evidence.
Last Updated: 2026-08-04
---

# Agent Failure Playbook

Use this playbook when an MCP tool call fails, is refused, or returns incomplete evidence. Prefer matching the situation to a **stable code**, then follow **Do / Don't / Next tools**.

Live machine-readable copy:

- `zeus://metadata/agent-failure-playbook.json`
- Embedded compact summary in `zeus.agent.bootstrap` → `failurePlaybook`

## Principles

1. **Do not invent.** Tool names, profiles, analysis results, and unresolved symbols stay evidence-backed.
2. **Fail closed on policy.** Allowlist and S3/S4 approval are not optional.
3. **One diagnosis, one recovery path.** Avoid retry loops with the same invalid call.
4. **Prefer default-allowlisted tools** when commercial or high-risk surfaces are unavailable.

## Codes

### POLICY_REFUSED

Tool is not on the current MCP allowlist or policy denied the call.

- **Do:** Call `tools/list` or `zeus.help`; ask the operator to allowlist if justified; prefer a default-allowlisted alternative.
- **Don't:** Invent tool names or retry the same denied tool in a loop.
- **Next tools:** `zeus.help`, `zeus.agent.bootstrap`, `zeus.doctor`

### MISSING_PROFILE

A required runtime profile is missing or empty.

- **Do:** Call `zeus.profiles`; ask the operator which profile to use; pass `profile` explicitly.
- **Don't:** Guess profile names or proceed with remote/analysis tools without a profile when required.
- **Next tools:** `zeus.profiles`, `zeus.doctor`, `zeus.onboarding`

### ANALYZE_REQUIRED

Downstream tool needs existing canonical-analysis artifacts that are absent.

- **Do:** Run `zeus.analyze` (with `source` when a full run is needed); confirm artifacts via `zeus.analyses`; retry the dependent tool.
- **Don't:** Invent analysis results or skip analyze when the dependent tool requires graph/artifacts.
- **Next tools:** `zeus.analyze`, `zeus.analyses`, `zeus.workflow.suggest`

### UNRESOLVED_REFS

Symbols, bindings, or references could not be resolved from evidence.

- **Do:** Search local source (`zeus.search-source` / `field-search`); re-run analyze with the correct source root; report unresolved items explicitly.
- **Don't:** Invent call targets, tables, or procedure names.
- **Next tools:** `zeus.search-source`, `zeus.field-search`, `zeus.analyze`, `zeus.impact`

### PI_ABSENT

Commercial Project Intelligence module is not present or not allowlisted.

- **Do:** Call `zeus.project-knowledge.check` when a local knowledge root is known; use `lookup` only for a fresh snapshot. Otherwise fall back to Community tools (analyze, search-source, impact, bundle).
- **Don't:** Serve stale/unknown Knowledge First results, thrash missing optional project-knowledge operations, or claim integrated PI when discovery says absent.
- **Next tools:** `zeus.project-knowledge.check`, `zeus.project-knowledge.lookup`, `zeus.project-knowledge.discover`, `zeus.analyze`, `zeus.search-source`, `zeus.impact`

### INVALID_ARGS

Tool arguments failed schema validation (required, type, enum, length).

- **Do:** Re-read the tool `inputSchema` from `tools/list`; fix required fields and types; use schema `examples` when present; retry once.
- **Don't:** Send properties outside the schema or retry the same invalid payload.
- **Next tools:** `zeus.help`, `zeus.agent.bootstrap`

### RUNTIME_BACKEND

Underlying runtime, DB2, or process backend failed (connection, timeout, crash).

- **Do:** Run `zeus.doctor` for the profile; report the backend error; prefer local-only tools until healthy.
- **Don't:** Hammer remote tools after repeated backend failures or invent successful remote results.
- **Next tools:** `zeus.doctor`, `zeus.profiles`, `zeus.resources`

### PATH_OUTSIDE_WORKSPACE

Requested path is outside the allowed workspace containment boundary.

- **Do:** Use paths under configured workspace / source roots only; ask the operator for an in-workspace path.
- **Don't:** Attempt path traversal or absolute paths outside policy.
- **Next tools:** `zeus.resources`, `zeus.doctor`

### APPROVAL_REQUIRED

Tool or step requires explicit operator approval (S3/S4, mutations, PI query).

- **Do:** Show the exact tool name and arguments; wait for explicit approval; use a lower-safety alternative if approval is not given.
- **Don't:** Call `approvalRequired` steps without confirmation or treat silence as approval.
- **Next tools:** `zeus.workflow.suggest`, `zeus.help`, `zeus.agent.bootstrap`

### TOOL_NOT_ALLOWED

Named tool is unknown or not registered on the current MCP server surface.

- **Do:** Use `tools/list` or `zeus.help`; map intent to a known tool via `zeus.workflow.suggest`.
- **Don't:** Guess tool names from docs alone when `tools/list` is available.
- **Next tools:** `zeus.help`, `zeus.workflow.suggest`, `zeus.agent.bootstrap`

## Suggested recovery order

1. Match the failure to a code above (or closest summary).
2. Follow **Do** once; avoid **Don't**.
3. Call one of the **Next tools** to regain a valid footing.
4. If still blocked, stop and ask the operator with the code and the last error message.
