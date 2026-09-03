---
Title: Agent Failure Playbook
Description: Stable CLI and MCP recovery guidance for AI agents working with Zeus.
Last Updated: 2026-09-03
---

# Agent Failure Playbook

Use this playbook when a Zeus CLI command or optional MCP operation fails, is refused, or returns incomplete evidence. Match the situation to a stable code, follow one recovery path, and avoid retry loops.

Machine-readable copy:

- CLI: `node cli/zeus.js agent bootstrap --json` → `failurePlaybook`
- MCP, when explicitly available: `zeus://metadata/agent-failure-playbook.json`

## Principles

1. Do not invent commands, options, profiles, tools, analysis results, or unresolved symbols.
2. Fail closed on policy, workspace containment, and approval gates.
3. Use one diagnosis and one recovery path; do not retry the same invalid call.
4. Prefer local, read-only evidence when remote or optional capabilities are unavailable.
5. Report the original error, recovery attempted, and remaining uncertainty.

## Codes

### POLICY_REFUSED / TOOL_NOT_ALLOWED

The requested capability is not available in the current surface or policy.

- Do: run `node cli/zeus.js tools list --json` and, for a known command, `node cli/zeus.js tools describe <command> --json`.
- Do: choose a documented lower-risk CLI alternative or ask the operator to enable the capability.
- Do not: invent a command, MCP tool, or alternate spelling and retry repeatedly.

Next CLI commands:

```text
node cli/zeus.js tools list --json
node cli/zeus.js agent suggest --goal "<goal>" --json
node cli/zeus.js doctor --profile <profile> --show-resolved
```

### MISSING_PROFILE

A profile is required but missing, empty, or unresolved.

- Do: run `profiles`, ask which profile is intended, then pass it explicitly.
- Do: use local source analysis if the task does not need IBM i or Db2.
- Do not: guess a profile name or proceed against a remote target without validation.

Next CLI commands:

```text
node cli/zeus.js profiles --json
node cli/zeus.js doctor --profile <profile> --show-resolved
node cli/zeus.js onboarding
```

### ANALYZE_REQUIRED

A dependent command needs analysis artifacts that do not exist.

- Do: run `analyze` or a suitable `workflow` for the target program.
- Do: verify `analyze-run-manifest.json` and the expected output directory.
- Do not: infer impact, risk, callers, or test cases without the evidence run.

Next CLI commands:

```text
node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root> --json
node cli/zeus.js analyses list --json
node cli/zeus.js impact --target <target> --program <program> --out <output-root> --json
```

### UNRESOLVED_REFS

Symbols, bindings, callers, tables, or references could not be resolved from the available evidence.

- Do: search local source, widen the source root, or re-run analysis with the correct inputs.
- Do: report the unresolved item explicitly and explain what evidence is missing.
- Do not: turn an unresolved reference into a confirmed dependency.

Next CLI commands:

```text
node cli/zeus.js search-source --source-root <source-root> --search-term "<term>"
node cli/zeus.js field-search --profile <profile> --field <field> --mode all --json
node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root> --json
```

### PI_ABSENT

Optional Project Intelligence or a local knowledge snapshot is unavailable, stale, or not enabled.

- Do: inspect the status/check result and use local `analyze`, `search-source`, `impact`, and `bundle` capabilities.
- Do: use Knowledge First lookup only when the snapshot is reported fresh.
- Do not: claim integrated Project Intelligence or serve stale/unknown retrieval results.

Next CLI commands:

```text
node cli/zeus.js project-knowledge discover --json
node cli/zeus.js project-knowledge check --json
node cli/zeus.js analyze --source <source-root> --program <program> --out <output-root> --json
```

### INVALID_ARGS

The command arguments failed validation.

- Do: read the command record and example from `tools describe`.
- Do: correct required fields, types, enum values, and paths; retry once.
- Do not: send extra arguments or repeat the same invalid payload.

Next CLI commands:

```text
node cli/zeus.js tools describe <command> --json
node cli/zeus.js agent bootstrap --json
```

### RUNTIME_BACKEND

The local runtime, Java process, IBM i connection, or Db2 backend failed.

- Do: run `doctor` for the selected profile and preserve the diagnostic message.
- Do: continue with local-only commands when they can answer part of the question.
- Do not: hammer a failing remote service or claim successful remote evidence.

Next CLI commands:

```text
node cli/zeus.js doctor --profile <profile> --show-resolved
node cli/zeus.js resources --profile <profile> --json
node cli/zeus.js search-source --source-root <source-root> --search-term "<term>"
```

### PATH_OUTSIDE_WORKSPACE

A requested path is outside the configured workspace or source containment boundary.

- Do: use an explicitly contained source/output path or ask the operator for an approved workspace path.
- Do not: disable containment checks, use traversal, or silently redirect output.

Next CLI commands:

```text
node cli/zeus.js context show --json
node cli/zeus.js resources --profile <profile> --json
```

### APPROVAL_REQUIRED

The requested action requires explicit user/operator approval, typically because it is remote, S3, S4, a mutation, or a fetch.

- Do: show the exact command, target, scope, safety level, and expected effect.
- Do: wait for explicit approval and use a dry-run, plan, report, or local alternative when possible.
- Do not: treat silence, a warning, or a previous approval as approval for a new target.

Next CLI commands:

```text
node cli/zeus.js agent suggest --goal "<goal>" --json
node cli/zeus.js tools describe <command> --json
```

## Standard recovery order

1. Capture exit status, structured output, command, and scope.
2. Match the closest stable code above.
3. Run one listed `nextCommands` recovery path.
4. Verify its checkpoint or artifact output.
5. If still blocked, stop and ask the operator with the code and last error.

Optional MCP clients should apply the same recovery logic using their live `tools/list` surface. The CLI commands above remain the canonical fallback.
