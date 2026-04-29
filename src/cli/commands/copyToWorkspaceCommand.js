/*
Copyright 2026 Guido Zeuner

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
} = require('../../config/runtimeConfig');
const { renderAsciiTable } = require('../helpers/asciiTable');
const {
  copyFetchedSourcesToWorkspace,
  parseMembersCsv,
} = require('../../workspace/workCopyService');

async function runCopyToWorkspace(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  const cwd = process.cwd();
  const env = process.env;
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const workCopyConfig = readWorkCopyConfig(profile, env);
  const sourceRoot = path.resolve(cwd, fetchConfig.out);
  const targetRoot = path.resolve(cwd, workCopyConfig.root);

  if (!fs.existsSync(sourceRoot)) {
    console.error(`Fetch output directory not found: ${sourceRoot}`);
    process.exit(2);
  }

  const result = copyFetchedSourcesToWorkspace({
    sourceRoot,
    targetRoot,
    workCopyMode: workCopyConfig.extension,
    force: Boolean(args.force),
    members: parseMembersCsv(args.members),
  });

  console.log(renderAsciiTable(
    ['Status', 'Member', 'Source', 'Target', 'Note'],
    result.results.map((entry) => [entry.status, entry.member, entry.source, entry.target, entry.note]),
  ));
  console.log(`Selected sources: ${result.selectedCount}/${result.discoveredCount}`);
  console.log(`Copied: ${result.copiedCount}`);
  console.log(`Already exists: ${result.existingCount}`);
  console.log(`Errors: ${result.errorCount}`);

  if (result.errorCount > 0) {
    process.exit(1);
  }
}

module.exports = {
  runCopyToWorkspace,
};
