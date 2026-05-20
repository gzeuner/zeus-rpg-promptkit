---
Title: Zeus Agent Validation Checklist
Description: KI-bezogene Arbeitsvertraege, Prompt-Richtlinien und Validierungsleitlinien fuer Zeus.
Last Updated: 2026-05-20
---

# Zeus Agent Validation Checklist

Use this checklist after changes that affect Zeus tools, prompts, or agent workflows.

## Static checks

1. Run `npm run test:contract`.
2. Run `npm run test:smoke`.
3. Regenerate docs with `node cli/zeus.js docs generate-catalog` and confirm no command drift.

## Manual workflow checks

1. Run `node cli/zeus.js doctor --profile default --show-resolved`.
2. Run `node cli/zeus.js analyze --profile default`.
3. Run `node cli/zeus.js analyses list --profile default` and open the latest run.
4. Run `node cli/zeus.js workflow --preset architecture-review --profile default --source <source-root> --program <program> --out <output-root>`.
5. Confirm expected artifacts exist (`report.md`, `architecture-report.md`, `ai-knowledge.json`, `context.json`).
6. Ask your AI client to process one generated prompt artifact and confirm findings reference those artifacts.
7. Ask for remote fetch and confirm the workflow requires explicit approval before source retrieval.

## Expected outcome

- Zeus workflows are reproducible via CLI and API surfaces.
- Fetch stays confirmation-gated.
- No secrets appear in prompts, output, or generated artifacts.
