# Contributing

See the main README for quick start.

## Local quality gates (must pass before PR)

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run package:smoke
```

All CI jobs (including the matrix on Linux/Windows + Node 20/LTS) must be green.

A red CI cannot be force-merged (see operating contract).

## Code style

- 2 spaces, single quotes, semicolons.
- Run `npm run format` and `npm run lint` locally.
- Type checking is JSDoc + checkJs (incremental; see jsconfig.json). Fix issues in touched architectural code.

## Tests

- `npm test` runs the full intended suite (contract + smoke + unit + corpus).
- Add deterministic tests for new behavior.
- No live IBM i or secrets in tests.

## CI / Release

The primary workflow is `.github/workflows/ci.yml`.
Boundary guard workflows are intentionally separate for security value.

Do not bypass failing quality gates.
