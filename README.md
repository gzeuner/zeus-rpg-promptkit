# Zeus RPG PromptKit

Evidence-first context builder for IBM i RPG, CL, and DDS.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java-11+-blue?logo=openjdk)
![IBM i](https://img.shields.io/badge/Platform-IBM%20i%20%2F%20AS%2F400-1F70C1)
![DB2](https://img.shields.io/badge/DB-DB2-0F62FE)
![License](https://img.shields.io/badge/License-Apache%202.0-green)

![Zeus RPG PromptKit](./images/zeus-rpg-promptkit.png)

Zeus RPG PromptKit helps teams collect source evidence, analyze dependencies, and produce reviewable artifacts for modernization, impact analysis, onboarding, and AI-assisted engineering.

This is not a code generator. It is an evidence preparation layer that is read-oriented, transparent, and review-friendly.

> Project status: active development. Features, workflows, and interfaces can change between releases.

## Why use it

- Understand legacy RPG/CL/DDS systems faster
- Build safer impact analysis before code changes
- Prepare structured context for AI tools and human reviewers
- Generate consistent documentation and architecture artifacts

## Core capabilities

- Source fetching from IBM i through SFTP, JT400, or FTP
- Static analysis for RPG III/IV, CL, and DDS
- Dependency mapping and call-graph generation
- Optional DB2 metadata enrichment
- AI-ready artifacts (Markdown + JSON)
- Local viewer UI for inspection and review
- Workflow presets for onboarding, modernization, and risk-focused analysis
- Local-first MCP support (experimental MVP)

## Quickstart (5 minutes)

### 1. Requirements

- Node.js 20+
- Java 11+ (required for JT400/DB2 integrations)

### 2. Install

```bash
git clone https://github.com/gzeuner/zeus-rpg-promptkit.git
cd zeus-rpg-promptkit
npm install
```

### 3. Run the demo project

```bash
npm run demo:run
```

### 4. Start local viewer

```bash
node cli/zeus.js serve --source-output-root ./examples/demo-rpg-mini-system/output-baseline
```

Open `http://localhost:4782`.

### 5. Build an AI session prompt from demo output

```bash
npm run demo:prompt
```

You will get artifacts in `examples/demo-rpg-mini-system/output-baseline/`, including:

- `report.md`
- `architecture-report.md`
- `ai-knowledge.json`
- `dependency-graph.mmd`

## Common commands

- `node cli/zeus.js doctor` - environment checks
- `node cli/zeus.js fetch` - import source from configured systems
- `node cli/zeus.js analyze` - run static analysis pipeline
- `node cli/zeus.js impact` - run change impact analysis
- `node cli/zeus.js bundle` - build shareable output bundle
- `node cli/zeus.js serve` - open local viewer
- `node cli/zeus.js docs generate-catalog` - regenerate docs tool catalog

Authoritative command reference:

- [docs/tool-catalog.md](docs/tool-catalog.md)

## MCP support (experimental MVP)

The branch includes a local MCP server integration for read-oriented tool access over stdio.

Current scope:

- Transport: local `stdio` only
- Policy: default-deny for non-allowlisted tools
- Tool allowlist flag: `--allow-tools`
- Redaction: response/error payload masking before emission
- Audit: append-only JSONL in `.local/mcp/audit/mcp-audit.jsonl`

Current MVP tools:

- `zeus.health`
- `zeus.version`
- `zeus.doctor`
- `zeus.query-sql` (strict read-only: `SELECT`/`WITH` only)

Start examples:

```bash
# Start with all currently registered MVP tools
node cli/zeus.js mcp serve --verbose

# Restrict to explicit allowlist
node cli/zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.query-sql
```

Notes:

- Write operations are not enabled in MVP.
- Do not store credentials in tracked files.
- Use role/profile controls for production data access.

## Safety model

Principle: evidence first, AI second.

Safety levels:

- `S0`: local read-only
- `S1`: local write (artifacts)
- `S2`: remote read-only
- `S3`: controlled write with approvals
- `S4`: operator-gated high-risk actions

Guidelines:

- Prefer read-oriented IBM i access by default.
- Keep local configuration local.
- Treat generated artifacts as review inputs, not final truth.
- Keep humans accountable for production decisions.

See [docs/safety/](docs/safety/) for detailed guidance.

## Documentation

- Hub: [docs/index.md](docs/index.md)
- Tool catalog: [docs/tool-catalog.md](docs/tool-catalog.md)
- AI session bootstrap: [docs/ai/session-prompt.md](docs/ai/session-prompt.md)
- Quickstart: [docs/quickstart/5-minutes.md](docs/quickstart/5-minutes.md)
- MCP operator guide: [docs/mcp/operator-guide.md](docs/mcp/operator-guide.md)

## Legal and non-affiliation

Zeus RPG PromptKit is an independent open-source project and is not affiliated with, endorsed by, certified by, or supported by IBM.

IBM, IBM i, AS/400, DB2, RPG, CL, DDS, JT400, JTOpen, and related names are trademarks of their respective owners and are referenced only to describe technical compatibility.

Software is provided under Apache License 2.0 on an "as is" basis, without warranty of any kind. Users are responsible for setup, operation, and review of generated artifacts before production use.

## License

Apache License 2.0. See [LICENSE](LICENSE).
