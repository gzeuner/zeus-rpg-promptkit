---
Title: Optional VS Code Adapter Boundary
Status: Accepted
Date: 2026-08-21
---

# ADR-015: Optional VS Code Adapter Boundary

## Context

The CLI and local MCP server are the canonical Zeus interfaces. An editor integration is useful for showing the
currently open legacy member, making the source location visible, and opening generated evidence. It must not create a
second analysis architecture or infer an IBM i system and library from an editor URI.

## Decision

The VS Code integration is an optional, independently packaged adapter under `vscode-extension/`.

- The adapter invokes the workspace Zeus CLI and does not import the repository's internal `src/` tree.
- The adapter owns editor UX only: current-target display, explicit workspace-relative roots, command registration,
  report navigation, and a small recent-analysis view.
- Source acquisition, freshness, evidence generation, knowledge synchronization, MCP policy, and capability
  registration remain in the core CLI/API/MCP contracts.
- Workspace Trust is required for local analysis. Source and output roots must remain within the opened workspace.
- Code for IBM i availability may be displayed as context, but remote reads and fetches remain explicit CLI/MCP actions.
- The adapter package has its own manifest, lockfile, test/build/package scripts, Apache-2.0 license, and path-scoped
  CI workflow. The root NPM package excludes the adapter.

## Consequences

The adapter can be installed or omitted without changing Community CLI/MCP behavior. The public CLI contract is the
single integration seam, which keeps the adapter replaceable and prevents duplicate business logic. IBM i dimensions
that cannot be proven from a local editor URI remain `unknown` instead of being guessed. A future Code4i fetch adapter
would need a separate explicit contract and tests; it is not implicit in this boundary.

## Verification

The adapter must pass its own `npm run check` and `npm run package`, while changes to the repository continue to pass
the root format, lint, typecheck, test, package-smoke, documentation, demo, and hygiene checks.
