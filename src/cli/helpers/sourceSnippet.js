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
const fs = require('fs');
const path = require('path');

function pickSourceSnippet(sourceFiles, programName, options = {}) {
  if (!sourceFiles || sourceFiles.length === 0) {
    return 'No source files were found.';
  }

  const resolvedRoot = options.sourceRoot ? path.resolve(options.sourceRoot) : null;
  const normalizedSourceTextByRelativePath = options.normalizedSourceTextByRelativePath instanceof Map
    ? options.normalizedSourceTextByRelativePath
    : null;
  const paths = sourceFiles.map((entry) => (typeof entry === 'string' ? entry : entry.path)).filter(Boolean);
  if (paths.length === 0) {
    return 'No source files were found.';
  }

  const normalizedProgram = String(programName || '').toLowerCase();
  const preferred = paths.find((file) => {
    const base = path.basename(file).toLowerCase();
    return base.startsWith(normalizedProgram);
  }) || paths[0];

  const relativePath = resolvedRoot ? path.relative(resolvedRoot, preferred).replace(/\\/g, '/') : null;
  const content = relativePath && normalizedSourceTextByRelativePath && normalizedSourceTextByRelativePath.has(relativePath)
    ? normalizedSourceTextByRelativePath.get(relativePath)
    : fs.readFileSync(preferred, 'utf8');
  return content.split(/\r?\n/).slice(0, 120).join('\n');
}

module.exports = {
  pickSourceSnippet,
};
