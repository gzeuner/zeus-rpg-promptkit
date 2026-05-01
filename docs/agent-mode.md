# VS Code Agent Integration

This document explains the Zeus RPG Toolkit VS Code integration layer for Copilot/Agent workflows.

## Scope

- CLI behavior stays unchanged.
- VS Code integration is additive.
- Default mode is read-only.
- No deployment features.
- No IBM i write operations.

## Profile and environment resolution

Zeus subprocesses and agent terminals merge environment values in this order:

1. `process.env`
2. VS Code `zeusRpgToolkit.env.*` settings
3. legacy VS Code settings (`configPath`, `defaultProfile`, `outputRoot`, `readOnlyMode`, `cliPath`, `javaPath`)
4. active selected profile

Supported environment settings:

- `zeusRpgToolkit.env.ZEUS_CONFIG_DIR`
- `zeusRpgToolkit.env.ZEUS_PROFILE`
- `zeusRpgToolkit.env.ZEUS_OUTPUT_ROOT`
- `zeusRpgToolkit.env.ZEUS_READ_ONLY`
- `zeusRpgToolkit.env.ZEUS_CLI_PATH`
- `zeusRpgToolkit.env.ZEUS_JAVA_PATH`

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

## Agent-accessible Zeus tools

Stable internal tool names:

- `zeus_doctor`
- `zeus_fetch_sources`
- `zeus_analyze_workspace`
- `zeus_query_table`
- `zeus_generate_ai_context`
- `zeus_get_latest_report`

Tools return structured JSON-like objects and sanitized summaries.

## Language Model Tool API status

The extension currently targets VS Code engine `^1.90.0`. Language Model Tool contribution wiring is deferred in this branch to avoid relying on API surface not guaranteed by that engine target. Internal stable tool commands are implemented now as a safe bridge.

## Terminal behavior

`Zeus: Create Agent Terminal` creates `Zeus Agent Terminal` with resolved ZEUS_* values and safe banner output:

- `Zeus RPG Toolkit environment loaded.`
- `Active profile: <profile>`
- `Read-only mode: true|false`
- `Config: <workspace-relative path>`

The extension also refreshes VS Code environment variable collection for Zeus keys when available.

## Safety model

- Secret masking is applied to logs and structured results.
- Masked key/value categories include password/pass/pwd/token/secret/api_key/key/credential/auth/authorization and JDBC credential patterns.
- User fields are masked when credentials are present.
- Agent tools are read-only guarded.
- Unsupported or risky operations return `BLOCKED` with `requiresUserConfirmation=true`.

## Limitations

- No chat participant (`@zeus`) in this minimal slice.
- No deployment command exposure.
- No IBM i write command exposure.

## Manual test steps

1. Open project in VS Code.
2. Run `Zeus: Select Profile`.
3. Run `Zeus: Show Active Environment`.
4. Run `Zeus: Create Agent Terminal`.
5. In the terminal, verify `ZEUS_PROFILE` and `ZEUS_CONFIG_DIR` exist.
6. Run `Zeus: Run Doctor`.
7. Run `Zeus: Generate AI Context`.
8. In Copilot Agent Mode, invoke Zeus tools/commands.
9. Confirm no secrets are shown in output channel, terminal banners, or generated context files.
