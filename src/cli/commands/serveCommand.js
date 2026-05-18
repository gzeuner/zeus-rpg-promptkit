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
const path = require('path');

const { loadProfiles, resolveBundleConfig, resolveProfile } = require('../../config/runtimeConfig');
const { resolveRegistryPath } = require('../../workspace/analysisRegistryService');
const { startLocalUiServer, DEFAULT_UI_HOST, DEFAULT_UI_PORT } = require('../../ui/localUiServer');

function parsePort(value, fallback) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error('Invalid option: --port must be a non-negative integer');
    process.exit(2);
  }
  return parsed;
}

async function runServe(args) {
  const verbose = Boolean(args.verbose);
  const config = resolveBundleConfig(args);
  const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
  const profile = args.profile ? resolveProfile(profiles, args.profile, { env: process.env }) : null;
  const hasRegistryConfig = Boolean(args['registry-path'] || process.env.ZEUS_ANALYSES_REGISTRY || (profile && profile.analysesRegistryPath));
  const registryPath = hasRegistryConfig
    ? resolveRegistryPath({
      registryPath: args['registry-path'],
      profile,
      env: process.env,
    })
    : null;
  const outputRoot = path.resolve(process.cwd(), config.sourceOutputRoot);
  const host = args.host || DEFAULT_UI_HOST;
  const port = parsePort(args.port, DEFAULT_UI_PORT);

  const result = await startLocalUiServer({
    outputRoot,
    host,
    port,
    registryPath,
  });

  if (verbose) {
    console.log(`[verbose] Output root: ${result.outputRoot}`);
    console.log(`[verbose] Registry path: ${registryPath || 'not configured (fallback workspace mode)'}`);
    console.log('[verbose] API routes: /api/health, /api/runs, /api/runs/:program, /api/runs/:program/artifacts/content, /api/analyses*, /api/prompt-builder/*');
  }

  console.log(`Zeus local UI available at: ${result.url}`);
  console.log(`Serving analysis output root: ${result.outputRoot}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = () => {
    result.server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return result;
}

module.exports = {
  runServe,
};
