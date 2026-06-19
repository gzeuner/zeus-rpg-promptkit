---
Title: Agent Integration
Description: Workflow-orientierte Leitfaeden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-06-19
---

# Agent Integration

This document explains how to run Zeus in AI-assisted workflows without binding to a specific editor.

For the recommended CLI/MCP-first product shape and the fastest agentic-coding path, start with [`agentic-coding.md`](agentic-coding.md).

Use [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md) for the shortest onboarding path.

Use [`../ai/agent-validation-checklist.md`](../ai/agent-validation-checklist.md) after changing tooling, prompts, or agent integration.

## Recommended operating model

The recommended setup is **CLI/MCP-first**:

- Zeus CLI commands and their MCP counterparts are the primary integration contract.
- Normal chat mode plus Zeus tools is the default user path.
- A runtime adapter is responsible for tool registration and execution.

## From zero to autonomous

```text
1.  git clone / download repo
2.  npm install
3.  cp config/profiles.example.json config/local-only/profiles.json
4.  load env explicitly in the current shell
5.  run doctor
6.  run analyze/workflow
7.  open AI chat client
8.  start with docs/ai/session-prompt.md and request Zeus tool-driven analysis
```

## First-time setup

### 1. Copy profile template

```bash
cp config/profiles.example.json config/local-only/profiles.json
```

### 2. Load environment explicitly in the shell

```bash
source ./config/load-env.sh <environment>

# PowerShell:
# . .\config\load-env.ps1 -Environment <environment>
```

If you set variables manually, do it only in the current shell session and never paste real credentials into prompts, logs, or artifacts.

### 3. Validate runtime

```bash
node cli/zeus.js doctor --profile default --show-resolved
```

All checks should show `PASS`.

## Using Zeus tools in chat

Use [`../ai/session-prompt.md`](../ai/session-prompt.md) as the standard session start prompt.

A good default sequence:

1. `zeus.doctor`
2. `zeus.analyze` or `zeus.workflow`
3. `zeus.query-table`, `zeus.query-sql`, `zeus.joblog`, or `zeus.inspect-object` only when more evidence is needed
4. `zeus.bundle` for review/sharing preparation
5. `zeus.serve` only when an optional local viewer helps
6. `zeus.fetch` only with explicit user confirmation

Example prompts:

```text
Run doctor first, then analyze ORDERPGM and summarize architecture risks from the generated artifacts.

Find security issues in INVPGM and cite the generated artifacts.

After approval, fetch sources, run a modernization-focused workflow for ORDERPGM, and cite the bundle outputs.
```

## CLI fallback

If direct tool-calls are not available, run Zeus directly:

```bash
node cli/zeus.js doctor --profile default --show-resolved
node cli/zeus.js analyze --profile default
node cli/zeus.js workflow --preset security-review --source ./rpg_sources --program ORDERPGM --out ./output
node cli/zeus.js bundle --program ORDERPGM --source-output-root ./output --include-md --include-json
# optional local viewer:
node cli/zeus.js serve --source-output-root ./output --port 4782
```

## Safety model

- Default mode is read-only where possible.
- No write operations on production systems.
- Secrets are masked in output, tool results, and generated artifacts.
- High-risk actions require explicit human approval.

## Manual validation checklist

1. Run `doctor` and confirm environment is valid.
2. Run `analyze` and verify output artifacts are generated.
3. Ask the agent to run a tool-driven task and verify evidence-first behavior.
4. Ask for remote fetch and verify explicit confirmation is required.
5. Confirm no secrets appear in generated files or logs.
