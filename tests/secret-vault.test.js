/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  resolveSecretValue,
  generateKeyString,
  SECRET_PREFIX,
} = require('../src/security/secretVault');
const { loadProfiles, resolveProfile } = require('../src/config/runtimeConfig');

const KEY = 'unit-test-master-key';

function createTempProject(profiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-secret-vault-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'config', 'profiles.example.json'),
    `${JSON.stringify(profiles, null, 2)}\n`,
    'utf8',
  );
  return tempRoot;
}

function resolveProfileWithEnv(profileConfig, env) {
  const tempRoot = createTempProject({ sample: profileConfig });
  try {
    const profiles = loadProfiles({ cwd: tempRoot, env });
    return resolveProfile(profiles, 'sample', { env });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('encrypt/decrypt roundtrip returns the original plaintext', () => {
  const token = encryptSecret('hunter2', { keyMaterial: KEY });
  assert.ok(isEncryptedSecret(token));
  assert.ok(token.startsWith(SECRET_PREFIX));
  assert.equal(decryptSecret(token, { keyMaterial: KEY }), 'hunter2');
});

test('ciphertext is non-deterministic (random IV) but decrypts to the same value', () => {
  const a = encryptSecret('same-secret', { keyMaterial: KEY });
  const b = encryptSecret('same-secret', { keyMaterial: KEY });
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, { keyMaterial: KEY }), 'same-secret');
  assert.equal(decryptSecret(b, { keyMaterial: KEY }), 'same-secret');
});

test('decryption with the wrong key fails loudly', () => {
  const token = encryptSecret('secret', { keyMaterial: 'key-one' });
  assert.throws(() => decryptSecret(token, { keyMaterial: 'key-two' }), /fehlgeschlagen|Entschluesselung/);
});

test('corrupted token throws instead of returning garbage', () => {
  assert.throws(() => decryptSecret('enc:v1:@@@', { keyMaterial: KEY }));
});

test('isEncryptedSecret only matches the enc:v1: prefix', () => {
  assert.equal(isEncryptedSecret('enc:v1:abc'), true);
  assert.equal(isEncryptedSecret('plain'), false);
  assert.equal(isEncryptedSecret(''), false);
  assert.equal(isEncryptedSecret(null), false);
  assert.equal(isEncryptedSecret(1234), false);
});

test('resolveSecretValue passes through non-encrypted values unchanged', () => {
  assert.equal(resolveSecretValue('plaintext', { keyMaterial: KEY }), 'plaintext');
  assert.equal(resolveSecretValue('', { keyMaterial: KEY }), '');
});

test('generateKeyString produces distinct 32-byte base64 keys', () => {
  const a = generateKeyString();
  const b = generateKeyString();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64').length, 32);
});

test('profile resolution decrypts an encrypted value sourced from env', () => {
  const token = encryptSecret('s3cr3t-db-pass', { keyMaterial: KEY });
  const env = { ZEUS_SECRET_KEY: KEY, ZEUS_DB_PASSWORD: token };
  const profile = resolveProfileWithEnv(
    { db: { password: '${env:ZEUS_DB_PASSWORD}' } },
    env,
  );
  assert.equal(profile.db.password, 's3cr3t-db-pass');
});

test('profile resolution decrypts an encrypted value placed directly in a profile', () => {
  const token = encryptSecret('direct-value', { keyMaterial: KEY });
  const env = { ZEUS_SECRET_KEY: KEY };
  const profile = resolveProfileWithEnv(
    { db: { password: token } },
    env,
  );
  assert.equal(profile.db.password, 'direct-value');
});

test('profile resolution leaves plain env-sourced values untouched', () => {
  const env = { ZEUS_DB_USER: 'APPUSER' };
  const profile = resolveProfileWithEnv(
    { db: { user: '${env:ZEUS_DB_USER}' } },
    env,
  );
  assert.equal(profile.db.user, 'APPUSER');
});

test('profile resolution throws a clear error when the key is missing for an encrypted value', () => {
  const token = encryptSecret('needs-key', { keyMaterial: KEY });
  // No ZEUS_SECRET_KEY in env and a cwd without a key file -> must fail loudly.
  const env = { ZEUS_DB_PASSWORD: token };
  assert.throws(
    () => resolveProfileWithEnv({ db: { password: '${env:ZEUS_DB_PASSWORD}' } }, env),
    /Schluesselmaterial|Entschluesselung/,
  );
});

const { detectPlaintextSecrets } = require('../src/security/plaintextSecretDetector');

test('detectPlaintextSecrets finds plaintext in .env files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-hygiene-'));
  fs.writeFileSync(path.join(tempRoot, '.env.local'), 'ZEUS_DB_PASSWORD=supersecret123\nOTHER=foo\nZEUS_FETCH_PASSWORD=enc:v1:xxx');
  const findings = detectPlaintextSecrets({ cwd: tempRoot, env: {}, checkProfiles: false });
  assert.ok(findings.some(f => f.key === 'ZEUS_DB_PASSWORD' && f.source === 'file'));
  assert.equal(findings.filter(f => f.source === 'file').length, 1);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('detectPlaintextSecrets detects in profiles.json', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-hygiene-'));
  fs.mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'config', 'profiles.json'), JSON.stringify({
    default: { db: { password: 'plain-in-profile' } }
  }));
  const findings = detectPlaintextSecrets({ cwd: tempRoot, checkProfiles: true });
  assert.ok(findings.some(f => f.source === 'profile'));
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('detectPlaintextSecrets scans current env', () => {
  const findings = detectPlaintextSecrets({ cwd: '/tmp', env: { ZEUS_DB_PASSWORD: 'from-env-plain' }, checkProfiles: false });
  assert.ok(findings.some(f => f.key === 'ZEUS_DB_PASSWORD' && f.source === 'env'));
});
