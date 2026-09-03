---
Title: Zeus Agent Validation Checklist
Description: KI-bezogene Arbeitsvertraege, Prompt-Richtlinien und Validierungsleitlinien fuer Zeus.
Last Updated: 2026-09-03
---

# Zeus Agent Validation Checklist

The CLI is the canonical agent surface. MCP is an optional adapter and is not
required for this checklist.

Use this checklist after changes that affect Zeus tools, prompts, or agent workflows.

## Static checks

1. Run `node cli/zeus.js agent bootstrap --json` and inspect the operating contract.
2. Run `node cli/zeus.js tools list --json` and confirm the expected capability inventory.
3. Run `node cli/zeus.js context show --json` and confirm the scope is explicit.
4. Run `npm run test:contract`.
5. Run `npm run test:smoke`.
6. Regenerate docs with `node cli/zeus.js docs generate-catalog` and confirm no command drift.

## Manual workflow checks

1. Run `node cli/zeus.js doctor --profile default --show-resolved` before profile-based remote work.
2. Run `node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root>` for local evidence.
3. Run `node cli/zeus.js analyses list --profile default` and open the latest run when a remote profile is in scope.
4. Run `node cli/zeus.js workflow --preset architecture-review --profile default --source <source-root> --program <program> --out <output-root>`.
5. Confirm expected artifacts exist (`report.md`, `architecture-report.md`, `ai-knowledge.json`, `context.json`).
6. Ask your AI client to process one generated prompt artifact and confirm findings reference those artifacts.
7. Ask for remote fetch and confirm the workflow requires explicit approval before source retrieval.

## Expected outcome

- Zeus workflows are reproducible via CLI and API surfaces.
- Fetch stays confirmation-gated.
- No secrets appear in prompts, output, or generated artifacts.
