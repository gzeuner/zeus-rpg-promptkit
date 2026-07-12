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

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

const DEFAULT_SOURCE_FILE_PATTERN =
  '**/*.{rpgle,rpg,sqlrpgle,rpgile,clle,clp,sql,dds,dspf,prtf,pf,lf,bnd,binder,bndsrc,cpy}';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toBoolean(value) {
  return value === true || value === 'true';
}

function parseMaxResults(value) {
  const parsed = Number.parseInt(String(value || '100'), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid option: --max-results must be a positive integer');
  }
  return parsed;
}

function normalizeFilePattern(value) {
  const pattern = String(value || '').trim();
  if (!pattern) {
    return DEFAULT_SOURCE_FILE_PATTERN;
  }
  return pattern.includes('/') ? pattern : `**/${pattern}`;
}

function buildSearchRegex({ searchTerm, member, table, caseSensitive }) {
  if (member) {
    const escapedMember = escapeRegex(String(member).toUpperCase());
    return caseSensitive
      ? new RegExp(
          `(^|[^A-Z0-9_])${escapedMember}([^A-Z0-9_]|$)|// Member: ${escapedMember}|Member: ${escapedMember}`
        )
      : new RegExp(
          `(^|[^A-Z0-9_])${escapedMember.toLowerCase()}([^A-Z0-9_]|$)|// Member: ${escapedMember.toLowerCase()}|Member: ${escapedMember.toLowerCase()}`,
          'i'
        );
  }

  if (table) {
    const escapedTable = escapeRegex(String(table).toUpperCase());
    return new RegExp(`(FROM|INTO|UPDATE|DELETE FROM|JOIN)\\s+${escapedTable}`, 'i');
  }

  if (searchTerm) {
    return caseSensitive ? new RegExp(String(searchTerm)) : new RegExp(String(searchTerm), 'i');
  }

  return null;
}

function groupResultsByFile(results) {
  const grouped = {};
  for (const result of results || []) {
    if (!grouped[result.file]) {
      grouped[result.file] = [];
    }
    grouped[result.file].push(result);
  }
  return grouped;
}

async function executeSearchSource(
  args,
  {
    cwd = process.cwd(),
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
    globFn = glob,
    onWarning = null,
  } = {}
) {
  if (!args['source-root']) {
    throw new Error('Missing required option: --source-root <path>');
  }

  const sourceRoot = path.resolve(cwd, String(args['source-root']).trim());
  if (!existsSync(sourceRoot)) {
    throw new Error(`Source root not found: ${sourceRoot}`);
  }

  const searchTerm = args['search-term'];
  const member = args.member;
  const table = args.table;
  const caseSensitive = toBoolean(args['case-sensitive']);
  const maxResults = parseMaxResults(args['max-results']);
  const filePattern = normalizeFilePattern(args['file-pattern']);

  if (!searchTerm && !member && !table) {
    throw new Error('Provide at least one search criterion: --search-term, --member, or --table');
  }

  const regex = buildSearchRegex({ searchTerm, member, table, caseSensitive });

  let files = [];
  try {
    files = await globFn(filePattern, {
      cwd: sourceRoot,
      absolute: false,
      nodir: true,
      maxDepth: 10,
    });
  } catch (err) {
    throw new Error(`Glob search failed: ${err.message}`);
  }

  if (files.length === 0) {
    return {
      filePattern,
      maxResults,
      noSourceFiles: true,
      results: [],
    };
  }

  const results = [];
  for (const file of files) {
    const filePath = path.join(sourceRoot, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, lineNum) => {
        if (regex.test(line) && results.length < maxResults) {
          results.push({
            file,
            lineNumber: lineNum + 1,
            line: line.substring(0, 100),
          });
        }
      });
    } catch (err) {
      if (toBoolean(args.verbose) && typeof onWarning === 'function') {
        onWarning(`Cannot read ${file}: ${err.message}`);
      }
    }
  }

  return {
    filePattern,
    maxResults,
    noSourceFiles: false,
    results,
  };
}

module.exports = {
  DEFAULT_SOURCE_FILE_PATTERN,
  buildSearchRegex,
  escapeRegex,
  executeSearchSource,
  groupResultsByFile,
  normalizeFilePattern,
  parseMaxResults,
};
