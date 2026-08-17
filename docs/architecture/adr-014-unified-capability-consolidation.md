---
title: ADR-014 Unified Capability Consolidation
status: Accepted
date: 2026-08-17
---

# ADR-014: Unified Capability Consolidation

## Context

The former private implementation repository duplicated useful product modules beside the public
Community codebase. The public repository is now the single active codebase. The user-authorized
project license for the consolidated tree is Apache-2.0.

## Decision

The public package owns and ships the useful implementations for:

- Project Intelligence operations and entitlement policy
- Generation Assurance
- Db2 Test Intelligence
- owner-gated IBM i Validation

They use the existing Zeus registrar and public contract structure. Each module has one source tree,
one descriptor, and one explicit registration path. `professional` and `enterprise` remain runtime
surface presets because they describe capability selection and safety gates, not source ownership
or separate package distribution.

The existing external module loader remains only as an explicit compatibility hook for third-party
or separately supplied extensions. It does not participate in built-in module discovery and is not
required by the public product.

## Consequences

- `src/index.js`, the API subpaths, CLI, MCP adapters, package exports, tests, and docs describe one
  public product.
- Entitlement is a runtime policy. It does not create a source-license split.
- Community-only operation remains available when no built-in module is requested.
- The IBM i live path remains disabled by default and requires owner-gated authorization.
- Historical release notes and the external-loader compatibility vocabulary may still mention the
  former split; current product docs must describe the unified package.

## Rejected alternatives

- Keeping a permanent private subtree or copying the private repository as a nested product.
- Maintaining duplicate Project Intelligence engines and separate capability registries.
- Automatically discovering or loading external modules.
- Removing explicit entitlement and safety checks merely because the source is public.

## Verification requirements

The consolidation branch must pass formatting, lint, typecheck, the full test inventory, package
smoke, docs, demo, diff hygiene, and secret/license hygiene checks before a commit is proposed for
review. Push, merge, release, and archival of the former private repository require separate
confirmation.
