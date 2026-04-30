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
  assert.equal(sanitized.db.user, REDACTED_VALUE);
  assert.equal(sanitized.db.password, REDACTED_VALUE);
  assert.equal(sanitized.nested.auth, REDACTED_VALUE);
  assert.equal(sanitized.nested.apiKey, REDACTED_VALUE);
});

test('maskSecretsInText redacts common inline secret patterns', () => {
  const input = 'jdbc:as400://demo:superpass@host;naming=system;user=ME;password=superpass token=abc authorization Bearer qwerty key=xyz';
  const output = maskSecretsInText(input);

  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /superpass/);
  assert.doesNotMatch(output, /\bME\b/);
  assert.doesNotMatch(output, /\babc\b/);
  assert.doesNotMatch(output, /\bqwerty\b/);
  assert.doesNotMatch(output, /\bxyz\b/);
});

