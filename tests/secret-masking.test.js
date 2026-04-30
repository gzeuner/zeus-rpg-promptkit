const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED_VALUE,
  maskSecretsInText,
  sanitizeValue,
} = require('../src/security/secretMasking');

test('sanitizeValue masks sensitive keys recursively', () => {
  const input = {
    db: {
      user: 'MYUSER',
      password: 'top-secret',
    },
    nested: {
      auth: 'abc',
      apiKey: 'xyz',
    },
  };

  const sanitized = sanitizeValue(input);
  assert.equal(sanitized.db.user, 'MYUSER');
  assert.equal(sanitized.db.password, REDACTED_VALUE);
  assert.equal(sanitized.nested.auth, REDACTED_VALUE);
  assert.equal(sanitized.nested.apiKey, REDACTED_VALUE);
});

test('maskSecretsInText redacts common inline secret patterns', () => {
  const input = 'jdbc:as400://host;password=superpass token=abc authorization Bearer qwerty';
  const output = maskSecretsInText(input);

  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /superpass/);
  assert.doesNotMatch(output, /\babc\b/);
  assert.doesNotMatch(output, /\bqwerty\b/);
});

