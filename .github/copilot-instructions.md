# Zeus Copilot Agent Instructions

Use Zeus VS Code commands and Zeus agent tools for evidence-first, read-only workflows.

## Workflow

1. Run `Zeus: Show Active Environment`.
2. If profile is unknown, run `Zeus: Select Profile` and then `Zeus: Run Doctor`.
3. Before editing RPG-related code, run `Zeus: Generate AI Context`.
4. Use read-only Zeus operations first: doctor, fetch sources, analyze workspace, query table, latest report.
5. Use generated reports and context artifacts as evidence.

## Safety

- Keep default mode read-only.
- Never deploy.
- Never run IBM i write operations.
- Never expose credentials, connection strings, tokens, passwords, or secrets.
- Never print secret values in terminal output, logs, or copied prompts.
- Do not edit fetched originals unless explicitly requested; prefer workspace copies.
- Ask for user confirmation before risky actions.

## Zeus Agent Tool Names

- `zeus_doctor`
- `zeus_fetch_sources`
- `zeus_analyze_workspace`
- `zeus_query_table`
- `zeus_generate_ai_context`
- `zeus_get_latest_report`

If a tool returns `BLOCKED`, stop and ask for user confirmation.
