---
Title: Handover — Next Iteration
Description: State of Community and Commercial after ZPI closure, docs alignment, release prep, and commercial host loader. Starting point for the next agent or maintainer iteration.
Last Updated: 2026-07-24
---

# Handover: Next Iteration

**Date:** 2026-07-24  
**Audience:** next agent / maintainer continuing Zeus RPG PromptKit work  
**Scope:** both repositories (Community + Commercial)

This document is the single entry point after the ZPI program and the follow-on release-prep /
commercial host-loader work. Prefer this over reconstructed chat history.

---

## 1. Current baselines (verified on `main`)

| Repo                           | Path                            | `main` SHA (full)                          | Short                  |
| ------------------------------ | ------------------------------- | ------------------------------------------ | ---------------------- |
| **Community**                  | `zeus-rpg-promptkit`            | `480cc1b134435792c189a052761eedb3355b96e7` | `480cc1b`              |
| **Commercial**                 | `zeus-rpg-promptkit-commercial` | `46d618213831a7b97730fed1aed3ff411a0717fc` | `46d6182`              |
| **Commercial → Community pin** | `package.json` / lock           | `480cc1b134435792c189a052761eedb3355b96e7` | same as Community main |

Package version (Community): **`0.2.0-beta.2`** (not bumped; no new tag/publish in this iteration).

Local workspaces (typical):

- Community: `c:\Java\workspace-java\zeus-rpg-promptkit`
- Commercial: `c:\Java\workspace-java\zeus-rpg-promptkit-commercial`
- Agentic package (local only): `.local/zeus-project-intelligence-agentic-dev-package/`

---

## 2. What was completed in this program of work

### 2.1 Zeus Project Intelligence (ZPI-01 … ZPI-12) — CLOSED

| Package | Repo       | Outcome                                                                                       |
| ------- | ---------- | --------------------------------------------------------------------------------------------- |
| ZPI-01  | Community  | Docs / ADRs 009–013 / threat model / license inventory / test strategy                        |
| ZPI-02  | Community  | Contracts, reason codes, validators, fixtures                                                 |
| ZPI-03  | Community  | SQLite KnowledgeStore + locks + migrations                                                    |
| ZPI-04  | Community  | Content-addressed store + trusted roots                                                       |
| ZPI-05  | Community  | Search SPI + pure-JS lexical provider (`lucene/` layout)                                      |
| ZPI-06  | Community  | Snapshot / incremental engine                                                                 |
| ZPI-07  | Community  | RPG/IBM i analyzer baseline                                                                   |
| ZPI-08  | Community  | Hybrid retrieval + context packages                                                           |
| ZPI-09  | Commercial | Entitled module registration, resource policy, non-claims                                     |
| ZPI-10  | Commercial | Entitled ops: create / full-index / incremental / query / impact / context / inspect / verify |
| ZPI-11  | Both       | Thin Community CLI/MCP adapters; commercial `cli`/`mcp` availability                          |
| ZPI-12  | Both       | Hardening + benchmarks (evidence only) + closure docs                                         |

**Public closure status:** [`../knowledgebase/zpi-closure-status.md`](../knowledgebase/zpi-closure-status.md)

**Architecture baseline:** [`../architecture/index.md`](../architecture/index.md) (ADR-001…013)

### 2.2 Documentation alignment

- Community README: German and English halves, no mixed-language blocks; Project Intelligence documented.
- Commercial README: English + German sections; ZPI commercial module status; pin documented.
- PRs (historical): Community #247, Commercial #18.

### 2.3 Release prep (A) — no tag

- [`next-release-checklist.md`](./next-release-checklist.md) — preflight, content, owner gates.
- `CHANGELOG.md` section **`[Unreleased]`** lists ZPI + loader; version intentionally still beta.2.
- Historical attestation exception for beta.2 remains accepted: [`release-integrity.md`](./release-integrity.md).

### 2.4 Commercial host loader (B)

**Community**

| Surface                  | Location                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Loader implementation    | `src/modules/commercialModuleLoader.js`                                                                        |
| Public API               | `createHostZeus`, `registerCommercialModules` via `zeus-rpg-promptkit/api`                                     |
| CLI                      | `--commercial-module <package-or-path>` or `ZEUS_COMMERCIAL_MODULE`                                            |
| MCP                      | same flag/env; capabilities injected into MCP tool context                                                     |
| Entitlement pass-through | `ZEUS_LICENSE_DOCUMENT_PATH`, `ZEUS_LICENSE_PUBLIC_KEY_PATH`                                                   |
| Authoring guide          | [`../modules/authoring-external-module-registration.md`](../modules/authoring-external-module-registration.md) |
| Tests                    | `tests/commercial-module-loader.test.js`                                                                       |

**Commercial**

| Surface            | Location                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Host entry         | `registerWithZeus(zeus, options)` in `src/registerWithZeus.js`, exported from package root |
| Default module key | `project-intelligence`                                                                     |
| Optional keys      | `reference`, `generation-assurance`, `db2-test-intelligence`, `ibmi-validation`            |
| Ops + registration | `src/projectIntelligence/` (ZPI-09/10)                                                     |

**Rules (must not regress)**

- No marketplace / directory crawl / auto-load by product ID.
- No paid handlers in Community.
- Loader only runs when operator sets flag or env.
- Absolute paths redacted in loader diagnostics.
- Entitlement verification stays inside the commercial package.

---

## 3. How to operate the commercial + PI path

```bash
# From a machine that has both packages resolvable / path-reachable:

# Discover (commercial absent if not configured)
zeus project-knowledge discover --json

# With commercial package + offline license material
set ZEUS_COMMERCIAL_MODULE=c:\path\to\zeus-rpg-promptkit-commercial
set ZEUS_LICENSE_DOCUMENT_PATH=c:\path\to\license.json
set ZEUS_LICENSE_PUBLIC_KEY_PATH=c:\path\to\public.pem
zeus project-knowledge status --json
zeus project-knowledge query --knowledge-root <abs> --project-id demo ^
  --trusted-roots "[{\"rootId\":\"src\",\"path\":\"C:\\\\abs\\\\src\"}]" --query ORDERPGM --json
```

Programmatic:

```js
const { createHostZeus } = require('zeus-rpg-promptkit/api');

const { zeus, commercial } = await createHostZeus({
  modulePath: process.env.ZEUS_COMMERCIAL_MODULE,
  // licenseDocument / publicKeyPem or path envs above
});
// commercial.loaded === true when package registered
// zeus.capabilities.execute('zeus-pro.project-intelligence.status', {}, {})
```

Commercial default registration:

```js
const { registerWithZeus } = require('@zeus-pro/module-sdk-reference'); // or local path
await registerWithZeus(zeus, {
  publicKeyPem,
  licenseDocument,
  modules: ['project-intelligence'], // default if omitted
});
```

---

## 4. Non-claims (do not re-open casually)

- Project Knowledge is **not** source of truth; preserved source evidence remains authoritative.
- **Package 09** (live IBM i S4) remains **CLOSED**; `liveAccessAuthorized` default false.
- Benchmarks are **evidence**, not SLAs.
- Community has **no** paid PI implementation.
- Core does **not** enforce commercial licenses (ADR-006).
- `review-ready` is never compile readiness (ADR-008).

---

## 5. Recommended next iteration options

Pick **one** primary track per iteration; cite ADRs in the PR.

### Option A — Public Community release cut (highest product value)

Owner chooses `0.2.0-beta.3` or `0.2.0`, then:

1. Follow [`next-release-checklist.md`](./next-release-checklist.md).
2. Bump `package.json` / lock, fill CHANGELOG dated section, add `.github/RELEASE_NOTES_v*`.
3. Run `npm run release:preflight -- --version <ver>`.
4. Use the hardened release workflow only (one artifact + attestation; no beta.2 exception).
5. After Community release SHA is known: **Commercial pin bump** + full `npm test`.

### Option B — Operator UX polish on loader

- Profile/config field for commercial module path (still explicit; no discovery).
- Clearer CLI errors when license paths missing.
- Optional smoke script that loads commercial from a known local path in CI only if secrets absent (entitlement mock).

### Option C — PI product depth (optional, ADR-010/013)

- Larger corpora / CI perf dashboards.
- Portable snapshot export packaging.
- Optional embeddings (default **off**).

### Option D — Commercial product packaging

- Clear Professional surface matrix (GA / Db2TI / PI).
- Pin discipline automation check.
- Do **not** reopen Package 09 live paths without separate owner program.

### Option E — Architecture doc hygiene

- Align ADR-009…013 body text from “ZPI-01 baseline” language to “accepted + delivered” (index already updated).
- New ADR only for real decisions (e.g. export format, embeddings policy, profile-based commercial load).

**Suggested default:** **A** (release cut), unless the owner prioritizes operator UX (**B**).

---

## 6. Repo gates (run before every PR)

### Community

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:discovery
npm test
npm run test:benchmark   # includes ZPI benchmark when inventory runs it
npm run check:public-knowledge-claims
npm run docs:check
npm run package:smoke
```

### Commercial

```bash
npm run test:discovery
npm test
npm run audit:prod
npm run package:smoke
```

**Process notes from this codebase:**

- Prefer sequential main delivery; clean feature branches after green CI.
- Self-approve may be blocked → **admin merge** after green checks is normal here.
- Commercial pin string must be updated in **all** places that hardcode the SHA (tests, README, constants, design docs), not only `package.json`.
- Community must never depend on Commercial.
- Do not invent successful checks; only scripts that exist in `package.json`.

---

## 7. Key file map

### Community

| Area                  | Path                                          |
| --------------------- | --------------------------------------------- |
| PI engines + adapters | `src/projectIntelligence/`                    |
| Module registrar      | `src/modules/`                                |
| Commercial loader     | `src/modules/commercialModuleLoader.js`       |
| CLI entry             | `cli/zeus.js`                                 |
| PI CLI                | `src/cli/commands/projectKnowledgeCommand.js` |
| MCP                   | `src/mcp/`                                    |
| Public API            | `src/api/zeusApi.js`                          |
| ZPI closure           | `docs/knowledgebase/zpi-closure-status.md`    |
| ADRs                  | `docs/architecture/adr-00*.md`                |
| This handover         | `docs/maintainers/HANDOVER-NEXT-ITERATION.md` |

### Commercial

| Area                 | Path                               |
| -------------------- | ---------------------------------- |
| Package root exports | `src/index.js`                     |
| Host entry           | `src/registerWithZeus.js`          |
| Project Intelligence | `src/projectIntelligence/`         |
| Entitlement          | `src/entitlement/`                 |
| PI tests             | `test/projectIntelligence.test.js` |
| README (EN + DE)     | `README.md`                        |

---

## 8. Open risks / watch items

1. **GitHub GraphQL `gh pr create`** intermittently failed during this iteration; REST/retry worked later. If create fails, branches are still pushable; open PR from compare URL.
2. **Node `node:sqlite`** is experimental; PI store tests skip when unavailable.
3. **Version still beta.2** — do not claim a new public release until checklist + owner gate complete.
4. **License material** for commercial is operator-local only; never commit real keys or customer licenses.
5. **MCP safe allowlist** only includes project-knowledge `discover` + `status` by default; write/index tools need explicit `--allow-tools`.

---

## 9. First 30 minutes for the next agent

1. `git pull` both repos on `main`; confirm SHAs match section 1 (or update this file if main moved).
2. Read: this handover → `zpi-closure-status.md` → `next-release-checklist.md` → ADR index.
3. Ask owner for primary track: **release cut (A)** vs **loader UX (B)** vs other.
4. Create a single feature branch; keep PRs bounded; run gates; admin-merge after green CI; delete branch; pin Commercial if Community SHA changed.

---

## 10. Explicitly out of scope unless re-authorized

- Live IBM i compile/execute/differential as a default product path (Package 09 reopen).
- Paid code in the Apache-2.0 Community tree.
- Silent workspace harvest without trusted roots.
- Force-push / rewriting published release history.
- Using the beta.2 attestation exception for any future release.

---

## 11. Related local evidence (not always in git)

If present under the agentic package:

- `.local/zeus-project-intelligence-agentic-dev-package/evidence/ZPI-FINAL-CLOSURE.md`
- `.local/zeus-project-intelligence-agentic-dev-package/evidence/ZPI-12-COMPLETION-REPORT.md`
- `.local/zeus-project-intelligence-agentic-dev-package/evidence/BASELINES.md`

These may be gitignored; regenerate or refresh from this handover if missing.

---

**Handover status:** Ready for next iteration. No open feature branches required from this workstream after pin PR #20.
