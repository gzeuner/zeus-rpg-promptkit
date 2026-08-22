/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const {
  KEY_ENV_VAR,
  KEY_FILE_RELATIVE,
  generateKeyString,
  resolveKeyMaterial,
  storeKeyInWindowsSecureXml,
  writeKeyFile,
} = require('../security/secretVault');

const PROFILE_KEY_WIZARD_METADATA = Object.freeze({
  schemaVersion: 1,
  mode: 'local-only-profile-key-wizard',
  readOnlyStatus: true,
  secretValuesInBrowser: false,
  supportedStorage: ['windows-secure', 'keyfile'],
  steps: Object.freeze([
    Object.freeze({ id: 'check', title: 'Check key readiness' }),
    Object.freeze({ id: 'choose-storage', title: 'Choose local storage' }),
    Object.freeze({ id: 'confirm-write', title: 'Confirm local key creation' }),
    Object.freeze({ id: 'verify', title: 'Verify key availability' }),
  ]),
  boundaries: Object.freeze([
    'The browser never receives key material or plaintext secret values.',
    'Key creation is explicit and writes only to OS-secure storage or the gitignored local key file.',
    'Encrypting a value remains a CLI operation so plaintext never enters browser state or browser logs.',
  ]),
});

class ProfileKeyWizardError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ProfileKeyWizardError';
    this.statusCode = statusCode;
  }
}

function normalizeStorage(value, platform) {
  const requested = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (requested === 'auto') {
    return platform === 'win32' ? 'windows-secure' : 'keyfile';
  }
  if (!PROFILE_KEY_WIZARD_METADATA.supportedStorage.includes(requested)) {
    throw new ProfileKeyWizardError(`Unsupported key storage: ${requested || '(empty)'}`, 400);
  }
  if (requested === 'windows-secure' && platform !== 'win32') {
    throw new ProfileKeyWizardError(
      'Windows secure key storage is only available on Windows.',
      400
    );
  }
  return requested;
}

function summarizeKeySource(source, platform) {
  const value = String(source || '');
  if (value.startsWith(`env:${KEY_ENV_VAR}`)) {
    return { kind: 'environment-reference', label: KEY_ENV_VAR };
  }
  if (value.startsWith('windows-secure-xml')) {
    return { kind: 'windows-secure', label: 'OS-secure storage' };
  }
  if (value.startsWith('keyfile:')) {
    return { kind: 'keyfile', label: KEY_FILE_RELATIVE.replace(/\\/g, '/') };
  }
  return {
    kind: 'unknown',
    label: platform === 'win32' ? 'local secure storage' : 'local key storage',
  };
}

function createProfileKeyWizardService({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  keyResolver = resolveKeyMaterial,
  keyGenerator = generateKeyString,
  windowsWriter = storeKeyInWindowsSecureXml,
  fileWriter = writeKeyFile,
} = {}) {
  function getState() {
    const resolved = keyResolver({ cwd, env });
    const source = summarizeKeySource(resolved && resolved.source, platform);
    return {
      ...PROFILE_KEY_WIZARD_METADATA,
      platform,
      defaultStorage: platform === 'win32' ? 'windows-secure' : 'keyfile',
      status: resolved ? 'ready' : 'missing',
      hasKeyMaterial: Boolean(resolved),
      source,
      keyFile: KEY_FILE_RELATIVE.replace(/\\/g, '/'),
      environmentReference: KEY_ENV_VAR,
      windowsSecureAvailable: platform === 'win32',
    };
  }

  function initialize(rawPayload = {}) {
    if (!rawPayload || rawPayload.confirm !== true) {
      throw new ProfileKeyWizardError(
        'Explicit confirmation is required before creating local key material.',
        400
      );
    }

    const storage = normalizeStorage(rawPayload.storage, platform);
    const key = keyGenerator();
    let target = '';
    if (storage === 'windows-secure') {
      target = windowsWriter(key);
    } else {
      target = fileWriter(key, { cwd });
    }

    const state = getState();
    return {
      saved: true,
      storage,
      status: state.status,
      source: state.source,
      target: storage === 'keyfile' ? KEY_FILE_RELATIVE.replace(/\\/g, '/') : 'OS-secure storage',
      targetKnownToServerOnly: Boolean(target),
      notes: [
        'Key material was generated locally and is never returned to the browser.',
        'Use the CLI secret encrypt command to encrypt a value without placing plaintext in browser state.',
      ],
    };
  }

  return { getState, initialize };
}

module.exports = {
  PROFILE_KEY_WIZARD_METADATA,
  ProfileKeyWizardError,
  createProfileKeyWizardService,
  normalizeStorage,
  summarizeKeySource,
};
