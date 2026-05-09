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
const path = require('path');
const { executeFetch } = require('../../core/fetchService');

async function runFetch(args) {
  const verbose = Boolean(args.verbose);
  try {
    const { config, summary } = await executeFetch(args);

    if (verbose) {
      console.log(`[verbose] Fetch host: ${config.host}`);
      console.log(`[verbose] Object library: ${config.sourceLib}`);
      console.log(`[verbose] Source files: ${config.files.join(', ')}`);
      console.log(`[verbose] IFS dir: ${config.ifsDir}`);
      console.log(`[verbose] Local out: ${path.resolve(process.cwd(), config.out)}`);
      console.log(`[verbose] Stream file encoding: ${summary.encodingPolicy}`);
      console.log(`[verbose] Download transport: ${config.transport}`);
      if (config.networkType) {
        console.log(`[verbose] Network type hint: ${config.networkType}`);
      }
      if (config.preferTransport) {
        console.log(`[verbose] Preferred transport: ${config.preferTransport}`);
      }
      if (config.members.length > 0) {
        console.log(`[verbose] Members (global filter): ${config.members.join(', ')}`);
      }
    }

    console.log(`Exported streamfiles: ${summary.exportedSuccess}/${summary.exportedTotal}`);
    console.log(`Downloaded files: ${summary.downloadedCount}`);
    console.log(`Download transport used: ${summary.transportUsed}`);
    console.log(`Source encoding policy: ${summary.encodingPolicy}`);
    console.log(`Local destination: ${summary.localDestination}`);
    if (summary.importManifestPath) {
      console.log(`Import manifest: ${summary.importManifestPath}`);
    }
    if (summary.transportDiagnostics && summary.transportDiagnostics.strategyRecommendation) {
      console.log(`Recommended transport order: ${summary.transportDiagnostics.strategyRecommendation.join(' -> ')}`);
    }
    if (summary.notes.length > 0) {
      console.log('Notes:');
      for (const note of summary.notes) {
        console.log(`- ${note}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runFetch,
};
