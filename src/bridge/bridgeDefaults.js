/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const BRIDGE_MODES = Object.freeze(['plan-only', 'plan-stage-apply', 'plan-stage-apply-compile']);
const BRIDGE_SUBCOMMANDS = Object.freeze(['plan', 'stage', 'apply', 'compile-plan', 'compile-run', 'report']);
const KNOWN_COMPILE_TEMPLATE_IDS = Object.freeze([
  'crtbndrpg',
  'crtrpgmod',
  'crtclpgm',
  'crtsqlrpgi',
]);

const BRIDGE_DEFAULTS = Object.freeze({
  enabled: false,
  mode: 'plan-only',
  requireConfirmation: true,
  allowAutoApprove: false,
  auditLog: true,
  allowedTargets: {
    libraries: [],
    sourceFiles: [],
    ifsPaths: [],
  },
  staging: {
    enabled: true,
    library: '',
    sourceFile: '',
    ifsPath: '',
  },
  compile: {
    enabled: false,
    allowedTemplates: [],
    requirePlan: true,
    requireApproval: true,
  },
});

module.exports = {
  BRIDGE_DEFAULTS,
  BRIDGE_MODES,
  BRIDGE_SUBCOMMANDS,
  KNOWN_COMPILE_TEMPLATE_IDS,
};
