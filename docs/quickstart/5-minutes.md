---
Title: Zeus in 5 Minutes
Description: Schneller operativer Einstieg in typische Zeus-Workflows.
Last Updated: 2026-05-20
---

# Zeus in 5 Minutes

This is the shortest path to get Zeus working for agentic coding (demo/local).

For a **real new IBM i system** see the dedicated guide: [`onboarding-new-ibm-i.md`](onboarding-new-ibm-i.md).

Quick local/demo path:
1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` to `config/local-only/profiles.json`.
3. Set `ZEUS_SOURCE_ROOT` and `ZEUS_OUTPUT_ROOT` for local analysis, plus `ZEUS_FETCH_*` or `ZEUS_DB_*` only if you need them.
4. Run `node cli/zeus.js doctor --profile default --show-resolved`.
5. Run `node cli/zeus.js analyze --profile default`.
6. Run `node cli/zeus.js analyses list --profile default`.
7. Open your preferred AI client and provide the generated prompt and context artifacts.
8. Ask: `Analyze ORDERPGM in documentation mode and summarize risks and dependencies.`

Example follow-up:

`Now summarize the latest report and tell me which tables and program calls matter for onboarding.`

That is the default product path: Zeus tools and artifacts first.
