---
Title: Agent Integration
Description: CLI-first Leitfaden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-09-03
---

# Agent Integration

This document explains how to run Zeus in AI-assisted workflows without binding to a specific editor or tool adapter.

For the detailed CLI contract, use [`../ai/cli-agent-guide.md`](../ai/cli-agent-guide.md). For the copy/paste session prompt, use [`../ai/session-prompt.md`](../ai/session-prompt.md).

## Recommended operating model

The recommended setup is **CLI-first**:

- Zeus CLI commands and their generated JSON help are the primary integration contract.
- `zeus agent` provides a transport-neutral bootstrap and workflow suggestion.
- MCP is an optional adapter for clients that explicitly provide a working MCP runtime.
- The local viewer is optional and is not required for agent work.

## From zero to agent-assisted work

```text
1.  git clone / download repo
2.  npm install
3.  copy the profile template only when IBM i/Db2 access is needed
4.  run agent bootstrap and command discovery
5.  inspect the working context
6.  run doctor for profile-based remote work
7.  run analyze/workflow and verify artifacts
8.  open the AI client
9.  start with docs/ai/session-prompt.md and request CLI-driven analysis
```

## First-time setup

### 1. Optional profile setup

For remote IBM i or Db2 evidence, copy and configure a local-only profile:

```powershell
Copy-Item config/profiles.example.json config/local-only/profiles.json
```

Load credentials through the configured environment or Secret Vault. Never paste them into a prompt.

### 2. Bootstrap the agent contract

From the project root:

```powershell
node .\cli\zeus.js agent bootstrap --json
node .\cli\zeus.js tools list --json
node .\cli\zeus.js context show --json
```

Use `node .\cli\zeus.js tools describe <command> --json` before using an unfamiliar command.

### 3. Validate remote configuration when needed

```powershell
node .\cli\zeus.js doctor --profile default --probe --show-resolved
```

For purely local source analysis, a missing remote profile is not by itself a blocker.

## Default CLI sequence

For most tasks:

1. `node cli/zeus.js agent bootstrap --json`
2. `node cli/zeus.js tools list --json`
3. `node cli/zeus.js context show --json`
4. `node cli/zeus.js analyze` or `node cli/zeus.js workflow --preset ...`
5. `node cli/zeus.js search-source`, `field-search`, `trace`, `xref`, `investigate`, or `impact` only as needed
6. `node cli/zeus.js assess-risk`, `generate-test`, `generate-checklist`, or `qa` for review planning
7. `node cli/zeus.js bundle --safe-sharing` for review/sharing preparation
8. `node cli/zeus.js fetch` only with explicit user confirmation

The read-only and local artifact sequence should continue even when optional Project Intelligence or remote services are unavailable.

## Example agent requests

```text
Use the Zeus CLI to analyze ORDERPGM from ./rpg_sources. Start with agent bootstrap and tools list, then summarize architecture risks from the generated artifacts.

Use the existing Zeus analysis artifacts to find the impact of changing STATUS. Cite files, lines, evidence ids, and unresolved references.

After I approve the exact fetch command, refresh the selected IBM i members, analyze ORDERPGM, and create a safe-sharing review bundle.
```

## CLI fallback and adapters

The CLI is the normal path and does not depend on direct tool calls. If a client explicitly provides MCP, discover its live tools before using them; the equivalent CLI commands remain valid and are the fallback when MCP is unavailable.

## Safety model

- Default mode is local read-only inspection plus local artifact generation.
- IBM i and Db2 operations are remote-read and require an explicit, verified profile.
- No write operations on production systems.
- Secrets are masked in output, tool results, and generated artifacts.
- S3/S4 actions require explicit human approval and the exact command shown first.

## Validation checklist

1. Run `agent bootstrap --json` and `tools list --json`.
2. Run `context show --json` and confirm the intended scope.
3. Run `analyze` and verify the output manifest and expected artifacts.
4. Ask the agent to perform a CLI-driven evidence task and verify citations.
5. Ask for remote fetch and verify explicit confirmation is required.
6. Confirm no secrets appear in generated files or logs.
