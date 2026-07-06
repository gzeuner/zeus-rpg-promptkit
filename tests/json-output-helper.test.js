const test = require('node:test');
const assert = require('node:assert/strict');
const { createJsonOutput, stringifyJson } = require('../src/cli/helpers/jsonOutput');

test('createJsonOutput detects --json flag', () => {
  const json = createJsonOutput({ json: true });
  assert.equal(json.isJsonMode, true);
  assert.equal(json.indent, 2);
});

test('createJsonOutput detects --format json and --output json', () => {
  assert.equal(createJsonOutput({ format: 'json' }).isJsonMode, true);
  assert.equal(createJsonOutput({ output: 'json' }).isJsonMode, true);
  assert.equal(createJsonOutput({ format: 'markdown' }).isJsonMode, false);
});

test('createJsonOutput compact mode', () => {
  const json = createJsonOutput({ format: 'compact' });
  assert.equal(json.compact, true);
  assert.equal(json.indent, 0);
});

test('stringify applies sanitization and pretty by default', () => {
  const json = createJsonOutput({ json: true });
  const data = { user: 'admin', password: 's3cr3t', nested: { token: 'xyz' } };
  const out = json.stringify(data);
  assert.match(out, /"user":\s*"\[REDACTED\]"/);
  assert.match(out, /"password":\s*"\[REDACTED\]"/);
  assert.match(out, /"nested":\s*\{/);
  assert.ok(out.endsWith('\n'));
});

test('stringifyJson compact no mask option', () => {
  const out = stringifyJson({ a: 1, b: 'secret' }, { compact: true, maskSecrets: false });
  assert.equal(out.trim(), '{"a":1,"b":"secret"}');
});

test('json helper handles error objects via toJSON', () => {
  const json = createJsonOutput({ json: true });
  const err = { toJSON: () => ({ code: 'ERR', message: 'refused' }) };
  const out = json.stringify(err);
  assert.match(out, /"code":\s*"ERR"/);
});

test('non-json mode returns null from stringify', () => {
  const json = createJsonOutput({});
  assert.equal(json.stringify({ foo: 'bar' }), null);
});

// Top-level contract test for global flag normalization in cli/zeus.js
const { normalizeJsonArgs } = require('../cli/zeus');

test('CLI normalizes --format json / --output json / --json-output to args.json', () => {
  const cases = [
    { input: { format: 'json' }, expectJson: true },
    { input: { output: 'json' }, expectJson: true },
    { input: { 'json-output': 'foo.json' }, expectJson: true },
    { input: { json: true }, expectJson: true },
    { input: { format: 'markdown' }, expectJson: false },
    { input: {}, expectJson: false },
  ];
  for (const { input, expectJson } of cases) {
    const args = { ...input };
    normalizeJsonArgs(args);
    assert.equal(!!args.json, expectJson, `failed for ${JSON.stringify(input)}`);
  }
});

test('CLI normalization is idempotent and does not override explicit --json=false', () => {
  const args = { json: false, format: 'json' };
  normalizeJsonArgs(args);
  assert.equal(args.json, false);
});

test('CLI normalization only acts when json key is absent', () => {
  const args = { format: 'json' };
  normalizeJsonArgs(args);
  assert.equal(args.json, true);
  normalizeJsonArgs(args); // idempotent
  assert.equal(args.json, true);
});
