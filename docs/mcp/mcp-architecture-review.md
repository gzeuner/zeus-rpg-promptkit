---
Title: MCP Architecture Review
Description: Neutral review of the current Zeus RPG PromptKit MCP architecture, remaining risks, and recommended next steps for robust AI-agent support.
Last Updated: 2026-05-25
---

# MCP Architecture Review

## 1. Executive Summary

The current MCP implementation is a credible local agent interface. It is materially safer than a broad shell bridge, but it is still not a finished long-term agent surface.

What is now solid:

- local `stdio` transport remains the default
- the runtime now exposes only a minimal safe default surface when `--allow-tools` is omitted
- dangerous and high-exposure tools are not part of the default surface
- local path inputs are now workspace-bounded for both relative and absolute paths
- redaction, audit logging, timeout guards, response-size guards, and deterministic error mapping already exist
- high-risk paths such as `zeus.write-sql` and `zeus.bridge` have real enforcement instead of doc-only promises
- removed knowledge surfaces remain disabled

What is still not good enough:

- MCP metadata is not yet the authoritative source of truth for agent behavior
- published input schemas are still descriptive, not centrally enforced
- some tool names and catalog descriptions still inherit CLI semantics that do not match MCP semantics cleanly
- read-only DB2 / IBM i access is still a confidentiality exposure surface, not just an evidence surface
- audit records are useful, but still too thin for strong policy verification and operator review
- path hardening still has a residual non-existent-path symlink edge that should be closed explicitly

Bottom line:

Do not call the current MCP surface “done”. It is now truthful about its default safety posture, which is a major improvement. It still needs metadata truthfulness, schema truthfulness, and tighter review ergonomics before it should be treated as a robust default local agent interface.

## 2. Current State Assessment

Current runtime shape:

`AI client -> local stdio MCP server -> tool policy -> tool execution -> redaction -> audit -> bounded response`

That shape is correct.

Current maturity by area:

- Transport: good
- Tool surface: mixed but narrower by default
- Allowlist/default-deny: materially improved
- Schemas: mixed
- Redaction: decent for secrets, weak for data minimization
- Audit: useful but shallow
- Path boundaries: improved, not fully finished
- Remote read-only: technically enforced, policy-thin
- Mutating tools: comparatively strong
- Agent ergonomics: uneven
- Documentation: improved, still not fully authoritative for MCP semantics
- CI guards: strong on knowledge safety, still light on MCP metadata/policy completeness

## 3. What Is Already Good

- `stdio`-only local transport keeps the blast radius smaller than a network-exposed agent endpoint.
- The server uses explicit tool registration rather than arbitrary shell passthrough.
- The runtime default surface is now conservative by default:
  - `zeus.health`
  - `zeus.version`
  - `zeus.doctor`
- Timeouts and max-response-size guards are implemented centrally.
- Cursor pagination is deterministic and legacy numeric cursors are rejected.
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
  - no legacy knowledge MCP surface is registered
  - API knowledge access stays disabled
  - public references remain warning-only and non-operational
- MCP test coverage is already stronger than many early MCP projects.

## 4. Key Risks And Gaps

The two urgent policy-truthfulness issues from the earlier review were closed on 2026-05-25:

- omitted `--allow-tools` no longer exposes the full tool surface
- absolute paths outside the workspace are no longer accepted by the shared MCP path guard

That leaves the next real risks below.

### Risk 1: MCP metadata is not authoritative

`docs/tool-catalog.md` is still a CLI-oriented catalog, not a clean MCP contract.

Several MCP tools are intentionally safer than their CLI names imply:

- `zeus.fetch` reads existing fetch metadata in MCP rather than performing a new remote fetch
- `zeus.copy-to-workspace` is plan-oriented in MCP
- `zeus.serve` returns serve metadata in MCP rather than acting like a general server launcher
- `zeus.workflow`, `zeus.bundle`, and `zeus.analyze` are artifact/viewer-oriented in MCP, not broad imperative entry points

Consequence:

- agents can infer the wrong side effects
- humans can approve the wrong allowlist
- docs and runtime can drift without a hard guard

### Risk 2: Input schemas are published but not centrally enforced

The tool list returns JSON-Schema-like `inputSchema` objects, but the server does not validate every `tools/call` request against those schemas centrally before execution.

Consequence:

- `additionalProperties: false` is not truly enforced at the MCP boundary
- schema drift can accumulate silently
- agents cannot fully trust the listed schema as the runtime contract

### Risk 3: Read-only DB2 / IBM i access is still an exfiltration surface

`query-sql`, `query-table`, `inspect-object`, and `joblog` are read-only from a mutation perspective. They are not low-risk from a confidentiality perspective.

Consequence:

- an MCP client can still retrieve sensitive operational or business data
- redaction currently focuses on secrets and obvious tokens, not broader data minimization or classification
- “read-only” can be misread as “safe for default agent exposure”, which would be wrong

### Risk 4: Audit is useful but not yet policy-rich

Audit records capture calls, results, refusals, and error codes. That is a good base. It is still not enough to serve as a strong operator review layer by itself.

Consequence:

- operators do not yet get a compact explanation of why a tool was safe to expose
- policy decisions are not yet backed by machine-readable tool metadata
- audit is still better for forensics than for approval-quality review

### Risk 5: Path hardening still has a residual symlink edge

The shared path guard now handles relative and absolute paths and prefers `realpath` when the target exists. For non-existent targets, it still falls back to lexical containment.

Consequence:

- the main escape class is closed for existing paths
- a follow-up hardening pass should resolve existing parent segments to fully close not-yet-created symlink escape scenarios

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
9. Audit must help human review without becoming a second leakage channel.
10. MCP should prepare plans and reviewable artifacts, not silently perform production change.

## 6. Tool Surface Review

The current tool surface is directionally reasonable, but still semantically mixed.

Good:

- health/discovery tools exist
- local evidence tools exist
- remote read-only DB2 / IBM i tools exist
- review artifact tools exist
- dangerous tools are explicit

Problems:

- some tool names imply active behavior while MCP implementations are passive/read-only viewers or planners
- some tools are cataloged at CLI scope but behave differently in MCP scope
- the surface is still a flat list rather than an operator-shaped model of safe exposure groups

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

If presets are added, they should resolve to concrete runtime allowlists, not stay documentation-only.

## 7. Tool Naming And Description Quality

Current quality: mixed.

Good:

- many descriptions already state “read-only”
- `write-sql` and `bridge` are comparatively explicit

Weak:

- names such as `zeus.fetch`, `zeus.serve`, `zeus.workflow`, `zeus.bundle`, and `zeus.analyze` still sound more imperative than their MCP behavior actually is
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
- then generate more precise descriptions from that metadata
- only consider renames or aliases after metadata truthfulness exists

## 8. Tool Input/Output Schema Review

Input schemas:

- useful as discoverability hints
- not yet strong enough as an authoritative contract
- still too dependent on hand-written tool validation

Output schemas:

- often structured enough to be useful
- bounded and redacted in the happy path
- still inconsistent across tools

The runtime does not yet expose one standard MCP result envelope for every tool. That is acceptable for the MVP, but it is still a long-term ergonomics gap.

Recommended output shape direction:

```json
{
  "ok": true,
  "tool": "zeus.search-source",
  "safetyLevel": "S0",
  "summary": "...",
  "artifacts": [],
  "data": {},
  "warnings": [],
  "limits": {
    "truncated": false
  }
}
```

Do not do a broad output refactor until metadata and schema truthfulness are in place.

## 9. Safety Level Mapping

Recommended practical safety mapping:

- `S0`: local health and low-risk discovery
- `S1`: local read-only evidence inside workspace
- `S2`: remote read-only evidence with potentially sensitive operational/business exposure
- `S3`: artifact generation or workspace-affecting operations that still need human review
- `S4`: mutating or operator-gated operations

Current reality:

- the project documents safety ideas, but they are not yet a single enforced metadata layer
- the runtime does not currently drive policy from a formal safety-level declaration

## 10. Allowlist/Default-Deny Model

Current state:

- default surface is now minimal and truthful
- explicit `--allow-tools` remains the operator override mechanism
- non-default tools are refused by `tools/call` unless they are in the effective allowlist

That is the correct baseline.

Remaining issue:

- allowlists are still string lists, not higher-level profiles or metadata-driven policies

Recommendation:

- keep string allowlists for now
- later add optional preset resolution on top of them
- do not re-expand the default surface

## 11. Redaction And Audit Model

Current strengths:

- response redaction exists
- error redaction exists
- audit logging exists
- audit records are append-only JSONL

Current weaknesses:

- secret masking is stronger than data minimization
- audit entries do not yet capture enough policy context
- large-result truncation/redaction behavior is not yet described as a clean operator contract

Recommendation:

- centralize redaction policy declarations per tool
- add audit fields for:
  - effective safety level
  - side-effect class
  - remote/local indicator
  - truncation status
  - artifact paths returned

## 12. Workspace And Path-Boundary Model

Current state:

- relative escape attempts are blocked
- absolute paths outside the workspace are blocked
- shared MCP path checks are centralized enough to be useful

Remaining gap:

- non-existent-path symlink handling should be hardened further by resolving existing parent segments

Recommendation:

- keep the shared path helper as the enforcement point
- close the remaining parent-symlink gap in a focused follow-up PR
- avoid reintroducing one-off path checks in individual tools

## 13. Timeout And Response-Size Model

Current state is good:

- tool execution timeouts are enforced centrally
- oversized responses fail deterministically
- refusal mode is consistent enough for operators and clients

Recommendation:

- keep this central and avoid tool-local timeout logic
- add per-tool metadata later so clients know which tools are expected to be expensive

## 14. Error Model / Deterministic Failure Behavior

Current state is good:

- MCP error mapping is stable
- timeouts and oversized results fail predictably
- some backend failures are normalized into operator-usable guidance

Remaining gap:

- the runtime does not yet emit one standard structured error payload with policy metadata beyond message/code

That is not urgent, but it would improve agent reasoning and operator review.

## 15. Read-Only Remote IBM i / DB2 Behavior

Current state:

- remote read tools are no longer in the default surface
- explicit allowlisting is required

That is the right default.

Remaining problem:

- read-only still allows broad data visibility
- there is no stronger runtime minimization policy yet

Recommendation:

- keep remote read tools explicit opt-in only
- later add result-shaping and safer default row/column limits where appropriate

## 16. Write/DML Guardrails Review

`zeus.write-sql` remains one of the strongest parts of the current MCP design.

Good:

- plan/apply split
- env opt-in
- confirmation token
- production-profile block
- table allowlist support
- SQL safety checks
- row-safety preflight
- deterministic refusal behavior

Recommendation:

- do not weaken this path
- keep it out of the default surface permanently

## 17. Operator-Gated High-Risk Operations

Current state is directionally correct:

- high-risk tools are explicit
- they are not in the default surface
- their mutation paths still require additional runtime gates

Recommendation:

- keep the operator-gated model narrow
- resist pressure to turn MCP into a general remote operations channel

## 18. AI-Agent Workflow Ergonomics

Current ergonomics are workable, not polished.

Good:

- tool discovery exists
- tool descriptions are present
- errors are reasonably actionable
- outputs are structured enough to reason over in many cases

Weak:

- agents still have to infer too much from names and descriptions
- there is no authoritative “recommended safe sequence” for common workflows
- the tool catalog is still more CLI-shaped than MCP-shaped

Recommendation:

- add an MCP-first tool catalog or generated reference
- document safe workflow sequences for:
  - local evidence gathering
  - remote evidence gathering
  - review artifact generation

## 19. Recommended Tool Groups / Profiles

Recommended operator-facing profiles:

- `minimal-safe`
  - `zeus.health`
  - `zeus.version`
  - `zeus.doctor`
- `readonly-local`
  - `minimal-safe`
  - `zeus.search-source`
  - `zeus.field-search`
  - `zeus.diff`
  - `zeus.analyses`
- `readonly-remote`
  - `minimal-safe`
  - `zeus.query-table`
  - `zeus.query-sql`
  - `zeus.inspect-object`
  - `zeus.joblog`
- `review`
  - `readonly-local`
  - `zeus.generate-test`
  - `zeus.generate-checklist`
  - `zeus.qa`
  - `zeus.assess-risk`
- `operator-gated`
  - explicit one-off use only
  - `zeus.write-sql`
  - `zeus.bridge`

Do not make `operator-gated` part of any default preset.

## 20. Documentation Gaps

Current documentation is better than it was before PR #166, but still incomplete.

Gaps:

- no authoritative MCP-only catalog yet
- CLI and MCP semantics are still mixed in public catalog material
- per-tool safety/default-surface semantics are not yet documented from one generated source

Specific note:

- the current tool catalog example still reflects a broad allowlist style and should not be treated as the runtime default contract

## 21. Test Coverage Gaps

Recent improvements:

- default surface behavior is tested
- non-default tool refusal without explicit allowlisting is tested
- relative and absolute workspace-boundary behavior is tested

Remaining gaps:

- metadata completeness is not tested because metadata truthfulness does not yet exist
- schema/runtime drift is not centrally tested
- the residual non-existent-path symlink edge needs dedicated coverage once hardened

## 22. CI/Guard Recommendations

Small worthwhile guards:

- MCP metadata completeness check
- MCP descriptions must declare safety/default-surface intent
- dangerous tools must never be part of the default surface
- MCP public docs must not claim broad default exposure
- audit artifacts must remain untracked
- removed knowledge surfaces must never reappear in MCP registration

## 23. Explicit Non-Goals

This review does not recommend:

- a new MCP transport
- broad write capability
- exposing removed knowledge surfaces
- exposing local AI features through MCP
- unrestricted shell execution
- unrestricted file access
- broad automatic presets that silently widen risk

## 24. Recommended Phased Roadmap

Phase 1: Completed on 2026-05-25

- make omitted allowlist resolve to a minimal safe default surface
- keep dangerous/operator-gated tools out of the default surface
- enforce workspace boundaries for absolute paths
- prove the behavior with tests

Phase 2: Next

- close the remaining non-existent-path symlink edge
- introduce MCP-native tool metadata as a single source of truth
- add a small metadata completeness guard in CI

Phase 3: After that

- enforce published input schemas centrally or generate them from the runtime truth source
- add a more consistent output envelope
- improve audit richness and operator review context

Phase 4: Later

- optional allowlist presets backed by concrete runtime metadata
- more explicit remote-read minimization policies
- clearer MCP-first workflow guidance for agents

## 25. Recommended Next Codex Task

The next correct task is small and focused:

`Close the remaining non-existent-path symlink boundary gap in the shared MCP path guard, add dedicated tests, and keep the PR limited to path-hardening plus metadata/TODO cleanup.`
