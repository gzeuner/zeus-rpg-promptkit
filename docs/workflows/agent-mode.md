---
Title: VS Code Agent Integration
Description: Workflow-orientierte Leitfaeden fuer Analyse-, Review- und Agentenablaeufe.
Last Updated: 2026-05-17
---

# VS Code Agent Integration

This document explains the Zeus RPG Toolkit VS Code integration for direct Zeus tool usage from chat — including installation, setup, and Language Model Tool API registration.

For the recommended product shape and the fastest agentic-coding path, start with [`agentic-coding.md`](agentic-coding.md).

Use [`../quickstart/5-minutes.md`](../quickstart/5-minutes.md) for the shortest onboarding path.

Use [`../ai/agent-validation-checklist.md`](../ai/agent-validation-checklist.md) after changing extension, prompt, or agent integration.

## Recommended operating model

The recommended setup is **tools first**:

- Zeus language-model tools are the primary integration contract.
- Normal chat mode plus Zeus tools is the default user path.
- The extension is required because it performs the tool registration and workspace wiring.

---

## Von null bis autonom — Kurzübersicht

```
1.  git clone / Download Repo
2.  npm install                           ← Node-Dependencies installieren
3.  cp config/profiles.example.json config/local-only/profiles.json
4.  Env-Variablen setzen (ZEUS_FETCH_*, ZEUS_DB_*)
5.  code vscode-extension                 ← Extension-Ordner in VS Code öffnen
6.  F5                                    ← Extension Development Host starten
7.  "Zeus: Select Profile"
8.  "Zeus: Run Doctor"                    ← Alles grün? Weiter.
9.  Copilot Chat öffnen und im normalen Chat-Modus arbeiten
10. "Analysiere ORDERPGM und zeig mir die Sicherheitsrisiken."
```

Die ausführliche Anleitung zu jedem Schritt folgt in den Abschnitten unten.

---

## Installation

The extension ships as part of this repository and is not yet published to the VS Code Marketplace. There are two ways to install it: **dev mode** (quickest, no packaging needed) or **VSIX install** (persistent, works across VS Code restarts).

> **Why two methods?** The extension references the toolkit's `src/` tree via relative paths. It is designed to run alongside the repo, not as a standalone install. Both methods below preserve that connection.

---

### Method A — Dev mode (recommended, no build tools needed)

This is the quickest path. The extension runs in a separate VS Code window called the **Extension Development Host**.

**Step 1 — Install prerequisites**

- [VS Code](https://code.visualstudio.com/) 1.99 or later
- [Node.js](https://nodejs.org/) 20 or later
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) extension installed and signed in

**Step 2 — Clone and install Node dependencies**

```powershell
# Windows PowerShell
git clone https://github.com/your-org/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
```

```bash
# macOS / Linux
git clone https://github.com/your-org/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
```

**Step 3 — Open the extension folder in VS Code**

```powershell
code vscode-extension
```

This opens a new VS Code window with `vscode-extension/` as the workspace root.

**Step 4 — Press F5**

VS Code detects `vscode-extension/package.json` and launches the **Extension Development Host** — a second VS Code window with the Zeus RPG Toolkit extension active and the repo root loaded as the workspace.

The extension is ready. Skip to [First-time setup](#first-time-setup).

---

### Method B — VSIX install (persistent, survives restarts)

Package the extension as a `.vsix` file and install it permanently. The repo root must stay at the same path after installation because the extension references `src/` via a relative path.

**Step 1 — Install vsce (VS Code extension packaging tool)**

```powershell
npm install -g @vscode/vsce
```

**Step 2 — Package the extension**

```powershell
cd vscode-extension
npm run package
# Creates: zeus-rpg-toolkit-vscode-0.1.0.vsix
```

**Step 3 — Install the .vsix in VS Code**

Open VS Code in the repo root, then:

```
Extensions sidebar (Ctrl+Shift+X)
  → ⋯ (top-right menu)
  → Install from VSIX...
  → Select: vscode-extension/zeus-rpg-toolkit-vscode-0.1.0.vsix
```

Or from the command line:

```powershell
code --install-extension vscode-extension\zeus-rpg-toolkit-vscode-0.1.0.vsix
```

**Step 4 — Open the repo root in VS Code**

After installing, always open the **repo root** (not `vscode-extension/`) as your workspace:

```powershell
code .
```

The extension activates automatically on startup.

---

## First-time setup

After installation (either method), do this once:

### 1. Copy the profile template

```powershell
# Windows PowerShell (run from repo root)
Copy-Item config\profiles.example.json config\local-only\profiles.json
```

```bash
# macOS / Linux
cp config/profiles.example.json config/local-only/profiles.json
```

`config/local-only/profiles.json` is gitignored — this is where your credentials live. Never commit it.

### 2. Set environment variables for your workflow

Open a terminal in VS Code (`Ctrl+\``) and set what you need:

```powershell
# Minimal: local analysis only (no IBM i, no DB2)
$env:ZEUS_SOURCE_ROOT = "C:\work\rpg_sources"
$env:ZEUS_OUTPUT_ROOT = "C:\work\analysis"

# Add these for fetch from IBM i:
$env:ZEUS_FETCH_HOST       = "myibmi.example.com"
$env:ZEUS_FETCH_USER       = "MYUSER"
$env:ZEUS_FETCH_PASSWORD   = "my-secret"
$env:ZEUS_FETCH_SOURCE_LIB = "SOURCEN"
$env:ZEUS_FETCH_IFS_DIR    = "/home/zeus/rpg_sources"
$env:ZEUS_FETCH_OUT        = "./rpg_sources"

# Add these for DB2 metadata:
$env:ZEUS_DB_HOST           = "myibmi.example.com"
$env:ZEUS_DB_USER           = "MYUSER"
$env:ZEUS_DB_PASSWORD       = "my-secret"
$env:ZEUS_DB_DEFAULT_SCHEMA = "MYLIB"
```

To persist these across sessions, add them to your PowerShell profile (`$PROFILE`) or Windows User Environment Variables.

### 3. Select your profile

Open the VS Code Command Palette (`Ctrl+Shift+P`) and run:

```
Zeus: Select Profile
```

Select `default` (or another profile from your `profiles.json`). The status bar shows the active profile.

### 4. Validate the environment

```
Zeus: Run Doctor
```

All checks should show `PASS`. If any fail, the output tells you what is missing and what to fix.

---

## Using Zeus Tools in Chat

Once setup is complete, you can let Copilot work autonomously with the toolkit.

### 1. Open Copilot Chat

Press `Ctrl+Alt+I` (or click the Copilot icon in the activity bar).

### 2. Use the normal chat mode

In the Copilot Chat input bar, stay in your normal chat mode and ask the AI to use the Zeus tools directly.

### 3. Tell it what to do

The chat workflow should first check your environment (`zeus_doctor`), then clarify the target program if needed, and execute the Zeus tools directly.

Example conversations:

```
"Analysiere Programm ORDERPGM und zeig mir die Architektur."

"Gibt es Sicherheitsrisiken in INVPGM? Zeig mir die Befunde."

"Wir wollen ORDERPGM modernisieren – was sind die Blocker?"

"Hole erst die Quellen von IBM i und analysiere dann ORDERPGM."

"Was wird von Tabelle ORDERS verwendet? Impact-Analyse bitte."
```

The agent discusses the plan, waits for your confirmation, then calls the Zeus tools in the right sequence and presents results with links to the generated artifacts.

### What "autonomous" means here

The agent can chain these operations without manual commands:

1. `zeus_doctor` — verify environment
2. `zeus_analyze_workspace` — run source analysis with the right mode
3. `zeus_get_latest_report` — locate the output
4. `zeus_generate_ai_context` — build the AI context bundle
5. `zeus_query_table` — look up DB2 metadata when needed
6. `zeus_fetch_sources` — download from IBM i (requires your confirmation first)

It will not run anything destructive, never exposes credentials, and stops with a clear explanation whenever a tool returns `BLOCKED`.

---

## Fallback: Zeus Agent Terminal

If you prefer direct CLI control (or if the LM Tool API is not available), run:

```
Zeus: Create Agent Terminal
```

A terminal opens with all `ZEUS_*` environment variables pre-loaded. Run any CLI command directly:

```powershell
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --mode security --out ./output --optimize-context
node cli/zeus.js workflow --preset security-review --source ./rpg_sources --program ORDERPGM --out ./output
node cli/zeus.js serve --source-output-root ./output --port 4782
```

---



All tools are available in Copilot Agent Mode via `vscode.lm.registerTool()`:

| Tool | Description |
|---|---|
| `zeus_doctor` | Environment diagnostics — always runs first |
| `zeus_analyze_workspace` | Full source analysis with mode selection |
| `zeus_generate_ai_context` | Generates sanitized AI context bundle |
| `zeus_get_latest_report` | Returns path of latest report.md |
| `zeus_query_table` | Read-only DB2 table metadata query |
| `zeus_fetch_sources` | Download sources from IBM i (requires confirmation) |

### Tool input examples

```json
// zeus_analyze_workspace
{ "members": ["ORDERPGM"], "mode": "security" }

// zeus_query_table
{ "table": "ORDERS", "schema": "MYLIB" }

// zeus_generate_ai_context
{ "taskContext": "Security review for ticket JIRA-1234" }
```

---

## Profile and environment resolution

Zeus subprocesses and agent terminals merge environment values in this order:

1. `process.env`
2. VS Code `zeusRpgToolkit.env.*` settings
3. Legacy VS Code settings (`configPath`, `defaultProfile`, `outputRoot`, `readOnlyMode`, `cliPath`, `javaPath`)
4. Active selected profile from `profiles.json`

Supported environment settings:

- `zeusRpgToolkit.env.ZEUS_CONFIG_DIR`
- `zeusRpgToolkit.env.ZEUS_PROFILE`
- `zeusRpgToolkit.env.ZEUS_OUTPUT_ROOT`
- `zeusRpgToolkit.env.ZEUS_READ_ONLY`
- `zeusRpgToolkit.env.ZEUS_CLI_PATH`
- `zeusRpgToolkit.env.ZEUS_JAVA_PATH`

---

## Commands

- `Zeus: Select Profile`
- `Zeus: Show Active Environment`
- `Zeus: Create Agent Terminal`
- `Zeus: Run Doctor`
- `Zeus: Fetch Sources`
- `Zeus: Analyze Workspace`
- `Zeus: Query Table`
- `Zeus: Generate AI Context`
- `Zeus: Copy AI Prompt to Clipboard`
- `Zeus: Open Latest Report`

---

## Safety model

- Default mode is read-only (`readOnlyMode: true`)
- No IBM i write operations exposed
- No deployment commands
- All secrets masked in output channel, tool results, and generated artifacts
- Tools that are not in `READ_ONLY_SAFE_ACTIONS` return `BLOCKED` with `requiresUserConfirmation: true`
- The agent stops on `BLOCKED` and explains what confirmation is needed

---

## Terminal fallback

For direct CLI access with credentials pre-loaded:

1. Run `Zeus: Create Agent Terminal`
2. The terminal opens at workspace root with all `ZEUS_*` vars set
3. Run any CLI command:

```powershell
node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --mode documentation --out ./output --optimize-context
node cli/zeus.js workflow --preset security-review --source ./rpg_sources --program ORDERPGM --out ./output
node cli/zeus.js serve --source-output-root ./output --port 4782
```

---

## Manual validation checklist

1. Run `Zeus: Open Config` — verify placeholder config created without real credentials.
2. Run `Zeus: Select Profile` — verify status bar shows the active profile.
3. Run `Zeus: Run Doctor` — verify output in `Zeus RPG Toolkit` channel.
4. Open Copilot Chat in normal mode and ask for a Zeus tool-driven task — verify doctor runs first when needed.
5. Ask the agent to analyze a program — verify it asks for confirmation before executing.
6. Run `Zeus: Generate AI Context`, then `Zeus: Copy AI Prompt to Clipboard` — verify `ai_prompt.md`, `context.json`, and `safety_rules.md`.
7. Confirm no secrets appear in output channel, tool results, or generated files.
