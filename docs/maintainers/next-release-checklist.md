---
Title: Next Release Checklist
Description: Maintainer checklist for Community releases after 0.2.0-beta.3.
Last Updated: 2026-07-25
---

# Next release checklist (Community)

Current package version on `main` after this cut lands: **0.2.0-beta.3**.

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

## Content checklist (0.2.0-beta.3)

- [x] `package.json` / `package-lock.json` version match target
- [x] `CHANGELOG.md` has exactly one `## [0.2.0-beta.3] - YYYY-MM-DD` section
- [x] `.github/RELEASE_NOTES_v0.2.0-beta.3.md` exists
- [x] Tool catalog regenerated for package version (`zeus docs:generate-catalog`)
- [x] Public claims guard still green (run before merge)
- [x] No accidental commercial/paid code in Community tree
- [x] Release workflow builds **one** artifact and attests that artifact (no historical exception)

## Owner gates (not automated)

- [ ] Tag + publish authorization for `v0.2.0-beta.3` via `workflow_dispatch` on `main`
- [ ] Commercial pin bump to the released Community SHA after the release commit is on `main`
- [ ] Confirm beta.2 historical attestation exception is **not** reused

## Notable delivered in 0.2.0-beta.3

- Project Intelligence Community baseline (ZPI-02…08 engines)
- Thin CLI/MCP adapters + capability present/absent behavior (ZPI-11)
- Hardening/benchmarks/closure status (ZPI-12)
- Explicit commercial module host loader (`registerCommercialModules` / `createHostZeus`)
- Docs alignment (DE/EN README, architecture index, ZPI closure status)
