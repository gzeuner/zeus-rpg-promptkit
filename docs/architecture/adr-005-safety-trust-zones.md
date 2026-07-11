# ADR-005: Safety Trust Zones

**Status:** Accepted

## Context

Zeus is explicitly designed with a multi-level safety model because it operates in environments containing sensitive business logic and can reach live IBM i systems.

Current safety model (consistently documented across inspected sources on baseline):

- **README.md** (Safety-Modell section)
- **docs/tool-catalog.md** (generated Safety Levels table)
- **docs/ai/session-prompt.md** (detailed command → safety mapping)
- **src/docs/toolCatalogMetadata.js** (SAFETY_LEVELS + per-command `safety` field)
- **src/cli/commandMetadata.js** (implied via `requiredCapabilities` and categories)

Observed levels:

| Level | Meaning                  | Typical Action                              |
|-------|--------------------------|---------------------------------------------|
| S0    | Local read-only          | Read local files, inspect artifacts, doctor, serve |
| S1    | Local write              | Create/update reports, bundles, prompts, analysis artifacts |
| S2    | Remote read-only         | Fetch sources, query Db2, inspect objects, joblog (no mutation) |
| S3    | Controlled write         | DML (upsert/insert/update/delete) with explicit approval + backup |
| S4    | Operator-gated high risk | Bridge (plan / stage / apply / compile) actions |

Enforcement mechanisms observed:

- `src/bridge/` — bridgeApprovalModel, bridgeAuditLog, bridgeRefusal, bridgeCompileGuard, requireApproval flags, plan-only vs apply modes.
- `src/security/` — secretVault, secretMasking, plaintextSecretDetector, connectionGuards.
- `src/knowledge/privacy/` — privacyGate, privacySignals.
- `src/mcp/mcpPolicy.js`, `mcpRedaction.js`, `mcpAuditLog.js`
- `src/config/runtimeConfigValidation.js` and doctor checks.
- Safe-sharing path (`--safe-sharing`, `safeSharingArtifactBuilder`).
- Default behavior is read-only; write paths are explicit.
- No implicit production mutation; profiles and env loading keep credentials out of source.

Higher-risk commands declare S3/S4 and are routed through guarded paths. Local artifact production (S1) is the common case for analysis.

Trust zone separation:
- Local workspace (trusted for S0/S1)
- Remote IBM i / Db2 (S2 read-only by default; S3/S4 only with explicit gates)
- External sharing (sanitized artifacts)

## Decision

Formalize the S0–S4 safety model and trust-zone separation as a core architectural rule:

1. Every capability (CLI command, MCP tool, stage, workflow) must declare a safety level.
2. The default for all analysis and evidence work is S0 or S1 (local).
3. Remote access without mutation is S2.
4. Any mutation of data on IBM i requires S3 + explicit operator approval, audit, and preferably backup/rollback artifacts.
5. High-risk actions that can affect production code or compilation (bridge, apply-style) are S4 and must be operator-gated with plan/approval stages.
6. Local workspace and remote IBM i are distinct trust zones. Crossing the boundary (fetch, query, bridge) must be visible and attributable.
7. All outputs that may leave the local trust zone should support `--safe-sharing` / redaction.
8. Safety declarations live in the capability metadata (see ADR-004) and are reflected in generated documentation and runtime policy.

## Consequences

- New features must answer "what is the safety level and which trust zone does it affect?"
- Bridge, write-sql, and similar paths remain the only places where S3/S4 logic lives.
- MCP policy and local UI must surface safety levels prominently.
- Tests for safety behavior (approval flows, redaction, refusal) are first-class.

## Compatibility Implications

The S-level table and per-command assignments are part of the public contract (tool-catalog). Changes to assigned levels are breaking for consumers who rely on the classification (e.g. agent harnesses).

## Security Implications

This is the primary security and governance control of the product. Weakening a level or bypassing a gate (approval, audit, redaction) would be a violation of the architecture. The model deliberately makes high-risk actions noisy and reviewable rather than convenient.

## Incremental Adoption Path

- Package 01: Capture the model that already exists in code and docs as the accepted baseline.
- Future packages: when adding or changing a capability, update its declared safety level and any supporting gates. Add or update tests that exercise the boundary (e.g. refusal without approval).
- Existing S3/S4 implementations already align; no migration required.

## Alternatives Considered

- Binary "safe / unsafe" flag. Rejected: too coarse for the real risk gradient between local artifact generation and live DML or bridge apply.
- Rely only on profile names or environment variables for safety. Rejected: safety must be declared on the capability itself so it can be discovered, audited, and enforced regardless of profile.
- Hide S3/S4 entirely behind "advanced" flags. Rejected: explicit classification + approval is safer than obscurity.

## Conditions to Revisit

- Introduction of new risk categories that do not fit S0–S4 (e.g. network exfiltration, supply-chain steps).
- Decision to support multi-tenant or shared-server deployments where local workspace is no longer a trusted zone.
- Regulatory or customer requirements that demand a different classification or mandatory human approval matrix.
