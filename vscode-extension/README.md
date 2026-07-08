# Zeus RPG PromptKit for VS Code

Brings the Zeus evidence-first analysis toolkit into VS Code, designed to work *alongside* **Code for IBM i**.

## Current Features
- `Zeus: Analyze Current Program/Member` (context menu + command palette)
- Automatically detects the open member (supports Code4i schemes)
- **Improved fallback**: Fully functional in local/standalone mode when Code for IBM i is not connected or not installed. Uses current file directory + workspace as source. Clear status bar indicator (`Zeus (local)`).
- Uses the rich **pluggable `zeus` API**
- `Zeus: Show Latest Analysis Report`
- `Zeus: Register Demo Custom Analyzer` (shows off pluggability)
- "Zeus Analyses" view in the Explorer sidebar
- Exposes the full Zeus API so *other* extensions can consume it

## Pluggable Features (exposed in VS Code)
The extension makes these core capabilities available directly from the editor:

- **Custom Analyzers** — `zeus.analyzers.registerAnalyzer(id, { run(ctx) { ... } })`
  - Your logic runs during analysis and enriches `canonicalAnalysis` / reports / AI prompts.
- **Dynamic MCP Tools** — add tools that agents inside VS Code can call.
- `zeus.registerPlugin(...)` — convenient way to bundle extensions.
- Dense output by default (clean for editor + LLM context).

## Why Use the VS Code Extension?
- No terminal switching — analyze the file you're editing.
- Works great **with or without Code for IBM i** (smart local fallback when not connected).
- Code4i synergy — reuses connection context when available.
- Pluggable by design — ship company rules or domain analyzers as small contributions.
- Better AI experience — generated artifacts (especially `ai-knowledge.json`) can be fed to Copilot or custom chat participants.
- Part of the modern IBM i stack (Code4i + Zeus).

## Development
1. Open the `vscode-extension` folder (or the repo root) in VS Code.
2. Press F5 to launch Extension Development Host.
3. Code for IBM i is optional. The extension fully supports **local/standalone mode** when Code4i is not installed or not connected.
4. To test the fallback:
   - Open any local source file, e.g. `../rpg_sources/pub400-zeus1/QRPGLESRC/DATEUTIL.rpgle` or a file from `../examples/demo-rpg-mini-system/rpg_sources`.
   - Run "Zeus: Analyze Current Program/Member" (command palette / context menu / status bar).
   - Status bar shows `Zeus (local)`.
   - Reports, webview, tree view, and chat participant all work using the local workspace files.
5. The extension loads the core from `../../src/api/zeusApi` (same repo). Pluggable analyzers/MCP tools work in both modes.

When Code for IBM i *is* active, Zeus reuses the connection profile automatically.

## Roadmap
This is the beginning of deep integration:
- Use Code4i's Content API to read members directly (no need for source dir).
- Richer tree view of analyses.
- Chat participant / context provider that injects Zeus evidence.
- One-click "Analyze + Ask AI".

See the main project for the full pluggable API surface.
