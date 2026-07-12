'use strict';

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...require('globals').node,
        ...require('globals').es2021,
      },
    },
    rules: {
      'no-unused-vars': 'off', // TODO enable and fix in future (many legacy)
      'no-console': 'off',
      'no-process-exit': 'off',
      'prefer-const': 'off', // TODO
      'no-var': 'error',
      'no-empty': 'off', // TODO
      'no-useless-escape': 'off', // TODO
      'no-control-regex': 'off', // TODO
      'no-extra-boolean-cast': 'off', // TODO
      'no-func-assign': 'off', // TODO enable
      'no-undef': 'off', // TODO enable (scope issues in dynamic requires)
      'no-case-declarations': 'off', // TODO
      'no-unreachable': 'off', // TODO
      'no-regex-spaces': 'error', // keep real
    },
  },
  {
    ignores: [
      'node_modules/**',
      'output/**',
      '*-output/**',
      '*.tgz',
      'docs/**',
      'examples/**/output*',
      'examples/demo-rpg-mini-system/scripts/*.mjs',
      '.local/**',
      '.git/**',
      'tests/**',
      'vscode-extension/**',
    ],
  },
  {
    files: ['src/api/zeusApi.js'],
    rules: {
      'no-undef': 'off', // registrations use requires inside try blocks; vars scoped for runtime
    },
  },
];
