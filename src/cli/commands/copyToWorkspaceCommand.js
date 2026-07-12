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
const { renderAsciiTable } = require('../helpers/asciiTable');
const { createJsonOutput } = require('../helpers/jsonOutput');
const { executeCopyToWorkspace } = require('../../core/workCopyService');

async function runCopyToWorkspace(args) {
  let execution;
  try {
    execution = executeCopyToWorkspace(args);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const { result } = execution;

  console.log(
    renderAsciiTable(
      ['Status', 'Member', 'Source', 'Target', 'Note'],
      result.results.map(entry => [
        entry.status,
        entry.member,
        entry.source,
        entry.target,
        entry.note,
      ])
    )
  );
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
