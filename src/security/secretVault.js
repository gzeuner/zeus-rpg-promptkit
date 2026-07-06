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

// Zeus Secret Vault
// -----------------
// Erlaubt es, Passwoerter/Secrets NICHT im Klartext in .env-Dateien oder Profilen
// abzulegen. Werte werden als `enc:v1:<base64>` gespeichert und zur Laufzeit
// transparent entschluesselt (AES-256-GCM).
//
// Der Master-Schluessel wird bereitgestellt entweder ueber
//   1. die Umgebungsvariable ZEUS_SECRET_KEY (hat Vorrang), oder
//   2. die Schluesseldatei config/local-only/.zeus-key (gitignoriert).
//
// Das Schluesselmaterial ist eine beliebige Passphrase / ein Base64-Key; daraus
// wird deterministisch ein 32-Byte-Schluessel via SHA-256 abgeleitet.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_PREFIX = 'enc:v1:';
const KEY_ENV_VAR = 'ZEUS_SECRET_KEY';
const KEY_FILE_RELATIVE = path.join('config', 'local-only', '.zeus-key');
const IV_BYTES = 12;
const TAG_BYTES = 16;

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}

function getKeyFileCandidates(cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, KEY_FILE_RELATIVE),
    path.join(PACKAGE_ROOT, KEY_FILE_RELATIVE),
  ];
  return [...new Set(candidates)];
}

// Primaerer Ablageort fuer eine neu erzeugte Schluesseldatei.
function getKeyFilePath(cwd = process.cwd()) {
  return path.join(cwd, KEY_FILE_RELATIVE);
}

// Ermittelt das rohe Schluesselmaterial und dessen Herkunft (env | keyfile) oder null.
function resolveKeyMaterial({ env = process.env, cwd = process.cwd() } = {}) {
  const fromEnv = env && env[KEY_ENV_VAR];
  if (fromEnv && String(fromEnv).trim()) {
    return { material: String(fromEnv).trim(), source: `env:${KEY_ENV_VAR}` };
  }
  for (const candidate of getKeyFileCandidates(cwd)) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8').trim();
        if (content) {
          return { material: content, source: `keyfile:${candidate}` };
        }
      }
    } catch (_error) {
      // Datei nicht lesbar -> naechsten Kandidaten pruefen.
    }
  }
  return null;
}

function hasKeyMaterial(options = {}) {
  return Boolean(resolveKeyMaterial(options));
}

function deriveKeyBuffer(material) {
  return crypto.createHash('sha256').update(String(material), 'utf8').digest();
}

function resolveKeyBuffer({ env = process.env, cwd = process.cwd(), keyMaterial = null } = {}) {
  const material = keyMaterial && String(keyMaterial).trim()
    ? String(keyMaterial).trim()
    : (resolveKeyMaterial({ env, cwd }) || {}).material;
  if (!material) {
    throw new Error(
      `Kein Schluesselmaterial gefunden. Setze ${KEY_ENV_VAR} oder lege `
      + `${KEY_FILE_RELATIVE} an (z. B. via "zeus secret init-key").`,
    );
  }
  return deriveKeyBuffer(material);
}

// Verschluesselt einen Klartext -> `enc:v1:<base64(iv|tag|ciphertext)>`.
function encryptSecret(plaintext, options = {}) {
  if (plaintext === undefined || plaintext === null) {
    throw new Error('encryptSecret: kein Klartext angegeben.');
  }
  const key = resolveKeyBuffer(options);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return SECRET_PREFIX + payload;
}

// Entschluesselt ein `enc:v1:...`-Token -> Klartext. Wirft bei fehlendem/falschem Schluessel.
function decryptSecret(token, options = {}) {
  if (!isEncryptedSecret(token)) {
    throw new Error('decryptSecret: Wert ist kein verschluesseltes Zeus-Secret (erwartet "enc:v1:...").');
  }
  const key = resolveKeyBuffer(options);
  let raw;
  try {
    raw = Buffer.from(token.slice(SECRET_PREFIX.length), 'base64');
  } catch (_error) {
    throw new Error('decryptSecret: ungueltige Base64-Nutzdaten im verschluesselten Wert.');
  }
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('decryptSecret: verschluesselter Wert ist beschaedigt (zu kurz).');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_error) {
    throw new Error(
      'decryptSecret: Entschluesselung fehlgeschlagen. Falscher Schluessel '
      + `(${KEY_ENV_VAR} / ${KEY_FILE_RELATIVE}) oder manipulierter Wert.`,
    );
  }
}

// Transparente Aufloesung: verschluesselte Werte werden entschluesselt, alles andere
// bleibt unveraendert. Wird von der Env-Platzhalteraufloesung genutzt.
function resolveSecretValue(value, options = {}) {
  if (!isEncryptedSecret(value)) {
    return value;
  }
  return decryptSecret(value, options);
}

// Erzeugt ein neues, zufaelliges Schluesselmaterial (Base64, 32 Byte).
function generateKeyString() {
  return crypto.randomBytes(32).toString('base64');
}

// Schreibt die Schluesseldatei mit restriktiven Rechten (0600, best effort).
function writeKeyFile(keyString, { cwd = process.cwd() } = {}) {
  const target = getKeyFilePath(cwd);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${String(keyString).trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(target, 0o600);
  } catch (_error) {
    // chmod auf Windows/NTFS ggf. wirkungslos -> best effort.
  }
  return target;
}

module.exports = {
  SECRET_PREFIX,
  KEY_ENV_VAR,
  KEY_FILE_RELATIVE,
  isEncryptedSecret,
  resolveKeyMaterial,
  hasKeyMaterial,
  encryptSecret,
  decryptSecret,
  resolveSecretValue,
  generateKeyString,
  getKeyFilePath,
  getKeyFileCandidates,
  writeKeyFile,
};
