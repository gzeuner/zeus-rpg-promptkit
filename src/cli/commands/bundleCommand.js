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
const { buildOutputBundle } = require('../../bundle/outputBundleBuilder');
const { resolveBundleConfig } = require('../../config/runtimeConfig');

function runBundle(args) {
  const verbose = Boolean(args.verbose);

  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  const config = resolveBundleConfig(args);
  const result = buildOutputBundle({
    program: String(args.program).trim(),
    sourceOutputRoot: config.sourceOutputRoot,
    bundleOutputRoot: config.bundleOutputRoot,
    includeJson: args['include-json'] === true,
    includeMd: args['include-md'] === true,
    includeHtml: args['include-html'] === true,
  });

  if (verbose) {
    console.log(`[verbose] Program output: ${result.programOutputDir}`);
    console.log(`[verbose] Bundle output: ${result.bundleOutputRoot}`);
  }

  console.log(`Bundle created for program ${result.program}`);
  console.log(`Files included: ${result.manifest.summary.totalFiles}`);
  console.log(`Bundle written to: ${result.zipPath}`);
}

module.exports = {
  runBundle,
};
