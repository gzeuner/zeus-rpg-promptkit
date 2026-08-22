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

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ProfileKeyWizardError,
  createProfileKeyWizardService,
  normalizeStorage,
} = require('../src/ui/profileKeyWizardService');

test('key wizard exposes status without key material or absolute paths', () => {
  const service = createProfileKeyWizardService({
    cwd: 'C:/private/workspace',
    env: {},
    platform: 'linux',
    keyResolver: () => null,
  });

  const state = service.getState();
  assert.equal(state.status, 'missing');
  assert.equal(state.hasKeyMaterial, false);
  assert.equal(state.source.kind, 'unknown');
  assert.equal(JSON.stringify(state).includes('private/workspace'), false);
  assert.equal(JSON.stringify(state).includes('unit-test-key-material'), false);
});

test('key wizard requires confirmation and creates only local key storage', () => {
  let written = null;
  const service = createProfileKeyWizardService({
    cwd: 'C:/local/project',
    env: {},
    platform: 'linux',
    keyResolver: () => ({ source: 'keyfile:C:/local/project/config/local-only/.zeus-key' }),
    keyGenerator: () => 'unit-test-key-material',
    fileWriter: (key, options) => {
      written = { key, options };
      return 'C:/local/project/config/local-only/.zeus-key';
    },
  });

  assert.throws(() => service.initialize({ storage: 'keyfile' }), ProfileKeyWizardError);
  const result = service.initialize({ storage: 'keyfile', confirm: true });
  assert.equal(written.key, 'unit-test-key-material');
  assert.equal(written.options.cwd, 'C:/local/project');
  assert.equal(result.saved, true);
  assert.equal(result.target, 'config/local-only/.zeus-key');
  assert.equal(JSON.stringify(result).includes('unit-test-key-material'), false);
  assert.equal(JSON.stringify(result).includes('C:/local/project'), false);
});

test('windows storage is fail-closed on non-Windows platforms', () => {
  assert.equal(normalizeStorage('auto', 'linux'), 'keyfile');
  assert.throws(() => normalizeStorage('windows-secure', 'linux'), ProfileKeyWizardError);
});
