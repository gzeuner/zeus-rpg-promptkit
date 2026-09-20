---
Title: Process-answer review projection
Description: Reviewer-friendly, bounded explanations and approval-history linkage for process-answer drift.
Last Updated: 2026-09-20
---

# Process-answer review projection

Iteration 22 adds a human-facing projection on top of the existing
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

An `approved` review means that a human reviewed this exact comparison. It is
not permission to modify a catalog, prompt, glossary, or remote system:
`automaticPromotion` and `promotionAllowed` remain false in every result.

## AI handling rule

Treat the explanation as a review aid, not as new process knowledge. A high
severity explanation requires checking the authoritative catalog, evidence,
freshness, or retrieval contract and rerunning the regression gate after an
explicit change. Record a sanitized experience event when a drift explanation
was unexpected, ambiguous, incomplete, stale, or corrected.
