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

async function runDocsGenerateCatalog(args) {
  const output = args.output ? String(args.output).trim() : 'docs/tool-catalog.md';
  const format = args.format ? String(args.format).trim().toLowerCase() : 'markdown';

  if (!['markdown', 'json'].includes(format)) {
    throw new Error('Invalid --format value. Use markdown or json.');
  }

  console.log('docs:generate-catalog is currently a scaffold command.');
  console.log(`Requested format: ${format}`);
  console.log(`Requested output: ${output}`);
  console.log('Next step: implement generator in src/docs/toolCatalogGenerator.js and wire metadata-based emission.');
}

module.exports = {
  runDocsGenerateCatalog,
};
