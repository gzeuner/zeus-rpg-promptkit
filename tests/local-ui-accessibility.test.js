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

const { renderLocalUiShell } = require('../src/ui/localUiShell');

test('local UI shell contains keyboard-first and secure setup contracts', () => {
  const html = renderLocalUiShell();

  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected/);
  assert.match(html, /aria-controls/);
  assert.match(html, /bindRovingTabKeyboard/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /forced-colors/);
  assert.match(html, /data-setup-checklist/);
  assert.match(html, /profileKeyWizardSection/);
  assert.match(html, /pluginCatalogSection/);
  assert.match(html, /credentials, key material, and plaintext secrets are never shown here/i);
  assert.doesNotMatch(html, /fetch\([^)]*telemetry|navigator\.sendBeacon/);
});
