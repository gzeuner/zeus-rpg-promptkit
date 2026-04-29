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
const { discoverFetchedSources } = require('../workspace/workCopyService');
const { buildWorkCopyTargetName } = require('../workspace/workCopyService');

function normalizeMember(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveDiffPaths({
  member,
  fetchRoot,
  workspaceRoot,
  workCopyMode,
}) {
  const normalizedMember = normalizeMember(member);
  const discovered = discoverFetchedSources(fetchRoot);
  const original = discovered.find((entry) => entry.member === normalizedMember);
  if (!original) {
    throw new Error(`No fetched source found for member "${normalizedMember}" under ${path.resolve(fetchRoot)}.`);
  }

  const candidateNames = Array.from(new Set([
    buildWorkCopyTargetName(original, workCopyMode),
    `${original.member}${original.extension}`,
  ]));
  const modifiedPath = candidateNames
    .map((fileName) => path.join(workspaceRoot, fileName))
    .find((candidate) => fs.existsSync(candidate));

  if (!modifiedPath) {
    throw new Error(`No workspace copy found for member "${normalizedMember}" under ${path.resolve(workspaceRoot)}.`);
  }

  return {
    member: normalizedMember,
    originalPath: original.sourcePath,
    modifiedPath,
  };
}

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function buildLineComparison(originalLines, modifiedLines) {
  const maxLines = Math.max(originalLines.length, modifiedLines.length);
  const rows = [];
  let changedCount = 0;

  for (let index = 0; index < maxLines; index += 1) {
    const original = originalLines[index];
    const modified = modifiedLines[index];
    let marker = ' ';
    if (original === undefined) {
      marker = '+';
      changedCount += 1;
    } else if (modified === undefined) {
      marker = '-';
      changedCount += 1;
    } else if (original !== modified) {
      marker = '~';
      changedCount += 1;
    }
    rows.push({
      line: index + 1,
      marker,
      original: original === undefined ? '' : original,
      modified: modified === undefined ? '' : modified,
    });
  }

  return {
    rows,
    changedCount,
  };
}

module.exports = {
  buildLineComparison,
  readLines,
  resolveDiffPaths,
};
