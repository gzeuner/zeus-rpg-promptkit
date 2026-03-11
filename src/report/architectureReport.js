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

function listSection(items, emptyLabel = 'None detected') {
  if (!items || items.length === 0) {
    return `- ${emptyLabel}`;
  }
  return items.map((item) => `- ${item}`).join('\n');
}

function sqlSection(stats, optimizedContext) {
  const lines = [];
  if (!stats || stats.length === 0) {
    lines.push('- None detected');
  } else {
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

function buildOverview(program, tables, calls, copies, sqlStats) {
  const sqlCount = (sqlStats || []).reduce((sum, entry) => sum + entry.count, 0);
  const hasSql = sqlCount > 0;
  return [
    `Program ${program} interacts with ${tables.length} database table${tables.length === 1 ? '' : 's'} and calls ${calls.length} external program${calls.length === 1 ? '' : 's'}.`,
    `The program ${hasSql ? 'contains embedded SQL statements' : 'does not contain embedded SQL statements'} and includes ${copies.length} copy member${copies.length === 1 ? '' : 's'}.`,
  ].join(' ');
}

function first(items, count) {
  return (items || []).slice(0, count);
}

function buildDataFlow(program, tables, calls, sqlStats) {
  const sqlRead = (sqlStats || []).some((entry) => entry.type === 'SELECT');
  const sqlWrite = (sqlStats || []).some((entry) => ['UPDATE', 'INSERT', 'DELETE', 'MERGE'].includes(entry.type));
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

  if (callList.length > 0) {
    parts.push(`invokes external program${callList.length === 1 ? '' : 's'} ${callList.join(', ')}`);
  }

  return `${parts.join(', ')}.`;
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
  const sqlCount = sqlStats.reduce((sum, entry) => sum + entry.count, 0);
  const overview = buildOverview(program, tables, calls, copyMembers, sqlStats);
  const dataFlow = buildDataFlow(program, tables, calls, sqlStats);
  const mermaid = renderMermaidBlock(graph, mermaidText);

  return `# Architecture Report

Program: ${program}

Generated: ${generatedAt}

## Architecture Complexity

- Tables: ${tables.length}
- Programs Called: ${calls.length}
- Copy Members: ${copyMembers.length}
- SQL Statements: ${sqlCount}

## Overview

${overview}

## Program Dependencies

### Called Programs

${listSection(calls)}

## Database Dependencies

### Tables Used

${listSection(tables)}

## Copy Member Dependencies

### Copy Members

${listSection(copyMembers)}

## SQL Activity

${sqlSection(sqlStats, optimizedContext)}

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
