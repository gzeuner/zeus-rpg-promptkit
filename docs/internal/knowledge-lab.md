---
Title: Internal Knowledge Lab Boundary
Description: Internal-only boundary for local knowledge-lab experiments and strict separation from product/runtime surfaces.
Last Updated: 2026-05-25
---

# Internal Knowledge Lab Boundary

This document defines a hard boundary:

- local knowledge-lab experiments are allowed
- product/runtime exposure is not

Expected local lab workspace:

```text
.local/internal-tools/knowledge-lab/
```

This location is local-only and should remain ignored/disposable.

## Core Rule

Internal knowledge-lab tools may inspect raw project evidence locally, but they must never produce, expose, commit, or promote project-derived raw/intermediate data as reusable toolkit knowledge.

Only privacy-passed final catalog objects may ever cross into public runtime surfaces.

## Boundary Model

```text
.local/internal-tools/knowledge-lab/
  = internal-only local workshop (raw evidence, classifier experiments, prompts, scratch output)

src/knowledge/
  = product boundary (contracts, privacy gates, final-safe catalog shapes, synthetic tests)
```

## Allowed vs Forbidden

| Area | Allowed | Forbidden |
|---|---|---|
| Local experimentation | local classifier/prompts over raw evidence, local taxonomy/normalization experiments, disposable candidate generation | auto-promoting local output into runtime/public docs |
| Synthetic data | create synthetic DDS/PUI/RPG examples for privacy-gate tests | commit real project-derived examples |
| Pattern candidates | propose generic candidates like `ui.grid`, `ui.button`, `workflow.prompt-confirm-action` | persist real field/program/library/table names as toolkit knowledge |
| Privacy hardening | improve rejection rules using synthetic cases | bypass privacy gate for runtime exposure |
| Local AI usage | local prompt/classification assistance as suggestion source | treating local AI output as final knowledge |
| Training/fine-tuning | synthetic-only experimentation | training/fine-tuning on real customer/project sources |
| Commit behavior | commit policy/docs/tests that are synthetic and boundary-safe | commit raw evidence, raw prompts/responses from real sources, model artifacts from project data |
| Runtime surfaces | keep CLI/MCP/API knowledge exposure disabled until privacy-passed final catalog exists | expose lab output in CLI, MCP, API, or analyze auto-load |

## Additional Non-Negotiables

- No migration from old `.zeus/knowledge` or legacy DDDL/template catalogs.
- DDDL remains raw local interchange only, never reusable toolkit knowledge.
- Sanitized candidates are still not automatically safe.
- Public docs and tests must remain synthetic and reproducible.

## Practical Checklist Before Any Promotion

1. Data is synthetic or privacy-passed final catalog only.
2. Schema validation passes (`src/knowledge/final` contract).
3. Privacy gate passes (`src/knowledge/privacy`).
4. No runtime auto-load path added in analyze.
5. No MCP/API/CLI exposure added without explicit safety review.
