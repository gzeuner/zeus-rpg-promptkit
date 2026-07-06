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
const { scanSourceFiles } = require('../../scanner/rpgScanner');
const { validateEmbeddedSql } = require('../../validator/sqlRpgValidator');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const { buildCanonicalAnalysisModel } = require('../../context/canonicalAnalysisModel');
const { createJsonOutput } = require('../helpers/jsonOutput');

function normalizeFormat(value) {
  const format = String(value || 'markdown').trim().toLowerCase();
  if (!['markdown', 'json'].includes(format)) {
    throw new Error('Invalid option: --format must be markdown or json');
  }
  return format;
}

function resolveInputPath(args, cwd) {
  const raw = args.input || args['input'];
  if (!raw) return null;
  return path.resolve(cwd, String(raw).trim());
}

function loadCanonicalAnalysis(inputPath) {
  if (!inputPath) return null;
  const stats = fs.existsSync(inputPath) ? fs.statSync(inputPath) : null;
  if (!stats) throw new Error(`Input path not found: ${inputPath}`);
  const canonicalPath = stats.isDirectory()
    ? path.join(inputPath, 'canonical-analysis.json')
    : inputPath;
  if (!fs.existsSync(canonicalPath)) {
    throw new Error(`canonical-analysis.json not found at: ${canonicalPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid canonical analysis payload.');
  return parsed;
}

function collectSqlValidationFromCanonical(canonicalAnalysis) {
  if (!canonicalAnalysis) return { errors: [], warnings: [], statements: [] };
  const sqlBlock = (canonicalAnalysis.enrichments && canonicalAnalysis.enrichments.sql) || {};
  const validation = sqlBlock.validation || { errors: [], warnings: [] };
  const statements = (sqlBlock.statements || canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements || []).map(s => ({
    ...s,
    validationErrors: s.validationErrors || [],
  }));
  return {
    errors: validation.errors || [],
    warnings: validation.warnings || [],
    statements,
  };
}

function renderMarkdownReport(program, validationData, sourceInfo) {
  const { errors, warnings, statements } = validationData;
  let md = `# RPG SQL Validation Report\n\n`;
  md += `**Program:** ${program || 'N/A'}\n`;
  if (sourceInfo) md += `**Source:** ${sourceInfo}\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;

  md += `## Summary\n`;
  md += `- Validation Errors: ${errors.length}\n`;
  md += `- Validation Warnings: ${warnings.length}\n`;
  md += `- SQL Statements Analyzed: ${statements.length}\n\n`;

  if (errors.length > 0) {
    md += `## Errors\n`;
    errors.forEach((err, i) => {
      md += `### ${i + 1}. ${err.code || 'ERROR'}\n`;
      md += `${err.message || JSON.stringify(err)}\n`;
      if (err.cursor) md += `- Cursor: ${err.cursor}\n`;
      if (err.selectColumns != null && err.intoVariables != null) {
        md += `- Columns: ${err.selectColumns} vs INTO vars: ${err.intoVariables}\n`;
      }
      md += `\n`;
    });
  } else {
    md += `## Errors\nNo SQL validation errors detected.\n\n`;
  }

  if (warnings.length > 0) {
    md += `## Warnings\n`;
    warnings.forEach((w, i) => {
      md += `- ${w.code || 'WARN'}: ${w.message || JSON.stringify(w)}\n`;
    });
    md += `\n`;
  }

  // Include any per-statement errors from scan
  const stmtErrors = statements.filter(s => (s.validationErrors || []).length > 0);
  if (stmtErrors.length > 0) {
    md += `## Per-Statement Issues\n`;
    stmtErrors.forEach(stmt => {
      md += `- **${stmt.type}** (line ~${(stmt.evidence && stmt.evidence[0] && stmt.evidence[0].line) || '?'}): ${stmt.text ? stmt.text.slice(0, 80) : ''}\n`;
      (stmt.validationErrors || []).forEach(e => {
        md += `  - ${e.code}: ${e.message}\n`;
      });
    });
  }

  md += `\n> Evidence-first SQL validation for RPG. Cursor column counts, dynamic SQL, and host variable usage are checked.\n`;
  return md;
}

async function runValidateRpgSql(args = {}, config = {}) {
  const verbose = Boolean(args.verbose);
  const cwd = process.cwd();
  const format = normalizeFormat(args.format);

  let program = args.program ? String(args.program).trim().toUpperCase() : null;
  let sourceRoot = args.source ? path.resolve(cwd, String(args.source).trim()) : null;
  const inputPath = resolveInputPath(args, cwd);
  const outRoot = args.out ? path.resolve(cwd, String(args.out)) : null;

  let validationData = { errors: [], warnings: [], statements: [] };
  let sourceInfo = null;

  if (inputPath) {
    const canonical = loadCanonicalAnalysis(inputPath);
    validationData = collectSqlValidationFromCanonical(canonical);
    sourceInfo = inputPath;
    if (!program && canonical.rootProgram) program = canonical.rootProgram;
  } else if (sourceRoot) {
    // Direct scan mode for validation
    if (!fs.existsSync(sourceRoot)) {
      throw new Error(`Source root not found: ${sourceRoot}`);
    }
    if (verbose) console.log(`[verbose] Scanning ${sourceRoot} for SQL validation...`);

    // Collect relevant files (simple glob for .rpgle / .sqlrpgle)
    const allFiles = [];
    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(rpgle|sqlrpgle|rpg)$/i.test(e.name)) allFiles.push(p);
      }
    }
    walk(sourceRoot);

    if (allFiles.length === 0) {
      console.error('No RPG source files found for validation.');
      process.exit(2);
    }

    let filesToScan = allFiles;

    // Dedicated --program filtering in scan mode
    if (program) {
      const progUpper = program.toUpperCase();
      const matching = allFiles.filter((f) => {
        const base = path.basename(f, path.extname(f)).toUpperCase();
        return base === progUpper;
      });
      if (matching.length > 0) {
        filesToScan = matching;
        if (verbose) console.log(`[verbose] Program filter: found ${filesToScan.length} file(s) matching ${progUpper}`);
      } else if (verbose) {
        console.log(`[verbose] No exact file match for program ${progUpper} (basename), scanning all ${allFiles.length} files`);
      }
    }

    const scanSummary = scanSourceFiles(filesToScan);
    const sqlStmts = scanSummary.sqlStatements || [];

    // Run validator
    const val = validateEmbeddedSql(sqlStmts);
    validationData = {
      errors: val.validationErrors || [],
      warnings: val.validationWarnings || [],
      statements: sqlStmts,
    };
    sourceInfo = sourceRoot;

    if (!program) program = 'SCAN';
  } else {
    console.error('Missing required input: provide --input <analyze-output> or --source <dir> [--program <name>]');
    process.exit(2);
  }

  const report = {
    program: program || 'UNKNOWN',
    source: sourceInfo,
    format,
    generatedAt: new Date().toISOString(),
    validation: validationData,
    summary: {
      errorCount: validationData.errors.length,
      warningCount: validationData.warnings.length,
      statementCount: validationData.statements.length,
    },
  };

  // Render
  const json = createJsonOutput({ format });
  let output;
  if (format === 'json') {
    output = json.stringify(report) || `${JSON.stringify(report, null, 2)}\n`;
  } else {
    output = renderMarkdownReport(program, validationData, sourceInfo);
  }

  // Print to stdout
  console.log(output);

  // Optionally write artifacts
  if (outRoot || inputPath) {
    const targetDir = outRoot || (inputPath ? (fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath)) : cwd);
    const base = program ? `${program}-sql-validation` : 'sql-validation';
    fs.mkdirSync(targetDir, { recursive: true });

    const jsonPath = path.join(targetDir, `${base}.json`);
    json.writeFile(jsonPath, report);

    if (format !== 'json') {
      const mdPath = path.join(targetDir, `${base}.md`);
      fs.writeFileSync(mdPath, output, 'utf8');
    }

    if (verbose) {
      console.error(`[verbose] Wrote validation report to ${targetDir}`);
    }
  }

  return {
    program,
    source: sourceInfo,
    errorCount: validationData.errors.length,
    warningCount: validationData.warnings.length,
    outputPath: outRoot || null,
  };
}

module.exports = {
  runValidateRpgSql,
  run: runValidateRpgSql,
  normalizeFormat,
  loadCanonicalAnalysis,
};
