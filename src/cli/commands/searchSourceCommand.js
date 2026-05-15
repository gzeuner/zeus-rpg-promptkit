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
'use strict';

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

/**
 * search-source command
 *
 * Searches locally fetched IBM i source members for keywords or patterns.
 * Useful after `zeus fetch` to find member references, table names, program calls, etc.
 *
 * Usage:
 *   zeus search-source --search-term "SELECT * FROM" --source-root ./analysis/zeus-fetch
 *   zeus search-source --member PROGRAM_001 --source-root ./analysis/zeus-fetch
 *   zeus search-source --table "TABLE_A" --source-root ./analysis/zeus-fetch --case-sensitive
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runSearchSource(args) {
  if (!args['source-root']) {
    console.error('Missing required option: --source-root <path>');
    process.exit(2);
  }

  const sourceRoot = path.resolve(String(args['source-root']).trim());
  if (!fs.existsSync(sourceRoot)) {
    console.error(`Source root not found: ${sourceRoot}`);
    process.exit(2);
  }

  // Collect search criteria
  const searchTerm = args['search-term'];
  const member = args.member;
  const table = args.table;
  const caseSensitive = args['case-sensitive'] === true || args['case-sensitive'] === 'true';
  const maxResults = parseInt(args['max-results'] || '100', 10);
  const filePattern = args['file-pattern'] || '*.{rpgle,rpg,clle,sql,dds,bnd}';

  if (!searchTerm && !member && !table) {
    console.error('Provide at least one search criterion: --search-term, --member, or --table');
    process.exit(2);
  }

  // Build regex from criteria
  let regex;
  if (member) {
    // Search for exact member name (anywhere in file or as member name in metadata)
    const escapedMember = escapeRegex(member.toUpperCase());
    regex = caseSensitive
      ? new RegExp(`(^|[^A-Z0-9_])${escapedMember}([^A-Z0-9_]|$)|// Member: ${escapedMember}|Member: ${escapedMember}`)
      : new RegExp(`(^|[^A-Z0-9_])${escapedMember.toLowerCase()}([^A-Z0-9_]|$)|// Member: ${escapedMember.toLowerCase()}|Member: ${escapedMember.toLowerCase()}`, 'i');
  } else if (table) {
    const escapedTable = escapeRegex(table.toUpperCase());
    regex = caseSensitive
      ? new RegExp(`(FROM|INTO|UPDATE|DELETE FROM|JOIN)\\s+${escapedTable}`, 'i')
      : new RegExp(`(FROM|INTO|UPDATE|DELETE FROM|JOIN)\\s+${escapedTable}`, 'i');
  } else if (searchTerm) {
    regex = caseSensitive
      ? new RegExp(searchTerm)
      : new RegExp(searchTerm, 'i');
  }

  // Find all source files
  let files;
  try {
    files = await glob(filePattern, {
      cwd: sourceRoot,
      absolute: false,
      nodir: true,
      maxDepth: 10,
    });
  } catch (err) {
    console.error(`Glob search failed: ${err.message}`);
    process.exit(2);
  }

  if (files.length === 0) {
    console.log(`No source files found matching pattern: ${filePattern}`);
    return;
  }

  // Search each file
  const results = [];
  for (const file of files) {
    const filePath = path.join(sourceRoot, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, lineNum) => {
        if (regex.test(line) && results.length < maxResults) {
          results.push({
            file,
            lineNumber: lineNum + 1,
            line: line.substring(0, 100), // truncate for display
          });
        }
      });
    } catch (err) {
      if (args.verbose) {
        console.warn(`Warning: Cannot read ${file}: ${err.message}`);
      }
    }
  }

  // Output
  if (results.length === 0) {
    console.log('No matches found.');
    return;
  }

  console.log(`Found ${results.length} matches (max ${maxResults}):`);
  console.log('');

  const grouped = {};
  results.forEach(r => {
    if (!grouped[r.file]) {
      grouped[r.file] = [];
    }
    grouped[r.file].push(r);
  });

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
