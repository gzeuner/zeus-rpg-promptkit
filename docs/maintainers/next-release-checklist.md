---
Title: Next Release Checklist
Description: Maintainer checklist for releases after the unified Apache-2.0 consolidation. Historical beta cut records remain below for provenance.
Last Updated: 2026-08-17
---

# Next release checklist (unified public package)

Current package version on main: **0.2.0** (published baseline; consolidation changes are unreleased).

Last published prerelease: [`v0.2.0-beta.4`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.4)
@ `6a4789a…`. **Do not re-tag** beta.4.

This checklist prepares public releases. Tag/publish still require the Release
`workflow_dispatch` after merge to `main`.

**Track F freeze package:** [`freeze-readiness-0.2.0.md`](./freeze-readiness-0.2.0.md)  
(beta.5 contains the agent-surface tracks; next non-beta cut remains owner-gated).

## Recommended next version (after beta.5)

| Candidate | When                                                        |
| --------- | ----------------------------------------------------------- |
| `0.2.0`   | Only after owner decision that beta surface is freeze-ready |
| Hold      | Owner wants more soak or product work before non-beta       |

## Preflight (local)

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:discovery
npm test
npm run test:benchmark
npm run check:public-knowledge-claims
npm run docs:check
npm run check:repo-portability
npm run test:release-integrity
npm run package:smoke
npm run check:consolidated-hygiene
npm run demo:run
npm audit --omit=dev --audit-level=high
```

**Track F preflight (2026-07-25 on `0e3c86b…`):** all of the above **pass** (see freeze-readiness
doc). Re-run after any further commits before a cut.

When the version is bumped and CHANGELOG / release notes exist:

```bash
npm run release:preflight -- --version <target-version>
```

## Beta.5 cut (2026-08-03)

This cut contains Tracks G0-G5 and H0, plus dependency/security maintenance. The source SHA,
tag, assets, attestation, and Commercial pin are recorded here after the Release workflow and
Commercial re-pin complete.

## Closed cut: 0.2.0-beta.5 (2026-08-03)

| Gate                  | Result                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Tag / assets          | [`v0.2.0-beta.5`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.5) |
| Source SHA            | `487cca7b06d287b7d5cb53024ca54747500dd584`                                                  |
| Assets                | tarball + SBOM + SHA256SUMS + attestation; fresh-download verification green                |
| Commercial pin        | Commercial PR #33; `487cca7…`; `overrides.brace-expansion=5.0.9`; gates green               |
| Full non-beta `0.2.0` | owner-gated                                                                                 |

## Content checklist (template for the next cut)

- [ ] `package.json` / `package-lock.json` version match target
- [ ] `CHANGELOG.md` has exactly one `## [<version>] - YYYY-MM-DD` section for the target
- [ ] `.github/RELEASE_NOTES_v<version>.md` exists
- [ ] Tool catalog regenerated if CLI surface or package version changed (`zeus docs:generate-catalog`)
- [ ] Public claims guard still green
- [ ] No private paths, secrets, customer data, or unapproved external-only code in the public tree
- [ ] Release workflow builds **one** artifact and attests that artifact (no historical exception)
- [ ] `gh attestation verify` uses only one of `--signer-workflow` / `--signer-repo` (mutually exclusive)

## Owner gates (not automated)

- [ ] Version number decision (`0.2.0` vs hold)
- [x] Tag + publish authorization via `workflow_dispatch` Release on `main` (Beta.5)
- [x] Commercial pin bump to the released Community SHA after the release commit is on `main` (Commercial PR #33)
- [x] Confirm beta.2 historical attestation exception is **not** reused
- [x] Confirm existing published tags (including beta.4) are **not** re-tagged

## Closed cut: 0.2.0-beta.4 (2026-07-25)

| Gate                    | Result                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Prep PR                 | [#258](https://github.com/gzeuner/zeus-rpg-promptkit/pull/258)                              |
| Tool-catalog fix        | [#259](https://github.com/gzeuner/zeus-rpg-promptkit/pull/259)                              |
| Tag / assets            | [`v0.2.0-beta.4`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.4) |
| Source SHA              | `6a4789a41e827bd82d97b54bb3346e3b4228b152`                                                  |
| Assets                  | tarball + SBOM + SHA256SUMS + attestation                                                   |
| Commercial pin          | commercial PR pins `6a4789a…`; `overrides.brace-expansion=5.0.8`                            |
| beta.2 exception reused | **no**                                                                                      |

### Notable delivered in 0.2.0-beta.4 (relative to beta.3)

- Commercial host loader UX: `profile.commercial` (#254)
- PI depth: portable snapshot export, corpora fixtures, embeddings default off (#255)
- ADR-009…013 body hygiene (#256)
- Freeze-readiness package + published status docs
- Tool catalog regenerated for beta.4; version-agnostic catalog tests (#259)

## Closed cut: 0.2.0-beta.3 (2026-07-25)

| Gate                    | Result                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Prep PR                 | [#251](https://github.com/gzeuner/zeus-rpg-promptkit/pull/251)                              |
| Attestation verify fix  | [#252](https://github.com/gzeuner/zeus-rpg-promptkit/pull/252) (`--signer-workflow` only)   |
| Tag / assets            | [`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3) |
| Source SHA              | `f1b6f29b73e59089c2873146f65f277663e38a4b`                                                  |
| Commercial pin          | commercial main pinned that SHA; `overrides.brace-expansion=5.0.8`                          |
| beta.2 exception reused | **no**                                                                                      |

### Notable delivered in 0.2.0-beta.3

- Project Intelligence Community baseline (ZPI-02…08 engines)
- Thin CLI/MCP adapters + capability present/absent behavior (ZPI-11)
- Hardening/benchmarks/closure status (ZPI-12)
- Explicit commercial module host loader (`registerCommercialModules` / `createHostZeus`)
- Docs alignment (DE/EN README, architecture index, ZPI closure status)
- Hardened single-artifact release with checksum, SBOM, and build-provenance attestation
