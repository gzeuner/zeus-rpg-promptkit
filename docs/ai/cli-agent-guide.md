---
Title: CLI Agent Guide
Description: Practical CLI-first contract for AI agents working with IBM i legacy systems through Zeus.
Last Updated: 2026-09-03
---

# CLI Agent Guide

This is the detailed companion to [`session-prompt.md`](session-prompt.md). The CLI is the canonical Zeus integration surface. MCP and the local viewer are optional adapters.

## What Zeus contributes

Zeus prepares evidence; the AI interprets and reviews it. Zeus can:

- analyze RPG, CL, DDS, and related source trees;
- resolve calls, file/table usage, procedures, SQL, bindings, and uncertainty;
- enrich local findings with explicitly requested IBM i/Db2 read-only evidence;
- generate reports, graphs, JSON projections, prompt artifacts, risk summaries, tests, QA output, and bundles;
- preserve provenance so findings can be checked by a human.

Zeus does not claim complete semantic understanding, autonomous correctness, production safety, or permission to change an IBM i system.

## Bootstrap and discovery

Run these commands from the project root:

```powershell
node .\cli\zeus.js agent bootstrap --json
node .\cli\zeus.js tools list --json
node .\cli\zeus.js context show --json
```

Use the output of `tools list` as the installed command contract. Before using a less familiar command:

```powershell
node .\cli\zeus.js tools describe <command> --json
```

The bootstrap and command catalog are generated from the same command metadata that supports the other public surfaces. Documentation explains intent and safety; it does not override the installed CLI contract.

## Route selection by intent

| User intent                        | Preferred first route                       | Follow-up                                                               |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| Understand a program               | `analyze` or `workflow --preset onboarding` | Read `report.md`, `architecture-report.md`, and the manifest            |
| Find dependencies or change impact | Existing analysis, then `impact`            | `trace`, `xref`, `investigate`                                          |
| Investigate a defect or error path | `investigate` or `search-source`            | `field-search`, `joblog` when remote evidence is justified              |
| Review architecture                | `workflow --preset architecture-review`     | Inspect graph, unresolved references, and risk output                   |
| Plan modernization                 | `workflow --preset modernization-review`    | Use `ai_prompt_modernization.md` and `ai_prompt_architecture_review.md` |
| Plan a small refactoring           | `workflow --preset refactoring-review`      | Validate callers, files, SQL, indicators, and tests                     |
| Plan tests                         | `generate-test`                             | `qa`, `generate-checklist`                                              |
| Prepare a review bundle            | `bundle --safe-sharing`                     | Verify the manifest and redaction before sharing                        |

## Scope decision

### Existing artifacts

Prefer the latest analysis run. Inspect `analyze-run-manifest.json`, `analysis-index.json`, `report.md`, and `architecture-report.md`. Do not re-run analysis merely because the AI has not read the artifacts yet.

### Local source

Run a bounded local analysis:

```powershell
node .\cli\zeus.js analyze --source <source-root> --program <program> --out <output-root> --optimize-context --dense full --reproducible --json
```

Use `--dense lite` for a smaller context, `full` for the normal balance, and `ultra` when prompt size is the primary constraint. Use `--skip-db2-metadata` when the task is explicitly local-only.

### Remote IBM i or Db2 evidence

First validate the intended profile and routing:

```powershell
node .\cli\zeus.js doctor --profile <profile> --probe --show-resolved
node .\cli\zeus.js resources --profile <profile> --json
```

Use `fetch`, `fetch-member`, `query-table`, `query-sql`, `resolve-object`, `inspect-object`, or `joblog` only when the task needs remote evidence. Fetch is never an implicit refresh. Credentials belong in the configured environment or Secret Vault, never in the prompt.

### New or unknown IBM i

Use:

```powershell
node .\cli\zeus.js onboarding
```

or the read-only discovery path:

```powershell
node .\cli\zeus.js discover-environment --profile <profile> --include-members --json
```

Never infer a library, schema, source file, member, table, or system from a filename alone.

## Evidence loop

1. Establish the goal and exact scope.
2. Discover the installed command surface.
3. Make the working context visible.
4. Generate or locate the smallest useful analysis run.
5. Verify the output manifest and expected artifacts.
6. Deepen only where evidence is missing.
7. Separate facts, inferences, unresolved references, and unknowns.
8. Generate risk, test, QA, and checklist artifacts when planning a change.
9. Package with `bundle --safe-sharing` when sharing outside the workspace.

For every result, record:

- the command and relevant arguments;
- the profile/system/library/schema/source root used;
- the output path and run identifier;
- the artifact path, evidence id, source file, and line location supporting the claim;
- freshness, uncertainty, unresolved references, and the next safety level.

## Experience loop

Use the local experience log as a bounded memory between attempts and sessions:

```powershell
node .\cli\zeus.js agent log list --json
```

Before retrying a failed command, read the recent records and apply an existing workaround. After a failed, blocked, or partial attempt, write exactly one concise event:

```powershell
node .\cli\zeus.js agent log --outcome failed --command "<safe-command>" --failure-code <CODE> --symptom "<what happened>" --workaround "<what helped>" --lesson "<reusable lesson>" --next-step "<next safe command>" --json
```

The default `.zeus/agent-experience.jsonl` is local and ignored by Git. The command stores structured, redacted fields only; never pass raw stdout/stderr, environment dumps, credentials, or credential-bearing URLs. Use stable failure codes so repeated problems can be identified and converted into better prompts, documentation, tests, or command contracts.

## Artifact contract

Read in this order for orientation:

1. `report.md`
2. `architecture-report.md`
3. `analyze-run-manifest.json`
4. `canonical-analysis.json`
5. `ai-knowledge.json`
6. task-specific `ai_prompt_*.md`
7. graphs and specialized investigation artifacts

`ai-knowledge.json` is a projection for one analysis run. It is not proof of a complete or current project knowledge base. Treat `riskMarkers`, `uncertaintyMarkers`, `evidenceIndex`, and unresolved entities as part of the answer, not as noise.

## Safety gates

- S0: local read-only inspection.
- S1: local artifact generation; verify output paths and avoid overwriting unrelated work.
- S2: remote read-only; verify profile and target before execution.
- S3: controlled data write; explicit user approval is mandatory.
- S4: bridge/apply/compile-style operation; explicit operator approval is mandatory and the exact command must be shown first.

If approval is not granted, use a lower-risk plan, report, diff, or dry-run alternative. Do not interpret a warning as permission.

## CLI failure recovery

When a command fails:

1. capture the exit status and structured error;
2. map it to [`agent-failure-playbook.md`](agent-failure-playbook.md);
3. run the listed `nextCommands` once;
4. do not repeat the same invalid command or invent a replacement;
5. stop and ask the operator when the next safe action needs missing scope or approval.

Typical mappings:

- missing profile → `profiles`, then `doctor` or `onboarding`;
- missing analysis artifacts → `analyze` or `workflow`, then verify the manifest;
- unresolved reference → `search-source`, `field-search`, or a wider analysis;
- backend failure → `doctor`, then continue locally if possible;
- path outside workspace → use an explicitly contained path;
- optional Project Intelligence absent → use local analysis and evidence tools;
- approval required → show the exact command and wait.

## Agent output contract

Every final response should contain:

1. a concise result;
2. confirmed evidence with references;
3. assumptions and unresolved items;
4. impact/risk and missing validation;
5. the smallest safe next step.

When suggesting RPG changes, keep the change narrow, show a minimal diff or before/after snippet, identify callers/files/SQL/indicators affected, and require compile and regression testing on a real IBM i.
