---
Title: Agent Integration
Description: Workflow-orientierte Leitfaeden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-05-20
---

# Agent Integration

This document explains how to run Zeus in AI-assisted workflows without binding to a specific editor.

For the recommended product shape and the fastest agentic-coding path, start with [`agentic-coding.md`](agentic-coding.md).

Use [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md) for the shortest onboarding path.

Use [`../ai/agent-validation-checklist.md`](../ai/agent-validation-checklist.md) after changing tooling, prompts, or agent integration.

## Recommended operating model

The recommended setup is **tools first**:

- Zeus tools are the primary integration contract.
- Normal chat mode plus Zeus tools is the default user path.
- A runtime adapter is responsible for tool registration and execution.

## From zero to autonomous

```text
1.  git clone / download repo
2.  npm install
3.  cp config/profiles.example.json config/local-only/profiles.json
4.  set env vars (ZEUS_FETCH_*, ZEUS_DB_*)
5.  run doctor
6.  run analyze/workflow
7.  open AI chat client
8.  request Zeus tool-driven analysis
```

## First-time setup

### 1. Copy profile template

```bash
cp config/profiles.example.json config/local-only/profiles.json
```

### 2. Set environment variables

```bash
export ZEUS_SOURCE_ROOT="/work/rpg_sources"
export ZEUS_OUTPUT_ROOT="/work/analysis"
```

Add remote values only when needed:

```bash
export ZEUS_FETCH_HOST="myibmi.example.com"
export ZEUS_FETCH_USER="MYUSER"
export ZEUS_FETCH_PASSWORD="my-secret"

export ZEUS_DB_HOST="myibmi.example.com"
export ZEUS_DB_USER="MYUSER"
export ZEUS_DB_PASSWORD="my-secret"
export ZEUS_DB_DEFAULT_SCHEMA="MYLIB"
```

### 3. Validate runtime

```bash
node cli/zeus.js doctor --profile default --show-resolved
```

All checks should show `PASS`.

## Using Zeus tools in chat

A good default sequence:

1. `zeus_doctor`
2. `zeus_analyze_workspace`
3. `zeus_get_latest_report`
4. `zeus_generate_ai_context`
5. `zeus_query_table` only when DB2 metadata is needed
6. `zeus_fetch_sources` only with explicit user confirmation

Example prompts:

```text
Analyze ORDERPGM and summarize architecture risks.

Find security issues in INVPGM and cite the generated artifacts.

Fetch sources first, then run a modernization-focused workflow for ORDERPGM.
```

## CLI fallback

If direct tool-calls are not available, run Zeus directly:

```bash
node cli/zeus.js doctor --profile default --show-resolved
node cli/zeus.js analyze --profile default
node cli/zeus.js workflow --preset security-review --source ./rpg_sources --program ORDERPGM --out ./output
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
