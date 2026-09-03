---
Title: Agentic Coding with Zeus
Description: CLI-first workflow for building IBM i context before coding, review, or analysis.
Last Updated: 2026-09-03
---

# Agentic Coding with Zeus

This is the recommended setup for developers who want an AI to build IBM i context before coding, review, or analysis work.

## Recommended product shape

Use **Zeus CLI commands as the core integration contract**.

That means:

- Any capable agent can use Zeus through the shell and the stable JSON CLI contract.
- `agent bootstrap`, `tools list`, and `tools describe` make the installed capabilities discoverable.
- MCP may be added as an optional adapter when the client explicitly supports it.
- The real behavior lives in Zeus CLI/API commands and generated artifacts.

In practice:

1. Start the CLI bootstrap and discover the installed commands.
2. Establish the exact working context.
3. Generate evidence locally before asking the AI for conclusions or code changes.
4. Keep remote reads and all mutations behind explicit scope and approval gates.

For the detailed route and artifact contract, see [`../ai/cli-agent-guide.md`](../ai/cli-agent-guide.md).

## Fastest developer path

1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` only when remote access is required.
3. Run `node cli/zeus.js agent bootstrap --json`.
4. Run `node cli/zeus.js tools list --json` and `node cli/zeus.js context show --json`.
5. Run `doctor` for profile-based remote work.
6. Run `analyze` or a suitable `workflow` preset.
7. Review the generated artifacts or package them with `bundle --safe-sharing`.
8. Open the AI client and start with [`../ai/session-prompt.md`](../ai/session-prompt.md).

## Recommended CLI sequence

For most tasks:

1. `node cli/zeus.js agent bootstrap --json`
2. `node cli/zeus.js tools list --json`
3. `node cli/zeus.js context show --json`
4. `node cli/zeus.js analyze` or `node cli/zeus.js workflow --preset ...`
5. `node cli/zeus.js query-table`, `query-sql`, `joblog`, or `inspect-object` only if more evidence is needed
6. `node cli/zeus.js impact`, `assess-risk`, `generate-test`, `generate-checklist`, or `qa`
7. `node cli/zeus.js bundle --safe-sharing`
8. `node cli/zeus.js fetch` only with explicit user confirmation

## Optional tool adapters

An adapter layer is optional for direct tool calls from chat. When present, it can provide:

- tool schema and registration for the AI runtime;
- runtime execution and safety enforcement;
- workspace-aware profile, environment, and CLI wiring.

Without an adapter, Zeus remains fully usable through the CLI/API surfaces and generated artifacts.

## Example CLI-driven flow

Developer:
`Use the Zeus CLI to analyze ORDERPGM in documentation mode and summarize the generated artifacts.`

Expected sequence:

1. `node cli/zeus.js agent bootstrap --json`
2. `node cli/zeus.js tools list --json`
3. `node cli/zeus.js context show --json`
4. `node cli/zeus.js analyze --source <source-root> --program ORDERPGM --out <output-root>`
5. inspect `report.md`, `architecture-report.md`, and `analyze-run-manifest.json`
6. optionally run `bundle --safe-sharing`

The default recommendation is: **CLI discovery first, evidence before conclusions, human review before changes**.
