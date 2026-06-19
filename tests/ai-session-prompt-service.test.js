const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_SESSION_PROMPT_PLACEHOLDER,
  AiSessionPromptError,
  createAiSessionPromptService,
  extractSessionPromptTemplate,
} = require('../src/ui/aiSessionPromptService');

function buildTemplate(body = AI_SESSION_PROMPT_PLACEHOLDER) {
  return [
    '# Title',
    '',
    '## Session Start Prompt (Copy/Paste)',
    '',
    '```text',
    'You are a safe assistant.',
    'Use docs/tool-catalog.md.',
    body,
    '```',
    '',
    '## Notes',
  ].join('\n');
}

test('extractSessionPromptTemplate reads the fenced text block', () => {
  const promptTemplate = extractSessionPromptTemplate(buildTemplate());

  assert.match(promptTemplate, /You are a safe assistant\./);
  assert.match(promptTemplate, /\[INSERT USER GOAL HERE\]/);
});

test('extractSessionPromptTemplate stops at the first closing fence inside the section', () => {
  const promptTemplate = extractSessionPromptTemplate([
    '# Title',
    '',
    '## Session Start Prompt (Copy/Paste)',
    '',
    '````text',
    'Prompt body line 1',
    '```bash',
    'echo nested example',
    '```',
    AI_SESSION_PROMPT_PLACEHOLDER,
    '````',
    '',
    'Additional notes in the same section should not be captured.',
    '',
    '## Notes',
  ].join('\n'));

  assert.match(promptTemplate, /Prompt body line 1/);
  assert.match(promptTemplate, /echo nested example/);
  assert.doesNotMatch(promptTemplate, /Additional notes in the same section/);
});

test('AI session prompt service replaces the goal placeholder and preserves safety guidance', () => {
  const service = createAiSessionPromptService({
    templateLoader: () => buildTemplate(),
  });

  const result = service.generatePrompt({
    profile: 'development',
    environment: 'sandbox',
    goal: 'Analyze program ORDERPGM and summarize dependencies.',
    includeDoctorSummary: true,
    doctorSummary: {
      status: 'warning',
      summary: { pass: 2, warn: 1, fail: 0, info: 0, skip: 0 },
      finishedAt: '2026-06-19T12:00:00.000Z',
    },
  });

  assert.match(result.prompt, /Session context from Local UI Setup/);
  assert.match(result.prompt, /Profile: development/);
  assert.match(result.prompt, /Environment hint: sandbox/);
  assert.match(result.prompt, /Doctor summary: status=warning/);
  assert.match(result.prompt, /Analyze program ORDERPGM and summarize dependencies\./);
  assert.match(result.prompt, /docs\/tool-catalog\.md/);
  assert.doesNotMatch(result.prompt, /\[INSERT USER GOAL HERE\]/);
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.metadata.templateSource, 'docs/ai/session-prompt.md');
});

test('AI session prompt service omits secrets from generated prompt metadata', () => {
  const service = createAiSessionPromptService({
    templateLoader: () => buildTemplate(),
  });

  const result = service.generatePrompt({
    profile: 'development',
    goal: 'Review fetch/analyze flow.',
    includeDoctorSummary: true,
    doctorSummary: {
      status: 'failed',
      summary: { pass: 0, warn: 0, fail: 1, info: 0, skip: 0 },
      finishedAt: '2026-06-19T12:00:00.000Z',
    },
  });

  assert.doesNotMatch(result.prompt, /password=/i);
  assert.doesNotMatch(result.prompt, /jdbc:[^\n]*:\/\/[^:\s/;,@]+:[^@\s/;]+@/i);
});

test('AI session prompt service fails safely when the template block is missing', () => {
  const service = createAiSessionPromptService({
    templateLoader: () => '# Missing prompt block\n',
  });

  assert.throws(
    () => service.generatePrompt({
      profile: 'development',
      goal: 'Review dependencies.',
    }),
    (error) => error instanceof AiSessionPromptError && /Session Start Prompt text block/i.test(error.message),
  );
});

test('AI session prompt service fails safely when the placeholder is missing', () => {
  const service = createAiSessionPromptService({
    templateLoader: () => buildTemplate('No placeholder here.'),
  });

  assert.throws(
    () => service.generatePrompt({
      profile: 'development',
      goal: 'Review dependencies.',
    }),
    (error) => error instanceof AiSessionPromptError && /session goal placeholder/i.test(error.message),
  );
});
