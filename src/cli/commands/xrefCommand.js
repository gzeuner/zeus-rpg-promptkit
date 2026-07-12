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

/**
 * zeus xref — Fast who-calls / who-uses cross-reference.
 *
 * Prefers IBM i catalogs (fast, precise) over full source grep.
 * Reuses:
 *   - fieldXrefService for table xref
 *   - catalog queries (PROGRAM_INFO, SYSDEPEND, etc.)
 *   - crossProgramGraph if available
 *
 * Usage:
 *   zeus xref --program <NAME> [--profile <p>] [--json]
 *   zeus xref --table <NAME> [--profile <p>] [--json]
 *   zeus xref --field <F> --table <T> ...
 */

const {
  loadProfiles,
  resolveProfile,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
} = require('../../config/runtimeConfig');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
const { createJsonOutput } = require('../helpers/jsonOutput');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { searchFileXrefViaSql } = require('../../investigation/fieldXrefService');

async function runXref(args) {
  // Route through capability (package 08) - guard _cap to prevent recursion when cap delegates
  if (!args || !args._cap) {
    try {
      const { capabilities } = require('../../api/zeusApi');
      const res = capabilities && typeof capabilities.execute === 'function' ? await capabilities.execute('investigation.xref', { cwd: process.cwd(), env: process.env, args }, args) : null;
      if (res && res.ok) {
        return res.result;
      }
    } catch (e) {
      // fallthrough
    }
  }
  if (args && args._cap) { delete args._cap; }

  const program = args.program ? String(args.program).trim().toUpperCase() : null;
  const table = args.table ? String(args.table).trim().toUpperCase() : null;
  const field = args.field ? String(args.field).trim().toUpperCase() : null;

  if (!program && !table) {
    console.error('Missing required option: --program <NAME> or --table <NAME>');
    process.exit(2);
  }

  console.log(`Zeus Xref — ${program ? 'Program: ' + program : ''}${table ? 'Table: ' + table : ''}${field ? ' | Field: ' + field : ''}`);

  let profile;
  let analyzeConfig;
  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    profile = resolveProfile(profiles, args.profile, { env: process.env });
    analyzeConfig = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
  } catch (e) {
    console.warn('Profile warning:', e.message);
  }

  const dbConfig = resolveAnalyzeDbConfig(analyzeConfig || {}, 'metadata') || (profile ? resolveAnalyzeDbConfig({ db: profile.db }, 'metadata') : null);
  const hasDb = dbConfig && dbConfig.host && dbConfig.user && dbConfig.password;

  const results = { target: program || table, type: program ? 'program' : 'table', refs: [] };

  if (hasDb) {
    if (table) {
      console.log(`\n[Catalog] Table xref for ${table}...`);
      try {
        const dbConfigForXref = dbConfig;
        const queryFn = async (sql, maxRows) => {
          const raw = runReadOnlyDb2Query({ dbConfig: dbConfigForXref, query: sql, maxRows: maxRows || 100 });
          return { rows: raw.rows || [], columns: raw.columns || [] };
        };
        const xrefRes = await searchFileXrefViaSql({ runQuery: queryFn, table, schema: null });
        results.refs = xrefRes.matches || [];
        if (results.refs.length) {
          console.log(renderAsciiTable(xrefRes.columns || ['REFERENCING'], results.refs));
        } else if (xrefRes.error) {
          console.log('Xref catalog note:', xrefRes.error);
        } else {
          console.log('No references found in catalog.');
        }
      } catch (e) {
        console.log('Catalog xref error:', e.message);
      }
    }

    if (program) {
      console.log(`\n[Catalog] Who-calls/uses for program ${program}...`);
      try {
        const sql = `
          SELECT DEPPGM AS REFERENCED_BY, DEPLIB AS LIB, DEPTPYE AS TYPE
          FROM QSYS2.SYSDEPEND
          WHERE DEPOBJ = '${program}'
          ORDER BY DEPPGM
          FETCH FIRST 100 ROWS ONLY
        `;
        const q = runReadOnlyDb2Query({ dbConfig, query: sql, maxRows: 100 });
        results.refs = q.rows || [];
        if (results.refs.length) {
          console.log(renderAsciiTable(['REFERENCED_BY', 'LIB', 'TYPE'], results.refs.map(r => [r.REFERENCED_BY, r.LIB, r.TYPE])));
        } else {
          console.log('No references found via catalog.');
        }
      } catch (e) {
        console.log('Catalog error:', e.message);
      }
    }
  } else {
    console.log('\n[Catalog] No DB config — using local/graph only (run with profile for catalogs).');
  }

  // If source available, could fall back to field-search xref, but for now note it.
  if (args.source || (profile && profile.sourceRoot)) {
    console.log('\n[Source] For deeper local xref use "field-search --mode xref --table ..." or full analyze.');
  }

  if (args.json) {
    const jsonOut = createJsonOutput({ output: 'json' });
    jsonOut.print(results);
  } else {
    console.log('\nXref complete. --json for structured output.');
  }
}

module.exports = {
  runXref,
};