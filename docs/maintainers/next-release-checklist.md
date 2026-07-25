---
Title: Next Release Checklist
Description: Maintainer checklist for Community releases after the published 0.2.0-beta.3 cut.
Last Updated: 2026-07-25
---

# Next release checklist (Community)

Current package version on `main`: **0.2.0-beta.3** (published as GitHub prerelease
[`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3),
source tag target `f1b6f29b73e59089c2873146f65f277663e38a4b`).

This checklist prepares a **future** release. It does **not** create tags, publish npm packages, or
bypass owner approval.

## Recommended next version

| Candidate      | When                                                        |
| -------------- | ----------------------------------------------------------- |
| `0.2.0-beta.4` | Incremental public beta if more surface lands before freeze |
| `0.2.0`        | Only after owner decision that beta surface is freeze-ready |

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
