const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONFIG_UI_FIELDS,
  CONFIG_UI_METADATA_ERRORS,
  CONFIG_UI_SECTIONS,
  getConfigUiField,
  listConfigUiFields,
  validateConfigUiMetadata,
} = require('../src/config/configUiMetadata');

test('config UI metadata validates and is ready for GUI rendering', () => {
  assert.deepEqual(CONFIG_UI_METADATA_ERRORS, []);
  assert.deepEqual(validateConfigUiMetadata(), []);
  assert.ok(Array.isArray(CONFIG_UI_SECTIONS));
  assert.ok(CONFIG_UI_SECTIONS.length > 0);
  assert.ok(Array.isArray(CONFIG_UI_FIELDS));
  assert.ok(CONFIG_UI_FIELDS.length >= 25);

  for (const field of CONFIG_UI_FIELDS) {
    assert.equal(typeof field.key, 'string');
    assert.equal(typeof field.label, 'string');
    assert.equal(typeof field.description, 'string');
    assert.equal(typeof field.section, 'string');
    assert.equal(typeof field.type, 'string');
    assert.equal(typeof field.required, 'boolean');
    assert.equal(typeof field.sensitive, 'boolean');
    assert.equal(typeof field.safeToDisplay, 'boolean');
    assert.ok(Array.isArray(field.capabilities));
    assert.ok(field.capabilities.length > 0);
    assert.ok(Array.isArray(field.sources));
    assert.ok(field.sources.length > 0);
  }
});

test('sensitive config fields are marked and excluded from safe listing', () => {
  const sensitiveKeys = CONFIG_UI_FIELDS.filter(field => field.sensitive)
    .map(field => field.key)
    .sort();

  assert.deepEqual(sensitiveKeys, ['profile.db.password', 'profile.fetch.password']);

  const safeFieldKeys = listConfigUiFields({ includeSensitive: false }).map(field => field.key);
  assert.equal(safeFieldKeys.includes('profile.db.password'), false);
  assert.equal(safeFieldKeys.includes('profile.fetch.password'), false);
});

test('config UI metadata avoids secret-like placeholder content', () => {
  const suspiciousTokens = ['/home/', 'BEGIN RSA', 'BEGIN OPENSSH', 'PRIVATE KEY', 'AKIA', 'ghp_'];

  for (const field of CONFIG_UI_FIELDS) {
    const text = [field.placeholder, field.example].filter(Boolean).join(' ');
    for (const token of suspiciousTokens) {
      assert.equal(text.includes(token), false, `unexpected token "${token}" in ${field.key}`);
    }
  }
});

test('config UI metadata supports section and capability filtering', () => {
  const fetchFields = listConfigUiFields({ capability: 'fetch' });
  assert.ok(fetchFields.length > 0);
  assert.ok(fetchFields.every(field => field.capabilities.includes('fetch')));

  const dbSectionFields = listConfigUiFields({ section: 'db2' });
  assert.ok(dbSectionFields.length > 0);
  assert.ok(dbSectionFields.every(field => field.section === 'db2'));

  const profileField = getConfigUiField('runtime.profile');
  assert.ok(profileField);
  assert.equal(profileField.section, 'profile');

  assert.ok(getConfigUiField('profile.systems'));
  assert.ok(getConfigUiField('profile.workflow.members'));
  assert.ok(getConfigUiField('profile.workflow.tables'));
  assert.ok(getConfigUiField('profile.workflow.impact'));
  assert.ok(getConfigUiField('profile.runtimeContext.journaledTables'));
});
