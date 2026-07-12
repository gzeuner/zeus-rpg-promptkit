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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-process-exit': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-func-assign': 'warn',
      'no-undef': 'warn',
      'no-case-declarations': 'warn',
      'no-unreachable': 'warn',
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
