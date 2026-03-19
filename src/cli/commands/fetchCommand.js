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
const { resolveFetchConfig } = require('../../config/runtimeConfig');
const { fetchSources, describeEncodingPolicy } = require('../../fetch/fetchService');

async function runFetch(args) {
  const verbose = Boolean(args.verbose);
  const config = resolveFetchConfig(args);

  const required = [
    ['host', '--host <hostname>'],
    ['user', '--user <username>'],
    ['password', '--password <password>'],
    ['sourceLib', '--source-lib <lib>'],
    ['ifsDir', '--ifs-dir <ifsPath>'],
    ['out', '--out <localPath>'],
  ];

  for (const [key, flag] of required) {
    if (!config[key] || !String(config[key]).trim()) {
      console.error(`Missing required option: ${flag}`);
      process.exit(2);
    }
  }

  if (verbose) {
    console.log(`[verbose] Fetch host: ${config.host}`);
    console.log(`[verbose] Source library: ${config.sourceLib}`);
    console.log(`[verbose] IFS dir: ${config.ifsDir}`);
    console.log(`[verbose] Local out: ${path.resolve(process.cwd(), config.out)}`);
    console.log(`[verbose] Source files: ${config.files.join(', ')}`);
    console.log(`[verbose] Stream file encoding: ${describeEncodingPolicy(config.streamFileCcsid)}`);
    console.log(`[verbose] Download transport: ${config.transport}`);
    if (config.members.length > 0) {
      console.log(`[verbose] Members (global filter): ${config.members.join(', ')}`);
    }
  }

  const summary = await fetchSources({
    ...config,
    verbose,
  });

  console.log(`Exported streamfiles: ${summary.exportedSuccess}/${summary.exportedTotal}`);
  console.log(`Downloaded files: ${summary.downloadedCount}`);
  console.log(`Download transport used: ${summary.transportUsed}`);
  console.log(`Source encoding policy: ${summary.encodingPolicy}`);
  console.log(`Local destination: ${summary.localDestination}`);
  if (summary.importManifestPath) {
    console.log(`Import manifest: ${summary.importManifestPath}`);
  }
  if (summary.notes.length > 0) {
    console.log('Notes:');
    for (const note of summary.notes) {
      console.log(`- ${note}`);
    }
  }
}

module.exports = {
  runFetch,
};
