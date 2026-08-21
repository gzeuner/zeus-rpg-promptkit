# Zeus RPG PromptKit — optional VS Code adapter

This package provides a small, optional editor adapter for the public Zeus RPG PromptKit. The CLI and local MCP
server remain the canonical product interfaces; the adapter adds editor context and report navigation without
duplicating analysis or knowledge-base logic.

## What it does

- shows the current system, library/schema, source file, member/program, source root, and output root;
- keeps the selected source and output roots inside the trusted workspace;
- runs the workspace Zeus CLI for an explicit current-member analysis;
- opens generated reports and lists recent analyses in the Explorer;
- works locally without Code for IBM i; if Code4i is installed, it is shown as available, but no implicit remote
  source read is performed.

The adapter never reads the repository's private source tree and has no embedded credentials or customer data. It
does not provide a second API, MCP server, chat participant, or dynamic plugin loader.

## Install and use

Build a VSIX from this directory:

```bash
npm ci
npm run check
npm run package
```

Install the generated `.vsix` in VS Code. Open a trusted workspace containing Zeus and the local legacy sources,
open a source member, then run **Zeus: Show Working Context** before **Zeus: Analyze Current Program/Member**.

The adapter uses `cli/zeus.js` from the opened workspace when present. Set `zeus.cliPath` only when a different
workspace-relative CLI entry point is required. `zeus.workingSourceRoot` and `zeus.outputRoot` are workspace-relative
paths and are rejected when they escape the workspace.

## Scope and limitations

The editor URI can identify a source file and member, but it cannot safely infer an IBM i system or library. Those
dimensions remain visible as `unknown` until the operator supplies them through the canonical Zeus working context or
an explicit CLI/MCP workflow. Code4i availability is informational in this iteration; remote fetching is still an
explicit CLI/MCP action.

For source acquisition, freshness checks, evidence generation, knowledge-base synchronization, and AI context use the
main repository documentation and CLI/MCP contracts.

## License

Apache License 2.0. See [LICENSE](LICENSE).
