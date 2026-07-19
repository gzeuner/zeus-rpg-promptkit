---
Title: ADR-008 Generation Validation Foundation
Description: Community offline validation of structured generation candidates as review artifacts without source mutation or commercial repair loops.
Last Updated: 2026-07-19
---

# ADR-008: Generation Validation Foundation

**Status:** Accepted and implemented as Community safety baseline

## Context

Zeus can prepare evidence and may later accept model-produced change proposals. Those proposals must
not become evidence, must not mutate the analyzed source workspace automatically, and must not ship
a commercial Generation Assurance / repair loop in the Apache-2.0 core.

## Decision

### Versioned contracts

The core registers:

- `zeus.generation-candidate@1`
- `zeus.generation-validation-report@1`
- `zeus.external-linter-adapter@1` (neutral optional descriptor only; no network default)

Candidates declare evidence references, assumptions, uncertainties, and explicit `proposedFiles`
only. Undeclared markdown fences, free-text paths, or side-channel file lists are not accepted as
changes. Hidden chain-of-thought fields are rejected.

### Validator registry

A dedicated Generation Validator Registry is separate from Capability, Provider, and future module
registries. Built-in validators cover schema, contract version, workspace paths, file types, size
limits, duplicate targets, declared scope, evidence references, policy, and a light static source
classification check. Order is deterministic (`order` then id). Validator failures are isolated.

### Status model

Overall status values:

| Status                       | Meaning                                         |
| ---------------------------- | ----------------------------------------------- |
| `invalid`                    | Schema/contract structure failed                |
| `denied`                     | Local safety policy denied the candidate        |
| `validation-failed`          | Blocking or error diagnostics from validators   |
| `unsupported`                | Reserved for hard unsupported local checks      |
| `internal-validator-failure` | Validator threw or report failed its own schema |
| `review-ready`               | All required checks passed                      |

**`review-ready` never means compiled, functionally correct, IBM i tested, approved, or deployable.**

### Workspace safety

Path checks use `path.resolve` containment against an authorized workspace root. Absolute paths,
Windows drive prefixes, UNC, `..` traversal, control characters, reserved device names, and scope
expansion fail closed. Review artifacts may only be written to an explicit `reviewArtifactRoot`
that is not inside the source workspace.

### API surface

Iteration 29 exposes a programmatic API under `zeus.generationValidation` / package
`generationValidation`. CLI and MCP remain thin and are not required for this foundation.

### Commercial boundary

Reserved for commercial modules: AI repair loops, advanced RPG/CL/DDS validator packs, ranking,
organization policy/approval, comparative quality reports, compiler validation, and differential
execution. The public core must not contain dormant paid implementations.

## Consequences

- Offline mock validation is fully testable without providers or IBM i.
- Later commercial Generation Assurance can attach to the same candidate/report contracts without
  rewriting the Community safety baseline.
