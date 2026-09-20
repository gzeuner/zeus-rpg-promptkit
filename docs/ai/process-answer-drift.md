---
Title: Process-answer drift report
Description: Bounded, read-only comparison of versioned process-answer regression results.
Last Updated: 2026-09-20
---

# Process-answer drift report

Iteration 21 compares two outputs created by `process regression-check`. This
keeps a catalog or prompt change reviewable without copying source content,
questions, answers, credentials, or absolute paths into a comparison artifact.

## Local workflow

1. Keep a known-good regression result under `.zeus/`, for example
   `.zeus/process-answer-regression-baseline.json`.
2. Run the same versioned corpus against the current catalog and write the new
   result under `.zeus/`.
3. Compare both bounded results:

   ```text
   node cli/zeus.js process drift-check \
     --baseline .zeus/process-answer-regression-baseline.json \
     --current .zeus/process-answer-regression.json \
     --out .zeus/process-answer-drift.json --json
   ```

The command accepts only workspace-relative JSON files inside `.zeus/`. It
checks that both inputs are read-only regression results with automatic
promotion disabled. The output contains short catalog and evaluation
identifiers, sanitized corpus identity, hashed scenario keys, bounded metrics,
and stable blocker codes. It never emits the scenario question, answer text,
matched process IDs, source content, or the absolute input path.

## Drift categories

The report distinguishes:

- `CATALOG_DRIFT`: the catalog fingerprint changed;
- `CORPUS_DRIFT` and `SCENARIO_SET_CHANGED`: the corpus identity or scenario
  set changed;
- `REGRESSION_INTRODUCED` and `REGRESSION_RESOLVED`: a scenario changed from
  pass to fail or from fail to pass;
- `EVIDENCE_LOSS` and `EVIDENCE_GAIN`: the bounded evidence count changed;
- `FRESHNESS_DRIFT`: the returned freshness changed;
- `STATUS_DRIFT`: the returned lifecycle status changed;
- `PROCESS_MATCH_DRIFT`: the number of matched processes changed;
- `ANSWER_CONTRACT_DRIFT`: scenario blockers changed;
- `EVALUATION_REPRODUCIBILITY_DRIFT`: the same catalog and corpus produced a
  different evaluation ID.

`drift` remains a review signal. `automaticPromotion` and
`promotionAllowed` are always false. A stable result means only that the
bounded projection did not change; it is not permission to modify a catalog,
prompt, glossary, or remote system.

## Safe follow-up

When drift is found, inspect the report, review the authoritative catalog and
retrieval contract, then rerun the smallest bounded command:

```text
node cli/zeus.js process regression-check \
  --catalog <relative-path> --corpus <relative-path> \
  --out .zeus/process-answer-regression.json --json
```

Only after explicit domain-owner review should an authoritative change be
made. Record a sanitized experience event when the drift was unexpected,
ambiguous, incomplete, stale, or corrected.

For reviewer-friendly explanations and an optional sanitized approval trail,
run the separate read-only projection after writing the drift artifact:

```text
node cli/zeus.js process drift-review \
  --drift .zeus/process-answer-drift.json \
  --history .zeus/process-answer-review-history.json \
  --out .zeus/process-answer-review.json --json
```

See [`process-answer-review.md`](process-answer-review.md) for the bounded
history contract. An approved review is evidence that a human reviewed the
exact drift identity; it never authorizes automatic promotion or mutation.
