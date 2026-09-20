---
Title: Process-answer regression gate
Description: Versioned, read-only regression checks for evidence-backed business-process answers.
Last Updated: 2026-09-20
---

# Process-answer regression gate

The process catalog is useful to a Product Owner, architect, developer, or
tester only when a known question continues to return the expected evidence,
status, and freshness. Iteration 20 adds a deterministic, read-only gate for
that contract.

## Local workflow

1. Copy [`process-answer-regression-corpus.template.json`](process-answer-regression-corpus.template.json)
   into a local workspace-owned JSON file and replace the placeholders with
   exact process IDs and sanitized questions from that environment.
2. Run the check without a decision first. This produces a stable
   `catalogFingerprint` and `evaluationId` without printing the question text:

   ```text
   node cli/zeus.js process regression-check \
     --catalog ./output/process-candidates.json \
     --corpus ./.local/process-answer-regression-corpus.json \
     --out .zeus/process-answer-regression.json --json
   ```

3. A domain owner reviews the scenario result and writes a local decision from
   [`process-answer-review-decision.template.json`](process-answer-review-decision.template.json)
   to `.zeus/process-answer-review.json`. Copy the exact `corpusId`,
   `corpusVersion`, `catalogFingerprint`, and `evaluationId` from the first
   result. The decision is an input to the gate, not an automatic publication.
4. Run the same check again with `--decision .zeus/process-answer-review.json`.
   Only a passing evaluation and a matching explicit approval result in
   `review.status: approved`. The CLI still never edits the catalog, prompt,
   glossary, or remote system.

## Scenario contract

Each scenario has a stable `id` and a bounded question. `expectedProcessIds`
assert exact retrieval, `expectedStatus` asserts the process lifecycle,
`requiredAnswerTerms` checks the answer wording without committing private
answers, and `requiredEvidenceKinds` prevents an answer from passing on a
summary without the expected provenance. `maxFreshness` makes stale evidence
visible instead of silently accepting it.

The corpus must declare `sanitized: true`, `containsCredentials: false`, and
`containsPrivateProjectIdentifiers: false`. Keep environment-specific corpora
and decisions in ignored local paths. Do not commit host names, system
aliases, library names, credentials, raw source, or private business values.

## Review and change policy

The result exposes stable blocker codes such as
`EXPECTED_PROCESS_MISSING`, `EVIDENCE_MISSING`,
`CATALOG_FINGERPRINT_MISMATCH`, and `REVIEW_DECISION_MISSING`. The reviewer
decision is bound to one corpus version, one catalog fingerprint, and one
evaluation ID, so a changed catalog cannot reuse an old approval silently.

`automaticPromotion` and `promotionAllowed` remain false in every result. An
approved result means only that the explicit human review gate passed; an
operator must still make the smallest authoritative catalog or prompt change
outside this read-only command and rerun the corpus afterward.
