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

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readTextFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function sortUnique(values) {
  return Array.from(new Set((values || []).filter(Boolean).map((value) => String(value).trim().toUpperCase())))
    .sort((a, b) => a.localeCompare(b));
}

function toName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value && value.name) return value.name;
  return '';
}

function collectTables(context) {
  const dependencies = (context && context.dependencies) || {};
  const sql = (context && context.sql) || {};
  const tableNames = (dependencies.tables || []).map((entry) => toName(entry));
  const sqlTableNames = (sql.tableNames || []).map((entry) => toName(entry));
  return sortUnique([...tableNames, ...sqlTableNames]);
}

function collectProgramCalls(context) {
  const dependencies = (context && context.dependencies) || {};
  return sortUnique((dependencies.programCalls || []).map((entry) => toName(entry)));
}

function collectCopyMembers(context) {
  const dependencies = (context && context.dependencies) || {};
  return sortUnique((dependencies.copyMembers || []).map((entry) => toName(entry)));
}

function collectSqlStats(context) {
  const sql = (context && context.sql) || {};
  const counters = new Map();
  for (const statement of sql.statements || []) {
    const type = String(statement && statement.type ? statement.type : 'OTHER').toUpperCase();
    counters.set(type, (counters.get(type) || 0) + 1);
  }
  return Array.from(counters.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function collectSqlSummary(context) {
  const sql = (context && context.sql) || {};
  const summary = sql.summary || {};
  return {
    statementCount: Number(summary.statementCount) || 0,
    readStatementCount: Number(summary.readStatementCount) || 0,
    writeStatementCount: Number(summary.writeStatementCount) || 0,
    dynamicStatementCount: Number(summary.dynamicStatementCount) || 0,
    unresolvedStatementCount: Number(summary.unresolvedStatementCount) || 0,
    cursorStatementCount: Number(summary.cursorStatementCount) || 0,
    hostVariableCount: Number(summary.hostVariableCount) || 0,
    cursorCount: Number(summary.cursorCount) || 0,
  };
}

function collectNativeFileUsage(context) {
  return (context && context.nativeFileUsage) || { summary: {}, files: [] };
}

function collectBindingAnalysis(context) {
  return (context && context.bindingAnalysis) || { summary: {}, modules: [], servicePrograms: [], bindingDirectories: [] };
}

function listSection(items, emptyLabel = 'None detected') {
  if (!items || items.length === 0) {
    return `- ${emptyLabel}`;
  }
  return items.map((item) => `- ${item}`).join('\n');
}

function sqlSection(stats, sqlSummary, optimizedContext) {
  const lines = [];
  if (!stats || stats.length === 0) {
    lines.push('- None detected');
  } else {
    lines.push(`- Read statements: ${sqlSummary.readStatementCount || 0}`);
    lines.push(`- Write statements: ${sqlSummary.writeStatementCount || 0}`);
    lines.push(`- Dynamic statements: ${sqlSummary.dynamicStatementCount || 0}`);
    lines.push(`- Unresolved statements: ${sqlSummary.unresolvedStatementCount || 0}`);
    lines.push(`- Cursor statements: ${sqlSummary.cursorStatementCount || 0}`);
    lines.push(`- Host variables: ${sqlSummary.hostVariableCount || 0}`);
    lines.push(`- Cursors: ${sqlSummary.cursorCount || 0}`);
    lines.push('');
    for (const item of stats) {
      lines.push(`- ${item.type} statements: ${item.count}`);
    }
  }

  const examples = (optimizedContext && optimizedContext.sqlStatements) || [];
  if (examples.length > 0) {
    lines.push('');
    lines.push('Examples');
    for (const statement of examples.slice(0, 3)) {
      const text = String(statement && statement.snippet ? statement.snippet : '').trim();
      if (!text) continue;
      lines.push(`- [${String(statement.type || 'OTHER').toUpperCase()}] ${text}`);
    }
  }

  return lines.join('\n');
}

function buildOverview(program, tables, calls, copies, sqlSummary, nativeFileUsage, bindingAnalysis) {
  const sqlCount = Number(sqlSummary && sqlSummary.statementCount) || 0;
  const hasSql = sqlCount > 0;
  const nativeSummary = (nativeFileUsage && nativeFileUsage.summary) || {};
  const bindingSummary = (bindingAnalysis && bindingAnalysis.summary) || {};
  return [
    `Program ${program} interacts with ${tables.length} database table${tables.length === 1 ? '' : 's'} and calls ${calls.length} external program${calls.length === 1 ? '' : 's'}.`,
    `The program ${hasSql ? `contains embedded SQL statements (${sqlSummary.readStatementCount || 0} read, ${sqlSummary.writeStatementCount || 0} write, ${sqlSummary.dynamicStatementCount || 0} dynamic)` : 'does not contain embedded SQL statements'} and includes ${copies.length} copy member${copies.length === 1 ? '' : 's'}.`,
    `Native file usage covers ${nativeSummary.fileCount || 0} file${(nativeSummary.fileCount || 0) === 1 ? '' : 's'}, including ${nativeSummary.mutatingFileCount || 0} mutating and ${nativeSummary.interactiveFileCount || 0} interactive file${(nativeSummary.interactiveFileCount || 0) === 1 ? '' : 's'}.`,
    `Bind-time modeling covers ${bindingSummary.moduleCount || 0} module${(bindingSummary.moduleCount || 0) === 1 ? '' : 's'}, ${bindingSummary.serviceProgramCount || 0} service program${(bindingSummary.serviceProgramCount || 0) === 1 ? '' : 's'}, and ${bindingSummary.bindingDirectoryCount || 0} binding director${(bindingSummary.bindingDirectoryCount || 0) === 1 ? 'y' : 'ies'}.`,
  ].join(' ');
}

function first(items, count) {
  return (items || []).slice(0, count);
}

function buildDataFlow(program, tables, calls, sqlSummary, nativeFileUsage, bindingAnalysis) {
  const sqlRead = (sqlSummary.readStatementCount || 0) > 0;
  const sqlWrite = (sqlSummary.writeStatementCount || 0) > 0;
  const nativeSummary = (nativeFileUsage && nativeFileUsage.summary) || {};
  const bindingSummary = (bindingAnalysis && bindingAnalysis.summary) || {};
  const tableList = first(tables, 3);
  const callList = first(calls, 2);

  const parts = [];
  if (tableList.length > 0) {
    const verb = sqlRead ? 'reads data from' : 'interacts with';
    parts.push(`${program} ${verb} ${tableList.join(', ')}`);
  } else {
    parts.push(`${program} processes internal logic`);
  }

  if (sqlWrite && tableList.length > 0) {
    parts.push(`updates ${tableList.join(', ')}`);
  }

  if ((sqlSummary.dynamicStatementCount || 0) > 0) {
    parts.push('uses dynamic SQL');
  }

  if (callList.length > 0) {
    parts.push(`invokes external program${callList.length === 1 ? '' : 's'} ${callList.join(', ')}`);
  }

  if ((nativeSummary.interactiveFileCount || 0) > 0) {
    parts.push('performs interactive workstation I/O');
  }

  if ((nativeSummary.mutatingFileCount || 0) > 0) {
    parts.push('updates native files');
  }

  if ((bindingSummary.boundModuleCount || 0) > 0) {
    parts.push('has explicit bind-time dependencies');
  }

  return `${parts.join(', ')}.`;
}

function nativeFileSection(nativeFileUsage) {
  const summary = (nativeFileUsage && nativeFileUsage.summary) || {};
  const files = (nativeFileUsage && nativeFileUsage.files) || [];

  const details = files.length > 0
    ? files.map((file) => {
      const flags = [];
      if (file.kind) flags.push(file.kind);
      if (file.access && file.access.read) flags.push('READ');
      if (file.access && file.access.write) flags.push('WRITE');
      if (file.access && file.access.update) flags.push('UPDATE');
      if (file.access && file.access.delete) flags.push('DELETE');
      if (file.access && file.access.display) flags.push('DISPLAY');
      if (file.keyed) flags.push('KEYED');
      if (file.access && file.access.interactive) flags.push('INTERACTIVE');
      if (file.access && file.access.mutating) flags.push('MUTATING');
      const recordFormats = (file.recordFormats || []).map((entry) => entry.name).join(', ');
      return `- ${file.name}${flags.length ? ` [${flags.join(', ')}]` : ''}${recordFormats ? ` record formats: ${recordFormats}` : ''}`;
    }).join('\n')
    : '- None detected';

  return `- Native Files: ${summary.fileCount || 0}\n- Mutating Files: ${summary.mutatingFileCount || 0}\n- Interactive Files: ${summary.interactiveFileCount || 0}\n- Workstation Files: ${summary.workstationFileCount || 0}\n- Printer Files: ${summary.printerFileCount || 0}\n- Keyed Files: ${summary.keyedFileCount || 0}\n- Record Formats: ${summary.recordFormatCount || 0}\n\n${details}`;
}

function bindingSection(bindingAnalysis) {
  const summary = (bindingAnalysis && bindingAnalysis.summary) || {};
  const modules = (bindingAnalysis && bindingAnalysis.modules) || [];
  const servicePrograms = (bindingAnalysis && bindingAnalysis.servicePrograms) || [];

  const moduleLines = modules.length > 0
    ? modules.map((module) => {
      const parts = [`${module.name} [${module.kind || 'MODULE'}]`];
      if ((module.bindingDirectories || []).length > 0) parts.push(`bnddir: ${module.bindingDirectories.join(', ')}`);
      if ((module.servicePrograms || []).length > 0) parts.push(`srvpgm: ${module.servicePrograms.join(', ')}`);
      if ((module.importedProcedures || []).length > 0) parts.push(`imports: ${module.importedProcedures.join(', ')}`);
      if (module.unresolvedBindings) parts.push('UNRESOLVED');
      return `- ${parts.join(' | ')}`;
    }).join('\n')
    : '- None detected';

  const serviceProgramLines = servicePrograms.length > 0
    ? servicePrograms.map((serviceProgram) => {
      const exports = (serviceProgram.exports || []).map((entry) => `${entry.symbol}${entry.resolved ? '' : ' (unresolved)'}`).join(', ');
      return `- ${serviceProgram.name}${serviceProgram.sourceKind ? ` [${serviceProgram.sourceKind}]` : ''}${exports ? ` exports: ${exports}` : ''}`;
    }).join('\n')
    : '- None detected';

  return `- Modules: ${summary.moduleCount || 0}\n- NoMain Modules: ${summary.noMainModuleCount || 0}\n- Service Programs: ${summary.serviceProgramCount || 0}\n- Binder Sources: ${summary.binderSourceCount || 0}\n- Binding Directories: ${summary.bindingDirectoryCount || 0}\n- Bound Modules: ${summary.boundModuleCount || 0}\n- Unresolved Bindings: ${summary.unresolvedModuleCount || 0}\n- Exported Symbols: ${summary.exportCount || 0}\n\n### Modules\n${moduleLines}\n\n### Service Programs\n${serviceProgramLines}`;
}

function renderMermaidBlock(graph, fallbackText) {
  const content = String(fallbackText || '').trim();
  if (content) {
    return content;
  }

  const lines = ['graph TD'];
  for (const edge of (graph && graph.edges) || []) {
    const from = String(edge.from || '').replace(/^[A-Z]+:/, '');
    const to = String(edge.to || '').replace(/^[A-Z]+:/, '');
    if (from && to) {
      lines.push(`  ${from} --> ${to}`);
    }
  }
  return lines.join('\n');
}

function renderArchitectureReport({ context, graph, optimizedContext, mermaidText }) {
  const program = String((context && context.program) || 'UNKNOWN');
  const generatedAt = new Date().toISOString();
  const tables = collectTables(context);
  const calls = collectProgramCalls(context);
  const copyMembers = collectCopyMembers(context);
  const sqlStats = collectSqlStats(context);
  const sqlSummary = collectSqlSummary(context);
  const nativeFileUsage = collectNativeFileUsage(context);
  const bindingAnalysis = collectBindingAnalysis(context);
  const sqlCount = sqlStats.reduce((sum, entry) => sum + entry.count, 0);
  const overview = buildOverview(program, tables, calls, copyMembers, sqlSummary, nativeFileUsage, bindingAnalysis);
  const dataFlow = buildDataFlow(program, tables, calls, sqlSummary, nativeFileUsage, bindingAnalysis);
  const mermaid = renderMermaidBlock(graph, mermaidText);

  return `# Architecture Report

Program: ${program}

Generated: ${generatedAt}

## Architecture Complexity

- Tables: ${tables.length}
- Programs Called: ${calls.length}
- Copy Members: ${copyMembers.length}
- SQL Statements: ${sqlCount}
- Modules: ${(bindingAnalysis.summary && bindingAnalysis.summary.moduleCount) || 0}
- Service Programs: ${(bindingAnalysis.summary && bindingAnalysis.summary.serviceProgramCount) || 0}
- Binding Directories: ${(bindingAnalysis.summary && bindingAnalysis.summary.bindingDirectoryCount) || 0}

## Overview

${overview}

## Program Dependencies

### Called Programs

${listSection(calls)}

## Database Dependencies

### Tables Used

${listSection(tables)}

## Native File I/O

${nativeFileSection(nativeFileUsage)}

## Binding Analysis

${bindingSection(bindingAnalysis)}

## Copy Member Dependencies

### Copy Members

${listSection(copyMembers)}

## SQL Activity

${sqlSection(sqlStats, sqlSummary, optimizedContext)}

## Dependency Graph

\`\`\`mermaid
${mermaid}
\`\`\`

## Data Flow Overview

${dataFlow}
`;
}

function generateArchitectureReport({
  contextPath,
  graphPath,
  outputPath,
  optimizedContextPath,
  mermaidPath,
}) {
  const context = readJsonFile(contextPath);
  const graph = readJsonFile(graphPath);
  const optimizedContext = readJsonFile(optimizedContextPath);
  const mermaidText = readTextFile(mermaidPath);

  if (!context) {
    throw new Error(`Context file not found: ${contextPath}`);
  }
  if (!graph) {
    throw new Error(`Dependency graph file not found: ${graphPath}`);
  }

  const markdown = renderArchitectureReport({
    context,
    graph,
    optimizedContext,
    mermaidText,
  });

  fs.writeFileSync(outputPath, markdown, 'utf8');
  return markdown;
}

module.exports = {
  generateArchitectureReport,
  renderArchitectureReport,
};
