# Zeus RPG PromptKit Demo: Mini RPG Legacy System

> Demo data only. Synthetic sample sources. No customer data, no credentials.
> This demo is not affiliated with, endorsed by, or sponsored by IBM.

## What this demo shows

This demo shows how Zeus RPG PromptKit analyzes a small synthetic IBM i / RPG legacy-style system with an evidence-first workflow.

The demo produces:

- human-readable reports
- dependency graph artifacts
- structured AI context artifacts for follow-up analysis

## Before/After AI context

Before:

- AI sees raw source snippets with limited structural context.

After:

- AI can use structured artifacts such as:
  - `report.md`
  - `architecture-report.md`
  - `canonical-analysis.json`
  - `ai-knowledge.json`
  - `dependency-graph.mmd`

## How to run locally

Prerequisites:

- Node.js 20+
- dependencies installed (`npm install`)

Run the demo analysis:

```bash
bash ./examples/demo-rpg-mini-system/scripts/run-demo.sh
```

PowerShell variant:

```powershell
./examples/demo-rpg-mini-system/scripts/run-demo.ps1
```

Generate the session prompt artifact:

```bash
node ./examples/demo-rpg-mini-system/scripts/build-ai-session-prompt.mjs
```

Run safety checks:

```bash
node ./examples/demo-rpg-mini-system/scripts/safety-check.mjs
```

## Expected outputs

After the demo run, artifacts are written under:

`examples/demo-rpg-mini-system/output-baseline/PROGRAM_100/`

Expected key files:

- `report.md`
- `architecture-report.md`
- `canonical-analysis.json`
- `ai-knowledge.json`
- `ai-session-prompt.md`
- `dependency-graph.mmd`

## Safety / disclaimer

- Synthetic demo sources only.
- No real customer, project, host, schema, library, or credential data.
- No production IBM i system information.
- For tooling illustration and local testing only.
- IBM, IBM i, AS/400, and DB2 may be trademarks of International Business Machines Corporation.

