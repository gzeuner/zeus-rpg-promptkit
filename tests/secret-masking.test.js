const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REDACTED_VALUE,
  collectSensitiveTermsFromEnv,
  maskSensitiveTermsInText,
  maskSecretsInText,
  sanitizeValue,
} = require('../src/security/secretMasking');

function createPrng(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(prng, entries) {
  return entries[Math.floor(prng() * entries.length)];
}

function randomWord(prng, min = 4, max = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const length = min + Math.floor(prng() * (max - min + 1));
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[Math.floor(prng() * alphabet.length)];
  }
  return result;
}

function buildSecretLogLine(prng, secret) {
  const variants = [
    `password=${secret}`,
    `token=${secret}`,
    `secret=${secret}`,
    `credentials="${secret}"`,
    `token=\\"${secret}\\"`,
    `authorization: Bearer ${secret}`,
    `authorization bearer ${secret}`,
    `user=${secret}`,
  ];
  const prefix = `${randomWord(prng)} ${randomWord(prng)}`;
  const suffix = `${randomWord(prng)} ${randomWord(prng)}`;
  return `${prefix} ${pick(prng, variants)} ${suffix}`;
}

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

test('maskSecretsInText preserves JSON parseability while redacting inline tokens', () => {
  const input = JSON.stringify({
    rows: [
      { NOTE: 'token=abc123', PASSWORD: 'top-secret' },
    ],
  });
  const output = maskSecretsInText(input);

  assert.doesNotThrow(() => JSON.parse(output));
  assert.doesNotMatch(output, /\babc123\b/);
});

test('maskSecretsInText redacts quoted secret assignments without breaking JSON text', () => {
  const input = JSON.stringify({
    note: 'token="abc123" secret=\'xyz987\' password="p4ssw0rd"',
  });
  const output = maskSecretsInText(input);

  assert.doesNotThrow(() => JSON.parse(output));
  assert.doesNotMatch(output, /\babc123\b/);
  assert.doesNotMatch(output, /\bxyz987\b/);
  assert.doesNotMatch(output, /\bp4ssw0rd\b/);
});

test('maskSecretsInText redacts authorization bearer tokens with separators and multiline blobs', () => {
  const input = [
    'authorization: Bearer abc.def.ghi',
    'authorization bearer mno.pqr.stu',
    'detail token=\u00a0abc123',
  ].join('\n');
  const output = maskSecretsInText(input);

  assert.doesNotMatch(output, /\babc\.def\.ghi\b/);
  assert.doesNotMatch(output, /\bmno\.pqr\.stu\b/);
  assert.doesNotMatch(output, /\babc123\b/);
  assert.match(output, /\[REDACTED\]/);
});

test('maskSecretsInText redacts escaped quoted values without swallowing trailing text', () => {
  const input = JSON.stringify({
    note: 'token=\\"abc123\\" status=ok user=\\"alice\\"',
  });
  const output = maskSecretsInText(input);
  const parsed = JSON.parse(output);

  assert.equal(typeof parsed.note, 'string');
  assert.match(parsed.note, /status=ok/);
  assert.doesNotMatch(parsed.note, /\babc123\b/);
  assert.doesNotMatch(parsed.note, /\balice\b/i);
});

test('maskSecretsInText seeded fuzz redacts random inline secret log variants', () => {
  const prng = createPrng(20260520);
  const cases = 250;

  for (let index = 0; index < cases; index += 1) {
    const secret = `S3CR3T_${index}_${randomWord(prng, 6, 10)}`;
    const input = buildSecretLogLine(prng, secret);
    const output = maskSecretsInText(input);

    assert.doesNotMatch(output, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(output, /\[REDACTED\]/);
  }
});

test('maskSecretsInText seeded fuzz preserves JSON parseability for random log notes', () => {
  const prng = createPrng(42424242);
  const cases = 200;

  for (let index = 0; index < cases; index += 1) {
    const secret = `J_${index}_${randomWord(prng, 5, 9)}`;
    const line = buildSecretLogLine(prng, secret);
    const payload = JSON.stringify({
      note: line,
      status: pick(prng, ['ok', 'warn', 'info']),
      seq: index,
    });
    const masked = maskSecretsInText(payload);

    assert.doesNotThrow(() => JSON.parse(masked));
    const parsed = JSON.parse(masked);
    assert.equal(parsed.seq, index);
    assert.doesNotMatch(parsed.note, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(parsed.note, /\[REDACTED\]/);
  }
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
  assert.ok(terms.includes('alpha'));
  assert.ok(terms.includes('beta'));
});

test('maskSensitiveTermsInText redacts configured names in plain text', () => {
  const output = maskSensitiveTermsInText('System DERSMT1 library WPT owner MYUSER', ['DERSMT1', 'WPT', 'MYUSER']);
  assert.doesNotMatch(output, /\bDERSMT1\b/);
  assert.doesNotMatch(output, /\bWPT\b/);
  assert.doesNotMatch(output, /\bMYUSER\b/);
  assert.match(output, /\[REDACTED\]/);
});

test('maskSensitiveTermsInText preserves lowercase identifiers when sensitive term case differs', () => {
  const output = maskSensitiveTermsInText('tool zeus.health path /home/zeus/dev project zeus-rpg-promptkit', ['ZEUS']);
  assert.match(output, /zeus\.health/);
  assert.match(output, /\/home\/zeus\/dev/);
  assert.match(output, /zeus-rpg-promptkit/);
  assert.doesNotMatch(output, /\[REDACTED\]/);
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
