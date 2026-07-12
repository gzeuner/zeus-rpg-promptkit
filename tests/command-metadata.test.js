const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_CATEGORIES,
  COMMAND_UI_METADATA,
  COMMAND_UI_METADATA_ERRORS,
  getCommandUiMetadata,
  listCommandUiMetadata,
  validateCommandUiMetadata,
} = require('../src/cli/commandMetadata');

test('command UI metadata validates and includes workflow-card categories', () => {
  assert.deepEqual(COMMAND_UI_METADATA_ERRORS, []);
  assert.deepEqual(validateCommandUiMetadata(), []);

  const categories = COMMAND_CATEGORIES.map(entry => entry.id).sort();
  assert.deepEqual(categories, [
    'analyze',
    'configure',
    'context',
    'fetch',
    'investigation',
    'query',
    'review',
  ]);

  const commandNames = COMMAND_UI_METADATA.map(entry => entry.name);
  for (const required of [
    'profiles',
    'doctor',
    'fetch',
    'fetch-member',
    'copy-to-workspace',
    'analyze',
    'impact',
    'workflow run',
    'resolve-object',
    'query-table',
    'query-sql',
    'serve',
    'bundle',
  ]) {
    assert.ok(commandNames.includes(required), `missing metadata for ${required}`);
  }
});

test('recommended next commands point to known command metadata entries', () => {
  const knownCommands = new Set(COMMAND_UI_METADATA.map(entry => entry.name));

  for (const entry of COMMAND_UI_METADATA) {
    for (const next of entry.recommendedNextCommands) {
      assert.ok(
        knownCommands.has(next),
        `unknown next command "${next}" referenced by "${entry.name}"`
      );
    }
  }
});

test('command metadata supports category filtering and lookup', () => {
  const configureEntries = listCommandUiMetadata({ category: 'configure' });
  assert.ok(configureEntries.length >= 2);
  assert.ok(configureEntries.every(entry => entry.category === 'configure'));

  const fetchEntry = getCommandUiMetadata('fetch');
  assert.ok(fetchEntry);
  assert.equal(fetchEntry.category, 'fetch');
  assert.ok(fetchEntry.commonOptions.includes('--profile'));
});
