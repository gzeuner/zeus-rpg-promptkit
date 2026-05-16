# Zeus Agent Validation Checklist

Use this checklist after extension changes that affect Zeus tools, prompts, or agent workflows.

## Static checks

1. Run `node --test tests/vscode-extension-tool-contract.test.js`.
2. Confirm the extension still declares all Zeus tools in `vscode-extension/package.json`.
3. Confirm `vscode-extension/extension.js` still registers the same tools through `vscode.lm.registerTool()`.

## Manual Dev Host checks

1. Open `vscode-extension/` in VS Code.
2. Press `F5` to start the Extension Development Host.
3. Run `Zeus: Select Profile`.
4. Run `Zeus: Run Doctor`.
5. Open Copilot Chat in normal chat mode.
6. Ask for a Zeus task, for example: `Use the Zeus tools to analyze ORDERPGM in documentation mode.`
7. Confirm the chat can invoke Zeus tools directly without any custom agent mode.
8. Ask for remote fetch and confirm the workflow asks for confirmation before source retrieval.
9. Run `Zeus: Generate AI Context` and confirm `ai_prompt.md`, `context.json`, and `safety_rules.md` are created.

## Expected outcome

- Normal chat mode works with Zeus tools directly.
- Fetch stays confirmation-gated.
- No secrets appear in prompts, output, or generated artifacts.