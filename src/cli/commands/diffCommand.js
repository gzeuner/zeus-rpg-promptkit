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
const path = require('path');
const { loadProfiles, readWorkCopyConfig, resolveAnalyzeConfig, resolveFetchConfig, resolveProfile } = require('../../config/runtimeConfig');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { buildLineComparison, readLines, resolveDiffPaths } = require('../../diff/workspaceDiffService');

async function runDiff(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }
  if (!args.member || !String(args.member).trim()) {
    console.error('Missing required option: --member <name>');
    process.exit(2);
  }

  const cwd = process.cwd();
  const env = process.env;
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const analyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
  const fetchConfig = resolveFetchConfig(args, { cwd, env });
  const workCopyConfig = readWorkCopyConfig(profile, env);
  const fetchRoot = path.resolve(cwd, fetchConfig.out);
  const workspaceRoot = path.resolve(cwd, analyzeConfig.sourceRoot || workCopyConfig.root);
  const resolved = resolveDiffPaths({
    member: args.member,
    fetchRoot,
    workspaceRoot,
    workCopyMode: workCopyConfig.extension,
  });
  const comparison = buildLineComparison(
    readLines(resolved.originalPath),
    readLines(resolved.modifiedPath),
  );

  console.log(`Member: ${resolved.member}`);
  console.log(`Original: ${resolved.originalPath}`);
  console.log(`Modified: ${resolved.modifiedPath}`);
  console.log('');
  console.log(renderAsciiTable(
    ['Line', 'Diff', 'Original', 'Modified'],
    comparison.rows.map((row) => [row.line, row.marker, row.original, row.modified]),
    { maxCellWidth: 60 },
  ));
  console.log(`Changed lines: ${comparison.changedCount}`);
}

module.exports = {
  runDiff,
};
