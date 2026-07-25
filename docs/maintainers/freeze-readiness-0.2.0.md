---
Title: Freeze readiness toward 0.2.0 (Track F)
Description: Owner-facing freeze package after beta.3 and Tracks B–E. Does not tag or publish.
Last Updated: 2026-07-25
---

# Freeze readiness toward Community `0.2.0` (Track F)

**Classification:** maintainer / owner  
**Date assessed:** 2026-07-25  
**Community tip assessed:** `0e3c86b6a9a4124199bff6df5f3ba50ba983da34` (`main`)  
**Last published prerelease:** [`v0.2.0-beta.3`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.3) @ `f1b6f29…`

This document is the Track **F** freeze package. It does **not** create tags, bump the package
version, or dispatch the Release workflow. Those remain **owner gates**.

## Recommendation

| Option                       | When                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Cut `0.2.0`**              | Owner accepts post-beta.3 surface (loader UX, PI export/corpora/embeddings-off, ADR hygiene) as freeze-ready |
| **Cut `0.2.0-beta.4` first** | Owner wants another prerelease soak before non-beta                                                          |
| **Hold**                     | Owner wants more product work before any release                                                             |

**Agent assessment:** technical preflight on `main` is **green**. Product freeze is an **owner**
decision (scope, messaging, support expectations). `0.2.0` is still not “production certification”
unless the owner separately asserts that bar.

## Delta since `v0.2.0-beta.3` (tag target `f1b6f29`)

| Area                      | PRs / commits | Notes                                                     |
| ------------------------- | ------------- | --------------------------------------------------------- |
| Published status docs     | #253          | README / checklist after beta.3                           |
| Commercial host loader UX | #254          | `profile.commercial` (CLI → env → profile)                |
| PI depth (Track C)        | #255          | portable snapshot export, corpora, embeddings default off |
| ADR hygiene (Track E)     | #256          | ADR-009…013 accepted + delivered language                 |

No Package 09 reopen. No paid code in Community. No live IBM i default path.

## Preflight results (2026-07-25, local)

| Gate                                      | Result                      |
| ----------------------------------------- | --------------------------- |
| `npm run format:check`                    | pass                        |
| `npm run lint`                            | pass                        |
| `npm run typecheck`                       | pass                        |
| `npm run test:discovery`                  | pass (145 files classified) |
| `npm test`                                | pass                        |
| `npm run test:benchmark`                  | pass (evidence only)        |
| `npm run check:public-knowledge-claims`   | pass                        |
| `npm run docs:check`                      | pass                        |
| `npm run check:repo-portability`          | pass                        |
| `npm run test:release-integrity`          | pass                        |
| `npm run package:smoke`                   | pass                        |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities           |

## Content checklist for the cut (owner-approved version)

Use after the owner chooses `0.2.0` or `0.2.0-beta.4`:

- [ ] Bump `package.json` / `package-lock.json` to target version
- [ ] Move `[Unreleased]` into `## [<version>] - YYYY-MM-DD` in `CHANGELOG.md`
- [ ] Add `.github/RELEASE_NOTES_v<version>.md`
- [ ] Regenerate tool catalog if needed (`zeus docs:generate-catalog`)
- [ ] `npm run release:preflight -- --version <target-version>`
- [ ] Confirm Release workflow still attests **one** artifact; attestation verify uses **only**
      `--signer-workflow` (not also `--signer-repo`)
- [ ] **Do not** reuse beta.2 historical attestation exception

## Owner gates (required for publish)

- [ ] Version decision: `0.2.0` vs `0.2.0-beta.4` vs hold
- [ ] Explicit authorization to open prep PR + run `workflow_dispatch` Release on `main`
- [ ] After publish: commercial re-pin to the **released** Community SHA in **all** pin locations
- [ ] Confirm messaging: prerelease vs freeze; no accidental “production certified” claim

## Non-claims (must survive freeze messaging)

- Project Knowledge is not source of truth
- Package 09 remains closed; `liveAccessAuthorized` default false
- Benchmarks are evidence, not SLAs
- Community has no paid PI implementation
- Core does not enforce commercial licenses (ADR-006)
- `review-ready` is never compile readiness (ADR-008)

## After owner authorization

1. One Community prep PR (version + CHANGELOG + release notes).
2. Merge to `main` after green CI.
3. Owner/maintainer: `workflow_dispatch` Release.
4. Verify GitHub release assets + attestation.
5. Commercial re-pin PR + commercial gates.
6. Update this file and `next-release-checklist.md` with the closed cut table.

## Commercial pin note

Commercial currently pins Track C tip `4ad0f43…` (not tip of `main` after docs-only #256). That is
intentional until the next **feature** or **release** pin. Docs-only #256 does not require a pin
bump; a `0.2.0` / beta.4 release cut **does**.
