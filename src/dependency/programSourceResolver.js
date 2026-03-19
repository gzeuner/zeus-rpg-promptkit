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
const { buildSourceCatalog, inferMemberName, normalizeName } = require('../source/sourceCatalog');

function normalizeProgramName(value) {
  return normalizeName(value);
}

function toMemberName(filePath) {
  return inferMemberName(filePath);
}

function toSortedUniquePaths(paths) {
  return buildSourceCatalog({ sourceFiles: paths }).entries.map((entry) => entry.path);
}

function buildSourceIndex(sourceFiles, options = {}) {
  return buildSourceCatalog({
    sourceFiles,
    sourceRoot: options.sourceRoot,
    importManifest: options.importManifest,
  });
}

function resolveProgram(programName, sourceIndex) {
  const normalized = normalizeProgramName(programName);
  if (!normalized) return null;

  const matches = sourceIndex && sourceIndex.byMemberName instanceof Map
    ? (sourceIndex.byMemberName.get(normalized) || [])
    : ((sourceIndex && sourceIndex.get && sourceIndex.get(normalized)) || []).map((filePath) => ({
      name: normalized,
      path: filePath,
      identity: `LOCAL:${filePath}`,
      relativePath: filePath,
      sourceLib: '',
      sourceFile: '',
      sourceType: '',
    }));
  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    return {
      name: normalized,
      path: null,
      identity: null,
      ambiguous: true,
      warning: `Ambiguous local sources found for program ${normalized}: ${matches.map((match) => match.identity || match.path).join(', ')}.`,
      matches: matches.map((match) => ({
        identity: match.identity || `LOCAL:${match.path}`,
        path: match.path,
        relativePath: match.relativePath || match.path,
        sourceLib: match.sourceLib || '',
        sourceFile: match.sourceFile || '',
        sourceType: match.sourceType || '',
      })),
      alternatives: [],
    };
  }

  const selectedMatch = matches[0];

  return {
    name: normalized,
    path: selectedMatch.path,
    identity: selectedMatch.identity || `LOCAL:${selectedMatch.path}`,
    relativePath: selectedMatch.relativePath || selectedMatch.path,
    sourceLib: selectedMatch.sourceLib || '',
    sourceFile: selectedMatch.sourceFile || '',
    sourceType: selectedMatch.sourceType || '',
    ambiguous: false,
    warning: null,
    matches: [{
      identity: selectedMatch.identity || `LOCAL:${selectedMatch.path}`,
      path: selectedMatch.path,
      relativePath: selectedMatch.relativePath || selectedMatch.path,
      sourceLib: selectedMatch.sourceLib || '',
      sourceFile: selectedMatch.sourceFile || '',
      sourceType: selectedMatch.sourceType || '',
    }],
    alternatives: [],
  };
}

module.exports = {
  normalizeProgramName,
  buildSourceIndex,
  resolveProgram,
};
