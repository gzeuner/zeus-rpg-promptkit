---
Title: Process-answer review projection
Description: Reviewer-friendly, bounded explanations, approval-history linkage, and consistency diagnostics for process-answer drift.
Last Updated: 2026-09-20
---

# Process-answer review projection

Iterations 22 and 23 add a human-facing projection on top of the existing
`process-answer-drift-result`. It explains stable blocker codes, their impact,
and the smallest safe follow-up without copying scenario questions, answer
content, matched process IDs, source content, or absolute paths.

## Local workflow

First create a bounded drift artifact:

```text
node cli/zeus.js process drift-check \
  --baseline .zeus/process-answer-regression-baseline.json \
  --current .zeus/process-answer-regression.json \
  --out .zeus/process-answer-drift.json --json
```

Then create the reviewer projection. The history file is optional; without it
the result is explicitly `pending`:

```text
node cli/zeus.js process drift-review \
  --drift .zeus/process-answer-drift.json \
  --history .zeus/process-answer-review-history.json \
  --out .zeus/process-answer-review.json --json
```

The command accepts only workspace-relative JSON files inside `.zeus/`. It
validates that the drift artifact is read-only and promotion-disabled. The
projection keeps only bounded identities, metrics, stable blocker codes,
static explanations, and a hashed `driftId`.

To scan a complete sanitized review history across multiple drift identities,
use the read-only summary command:

```text
node cli/zeus.js process drift-review-summary \
  --history .zeus/process-answer-review-history.json \
  --out .zeus/process-answer-review-summary.json --json
```

The summary groups only by hashed `driftId`, reports bounded decision and
finding counts, and lists unresolved identities with their latest bounded
decision. It never copies questions, answers, source content, process IDs,
reviewer identities, or free-text notes. A summary with `needs-review` must be
resolved with the exact `drift-review` projection before an agent relies on a
decision.

## Approval-history contract

If a team wants a durable local review trail, create a sanitized history file
with this shape:

```json
{
  "schemaVersion": 1,
  "kind": "process-answer-review-history",
  "sanitized": true,
  "containsCredentials": false,
  "containsPrivateProjectIdentifiers": false,
  "entries": [
    {
      "decisionId": "decision:0123456789abcdef",
      "driftId": "drift:fedcba9876543210",
      "decision": "approve",
      "reviewerId": "local-domain-reviewer",
      "reviewedAt": "2026-09-20T12:30:00.000Z",
      "rationaleCode": "EVIDENCE_REVIEW_REQUIRED"
    }
  ]
}
```

Only `approve`, `reject`, and `defer` are accepted. `rationaleCode` is a
bounded vocabulary; free-text notes are intentionally not part of the shared
projection. The output exposes only a short hash of `reviewerId` and the last
matching decision for the exact `driftId`.

The `approval.consistency` projection makes repeated reviews explainable:

- `not-provided` means no history file was supplied.
- `no-matching-decision` means the supplied history contains no entry for this
  exact drift identity.
- `consistent` means all matching decisions have the same decision kind.
- `contradictory` means matching decisions disagree. The latest entry is still
  exposed as `lastDecision`, but the result remains `needs-review` until the
  conflict is resolved.

An older matching decision with a different decision kind is counted as
`staleDecisionCount` and emits `REVIEW_DECISION_STALE`. A disagreement also
emits `REVIEW_HISTORY_CONFLICT`. The latest entry remains explainable through
its bounded decision, timestamp, and rationale code; neither the history nor
the projection changes catalog or review state automatically.

An `approved` review means that a human reviewed this exact comparison. It is
not permission to modify a catalog, prompt, glossary, or remote system:
`automaticPromotion` and `promotionAllowed` remain false in every result.

## AI handling rule

Treat the explanation as a review aid, not as new process knowledge. A high
severity explanation requires checking the authoritative catalog, evidence,
freshness, or retrieval contract and rerunning the regression gate after an
explicit change. Record a sanitized experience event when a drift explanation
was unexpected, ambiguous, incomplete, stale, or corrected.

## Freshness and retention preview

Use the retention preview when an agent must decide whether a review record is
current evidence or only historical context:

```powershell
node cli/zeus.js process drift-review-retention `
  --history .zeus/process-answer-review-history.json `
  --as-of 2026-09-20T00:00:00.000Z `
  --fresh-days 30 `
  --retention-days 90 `
  --json
```

The result classifies each bounded decision as `fresh`, `aging`, `historical`,
or `future`. Only historical decisions that are superseded by a newer decision
for the same hashed `driftId` are listed as retention candidates. A historical
latest decision remains `review-required`; it is never suggested for automatic
deletion. The result exposes hashed decision and drift IDs only and keeps
`automaticDeletion`, `deletionAllowed`, `automaticPromotion`, and
`promotionAllowed` false. Pass `--as-of` for reproducible reports; omitted
timestamps use the local current time.

When the retention result must be preserved as a reproducible review record,
create a receipt from the same sanitized history and explicit policy:

```powershell
node cli/zeus.js process drift-review-receipt `
  --history .zeus/process-answer-review-history.json `
  --as-of 2026-09-20T00:00:00.000Z `
  --fresh-days 30 `
  --retention-days 90 `
  --out .zeus/process-answer-review-receipt.json `
  --json
```

The receipt contains a stable `receiptId`, a bounded `historyFingerprint`,
the applied policy, freshness metrics, hashed retention candidates, and
review-required reason codes. Its inspection timestamp is the explicit
`--as-of` value, so the record can be compared or attached to a later review.
The receipt is evidence of inspection only: `decision.recorded` is false and
automatic deletion and promotion remain disabled.
