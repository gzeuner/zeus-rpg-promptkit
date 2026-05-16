# Agentic Coding with Zeus

This is the recommended setup for developers who want an AI to build IBM i context before coding, review, or analysis work.

## Recommended product shape

Use **Zeus language-model tools as the core integration contract**.

That means:

- Any capable chat session can use Zeus when the extension has registered the tools.
- The product does not depend on any custom agent mode or prompt file.
- The extension is the required integration layer because it registers the Zeus tools into chat.

In practice the product shape is:

1. Register the Zeus tools through the VS Code extension.
2. Keep the real behavior in the tools.
3. Use normal chat as the default entry point.

For a faster operational checklist, see [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md).

For rollout validation, see [docs/agent-validation-checklist.md](docs/agent-validation-checklist.md).

## Fastest developer path

1. Run `npm install` in the repository root.
2. Copy `config/profiles.example.json` to `config/local-only/profiles.json`.
3. Set the required `ZEUS_*` environment variables.
4. Start the extension.
5. Run `Zeus: Select Profile`.
6. Run `Zeus: Run Doctor`.
7. Open Copilot Chat.
8. Stay in your normal chat mode and ask the AI to use the Zeus tools.

## Recommended tool sequence

For most tasks the agent should do this:

1. `zeus_doctor`
2. `zeus_analyze_workspace`
3. `zeus_get_latest_report`
4. `zeus_generate_ai_context`
5. `zeus_query_table` only if DB2 metadata is needed
6. `zeus_fetch_sources` only with explicit user confirmation

## Why the VS Code extension is still necessary

The extension is still required.

It provides:

- `languageModelTools` declarations in `vscode-extension/package.json`
- runtime registration through `vscode.lm.registerTool()`
- workspace-aware profile, environment, and CLI wiring

Without the extension, Zeus commands exist only as CLI/API surfaces and are not directly callable from chat.

## Example chat flow

Developer:
`Use the Zeus tools to analyze ORDERPGM in documentation mode and then generate AI context.`

Expected tool sequence:

1. `zeus_doctor`
2. `zeus_analyze_workspace`
3. `zeus_get_latest_report`
4. `zeus_generate_ai_context`

That is the default recommendation for agentic coding: **tools first, normal chat first**.
