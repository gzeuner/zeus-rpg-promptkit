---
Title: Local Workspace Policy
Description: Rules for local workspace data, sensitive artifacts, and public-safe documentation boundaries.
Last Updated: 2026-05-24
---

# Local Workspace Policy

This policy is blunt on purpose: local workspace data is useful for operators, but it is not reusable toolkit knowledge.

## Scope

These locations are local-workshop surfaces and may be sensitive:

- `.local/`
- `output/`
- `.zeus/`

## What These Locations Are

- `.local/` may contain operator notes, MCP audit traces, session notes, scratch files, and debugging output.
- `output/` may contain generated analysis artifacts for review and troubleshooting.
- `.zeus/` may contain local runtime/experimental data.

## What These Locations Are Not

- not a project-neutral knowledgebase
- not a public fixture source by default
- not a safe MCP/API knowledge source
- not a source-code-generation input
- not a replacement for `src/knowledge/final` contracts

## Hard Rules

- Treat `.local/`, `output/`, and `.zeus/` content as potentially sensitive unless proven synthetic.
- Do not migrate local audit/session notes into `src/knowledge/final`.
- Do not promote local DDDL/template artifacts into reusable toolkit knowledge.
- Do not copy local examples into public docs/tests unless content is intentionally synthetic and reviewed.
- Purge old knowledge-transfer notes, old `zeus.knowledge` traces, and old DDDL/template artifacts unless clearly synthetic and still needed.

## DDDL Rule

DDDL remains local raw interchange only. It is not a final-safe or reusable project-neutral knowledgebase.

## MCP/API Rule

Knowledge exposure via CLI/MCP/API stays disabled until a final project-neutral catalog has passed privacy validation.

## Public Docs and Tests Rule

- Public docs and tests must use synthetic examples only.
- If a local artifact is useful, rewrite it as synthetic before promoting it to repository content.
- Historical references to removed paths are acceptable only in dedicated reset/architecture documents, not as active behavior claims.
