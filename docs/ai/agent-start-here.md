---
Title: Zeus RPG PromptKit — AI Start Here
Description: Short orientation for an AI agent entering an unfamiliar Zeus session.
---

# Zeus RPG PromptKit — AI Start Here

Zeus is a CLI/MCP-first, evidence-first toolkit for understanding IBM i and RPG applications. The local viewer is optional. The authoritative live map is available through `zeus tools guide --json` or, with MCP, `zeus.agent.bootstrap` and `zeus://metadata/agent-orientation.json`.

## First point to check

CLI:

```text
node cli/zeus.js tools guide --json
node cli/zeus.js context show --json
node cli/zeus.js doctor --profile <name> --show-resolved --json
node cli/zeus.js tools list --json
```

MCP:

```text
zeus.agent.bootstrap
tools/list
zeus.help
zeus.context.get
```

Do not guess a command or tool name. Use the live help surface first.

## Working location must be explicit

Before reading source, metadata, or data, make the effective location visible:

- system / system alias
- source library and source file (`QRPGLESRC`, `QCLSRC`, or the applicable source file)
- member and local source root
- metadata system/schema
- data system/schema and requested scope

Use `context show` / `zeus.context.get` to inspect it. Use `context set` / `zeus.context.set` to correct it. Explicit command and tool arguments override the context and must be repeated in the result.

## Evidence-first loop

1. Locate the source or local knowledge snapshot.
2. Run the freshness check before serving a snapshot or drawing conclusions.
3. Fetch only the required source and only after the operator has approved the remote read.
4. Analyze locally, then deepen with search, field, impact, object, SQL, or joblog evidence.
5. Report exact evidence references, freshness, uncertainty, and the next safe action.

Typical local path:

```text
analyze → investigate/search-source/field-search → impact/assess-risk → generate-test/qa → bundle
```

Typical Knowledge First path:

```text
context → project-knowledge check → locate/lookup only when fresh → sync only with explicit local-write approval
```

## Safety checkpoints

- `S0`: local read-only; safe default for orientation and inspection.
- `S1`: local artifact or context write; show the target and preserve provenance.
- `S2`: remote IBM i/DB2 read-only; state the exact system and scope first.
- `S3`: controlled remote write; require explicit approval and show the exact command first.
- `S4`: bridge/apply/compile; operator-gated and never implicit.

Keep credentials out of prompts, logs, generated artifacts, and responses. For the complete command list, aliases, nested actions, safety levels, examples, and workflow presets, use [`docs/tool-catalog.md`](../tool-catalog.md). For recovery, use the [agent failure playbook](agent-failure-playbook.md).
