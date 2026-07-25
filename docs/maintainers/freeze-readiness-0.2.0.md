---
Title: Freeze readiness toward 0.2.0 (Track F)
Description: Owner-facing freeze package after beta.4. Full 0.2.0 remains owner-gated. Does not tag or publish.
Last Updated: 2026-07-25
---

# Freeze readiness toward Community `0.2.0` (Track F)

**Classification:** maintainer / owner  
**Date assessed:** 2026-07-25  
**Community tip assessed:** `6a4789a41e827bd82d97b54bb3346e3b4228b152` (`main`)  
**Last published prerelease:** [`v0.2.0-beta.4`](https://github.com/gzeuner/zeus-rpg-promptkit/releases/tag/v0.2.0-beta.4) @ `6a4789a…`

This document is the Track **F** freeze package. It does **not** create tags, bump the package
version, or dispatch the Release workflow. Those remain **owner gates**.

## Status after beta.4

| Item | State |
| ---- | ----- |
| `v0.2.0-beta.4` | **Published** (prerelease; tarball + SBOM + SHA256SUMS + attestation) |
| Tag / tip SHA | `6a4789a41e827bd82d97b54bb3346e3b4228b152` — **do not re-tag** |
| Commercial pin | re-pin PR targets this SHA (commercial repo) |
| Full non-beta `0.2.0` | **still owner-gated** |

## Recommendation (next cut)

| Option | When |
| ------ | ---- |
| **Cut `0.2.0`** | Owner accepts post-beta.4 surface as freeze-ready |
| **Hold** | Owner wants more product work or soak before non-beta |

**Agent assessment:** beta.4 is shipped. Product freeze for non-beta `0.2.0` remains an **owner**
decision (scope, messaging, support expectations). `0.2.0` is still not “production certification”
unless the owner separately asserts that bar.

## Delta since `v0.2.0-beta.3` (included in beta.4)

| Area | PRs / commits | Notes |
| ---- | ------------- | ----- |
| Published status docs | #253 | README / checklist after beta.3 |
| Commercial host loader UX | #254 | `profile.commercial` (CLI → env → profile) |
| PI depth (Track C) | #255 | portable snapshot export, corpora, embeddings default off |
| ADR hygiene (Track E) | #256 | ADR-009…013 accepted + delivered language |
| Release prep beta.4 | #258 | version / CHANGELOG / release notes |
| Tool catalog fix | #259 | catalog regenerated; version-agnostic tests |

No Package 09 reopen. No paid code in Community. No live IBM i default path.

## Preflight results (2026-07-25, local — pre beta.4 cut)

| Gate | Result |
| ---- | ------ |
| `npm run format:check` | pass |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run test:discovery` | pass (145 files classified) |
| `npm test` | pass |
| `npm run test:benchmark` | pass (evidence only) |
| `npm run check:public-knowledge-claims` | pass |
| `npm run docs:check` | pass |
| `npm run check:repo-portability` | pass |
| `npm run test:release-integrity` | pass |
| `npm run package:smoke` | pass |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

Re-run the full gate set on `main` before any future cut.

## Content checklist for the next cut (owner-approved version)

Use after the owner chooses non-beta `0.2.0` (or a later beta):

- [ ] Bump `package.json` / `package-lock.json` to target version
- [ ] Move `[Unreleased]` into `## [<version>] - YYYY-MM-DD` in `CHANGELOG.md`
- [ ] Add `.github/RELEASE_NOTES_v<version>.md`
- [ ] Regenerate tool catalog if needed (`zeus docs:generate-catalog`)
- [ ] `npm run release:preflight -- --version <target-version>`
- [ ] Confirm Release workflow still attests **one** artifact; attestation verify uses **only**
      `--signer-workflow` (not also `--signer-repo`)
- [ ] **Do not** reuse beta.2 historical attestation exception
- [ ] **Do not** re-tag an existing published version

## Owner gates (required for next publish)

- [ ] Version decision: `0.2.0` vs hold (or a later beta if re-opened)
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
- Published betas are prereleases — not production certification

## After owner authorization (next cut)

1. One Community prep PR (version + CHANGELOG + release notes).
2. Merge to `main` after green CI.
3. Owner/maintainer: `workflow_dispatch` Release.
4. Verify GitHub release assets + attestation.
5. Commercial re-pin PR + commercial gates.
6. Update this file and `next-release-checklist.md` with the closed cut table.

## Commercial pin note

Commercial should pin **`6a4789a…`** (= `v0.2.0-beta.4` tag). A future release cut requires a new
pin to that release’s tag SHA.
