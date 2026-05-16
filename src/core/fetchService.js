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
const { resolveFetchConfig } = require('../config/runtimeConfig');
const { fetchSources, describeEncodingPolicy } = require('../fetch/fetchService');

const REQUIRED_FETCH_FIELDS = Object.freeze([
  ['host', '--host <hostname>'],
  ['user', '--user <username>'],
  ['password', '--password <password>'],
  ['sourceLib', '--source-lib <lib>'],
  ['ifsDir', '--ifs-dir <ifsPath>'],
  ['out', '--out <localPath>'],
]);

function findMissingFetchFields(config) {
  return REQUIRED_FETCH_FIELDS
    .filter(([key]) => !config[key] || !String(config[key]).trim())
    .map(([, flag]) => flag);
}

async function executeFetch(args, { cwd = process.cwd(), env = process.env } = {}) {
  const config = resolveFetchConfig(args, { cwd, env });
  const missing = findMissingFetchFields(config);

  if (missing.length > 0) {
    const error = new Error(`Missing required option: ${missing[0]}`);
    error.code = 'FETCH_CONFIG_INCOMPLETE';
    error.missing = missing;
    error.config = config;
    throw error;
  }

  const summary = await fetchSources({
    ...config,
    verbose: Boolean(args.verbose),
  });

  return {
    config,
    summary: {
      ...summary,
      localDestination: path.resolve(cwd, summary.localDestination || config.out),
      encodingPolicy: summary.encodingPolicy || describeEncodingPolicy(config.streamFileCcsid),
    },
  };
}

module.exports = {
  REQUIRED_FETCH_FIELDS,
  executeFetch,
  findMissingFetchFields,
};
