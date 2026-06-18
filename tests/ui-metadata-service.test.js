const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UI_METADATA_SCHEMA_VERSION,
  buildUiMetadataPayload,
  deriveWorkflowCards,
} = require('../src/ui/uiMetadataService');

test('ui metadata payload exposes config, command, and workflow card contracts', () => {
  const payload = buildUiMetadataPayload();

  assert.equal(payload.schemaVersion, UI_METADATA_SCHEMA_VERSION);
  assert.equal(payload.uiMode, 'metadata-workflow-shell');
  assert.ok(payload.config);
  assert.ok(Array.isArray(payload.config.sections));
  assert.ok(Array.isArray(payload.config.fields));
  assert.ok(payload.commands);
  assert.ok(Array.isArray(payload.commands.categories));
  assert.ok(Array.isArray(payload.commands.entries));
  assert.ok(payload.guidedConfiguration);
  assert.ok(Array.isArray(payload.guidedConfiguration.steps));
  assert.ok(Array.isArray(payload.guidedConfiguration.intents));
  assert.ok(Array.isArray(payload.guidedConfiguration.discoveryActions));
  assert.ok(payload.profileWizard);
  assert.equal(payload.profileWizard.mode, 'local-only-profile-wizard');
  assert.ok(Array.isArray(payload.profileWizard.steps));
  assert.ok(payload.profileWizard.steps.length >= 6);
  assert.ok(Array.isArray(payload.workflowCards));
  assert.equal(payload.workflowCards.length, 6);
});

test('workflow cards are derived from command metadata categories', () => {
  const cards = deriveWorkflowCards();
  const cardIds = cards.map((card) => card.id).sort();

  assert.deepEqual(cardIds, [
    'analyze-workspace',
    'configure',
    'fetch-sources',
    'generate-ai-context',
    'query-db2',
    'review-reports',
  ]);

  for (const card of cards) {
    assert.equal(typeof card.title, 'string');
    assert.equal(typeof card.description, 'string');
    assert.equal(typeof card.badge, 'string');
    assert.equal(typeof card.primaryActionLabel, 'string');
    assert.equal(typeof card.availability, 'string');
    assert.equal(typeof card.enabledInShell, 'boolean');
    assert.ok(Array.isArray(card.commands));
    assert.ok(card.commands.length >= 1);
  }

  const setupCard = cards.find((card) => card.id === 'configure');
  assert.equal(setupCard.title, 'Setup');
  assert.equal(setupCard.availability, 'production-ready');
  assert.equal(setupCard.enabledInShell, true);
  assert.equal(setupCard.status, 'Available now');
  assert.equal(setupCard.area, 'primary');

  const reportsCard = cards.find((card) => card.id === 'review-reports');
  assert.equal(reportsCard.title, 'Reports');
  assert.equal(reportsCard.availability, 'production-ready');
  assert.equal(reportsCard.enabledInShell, true);
  assert.equal(reportsCard.status, 'Available now');
  assert.equal(reportsCard.area, 'secondary');
  assert.equal(reportsCard.uiTarget, 'reports');
  assert.match(reportsCard.explanation, /Graph/);

  const deferredCard = cards.find((card) => card.id === 'fetch-sources');
  assert.equal(deferredCard.availability, 'coming-later');
  assert.equal(deferredCard.enabledInShell, false);
  assert.equal(deferredCard.status, 'Coming later');

  const advancedCard = cards.find((card) => card.id === 'analyze-workspace');
  assert.equal(advancedCard.availability, 'advanced');
  assert.equal(advancedCard.status, 'Advanced tool');
  assert.equal(advancedCard.area, 'advanced');
  assert.match(advancedCard.explanation, /local-only/i);
});

test('ui metadata includes sensitive field markers but no resolved values', () => {
  const payload = buildUiMetadataPayload();
  const passwordFields = payload.config.fields
    .filter((field) => field.type === 'password')
    .map((field) => field.key)
    .sort();

  assert.deepEqual(passwordFields, ['profile.db.password', 'profile.fetch.password']);
  for (const field of payload.config.fields) {
    assert.equal(Object.prototype.hasOwnProperty.call(field, 'value'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(field, 'resolvedValue'), false);
  }
});
