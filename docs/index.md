---
Title: Zeus RPG PromptKit Documentation Hub (v2.2)
Description: Central, AI-friendly navigation across documentation domains including safety-first onboarding, external extension boundaries, and the ZPI architecture baseline.
Last Updated: 2026-08-21
---

# Zeus RPG PromptKit Documentation Hub (v2.2)

This page is the central entry point for humans and AI assistants.

## The Product Golden Path (Canonical Journey)

The primary user journey is documented in [`quickstart/5-minutes.md`](quickstart/5-minutes.md):
Question -> CLI bootstrap/discovery -> Analyze -> Investigate (search/trace/xref) -> Impact/Risk -> Generate (tests/checklist/QA) -> Bundle (safe and reproducible) -> Verify -> Human review -> (optional MCP adapter).

**What Zeus is:** Evidence and investigation platform. Produces reproducible, reviewable artifacts. Humans decide. Local control.

**What Zeus is not:** Autonomous generator, correctness guarantee, production mutator, hosted service.

## Start Sequence (CLI-First)

1. Start with `node cli/zeus.js agent bootstrap --json` and `node cli/zeus.js tools list --json`.
2. Inspect the scope with `node cli/zeus.js context show --json`.
3. Use `doctor` before profile-based remote work; local-only analysis can proceed without a live IBM i connection.
4. Use [`tool-catalog.md`](tool-catalog.md) as the authoritative command, safety, and scope reference.
5. Start AI sessions with [`ai/session-prompt.md`](ai/session-prompt.md) and use [`ai/cli-agent-guide.md`](ai/cli-agent-guide.md) for details.
6. Work evidence-first through the CLI and use generated artifacts as proof. MCP is optional.

## Documentation Domains

| Domain           | Purpose                                                                                                                                         | Primary Entry                                                                                                                                                                                                  | Typical Audience                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `ai/`            | AI contracts, CLI-first session patterns, validation                                                                                            | [`ai/agent-start-here.md`](ai/agent-start-here.md), [`ai/session-prompt.md`](ai/session-prompt.md), [`ai/cli-agent-guide.md`](ai/cli-agent-guide.md)                                                           | AI agents, prompt engineers                |
| `cli/`           | Reference and practical command examples, including bounded IBM-i spoolfile reads                                                               | [`cli/reference.md`](cli/reference.md), [`cli/spool-read.md`](cli/spool-read.md)                                                                                                                               | Developers, operators                      |
| `quickstart/`    | Canonical evidence-investigation golden path plus credential and onboarding guides                                                              | [`quickstart/5-minutes.md`](quickstart/5-minutes.md), [`quickstart/secrets-and-overrides.md`](quickstart/secrets-and-overrides.md), [`quickstart/onboarding-new-ibm-i.md`](quickstart/onboarding-new-ibm-i.md) | All roles                                  |
| `architecture/`  | Architecture baseline, ADRs, runtime config, dependency rules, capability model, safety trust zones, ZPI contracts, and the evolving GUI target | [`architecture/index.md`](architecture/index.md), [`architecture/gui-ai-workbench-roadmap.md`](architecture/gui-ai-workbench-roadmap.md)                                                                       | Maintainers, tooling engineers, architects |
| `knowledgebase/` | Project-neutral knowledge reset, ZPI threat model, license inventory, test strategy, and closure status                                         | [`knowledgebase/README.md`](knowledgebase/README.md), [`knowledgebase/zpi-closure-status.md`](knowledgebase/zpi-closure-status.md)                                                                             | Architects, security, maintainers          |
| `mcp/`           | Local MCP operation, policy boundaries, troubleshooting                                                                                         | [`mcp/operator-guide.md`](mcp/operator-guide.md)                                                                                                                                                               | Operators, AI integrators                  |
| `maintainers/`   | Release-integrity policy, next-release checklist, historical exception record                                                                   | [`maintainers/release-integrity.md`](maintainers/release-integrity.md), [`maintainers/next-release-checklist.md`](maintainers/next-release-checklist.md)                                                       | Maintainers, release reviewers             |
| `safety/`        | Safety guidance, governance, sharing                                                                                                            | [`safety/best-practice-guide.md`](safety/best-practice-guide.md)                                                                                                                                               | Reviewers, security, leads                 |
| `viewer/`        | Optional local artifact viewer and experimental UI shell                                                                                        | [`viewer/local-ui-shell.md`](viewer/local-ui-shell.md)                                                                                                                                                         | Tooling engineers                          |
| `sql/`           | Reproducible IBM i and DB2 discovery SQL                                                                                                        | [`sql/index.md`](sql/index.md)                                                                                                                                                                                 | Analysts, DB2 engineers                    |
| `journaling/`    | Read-only journal before/after comparison with independent validation                                                                           | [`journaling/read-only-row-diff.md`](journaling/read-only-row-diff.md)                                                                                                                                         | Analysts, DB2 engineers, AI assistants     |

## Quick Links For AI Assistants

| Need                                | Go To                                                                                                                                                                                                                              | Why                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Authoritative command behavior      | [`tool-catalog.md`](tool-catalog.md)                                                                                                                                                                                               | Single source of truth for commands, safety, and examples             |
| Session bootstrap                   | [`ai/agent-start-here.md`](ai/agent-start-here.md), [`ai/session-prompt.md`](ai/session-prompt.md), [`ai/cli-agent-guide.md`](ai/cli-agent-guide.md)                                                                               | CLI-first intent map, context contract, and safety gates              |
| GUI target and iteration status     | [`architecture/gui-ai-workbench-roadmap.md`](architecture/gui-ai-workbench-roadmap.md)                                                                                                                                             | Living plan for the optional local AI Workbench                       |
| Portable E2E test modules           | [`testing/portable-e2e.md`](testing/portable-e2e.md)                                                                                                                                                                               | SFTP, MCP stdio, and real-browser integration scenarios               |
| MCP operator setup                  | [`mcp/operator-guide.md`](mcp/operator-guide.md)                                                                                                                                                                                   | Start, policy, and audit reference for local MCP operation            |
| Prompt schema and constraints       | [`ai/prompt-contracts.md`](ai/prompt-contracts.md)                                                                                                                                                                                 | Prevents inconsistent prompt outputs                                  |
| Architecture decisions and baseline | [`architecture/index.md`](architecture/index.md)                                                                                                                                                                                   | ADRs for kernel, dependencies, contracts, registry, and ZPI           |
| Unified capability architecture     | [`architecture/adr-014-unified-capability-consolidation.md`](architecture/adr-014-unified-capability-consolidation.md)                                                                                                             | Single public codebase, built-in modules, and explicit external hooks |
| ZPI security and closure status     | [`knowledgebase/zpi-threat-model.md`](knowledgebase/zpi-threat-model.md), [`knowledgebase/zpi-closure-status.md`](knowledgebase/zpi-closure-status.md), [`knowledgebase/zpi-test-strategy.md`](knowledgebase/zpi-test-strategy.md) | Threat model, delivered surface, non-claims, and acceptance matrix    |
| Safe sharing guidance               | [`safety/safe-sharing.md`](safety/safe-sharing.md)                                                                                                                                                                                 | Reduction and sanitization rules for external use                     |
| CLI examples                        | [`cli/examples.md`](cli/examples.md)                                                                                                                                                                                               | Fast reproducible command patterns                                    |
| Existing IBM-i spool output         | [`cli/spool-read.md`](cli/spool-read.md)                                                                                                                                                                                           | Bounded, read-only spoolfile evidence                                 |
| DB2 discovery SQL                   | [`sql/system-environment-discovery.sql`](sql/system-environment-discovery.sql)                                                                                                                                                     | Standardized discovery queries for system and ticket context          |
| Read-only journal comparison        | [`journaling/read-only-row-diff.md`](journaling/read-only-row-diff.md)                                                                                                                                                             | Aggregate no-op/change evidence without exposing row data             |

## Governance Notes

- `docs/tool-catalog.md` remains the authoritative command reference for AI assistants.
- `docs/architecture/index.md` and its ADRs are the authoritative source for product kernel,
  dependency direction, versioned contracts, capability registry, safety trust zones, external
  extension boundaries, and the ZPI architecture baseline.
- `docs/knowledgebase/README.md` and the ZPI documents beneath it define the security, licensing,
  test strategy, and **closure status** for Project Intelligence (integrated engines, operations,
  and thin adapters in the public package).
- The CLI is the canonical product and agent path; MCP is an optional local adapter and the viewer is optional and experimental.
- Documentation changes should keep safety levels and scope terminology consistent (`S0` to `S4`).
- The tool catalog is generated from code via `zeus docs:generate-catalog`.
