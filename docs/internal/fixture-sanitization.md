# Fixture Sanitization

The sanitized fixture corpus under `tests/fixtures/sanitized-corpus/` exists to preserve IBM i technical patterns without carrying forward case-specific names, customer identifiers, or copied production-like values.

## Rules

- Use deterministic placeholder identifiers such as `PROGRAM_001`, `TABLE_001`, `FILE_001`, `SCHEMA_001`, and `VALUE_001`.
- Keep paths generic and repository-local, for example `/tmp/zeus_fixture/exported_source`.
- Use synthetic snippets and metadata only. Do not copy real customer names, emails, host names, production libraries, or extracted business rows.
- Preserve technical structure, not narrative specificity. The goal is regression coverage for parser, metadata, workflow, and prompt behavior.
- Prefer one reusable fixture over many inline one-off samples when a test shape is shared.

## Review Expectations

Before merging fixture changes:

1. Confirm every new identifier is placeholder-style or obviously generic.
2. Confirm no fixture text includes copied issue content, customer names, host names, or production library names.
3. Confirm the relevant tests use the shared corpus rather than reintroducing duplicated inline samples.
4. Run `node --test tests/fixture-sanitization.test.js` or `npm test`.

## Validation

`tests/fixture-sanitization.test.js` scans the sanitized corpus and rejects a set of forbidden legacy sample names and common confidential patterns such as email addresses.

`tests/fixtures/sanitized-corpus/review-checklist.json` records the standing checklist that fixture contributors are expected to follow.
