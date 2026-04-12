# Prompt Contracts

Zeus prompt generation is governed by a registry-backed contract layer.

## Contract Metadata

Each prompt template stores:

- `name`
- `version`
- `templateFile`
- `workflow`
- `outputFileName`
- `requiredInputs`
- `preferredOutputShape`
- `budget`

The registry lives in `src/prompt/promptRegistry.js`.

Guided analyze modes should reuse this registry-backed metadata instead of defining a parallel prompt-selection table. Task-oriented CLI modes may choose a subset of templates, but contract validation and budget enforcement still flow through the same prompt contracts.

## Validation

Before a prompt is rendered, Zeus validates that the selected `ai-knowledge.json` workflow provides the required inputs for the template.

Typical checks include:

- workflow presence
- non-empty summary text
- required evidence arrays
- prompt-ready semantic sections such as tables or SQL statements

If validation fails, prompt rendering throws a contract error instead of silently producing a degraded prompt.

## Budget Enforcement

After rendering, Zeus estimates prompt size and compares it to the contract budget.

- `targetTokens` expresses the preferred size range
- `maxTokens` is enforced

This keeps prompt growth visible as the semantic model becomes richer.

## Fixture Harness

Fixture-driven contract regression tests live under:

- `tests/fixtures/prompt-contracts/`

The evaluation harness in `src/prompt/promptEvaluationHarness.js` renders prompt fixtures and verifies:

- completeness
- evidence preservation
- contract size discipline

Current fixture coverage includes:

- `documentation`
- `defect-analysis`
- `modernization`

Specialized prompt packs now also include:

- `architecture-review`
- `refactoring-plan`
- `test-generation`

These prompt packs still consume the same shared AI knowledge projection and can be selected through guided analyze modes or workflow presets instead of a second prompt-selection system.
