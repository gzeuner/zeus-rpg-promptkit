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
const { collectSourceFiles } = require('../../collector/sourceCollector');
const { buildSourceCatalog, normalizeName } = require('../../source/sourceCatalog');
const { resolveProgram } = require('../../dependency/programSourceResolver');

function resolveMemberProgram({ member, sourceRoot, extensions }) {
  const normalizedMember = normalizeName(member);
  if (!normalizedMember) {
    throw new Error('Missing required option: --member <name>');
  }

  const resolvedSourceRoot = path.resolve(sourceRoot);
  if (!fs.existsSync(resolvedSourceRoot)) {
    throw new Error(`Source directory not found: ${resolvedSourceRoot}. Provide a valid --source path.`);
  }

  const sourceFiles = collectSourceFiles(resolvedSourceRoot, extensions);
  const catalog = buildSourceCatalog({
    sourceRoot: resolvedSourceRoot,
    sourceFiles,
  });
  const resolved = resolveProgram(normalizedMember, catalog);

  if (!resolved) {
    throw new Error(`Member "${normalizedMember}" not found under ${resolvedSourceRoot}.`);
  }
  if (resolved.ambiguous) {
    throw new Error(resolved.warning || `Member "${normalizedMember}" is ambiguous.`);
  }

  return {
    program: normalizedMember,
    sourceRoot: resolvedSourceRoot,
    sourcePath: resolved.path,
    catalog,
  };
}

module.exports = {
  resolveMemberProgram,
};
