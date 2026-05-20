---
Title: Agentic Coding with Zeus
Description: Workflow-orientierte Leitfaeden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-05-20
---

# Agentic Coding with Zeus

This is the recommended setup for developers who want an AI to build IBM i context before coding, review, or analysis work.

## Recommended product shape

Use **Zeus language-model tools as the core integration contract**.

That means:

- Any capable chat session can use Zeus when Zeus tools are exposed through your chosen integration layer (for example MCP, internal tool gateway, or script wrapper).
- The product does not depend on any custom agent mode or prompt file.
- The real behavior lives in Zeus CLI/API commands and generated artifacts.

In practice the product shape is:

1. Expose Zeus tools through one integration layer.
2. Keep the real behavior in the tools.
3. Use normal chat as the default entry point.

For a faster operational checklist, see [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md).

For rollout validation, see [`../ai/agent-validation-checklist.md`](../ai/agent-validation-checklist.md).

## Fastest developer path

1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` to `config/local-only/profiles.json`.
3. Set the required `ZEUS_*` environment variables.
4. Run `node cli/zeus.js doctor --profile default --show-resolved`.
5. Run `node cli/zeus.js analyze --profile default`.
6. Open your AI client.
7. Stay in your normal chat mode and ask the AI to use the Zeus tools.

## Recommended tool sequence

For most tasks the agent should do this:

1. `zeus_doctor`
2. `zeus_analyze_workspace`
3. `zeus_get_latest_report`
4. `zeus_generate_ai_context`
5. `zeus_query_table` only if DB2 metadata is needed
6. `zeus_fetch_sources` only with explicit user confirmation

## Why a tool adapter is still necessary

An adapter layer is still required for direct tool calls from chat.

It provides:

- tool schema/registration for the AI runtime
- runtime execution and safety enforcement
- workspace-aware profile, environment, and CLI wiring

Without an adapter, Zeus commands exist only as CLI/API surfaces and are not directly callable from chat.

## Example chat flow

Developer:
`Use the Zeus tools to analyze ORDERPGM in documentation mode and then generate AI context.`

Expected tool sequence:

1. `zeus_doctor`
2. `zeus_analyze_workspace`
3. `zeus_get_latest_report`
4. `zeus_generate_ai_context`

That is the default recommendation for agentic coding: **tools first, normal chat first**.
