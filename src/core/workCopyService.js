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
const fs = require('fs');
const path = require('path');
const {
  loadProfiles,
  readWorkCopyConfig,
  resolveProfile,
  resolveFetchConfig,
} = require('../config/runtimeConfig');
const {
  copyFetchedSourcesToWorkspace,
  parseMembersCsv,
} = require('../workspace/workCopyService');

function executeCopyToWorkspace(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }

  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const workCopyConfig = readWorkCopyConfig(profile, env);
  const sourceRoot = path.resolve(cwd, options.sourceRoot || fetchConfig.out);
  const targetRoot = path.resolve(cwd, options.targetRoot || workCopyConfig.root);
  const workCopyMode = String(options.workCopyMode || workCopyConfig.extension).trim().toLowerCase();

  if (!fs.existsSync(sourceRoot)) {
    const error = new Error(`Fetch output directory not found: ${sourceRoot}`);
    error.code = 'FETCH_OUTPUT_MISSING';
    throw error;
  }

  return {
    sourceRoot,
    targetRoot,
    workCopyMode,
    result: copyFetchedSourcesToWorkspace({
      sourceRoot,
      targetRoot,
      workCopyMode,
      force: options.force !== undefined ? Boolean(options.force) : Boolean(args.force),
      members: options.members || parseMembersCsv(args.members),
    }),
  };
}

module.exports = {
  executeCopyToWorkspace,
};
