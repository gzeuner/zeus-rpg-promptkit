---
Title: Zeus RPG PromptKit — AI Start Here
Description: Short orientation for an AI agent entering an unfamiliar Zeus session.
---

# Zeus RPG PromptKit — AI Start Here

Zeus is a CLI-first, evidence-first toolkit for understanding IBM i and RPG applications. MCP and the local viewer are optional adapters. The authoritative CLI map starts with `zeus agent bootstrap --json`; the live command guide is `zeus tools guide --json`. With MCP, the equivalent optional resources are `zeus.agent.bootstrap` and `zeus://metadata/agent-orientation.json`.

## First point to check

CLI:

```text
node cli/zeus.js agent bootstrap --json
node cli/zeus.js agent log list --json
node cli/zeus.js tools guide --json
node cli/zeus.js context show --json
node cli/zeus.js doctor --profile <name> --show-resolved
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

## Spoolfile evidence

For batch output or operational evidence that already exists on IBM i, use the
read-only `spool-read` route instead of fetching or mutating anything:

```text
node cli/zeus.js tools describe spool-read --json
node cli/zeus.js doctor --profile <name> --probe --show-resolved
node cli/zeus.js spool-read --profile <name> --job-number <number> --job-user <user> --job-name <job> --spool-file <name> --json
```

`spool-read` is `S2`: it reads only spoolfiles visible to the configured IBM-i
user, returns bounded text, defaults to `Cp037`, and masks detected secrets
before output. Add `--spool-number <number>` when the job has multiple spoolfiles;
without it, matching visible spoolfiles are enumerated. The IBM-i account still
needs permission to see and open the target spoolfile.

## Safety checkpoints

- `S0`: local read-only; safe default for orientation and inspection.
- `S1`: local artifact or context write; show the target and preserve provenance.
- `S2`: remote IBM i/DB2 read-only; state the exact system and scope first.
- `S3`: controlled remote write; require explicit approval and show the exact command first.
- `S4`: bridge/apply/compile; operator-gated and never implicit.

Keep credentials out of prompts, logs, generated artifacts, and responses. For the complete command list, aliases, nested actions, safety levels, examples, and workflow presets, use [`docs/tool-catalog.md`](../tool-catalog.md). For recovery, use the [agent failure playbook](agent-failure-playbook.md).

## Experience loop

The local experience log makes failed attempts useful for the next session:

1. Read recent records before retrying: `node cli/zeus.js agent log list --json`.
2. After a failed, blocked, or partial attempt, record one concise event with `outcome`, the safe command, a stable `failure-code`, the symptom, the lesson, and the next safe step.
3. Use the recurring failure codes and lessons to improve the prompt, documentation, or command contract instead of repeating the same invalid call.

Example:

```text
node cli/zeus.js agent log --outcome failed --command "node cli/zeus.js impact --target <target> --program <program>" --failure-code ANALYZE_REQUIRED --symptom "analysis artifacts were missing" --workaround "run analyze and verify the manifest" --lesson "impact requires a completed analysis run" --next-step "node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root> --json" --json
```

Records are stored in `.zeus/agent-experience.jsonl`, which is ignored by Git. Never put raw stdout/stderr, environment dumps, credentials, or credential-bearing URLs into the event.
