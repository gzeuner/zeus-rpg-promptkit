---
Title: MCP Architecture Review
Description: Neutral review of the current Zeus RPG PromptKit MCP architecture, risks, and next steps for robust AI-agent support.
Last Updated: 2026-05-25
---

# MCP Architecture Review

## 1. Executive Summary

The current MCP implementation is a credible experimental local agent interface, not yet a robust safe-by-default one.

What is good:

- local `stdio` transport is the right default
- the server is intentionally narrow compared with a full shell
- redaction, audit logging, timeout guards, response-size guards, and deterministic error mapping already exist
- high-risk paths such as `zeus.write-sql` and `zeus.bridge` have real enforcement, not just documentation
- knowledge-lab and legacy knowledge exposure remain disabled

What is not good enough:

- the runtime is not actually default-deny today
- workspace boundary enforcement is incomplete because absolute paths are still allowed
- MCP tool metadata is not the authoritative source of truth for agent behavior
- published input schemas are descriptive, not centrally enforced
- tool names and catalog entries still inherit CLI semantics that do not always match MCP semantics
- read-only DB2 access is not the same thing as data-minimized agent-safe access
- audit events are too thin for strong operator review and too loose for policy verification

Bottom line:

Do not call the current MCP surface a robust local agent interface yet. It is a useful MVP. It is not yet safe-by-default enough to be the project’s long-term answer for AI assistants.

## 2. Current State Assessment

Current runtime shape:

`AI client -> local stdio MCP server -> tool policy -> tool execution -> redaction -> audit -> bounded response`

That shape is correct. The implementation, however, still has several mismatches between policy intent and runtime behavior.

Current maturity by area:

- Transport: good
- Tool surface: mixed
- Allowlist/default-deny: weak
- Schemas: mixed
- Redaction: decent for secrets, weak for data minimization
- Audit: useful but shallow
- Path boundaries: incomplete
- Remote read-only: technically enforced, policy-thin
- Mutating tools: comparatively strong
- Agent ergonomics: uneven
- Documentation: directionally good, not yet authoritative for MCP behavior
- CI guards: strong on knowledge safety, weak on MCP policy safety

## 3. What Is Already Good

- `stdio`-only local transport keeps the blast radius smaller than a network-exposed agent endpoint.
- The server has explicit tool registration rather than arbitrary shell passthrough.
- Timeouts and max-response-size guards are implemented centrally.
- Cursor pagination is deterministic and rejects legacy numeric cursors.
- `zeus.write-sql` has real gates:
  - explicit env opt-in
  - confirmation token
  - production-profile block
  - table allowlist support
  - `WHERE` enforcement
  - row-safety preflight
- `zeus.bridge` is deliberately preview-oriented in MCP and blocks mutation semantics.
- DB-backed failure normalization exists for `joblog` and `inspect-object`.
- Knowledge safety remains intact:
  - no legacy knowledge MCP tool is registered
  - API knowledge access stays disabled
  - public references stay in removed/disabled warning context only
- Test coverage for MCP is already stronger than in many early MCP projects.

## 4. Key Risks And Gaps

### Blocker 1: The runtime is not actually default-deny

The documentation says allowlist/default-deny. The runtime defaults to exposing all tools when `--allow-tools` is omitted.

That is the single biggest architectural mismatch in the current MCP design.

Consequence:

- a user can start `zeus mcp serve` and unintentionally expose the full experimental tool surface
- dangerous or operator-gated tools are one omission away from being visible to the client
- the current tests codify this broad default behavior, which means CI currently protects the wrong thing

### Blocker 2: Workspace boundary enforcement is incomplete

The path guard only blocks escaping relative paths. Absolute paths are accepted by multiple MCP tools.

That means the documented rule “local paths must remain inside the workspace” is not actually true today.

Consequence:

- local evidence tools can read outside the workspace if given absolute paths
- artifact/manifest inspection tools can point at arbitrary local files
- operator expectations and runtime behavior diverge

### Blocker 3: MCP metadata is not authoritative

`docs/tool-catalog.md` is a CLI catalog, not an MCP contract.

Several MCP tools are intentionally safer than their CLI names imply:

- `zeus.fetch` does not fetch from IBM i in MCP; it reads existing fetch metadata
- `zeus.copy-to-workspace` is plan-only in MCP
- `zeus.serve` does not start a server in MCP; it returns serve metadata
- `zeus.workflow`, `zeus.bundle`, and `zeus.analyze` are read-existing-artifact tools in MCP, not live artifact generators

Consequence:

- agents can infer the wrong side effects from the tool names
- humans may approve the wrong allowlist because the catalog is semantically overloaded
- documentation drift is already visible

### Blocker 4: Input schemas are published but not centrally enforced

The MCP tool list returns JSON-Schema-like `inputSchema` objects, but the server does not validate `tools/call` inputs against those schemas before execution.

Actual validation is mostly manual and tool-specific.

Consequence:

- `additionalProperties: false` is not truly enforced
- schema drift can accumulate silently
- agents cannot rely on the listed schema being the actual runtime contract

### Blocker 5: Read-only DB2 access is still an exfiltration surface

`query-sql` is read-only, but it is still capable of returning arbitrary row data visible to the configured credentials.

That is a safety distinction the current docs understate:

- read-only is a mutation boundary
- it is not a confidentiality boundary

Consequence:

- an MCP client can still pull sensitive business data unless DB credentials are already tightly scoped
- current redaction is secret-oriented, not data-classification-oriented

## 5. MCP Design Principles For Zeus RPG PromptKit

Recommended durable principles:

1. Local-first, `stdio` first, no network listener by default.
2. Default-deny at runtime, not just in docs.
3. Evidence gathering before synthesis.
4. Read-oriented by default, write-oriented only through explicit operator gates.
5. Tool metadata must be machine-readable and policy-bearing.
6. Workspace-scoped local access by default.
7. Remote access must be least-privilege and read-minimized, not only read-only.
8. Outputs must be structured, bounded, and review-friendly.
9. Audit must be useful for humans without becoming a second leakage channel.
10. MCP should prepare artifacts and plans, not silently perform production change.

## 6. Tool Surface Review

The current tool surface is directionally reasonable, but too semantically mixed.

Good:

- health/discovery tools exist
- local evidence tools exist
- remote read-only DB2/IBM i tools exist
- review artifact tools exist
- dangerous tools are explicit

Problems:

- some tool names imply active behavior while MCP implementations are passive/read-only viewers
- some tools are cataloged at CLI scope but behave differently in MCP scope
- the current surface is a flat list rather than an operator-shaped set of use-case groups

Recommended groups:

- Health / discovery
  - `zeus.health`
  - `zeus.version`
  - `zeus.doctor`
- Local source evidence
  - `zeus.search-source`
  - `zeus.field-search`
  - `zeus.analyze`
  - `zeus.impact`
- Remote read-only evidence
  - `zeus.query-table`
  - `zeus.query-sql`
  - `zeus.inspect-object`
  - `zeus.joblog`
- Review / planning artifacts
  - `zeus.bundle`
  - `zeus.generate-test`
  - `zeus.generate-checklist`
  - `zeus.qa`
  - `zeus.assess-risk`
- Workspace / viewer
  - `zeus.analyses`
  - `zeus.fetch`
  - `zeus.copy-to-workspace`
  - `zeus.serve`
  - `zeus.test-run`
  - `zeus.diff`
- Dangerous / gated
  - `zeus.write-sql`
  - `zeus.bridge`

Recommended presets:

- `readonly-local`
- `readonly-remote`
- `analysis`
- `review`
- `operator-gated`

Do not make these only documentation concepts. If presets are added, they should resolve to concrete runtime allowlists.

## 7. Tool Naming And Description Quality

Current quality: mixed.

Good:

- many descriptions do say “read-only”
- `write-sql` and `bridge` descriptions are fairly explicit

Weak:

- names such as `zeus.fetch`, `zeus.serve`, `zeus.workflow`, `zeus.bundle`, and `zeus.analyze` still sound like imperative CLI actions
- descriptions do not consistently state:
  - safety level
  - side-effect class
  - whether the tool is safe for autonomous agent use
  - whether it can touch IBM i / DB2
  - whether it reads existing artifacts versus generating new ones
  - when not to use it

Recommendation:

- do not rush into renaming everything immediately
- first introduce explicit per-tool metadata:
  - `safetyLevel`
  - `sideEffectClass`
  - `touchesRemote`
  - `autonomousUse`
  - `operatorApprovalRequired`
  - `readsExistingArtifacts`
- then improve descriptions using that metadata
- if names remain ambiguous after metadata cleanup, add alias names and deprecate the misleading ones gradually

Specific naming concern:

The CLI catalog should not be presented as the authoritative MCP contract. MCP needs its own generated catalog.

## 8. Tool Input/Output Schema Review

### Input schemas

Strengths:

- every tool has an `inputSchema`
- schemas are generally narrow
- many fields declare enums and minimums

Weaknesses:

- schemas are not centrally enforced before execution
- `additionalProperties: false` is currently aspirational
- alias fields increase drift risk
- some tools depend on manual validation rather than schema-enforced contracts

Recommendation:

- keep the existing schema objects
- make them executable policy by validating `tools/call` input against the published schema
- reject unknown fields centrally
- reserve manual validation for semantic rules that JSON Schema cannot express cleanly

### Output schemas

Strengths:

- most tools return structured JSON
- many tools include pagination and truncation metadata
- write and bridge tools expose useful decision context

Weaknesses:

- there is no single standard response envelope
- payloads are not self-describing enough for agents
- safety level, side effects, warnings, and artifact references are not consistently present
- some responses expose absolute paths freely

Recommended standard envelope:

```json
{
  "ok": true,
  "tool": "zeus.search-source",
  "safetyLevel": "S0",
  "sideEffectClass": "read-local",
  "summary": "Found 12 matches across 4 files.",
  "warnings": [],
  "artifacts": [],
  "limits": {
    "truncated": false,
    "maxPayloadItems": 100
  },
  "data": {}
}
```

Do not refactor all outputs in one PR. Introduce the contract first, then migrate tool groups.

## 9. Safety Level Mapping

The documented `S0` through `S4` model is good.

The problem is enforcement and metadata visibility:

- safety levels are documented
- safety levels are not first-class in MCP runtime metadata
- safety levels are not returned in tool list entries
- safety levels are not attached to tool results
- safety levels are not enforced through allowlist profiles

Recommendation:

- define safety level in one MCP metadata source
- generate docs and runtime tool list from that source
- require every MCP tool to declare:
  - `safetyLevel`
  - `sideEffectClass`
  - `auditPolicy`
  - `redactionPolicy`
  - `workspacePolicy`

## 10. Allowlist/Default-Deny Model

Current state:

- allowlisting exists
- unknown allowlist names are rejected
- allowlisted tools are enforced when provided
- omitted allowlist means full exposure

That is not acceptable for the long-term design.

Recommendation:

- Phase 1: change omitted allowlist behavior to a minimal built-in safe preset, not full exposure
- Phase 2: require either:
  - explicit `--allow-tools`, or
  - explicit `--preset`
- Phase 3: keep `operator-gated` tools out of every default preset

Recommended invariant:

- `zeus.write-sql` and `zeus.bridge` must never appear in the default preset

## 11. Redaction And Audit Model

### Redaction

Current state:

- redaction is centralized
- responses, errors, and audit events all flow through shared secret masking
- env-configured sensitive terms can be masked

This is good foundation work.

Limits:

- current redaction is mostly secret-pattern masking
- it is not data minimization
- it does not prevent returning sensitive but non-secret business records
- it does not intentionally reduce path disclosure

Recommendation:

- keep the current secret redaction layer
- add a second policy layer for data minimization:
  - path disclosure policy
  - row/column masking policy
  - max row and max cell policies for read-only DB2 tools
  - audit summary policy versus full payload policy

### Audit

Current state:

- append-only JSONL
- coarse success/refusal/error events
- schema version included

That is useful but not sufficient for strong reviewability.

Missing for review-grade operator audit:

- tool safety level
- side-effect class
- allowlist or preset snapshot
- request summary fingerprint
- truncation/timeout flags
- workspace identifier
- stable policy refusal codes
- artifact references when a tool operates on existing manifests or outputs

Recommendation:

- keep audit payloads small and redacted
- add safe summaries and fingerprints, not raw arguments
- separate operator review value from raw-data capture

## 12. Workspace And Path-Boundary Model

Current state:

- relative traversal is blocked in several tools
- absolute paths are still allowed

That means the current model is “relative traversal guarded,” not “workspace bounded.”

Recommendation:

- decide the actual rule explicitly:
  - strict workspace-only, or
  - workspace-plus-explicitly-allowlisted roots
- implement that rule centrally
- treat absolute paths the same as relative paths for boundary checks
- define symlink behavior explicitly
- add tests for:
  - absolute path escape
  - symlink escape
  - manifest path escape
  - registry path escape
  - output root escape

Until that is fixed, path boundary claims should be treated as incomplete.

## 13. Timeout And Response-Size Model

Current state:

- centrally implemented
- deterministic failure behavior exists
- tests cover timeout and oversize response handling

This is one of the stronger parts of the runtime.

Recommendations:

- expose the effective limits in tool metadata or startup logs
- return machine-readable limit context in errors
- allow per-tool defaults later, but keep central hard caps

## 14. Error Model / Deterministic Failure Behavior

Current state:

- JSON-RPC errors are deterministic
- parse errors and invalid requests are handled cleanly
- timeouts and oversize payloads map to deterministic failures

Weaknesses:

- `-32601` is used for both “tool not found” and “policy refusal”
- errors are not carrying stable machine-readable subcodes in `error.data`

Recommendation:

- keep current JSON-RPC compatibility
- add stable internal subcodes in `error.data`, for example:
  - `tool_not_found`
  - `tool_not_allowed`
  - `tool_timeout`
  - `tool_response_too_large`
  - `invalid_cursor`
  - `invalid_arguments`
- keep error messages human-readable and redacted

## 15. Read-Only Remote IBM i / DB2 Behavior

Current state:

- `query-sql` restricts to `SELECT` / `WITH`
- `query-table`, `joblog`, and `inspect-object` are read-only evidence tools
- fallback behavior for IBM i service availability is thoughtful

This is good engineering.

But:

- read-only is not enough for agent safety
- there is no read-side object/table/column policy layer at the MCP level
- least-privilege is delegated entirely to the configured credentials

Recommendation:

- document that remote-read MCP should use dedicated low-privilege profiles
- add optional schema/table allowlists for read-only tools
- add optional result-cell masking for read-only DB2 tools
- add optional per-tool row ceilings stricter than generic `maxRows`

## 16. Write/DML Guardrails Review

Current state:

- comparatively strong
- significantly better than the rest of the policy surface

Strengths:

- plan/apply split
- env opt-in
- confirmation token
- production block
- table allowlist support
- `WHERE` requirement
- trivial predicate rejection
- row-safety preflight

Remaining issues:

- the tool is still exposed by the broad default runtime surface when no allowlist is passed
- safety metadata is not first-class in tool discovery

Recommendation:

- keep this guard design
- move it behind a default-hidden preset
- make `write-sql` opt-in twice:
  - allowlist or preset
  - runtime env gates

## 17. Operator-Gated High-Risk Operations

Current state:

- `bridge` is preview-only in MCP
- mutation semantics are blocked

That is correct.

Recommendation:

- keep all future apply/compile/bridge mutation paths out of default MCP
- if future operator-gated tools are added, require:
  - explicit preset
  - runtime env flag
  - approval artifact or token
  - audit trail with policy reason and operator marker

## 18. AI-Agent Workflow Ergonomics

Current state:

- agents can discover tools
- tool outputs are structured enough to be usable
- pagination exists for larger evidence tools

Weak points:

- agents still have to guess too much from names
- there is no MCP-specific operating sequence document
- there are no shipped MCP presets
- there is no machine-readable safety metadata in tool discovery
- the current “authoritative” catalog is CLI-oriented and therefore misleading for MCP

Recommendation:

- generate an MCP-specific tool catalog from MCP metadata
- ship explicit safe presets
- add one recommended agent operating sequence for MCP only
- make every tool description answer:
  - what it does
  - whether it reads or writes
  - whether it touches remote IBM i / DB2
  - whether it is safe for autonomous use
  - what the next likely tool is

## 19. Recommended Tool Groups / Profiles

Recommended built-in profiles:

- `readonly-local`
  - `zeus.health`
  - `zeus.version`
  - `zeus.doctor`
  - `zeus.search-source`
  - `zeus.field-search`
  - `zeus.analyze`
  - `zeus.impact`
  - `zeus.assess-risk`
  - `zeus.generate-test`
  - `zeus.generate-checklist`
  - `zeus.qa`
  - `zeus.analyses`
  - `zeus.fetch`
  - `zeus.copy-to-workspace`
  - `zeus.serve`
  - `zeus.diff`
  - `zeus.test-run`
- `readonly-remote`
  - `zeus.query-table`
  - `zeus.query-sql`
  - `zeus.inspect-object`
  - `zeus.joblog`
- `analysis`
  - `readonly-local`
  - plus the subset needed for artifact inspection workflows
- `review`
  - `analysis`
  - plus `bundle`
  - plus `workflow`
- `operator-gated`
  - `zeus.write-sql`
  - `zeus.bridge`

Important:

- `operator-gated` should not compose into a default profile
- `readonly-remote` should be treated as more sensitive than its name suggests because it can still reveal live data

## 20. Documentation Gaps

- There is no MCP architecture review document. This file fixes that gap.
- There is no MCP-specific generated tool catalog.
- `docs/tool-catalog.md` is not a safe MCP source of truth because it describes CLI commands, not always MCP semantics.
- `docs/ai/session-prompt.md` is CLI-oriented and contains metadata drift.
- The docs say default-deny/allowlist, but the runtime currently defaults to full tool exposure.
- The docs say workspace-bounded, but absolute path handling is not yet bounded.

## 21. Test Coverage Gaps

Existing coverage is good, but key gaps remain:

- no test that omitted `--allow-tools` is denied or narrowed by default
- no test that dangerous tools are excluded from default exposure
- no test that absolute path inputs are rejected outside workspace policy
- no test that published `inputSchema` matches actual runtime acceptance/rejection
- no test that tool descriptions contain required safety metadata
- no test that CLI catalog and MCP catalog stay semantically aligned

Also note:

- some existing tests currently lock in the broad default exposure behavior

## 22. CI / Guard Recommendations

Recommended small guards:

- MCP default-surface guard
  - fail if dangerous tools are visible without explicit preset/allowlist
- MCP metadata completeness guard
  - every MCP tool must declare safety level, side-effect class, audit policy, redaction policy, and workspace policy
- MCP catalog sync guard
  - generated MCP docs must match MCP metadata source
- MCP description guard
  - every description must include read/write and remote/local semantics
- MCP path-boundary guard
  - reject absolute-path escape cases
- MCP knowledge-surface guard
  - fail if any removed knowledge tool ever appears in tool registration
- audit-ignore guard
  - fail if `.local/mcp/audit/` becomes tracked

## 23. Explicit Non-Goals

- no new transport
- no remote network listener by default
- no broad shell exposure
- no knowledgebase re-exposure
- no local AI exposure through MCP
- no production mutation path for agents
- no “AI can do everything” posture

## 24. Recommended Phased Roadmap

### Phase 0: Safety truthfulness

Goal: make runtime behavior match the documented posture.

- make omitted allowlist resolve to a minimal safe preset, not full exposure
- enforce workspace boundary on absolute paths
- add tests for both
- stop calling the current runtime default-deny until this is true

### Phase 1: MCP metadata source of truth

Goal: make MCP contract machine-readable and authoritative.

- introduce per-tool MCP metadata:
  - safety level
  - side-effect class
  - remote/local
  - audit policy
  - redaction policy
  - autonomous-use suitability
- generate MCP docs from that metadata
- stop treating the CLI catalog as the MCP authority

### Phase 2: Schema and envelope hardening

Goal: reduce agent guessing and contract drift.

- validate inputs against published schemas
- reject unknown fields centrally
- add stable output envelope fields
- add machine-readable error subcodes

### Phase 3: Operator-grade presets and audit

Goal: support repeatable local agent workflows.

- add presets
- attach preset identity to audit events
- expand audit summaries safely
- add metadata completeness guards in CI

### Phase 4: Remote read minimization

Goal: make remote evidence safer for agent use.

- add optional read-side object/table policies
- add optional row/column masking
- document least-privilege profile guidance

## 25. Recommended Next Codex Task

Implement the policy truthfulness fix, not a broad refactor.

Recommended next task:

`Make MCP truly default-deny and workspace-bounded`

Scope:

- change omitted `--allow-tools` behavior from full exposure to a minimal safe preset
- keep `zeus.write-sql` and `zeus.bridge` out of that preset
- enforce workspace boundary checks for absolute paths
- add tests for:
  - default tool surface
  - absolute path rejection
  - dangerous-tool exclusion from default surface

That is the right next PR because it closes the largest gap between what Zeus says MCP is and what MCP currently does.
