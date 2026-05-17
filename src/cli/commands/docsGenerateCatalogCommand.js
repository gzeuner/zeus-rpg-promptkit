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

const { generateToolCatalog } = require('../../docs/toolCatalogGenerator');

async function runDocsGenerateCatalog(args) {
  const format = args.format ? String(args.format).trim().toLowerCase() : 'markdown';

  if (!['markdown', 'json'].includes(format)) {
    throw new Error('Invalid --format value. Use markdown or json.');
  }

  if (format === 'json') {
    const jsonOutput = args.output ? String(args.output).trim() : 'docs/tool-catalog.json';
    const result = generateToolCatalog({
      repoRoot: process.cwd(),
      markdownOutputPath: 'docs/tool-catalog.md',
      jsonOutputPath: jsonOutput,
    });
    console.log(`Tool catalog markdown written to: ${result.markdownPath}`);
    console.log(`Tool catalog json written to: ${result.jsonPath}`);
    console.log(`Commands exported: ${result.commandCount}`);
    console.log(`Workflow presets exported: ${result.presetCount}`);
    return;
  }

  const markdownOutput = args.output ? String(args.output).trim() : 'docs/tool-catalog.md';
  const result = generateToolCatalog({
    repoRoot: process.cwd(),
    markdownOutputPath: markdownOutput,
    jsonOutputPath: null,
  });
  console.log(`Tool catalog markdown written to: ${result.markdownPath}`);
  console.log(`Commands exported: ${result.commandCount}`);
  console.log(`Workflow presets exported: ${result.presetCount}`);
}

module.exports = {
  runDocsGenerateCatalog,
};
