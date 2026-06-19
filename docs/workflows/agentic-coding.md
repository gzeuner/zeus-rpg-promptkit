---
Title: Agentic Coding with Zeus
Description: Workflow-orientierte Leitfaeden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-06-19
---

# Agentic Coding with Zeus

This is the recommended setup for developers who want an AI to build IBM i context before coding, review, or analysis work.

## Recommended product shape

Use **Zeus CLI commands and MCP tools as the core integration contract**.

That means:

- Any capable chat session can use Zeus when Zeus tools are exposed through your chosen integration layer (for example MCP, internal tool gateway, or script wrapper).
- The standard session bootstrap is [`../ai/session-prompt.md`](../ai/session-prompt.md).
- The real behavior lives in Zeus CLI/API commands and generated artifacts.

In practice the product shape is:

1. Expose Zeus tools through one integration layer.
2. Keep the real behavior in the CLI/MCP tools.
3. Use normal chat plus the standard session prompt as the default entry point.

For a faster operational checklist, see [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md).

For rollout validation, see [`../ai/agent-validation-checklist.md`](../ai/agent-validation-checklist.md).

## Fastest developer path

1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` to `config/local-only/profiles.json`.
3. Load the required environment explicitly in the current shell.
4. Run `node cli/zeus.js doctor --profile default --show-resolved`.
5. Run `node cli/zeus.js analyze --profile default` or a `workflow` preset.
6. Review the generated artifacts or package them with `bundle`.
7. Open your AI client and start with [`../ai/session-prompt.md`](../ai/session-prompt.md).
8. Stay in normal chat mode and ask the AI to use the Zeus tools.

## Recommended tool sequence

For most tasks the agent should do this:

1. `zeus.doctor`
2. `zeus.analyze` or `zeus.workflow`
3. `zeus.query-table`, `zeus.query-sql`, `zeus.joblog`, or `zeus.inspect-object` only if more evidence is needed
4. `zeus.bundle` to package artifacts for review/sharing
5. `zeus.serve` only if an optional local viewer helps
6. `zeus.fetch` only with explicit user confirmation

## Why a tool adapter is still necessary

An adapter layer is still required for direct tool calls from chat.

It provides:

- tool schema/registration for the AI runtime
- runtime execution and safety enforcement
- workspace-aware profile, environment, and CLI wiring

Without an adapter, Zeus commands exist only as CLI/API surfaces and are not directly callable from chat.

## Example chat flow

Developer:
`Run doctor first, then use the Zeus tools to analyze ORDERPGM in documentation mode and summarize the generated artifacts.`

Expected tool sequence:

1. `zeus.doctor`
2. `zeus.analyze`
3. `zeus.bundle`
4. optional follow-up evidence tools as needed

That is the default recommendation for agentic coding: **tools first, normal chat first**.
