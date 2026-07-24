---
Title: Next Release Checklist
Description: Maintainer checklist for the next public Community release after 0.2.0-beta.2 and ZPI delivery.
Last Updated: 2026-07-24
---

# Next release checklist (Community)

Current package version on `main`: **0.2.0-beta.2** (historical attestation exception documented in
[`release-integrity.md`](./release-integrity.md)).

This checklist prepares a **future** release. It does **not** create tags, publish npm packages, or
bypass owner approval.

## Recommended next version

| Candidate      | When                                                        |
| -------------- | ----------------------------------------------------------- |
| `0.2.0-beta.3` | Incremental public beta after ZPI + commercial host loader  |
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

## Content checklist

- [ ] `package.json` / `package-lock.json` version match target
- [ ] `CHANGELOG.md` has exactly one `## [<version>] - YYYY-MM-DD` section for the target
- [ ] `.github/RELEASE_NOTES_v<version>.md` exists
- [ ] Tool catalog regenerated if CLI surface changed (`zeus docs:generate-catalog`)
- [ ] Public claims guard still green
- [ ] No accidental commercial/paid code in Community tree
- [ ] Release workflow builds **one** artifact and attests that artifact (no historical exception)

## Notable delivered since beta.2 (document in next CHANGELOG)

- Project Intelligence Community baseline (ZPI-02…08 engines)
- Thin CLI/MCP adapters + capability present/absent behavior (ZPI-11)
- Hardening/benchmarks/closure status (ZPI-12)
- Explicit commercial module host loader (`registerCommercialModules` / `createHostZeus`)
- Docs alignment (DE/EN README, architecture index)

## Owner gates (not automated)

- [ ] Version number decision (beta.3 vs 0.2.0)
- [ ] Tag + publish authorization
- [ ] Commercial pin bump to the released Community SHA after merge
