# ADR-002: Dependency Direction

**Status:** Accepted

## Context

Current module layout (inspected on baseline main):

- **Entry / Facade:** `cli/zeus.js`, `src/api/zeusApi.js`, `src/cli/commands/*`
- **Application / Orchestration:** `src/core/*Service.js`, `src/analyze/analyzePipeline.js`, `src/workflow/workflowRunner.js`
- **Domain logic:** `src/scanner/`, `src/context/canonicalAnalysisModel.js`, `src/dependency/`, `src/impact/`, `src/report/`, `src/investigation/`, `src/prompt/`
- **Adapters / Infrastructure:** `src/fetch/` (sftp, ftp, jt400, ifsExporter, memberDiscovery, ...), `src/db2/` (multiple query/metadata services), `src/java/javaRuntime.js`, `src/config/`
- **Cross-cutting:** `src/security/`, `src/sharing/`, `src/reproducibility/`, `src/knowledge/privacy/`

Inspection of `src/core/analyzeService.js` (and peers) shows they require config resolvers, reproducibility, sharing, analyze pipeline, and call into scanners/db/fetch indirectly via services. Adapters implement concrete I/O. Config resolution happens early and is passed down.

No obvious upward dependencies from adapters into domain/core were observed in the primary paths. CLI commands are thin wrappers. Registries (stage, component, workflow preset, prompt) allow extension without reversing arrows.

`.github/copilot-instructions.md` and `docs/safety/best-practice-guide.md` describe a similar layered picture.

## Decision

Adopt and document the following dependency direction:

1. **Domain and application services** (`src/core/`, `src/analyze/`, `src/context/`, `src/dependency/`, `src/impact/`, `src/report/`, `src/investigation/`, `src/prompt/`, `src/workflow/`, `src/scanner/`) may depend on:
   - Each other (domain)
   - Adapters / infrastructure
   - Cross-cutting utilities (reproducibility, security primitives, sharing)

2. **Adapters and infrastructure** (`src/fetch/*`, `src/db2/*`, `src/java/`, transport implementations, low-level config loaders) must not depend on domain or application services. They expose narrow interfaces used by services.

3. **Configuration** (`src/config/`) is resolved centrally early and injected. It is a supporting layer.

4. **Public surface** (CLI dispatch, `zeusApi.js` registries, MCP) orchestrates services and adapters. It does not contain domain logic.

5. **Extension points** (registries) are the approved mechanism for adding behavior without violating direction.

Tests may use fakes/doubles at adapter boundaries.

## Consequences

- Easier to test core logic in isolation (mock adapters).
- Clear boundary for "what belongs in fetch/db2 vs analyze/context".
- New adapters (e.g. additional transport or Db2 dialect) can be added without touching domain.
- When reviewing diffs, flag any require/import that points the wrong way.

## Compatibility Implications

No immediate runtime behavior change. Future packages that move code must preserve the direction or introduce explicit anti-corruption / adapter layers at the boundary.

## Security Implications

Adapters are the points that touch remote systems (IBM i) and credentials. Keeping them from depending on (and therefore being able to be called from) arbitrary domain code reduces the chance of accidental or malicious escalation. Security and privacy gates (secret masking, redaction) live in or above the adapter boundary.

## Incremental Adoption Path

- Package 01: Document the observed direction as the rule.
- Later packages: when touching cross-boundary code, enforce the rule in the changed paths. Add characterization tests at boundaries if gaps appear.
- No big-bang move of files in package 01.

## Alternatives Considered

- Strict hexagonal / ports-and-adapters with explicit port interfaces in every case. Rejected for now: current service + narrow module boundaries already provide most of the benefit with lower ceremony. Can evolve later.
- Allow bidirectional dependencies with "well-known" exceptions. Rejected: quickly becomes unmaintainable and hides risk.
- Put all I/O behind a single "repository" abstraction. Rejected: over-abstraction for the current needs (fetch vs Db2 vs local FS have very different contracts).

## Conditions to Revisit

- Introduction of a new major subsystem (e.g. language server, compiler bridge) that requires different layering.
- Evidence of repeated pain from the current direction (circular dependencies or test friction).
- Decision to extract a reusable "zeus-evidence" library where clean boundaries become critical.
