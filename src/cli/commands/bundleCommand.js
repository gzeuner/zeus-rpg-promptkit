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
const { buildOutputBundle } = require('../../bundle/outputBundleBuilder');
const { resolveBundleConfig } = require('../../config/runtimeConfig');
const { normalizeReproducibilitySettings } = require('../../reproducibility/reproducibility');
const { createJsonOutput } = require('../helpers/jsonOutput');

function runBundle(args) {
  const verbose = Boolean(args.verbose);

  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  let result;
  try {
    // Route through capability (package 07)
    const { capabilities } = require('../../api/zeusApi');
    const res = capabilities && typeof capabilities.execute === 'function' ? capabilities.execute('bundle.create', { cwd: process.cwd(), env: process.env, args }, args) : null;
    if (res && res.ok && res.result) {
      result = res.result;
    }
    if (!result) {
      const config = resolveBundleConfig(args);
      result = buildOutputBundle({
      program: String(args.program).trim(),
      sourceOutputRoot: config.sourceOutputRoot,
      bundleOutputRoot: config.bundleOutputRoot,
      includeJson: args['include-json'] === true,
      includeMd: args['include-md'] === true,
      includeHtml: args['include-html'] === true,
      safeSharingEnabled: Boolean(args['safe-sharing']),
      reproducibility: normalizeReproducibilitySettings(Boolean(args.reproducible)),
      artifactPaths: Array.isArray(args['artifact-paths']) ? args['artifact-paths'] : null,
      workflowPreset: args['workflow-preset-settings'] || null,
      bundleFileName: args['bundle-file-name'] || null,
    });
  }

  if (verbose) {
    console.log(`[verbose] Program output: ${result.programOutputDir}`);
    console.log(`[verbose] Bundle output: ${result.bundleOutputRoot}`);
  }

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(result);
    return result;
  }

  console.log(`Bundle created for program ${result.program}`);
  if (result.manifest.safeSharing && result.manifest.safeSharing.enabled) {
    console.log('Safe-sharing bundle: enabled');
  }
  console.log(`Files included: ${result.manifest.summary.totalFiles}`);
  console.log(`Bundle written to: ${result.zipPath}`);
  return result;
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runBundle,
};
