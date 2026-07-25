---
Title: Next Release Checklist
Description: Maintainer checklist for Community releases after the published 0.2.0-beta.3 cut and Track F freeze readiness.
Last Updated: 2026-07-25
---

# Next release checklist (Community)

Current package version on `main` (this prep cut): **0.2.0-beta.4**.

Last closed prerelease before this prep: [`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3)
@ `f1b6f29…`. After beta.4 publishes, update the closed-cut table below.

This checklist prepares Community releases. Tag/publish still require the Release
`workflow_dispatch` after merge to `main`.

**Track F freeze package:** [`freeze-readiness-0.2.0.md`](./freeze-readiness-0.2.0.md)  
(preflight for freeze assessment; next non-beta cut remains owner-gated).

## Recommended next version (after beta.4)

| Candidate | When                                                        |
| --------- | ----------------------------------------------------------- |
| `0.2.0`   | Only after owner decision that beta surface is freeze-ready |

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
npm audit --omit=dev --audit-level=high
```

**Track F preflight (2026-07-25 on `0e3c86b…`):** all of the above **pass** (see freeze-readiness
doc). Re-run after any further commits before a cut.

When the version is bumped and CHANGELOG / release notes exist:

```bash
npm run release:preflight -- --version <target-version>
```

## Content checklist (template for the next cut)

- [ ] `package.json` / `package-lock.json` version match target
- [ ] `CHANGELOG.md` has exactly one `## [<version>] - YYYY-MM-DD` section for the target
- [ ] `.github/RELEASE_NOTES_v<version>.md` exists
- [ ] Tool catalog regenerated if CLI surface or package version changed (`zeus docs:generate-catalog`)
- [ ] Public claims guard still green
- [ ] No accidental commercial/paid code in Community tree
- [ ] Release workflow builds **one** artifact and attests that artifact (no historical exception)
- [ ] `gh attestation verify` uses only one of `--signer-workflow` / `--signer-repo` (mutually exclusive)

## Owner gates (not automated)

- [ ] Version number decision (beta.4 vs 0.2.0)
- [ ] Tag + publish authorization via `workflow_dispatch` Release on `main`
- [ ] Commercial pin bump to the released Community SHA after the release commit is on `main`
- [ ] Confirm beta.2 historical attestation exception is **not** reused

## Closed cut: 0.2.0-beta.3 (2026-07-25)

| Gate                    | Result                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Prep PR                 | [#251](https://github.com/gzeuner/zeus-rpg-promptkit/pull/251)                              |
| Attestation verify fix  | [#252](https://github.com/gzeuner/zeus-rpg-promptkit/pull/252) (`--signer-workflow` only)   |
| Tag / assets            | [`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3) |
| Source SHA              | `f1b6f29b73e59089c2873146f65f277663e38a4b`                                                  |
| Commercial pin          | commercial main pins the same SHA; `overrides.brace-expansion=5.0.8`                        |
| beta.2 exception reused | **no**                                                                                      |

### Notable delivered in 0.2.0-beta.3

- Project Intelligence Community baseline (ZPI-02…08 engines)
- Thin CLI/MCP adapters + capability present/absent behavior (ZPI-11)
- Hardening/benchmarks/closure status (ZPI-12)
- Explicit commercial module host loader (`registerCommercialModules` / `createHostZeus`)
- Docs alignment (DE/EN README, architecture index, ZPI closure status)
- Hardened single-artifact release with checksum, SBOM, and build-provenance attestation

### Closed cut: 0.2.0-beta.4 (2026-07-25) — fill after publish

| Gate                    | Result                      |
| ----------------------- | --------------------------- |
| Prep PR                 | (this release prep PR)      |
| Tag / assets            | pending `workflow_dispatch` |
| Source SHA              | set after tag               |
| Commercial pin          | re-pin after publish        |
| beta.2 exception reused | **no**                      |

Included relative to beta.3: #254 loader UX, #255 PI export/corpora/embeddings-off, #256 ADR hygiene,
#253 status docs, freeze-readiness package.
