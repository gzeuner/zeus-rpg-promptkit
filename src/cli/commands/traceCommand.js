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
 * zeus trace — Data / value lineage across programs and tables.
 *
 * Reuses:
 *   - field-search local/remote logic for finding value mentions
 *   - crossProgramGraph from analyze artifacts or light build
 *   - catalog queries for remote references
 *
 * Usage (neutral):
 *   zeus trace --value <VAL> --start-table <TBL> [--profile <p>] [--source <dir>] [--json]
 *   zeus trace --field <FIELD> --start-program <PGM> ...
 */

const fs = require('fs');
const path = require('path');
const {
  loadProfiles,
  resolveProfile,
  resolveAnalyzeConfig,
  resolveAnalyzeDbConfig,
} = require('../../config/runtimeConfig');
const { runReadOnlyDb2Query } = require('../../db2/readOnlyQueryService');
const { createJsonOutput } = require('../helpers/jsonOutput');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { buildCrossProgramGraph } = require('../../dependency/crossProgramGraphBuilder');

// Fallback simple local value search if not using full field search
function findValueMentions(sourceRoot, value, maxResults = 50) {
  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return { matches: [], count: 0 };
  }
  const matches = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/\.(rpgle|sqlrpgle|clle|clp|dds|sql)$/i.test(e.name)) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            if (line.toUpperCase().includes(String(value).toUpperCase())) {
              matches.push({
                file: path.relative(sourceRoot, full),
                line: idx + 1,
                snippet: line.trim().substring(0, 80),
              });
            }
          });
        } catch (_) {}
      }
      if (matches.length >= maxResults) return;
    }
  };
  walk(sourceRoot);
  return { matches: matches.slice(0, maxResults), count: matches.length };
}

async function runTrace(args) {
  // Route through capability (package 08) - guard _cap to prevent recursion when cap delegates back to run
  if (!args || !args._cap) {
    try {
      const { capabilities } = require('../../api/zeusApi');
      const res = capabilities && typeof capabilities.execute === 'function' ? await capabilities.execute('investigation.trace', { cwd: process.cwd(), env: process.env, args }, args) : null;
      if (res && res.ok) {
        return res.result;
      }
    } catch (e) {
      // fallthrough
    }
  }
  if (args && args._cap) { delete args._cap; }

  const value = args.value ? String(args.value).trim().toUpperCase() : null;
  const field = args.field ? String(args.field).trim().toUpperCase() : null;
  const startTable = args['start-table'] || args.table ? String(args['start-table'] || args.table).trim().toUpperCase() : null;
  const startProgram = args['start-program'] || args.program ? String(args['start-program'] || args.program).trim().toUpperCase() : null;

  if (!value && !field) {
    console.error('Missing required option: --value <VAL> or --field <FIELD>');
    process.exit(2);
  }

  const target = value || field;
  console.log(`Zeus Trace — ${value ? 'Value' : 'Field'}: "${target}"${startTable ? ` | Start-Table: ${startTable}` : ''}${startProgram ? ` | Start-Program: ${startProgram}` : ''}`);

  let profile = null;
  let analyzeConfig = null;
  try {
    const profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args });
    profile = resolveProfile(profiles, args.profile, { env: process.env });
    analyzeConfig = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
  } catch (e) {
    console.warn('Profile load warning:', e.message);
  }

  const sourceRoot = args.source
    ? path.resolve(process.cwd(), args.source)
    : (profile && profile.sourceRoot ? path.resolve(process.cwd(), profile.sourceRoot) : null);

  const outputRoot = (analyzeConfig && analyzeConfig.outputRoot)
    ? path.resolve(process.cwd(), analyzeConfig.outputRoot)
    : path.join(process.cwd(), 'output');

  const results = {
    target,
    startTable,
    startProgram,
    localMentions: [],
    graphPaths: [],
    catalogRefs: [],
    artifactsUsed: false,
  };

  // Try loading from previous analyze artifacts for richer data
  let crossProgramGraph = null;
  if (startProgram) {
    const graphJson = path.join(outputRoot, startProgram, 'program-call-tree.json');
    if (fs.existsSync(graphJson)) {
      try {
        crossProgramGraph = JSON.parse(fs.readFileSync(graphJson, 'utf8'));
        results.artifactsUsed = true;
        console.log(`[Artifacts] Loaded cross-program graph from ${graphJson}`);
      } catch (e) {}
    }
  }

  // Local mentions via simple search
  if (sourceRoot) {
    console.log(`\n[Local] Searching sources under ${sourceRoot}...`);
    const local = findValueMentions(sourceRoot, target);
    results.localMentions = local.matches;
    console.log(`  Found ${local.count} mention(s) in source.`);
    if (local.matches.length > 0) {
      console.log(renderAsciiTable(['file', 'line', 'snippet'], local.matches.map(m => [m.file, m.line, m.snippet]), { maxCellWidth: 50 }));
    }
  } else {
    console.log('\n[Local] No source root — skipped.');
  }

  // Cross program graph / lineage paths
  if (crossProgramGraph || (sourceRoot && startProgram)) {
    console.log(`\n[Graph] Lineage paths${crossProgramGraph ? ' (from artifacts)' : ''}...`);
    try {
      if (!crossProgramGraph && sourceRoot && startProgram) {
        crossProgramGraph = buildCrossProgramGraph({
          rootProgram: startProgram,
          sourceRoot,
          limits: analyzeConfig && analyzeConfig.analysisLimits,
        });
      }
      const nodes = crossProgramGraph.nodes || [];
      const edges = crossProgramGraph.edges || [];
      const relevantNodes = nodes.filter(n =>
        String(n.label || n.id || '').toUpperCase().includes(target) ||
        (startTable && String(n.label || '').toUpperCase() === startTable)
      );
      results.graphPaths = relevantNodes.slice(0, 30);
      console.log(`  Graph: ${crossProgramGraph.summary ? crossProgramGraph.summary.programCount : nodes.length} programs, edges: ${edges.length}`);
      if (relevantNodes.length) {
        console.log('  Nodes related to target:');
        relevantNodes.forEach(n => console.log(`    ${n.type || 'NODE'}: ${n.label || n.id}`));
        // Simple lineage hint via edges
        const relatedEdges = edges.filter(e => relevantNodes.some(n => n.id === e.from || n.id === e.to));
        if (relatedEdges.length) {
          console.log('  Related connections (lineage hints):');
          relatedEdges.slice(0, 10).forEach(e => console.log(`    ${e.from} -> ${e.to} (${e.type})`));
        }
      }
    } catch (e) {
      console.log('  Graph processing skipped:', e.message);
    }
  }

  // Remote catalog for value/table references (if profile has DB)
  const dbConfig = profile ? resolveAnalyzeDbConfig(analyzeConfig || {}, 'metadata') : null;
  if (dbConfig && dbConfig.host && startTable) {
    console.log(`\n[Catalog] Searching references for table ${startTable}...`);
    try {
      const sql = `
        SELECT DEPOBJ AS REFERENCING_OBJECT, DEPLIB AS LIBRARY, DEPTPYE AS TYPE
        FROM QSYS2.SYSDEPEND
        WHERE DEPPGM = '${startTable}'
        FETCH FIRST 20 ROWS ONLY
      `;
      const qres = runReadOnlyDb2Query({ dbConfig, query: sql, maxRows: 20 });
      results.catalogRefs = qres.rows || [];
      if (results.catalogRefs.length) {
        console.log(renderAsciiTable(qres.columns || ['REFERENCING_OBJECT'], results.catalogRefs));
      } else {
        console.log('  No catalog references found.');
      }
    } catch (e) {
      console.log('  Catalog query skipped:', e.message);
    }
  }

  if (args.json) {
    const json = createJsonOutput({ output: 'json' });
    json.print(results);
  } else {
    console.log('\nTrace summary complete. Use --json for machine readable output.');
    console.log('Tip: Run full "analyze" first for richer graph data, then trace can use artifacts in future versions.');
  }
}

module.exports = {
  runTrace,
};