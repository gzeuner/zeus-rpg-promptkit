# Portable End-to-End Tests

The repository contains an optional portable E2E lane for the three most
important external surfaces:

1. a real SFTP connection feeding the fetch, analyze, and bundle flow;
2. a real MCP stdio process using JSON-RPC `Content-Length` framing; and
3. a real Chrome/Chromium browser operating the local GUI over HTTP.

All fixtures are synthetic. Temporary workspaces, containers, browser profiles,
logs, and output bundles are removed after each test. The tests reject known
synthetic secret sentinels in output and do not load the operator's local
credential environment.

## Run the modules

From the repository root:

```powershell
npm run test:e2e:mcp
npm run test:e2e:sftp
npm run test:e2e:gui
```

Or run all three:

```powershell
npm run test:e2e
```

The MCP test needs only Node.js. The SFTP test prefers Docker for its OpenSSH
fixture and automatically falls back to an embedded, ephemeral `ssh2` server
when Docker is unavailable. The GUI test needs Chrome or Chromium and a Node
runtime with native WebSocket support. Missing optional browser infrastructure
is reported as a skipped E2E test; a running service that fails is a test
failure.

CI sets `ZEUS_E2E_REQUIRED=1`. In that mode missing Chrome/Chromium is an
explicit failure instead of a silent skip; Docker is not required because the
SFTP fallback keeps that transport lane fully local.

## What is covered

### SFTP → Analyze → Bundle

`tests/e2e/sftp-fetch-analyze-bundle.e2e.test.js` uses a small OpenSSH/SFTP
fixture container when Docker is available. Without Docker it starts a local,
ephemeral SFTP server with an in-memory host key and a temporary synthetic
source root. Both modes connect with the real `ssh2-sftp-client`
implementation, feed the downloaded synthetic RPG/SQL source through the fetch
orchestration, and invoke the real CLI for analysis and bundle creation.

The embedded fallback is intentionally read-only: mutation requests and paths
outside its virtual `/incoming` root are rejected. It is a test transport, not
a production SFTP service or an operator credential store.

The IBM i member discovery/export step is supplied by a synthetic test backend.
This keeps the test portable while preserving the actual network transport and
downstream artifact path. It is not an IBM i compatibility certification.

### MCP stdio

`tests/e2e/mcp-stdio.e2e.test.js` starts `cli/zeus.js mcp serve` as a child
process, sends `initialize`, `tools/list`, and a safe health call, and verifies
that an unallowlisted write operation is refused deterministically.

### GUI browser flow

`tests/e2e/gui-workbench.e2e.test.js` starts the real local UI server and uses
Chrome DevTools Protocol directly. It verifies Setup/Reports navigation, the
four-step secure setup checklist, the live plugin catalog, profile state, and
secret-safe metadata responses.

## Boundary to real IBM i

Portable E2E tests cannot prove IBM i-specific behavior such as CCSID handling,
JT400 protocol compatibility, `QSYS2` catalog differences, CL command behavior,
or journal semantics. Those belong in a separate private/self-hosted
compatibility lane with an actual read-only IBM i target and externally injected
credentials. No such credentials or production endpoints may enter this
repository or the portable E2E fixtures.
