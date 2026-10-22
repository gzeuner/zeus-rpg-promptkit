# Contributing

See the main README for quick start.

## Local quality gates (must pass before PR)

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:full
npm run package:smoke
```

All CI jobs (including the matrix on Linux/Windows + Node 20/LTS) must be green.

A red CI cannot be force-merged (see operating contract).

## Code style

- 2 spaces, single quotes, semicolons.
- Run `npm run format` and `npm run lint` locally.
- Type checking is JSDoc + checkJs (incremental; see jsconfig.json). Fix issues in touched architectural code.

## Tests

- `npm test` runs contract, smoke, corpus, explicit-resource and unit suites.
- `npm run test:full` adds the MCP, SFTP and real-browser GUI E2E lanes.
- CI requires its browser and network-boundary fixtures; locally, optional E2E prerequisites may skip unless `ZEUS_E2E_REQUIRED=1` is set.
- Add deterministic tests for new behavior.
- No live IBM i or secrets in tests.

## CI / Release

The primary workflow is `.github/workflows/ci.yml`.
Boundary guard workflows are intentionally separate for security value.

Do not bypass failing quality gates.
