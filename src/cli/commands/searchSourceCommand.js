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
'use strict';

const {
  executeSearchSource,
  groupResultsByFile,
} = require('../../core/searchSourceService');

async function runSearchSource(args) {
  let execution;
  try {
    execution = await executeSearchSource(args, {
      onWarning: (message) => {
        console.warn(`Warning: ${message}`);
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  if (execution.noSourceFiles) {
    console.log(`No source files found matching pattern: ${execution.filePattern}`);
    return;
  }

  const { maxResults, results } = execution;
  if (results.length === 0) {
    console.log('No matches found.');
    return;
  }

  console.log(`Found ${results.length} matches (max ${maxResults}):`);
  console.log('');

  const grouped = groupResultsByFile(results);

  Object.keys(grouped).sort().forEach(file => {
    console.log(`  ${file}`);
    grouped[file].forEach(r => {
      console.log(`    Line ${String(r.lineNumber).padStart(4, ' ')}: ${r.line}`);
    });
    console.log('');
  });

  if (results.length >= maxResults) {
    console.log(`(showing first ${maxResults} results; use --max-results <n> to increase)`);
  }
}

module.exports = { runSearchSource };
