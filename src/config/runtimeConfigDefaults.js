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
const DEFAULT_EXTENSIONS = ['.rpg', '.rpgle', '.sqlrpgle', '.rpgile', '.bnd', '.binder', '.bndsrc', '.clp', '.clle', '.dds', '.dspf', '.prtf', '.pf', '.lf'];
const ALLOWED_FETCH_TRANSPORTS = new Set(['auto', 'sftp', 'jt400', 'ftp']);
const ALLOWED_WORK_COPY_EXTENSIONS = new Set(['txt', 'original', 'suffixed']);
const ALLOWED_WORKFLOW_STEPS = new Set(['fetch', 'copy', 'analyze', 'impact', 'query-table', 'report']);
const ALLOWED_BRIDGE_MODES = new Set(['plan-only', 'plan-stage-apply', 'plan-stage-apply-compile']);
const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);
const PROFILES_METADATA_KEY = Symbol('zeusProfilesMetadata');
const DEFAULT_WORK_COPY = Object.freeze({
  root: 'source/',
  extension: 'txt',
});
const DEFAULT_TOKEN_BUDGET = 2200;
const DEFAULT_WORKFLOW_STEPS = Object.freeze(['fetch', 'copy', 'analyze', 'report']);
const DEFAULT_WORKFLOW_ANALYZE_MODES = Object.freeze(['documentation', 'defect-analysis']);
const TOKEN_BUDGET_KEY_ALIASES = Object.freeze({
  documentation: 'documentation',
  'error-analysis': 'errorAnalysis',
  erroranalysis: 'errorAnalysis',
  errorAnalysis: 'errorAnalysis',
  'defect-analysis': 'defectAnalysis',
  defectanalysis: 'defectAnalysis',
  defectAnalysis: 'defectAnalysis',
});

module.exports = {
  ALLOWED_BRIDGE_MODES,
  ALLOWED_FETCH_TRANSPORTS,
  ALLOWED_WORKFLOW_STEPS,
  ALLOWED_WORK_COPY_EXTENSIONS,
  DEFAULT_EXTENSIONS,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_WORKFLOW_ANALYZE_MODES,
  DEFAULT_WORKFLOW_STEPS,
  DEFAULT_WORK_COPY,
  GLOBAL_PROFILE_KEYS,
  PROFILES_METADATA_KEY,
  TOKEN_BUDGET_KEY_ALIASES,
};
