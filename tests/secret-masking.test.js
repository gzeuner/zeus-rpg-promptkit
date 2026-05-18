const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED_VALUE,
  collectSensitiveTermsFromEnv,
  maskSensitiveTermsInText,
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

test('maskSecretsInText redacts credential fields and jdbc query credentials', () => {
  const input = 'jdbc:db2://host/db?user=alice&password=secret123 credentials=top-secret username=alice';
  const output = maskSecretsInText(input);

  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /\balice\b/i);
  assert.doesNotMatch(output, /\bsecret123\b/);
  assert.doesNotMatch(output, /\btop-secret\b/);
});

test('collectSensitiveTermsFromEnv includes configured system/library/user values', () => {
  const terms = collectSensitiveTermsFromEnv({
    ZEUS_DB_HOST: 'DERSMT1',
    ZEUS_FETCH_SOURCE_LIB: 'WPT',
    ZEUS_FETCH_USER: 'MYUSER',
    ZEUS_SENSITIVE_TERMS: 'alpha,beta',
  });

  assert.ok(terms.includes('DERSMT1'));
  assert.ok(terms.includes('WPT'));
  assert.ok(terms.includes('MYUSER'));
  assert.ok(terms.includes('ALPHA'));
  assert.ok(terms.includes('BETA'));
});

test('maskSensitiveTermsInText redacts configured names in plain text', () => {
  const output = maskSensitiveTermsInText('System DERSMT1 library WPT owner MYUSER', ['DERSMT1', 'WPT', 'MYUSER']);
  assert.doesNotMatch(output, /\bDERSMT1\b/);
  assert.doesNotMatch(output, /\bWPT\b/);
  assert.doesNotMatch(output, /\bMYUSER\b/);
  assert.match(output, /\[REDACTED\]/);
});

test('sanitizeValue applies sensitive term masking recursively', () => {
  const sanitized = sanitizeValue({
    system: 'DERSMT1',
    nested: {
      text: 'Library WPT, Owner MYUSER',
    },
  }, { sensitiveTerms: ['DERSMT1', 'WPT', 'MYUSER'] });

  assert.equal(sanitized.system, REDACTED_VALUE);
  assert.doesNotMatch(sanitized.nested.text, /\bWPT\b/);
  assert.doesNotMatch(sanitized.nested.text, /\bMYUSER\b/);
});
