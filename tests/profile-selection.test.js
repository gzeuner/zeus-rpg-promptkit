const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listSelectableProfiles,
  resolveActiveProfile,
} = require('../src/vscode/profileSelection');

test('listSelectableProfiles excludes global config keys and sorts names', () => {
  const profiles = {
    contextOptimizer: {
      softTokenLimit: 3000,
    },
    'PROJECT-B': {
      sourceRoot: './src',
    },
    'PROJECT-A': {
      sourceRoot: './src',
    },
    presets: {
      presetA: {},
    },
  };

  assert.deepEqual(listSelectableProfiles(profiles), ['PROJECT-A', 'PROJECT-B']);
});

test('resolveActiveProfile prefers configured value and falls back to first profile', () => {
  const names = ['A', 'B'];
  assert.equal(resolveActiveProfile('B', names), 'B');
  assert.equal(resolveActiveProfile('missing', names), 'A');
  assert.equal(resolveActiveProfile('', names), 'A');
  assert.equal(resolveActiveProfile('A', []), '');
});

