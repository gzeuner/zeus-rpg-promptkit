const test = require('node:test');
const assert = require('node:assert/strict');

const { renderPrompt, validatePromptApplicability } = require('../src/prompt/promptBuilder');
const { listPromptContracts, getPromptContract } = require('../src/prompt/promptRegistry');
const { evaluatePromptFixture, loadPromptEvaluationFixture } = require('../src/prompt/promptEvaluationHarness');
const { resolveSanitizedFixturePath } = require('./helpers/fixtureCorpus');

const fixturePath = resolveSanitizedFixturePath('prompt', 'workflow-ai-knowledge.json');

test('prompt registry exposes contract metadata for supported templates', () => {
  const contracts = listPromptContracts();
  assert.ok(contracts.some((entry) => entry.name === 'documentation'));
  assert.ok(contracts.some((entry) => entry.name === 'defect-analysis'));
  assert.ok(contracts.some((entry) => entry.name === 'modernization'));
  assert.equal(getPromptContract('documentation').version, 1);
  assert.equal(getPromptContract('modernization').workflow, 'documentation');
});

test('prompt validation reports missing required inputs clearly', () => {
  const invalidProjection = {
    kind: 'ai-knowledge-projection',
    program: 'BROKENPGM',
    workflows: {
      documentation: {
        summary: '',
        tables: [],
        sqlStatements: null,
      },
    },
  };

  const result = validatePromptApplicability('documentation', invalidProjection);
  assert.equal(result.applicable, false);
  assert.ok(result.failures.some((entry) => /non-empty string/.test(entry)));
  assert.ok(result.failures.some((entry) => /array/.test(entry)));
});

test('prompt validation remains compatible with legacy context inputs', () => {
  const legacyContext = {
    program: 'LEGACYPGM',
    summary: { text: 'Legacy prompt context.' },
  };
  const result = validatePromptApplicability('documentation', legacyContext);
  assert.equal(result.applicable, true);
});

test('renderPrompt enforces contract budget expectations', () => {
  const fixture = loadPromptEvaluationFixture(fixturePath);
  const oversized = JSON.parse(JSON.stringify(fixture.input));
  oversized.workflows.documentation.summary = 'X'.repeat(30000);

  assert.throws(
    () => renderPrompt('documentation', oversized),
    /Prompt contract budget exceeded/,
  );
});

test('renderPrompt honors token budget overrides from profile config', () => {
  const fixture = loadPromptEvaluationFixture(fixturePath);
  const oversized = JSON.parse(JSON.stringify(fixture.input));
  oversized.workflows.documentation.summary = 'X'.repeat(30000);

  assert.doesNotThrow(() => renderPrompt('documentation', oversized, {
    tokenBudgets: {
      documentation: 8000,
    },
  }));
});

test('fixture-driven prompt evaluation preserves completeness, evidence, and size', () => {
  const results = evaluatePromptFixture(fixturePath);
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.ok, true, `${result.template}: ${result.failures.join(' | ')}`);
    assert.ok(result.estimatedTokens > 0);
  }
});
