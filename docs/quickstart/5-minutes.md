---
Title: Zeus in 5 Minutes
Description: Schneller operativer Einstieg in typische Zeus-Workflows.
Last Updated: 2026-05-17
---

# Zeus in 5 Minutes

This is the shortest path to get Zeus working for agentic coding.

1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` to `config/local-only/profiles.json`.
3. Set `ZEUS_SOURCE_ROOT` and `ZEUS_OUTPUT_ROOT` for local analysis, plus `ZEUS_FETCH_*` or `ZEUS_DB_*` only if you need them.
4. Open `vscode-extension/` in VS Code and press `F5`.
5. In the Extension Development Host run `Zeus: Select Profile`.
6. Run `Zeus: Run Doctor`.
7. Open Copilot Chat.
8. Stay in normal chat mode and ask: `Use the Zeus tools to analyze ORDERPGM in documentation mode and then generate AI context.`

Example follow-up:

`Now summarize the latest report and tell me which tables and program calls matter for onboarding.`

That is the default product path: Zeus tools in chat first.