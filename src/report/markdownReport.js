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
function sectionList(values) {
  if (!values || values.length === 0) {
    return '- None detected';
  }
  return values.map((value) => {
    if (typeof value === 'string') {
      return `- ${value}`;
    }

    if (value && typeof value === 'object') {
      if (value.path) {
        const details = [];
        if (typeof value.sizeBytes === 'number') details.push(`${value.sizeBytes} bytes`);
        if (typeof value.lines === 'number') details.push(`${value.lines} lines`);
        return `- ${value.path}${details.length ? ` (${details.join(', ')})` : ''}`;
      }

      if (value.name && value.kind) {
        return `- ${value.name} (${value.kind})`;
      }

      if (value.name) {
        return `- ${value.name}`;
      }

      if (value.text && value.type) {
        return `- [${value.type}] ${value.text}`;
      }
    }

    return `- ${String(value)}`;
  }).join('\n');
}

function optimizationSection(tokenReport) {
  if (!tokenReport) {
    return '## AI Context Optimization\n- Enabled: false\n';
  }

  const lines = [
    '## AI Context Optimization',
    `- Enabled: ${tokenReport.enabled ? 'true' : 'false'}`,
    `- Context Tokens: ${tokenReport.contextTokens || 0}`,
  ];

  if (tokenReport.enabled) {
    lines.push(`- Optimized Tokens: ${tokenReport.optimizedTokens || 0}`);
    lines.push(`- Reduction: ${tokenReport.reductionPercent || 0}%`);
    lines.push(`- Soft Token Limit: ${tokenReport.softTokenLimit || 0}`);
    if (tokenReport.warning) {
      lines.push('- Warning: optimized context may exceed safe prompt size.');
    }
  }

  return `${lines.join('\n')}\n`;
}

function nativeFileUsageSection(nativeFileUsage) {
  const summary = (nativeFileUsage && nativeFileUsage.summary) || {};
  const files = (nativeFileUsage && nativeFileUsage.files) || [];

  const detailLines = files.length > 0
    ? files.map((file) => {
      const flags = [];
      if (file.kind) flags.push(file.kind);
      if (file.access && file.access.read) flags.push('READ');
      if (file.access && file.access.write) flags.push('WRITE');
      if (file.access && file.access.update) flags.push('UPDATE');
      if (file.access && file.access.delete) flags.push('DELETE');
      if (file.access && file.access.position) flags.push('POSITION');
      if (file.access && file.access.display) flags.push('DISPLAY');
      if (file.keyed) flags.push('KEYED');
      if (file.access && file.access.interactive) flags.push('INTERACTIVE');
      if (file.access && file.access.mutating) flags.push('MUTATING');
      const recordFormats = (file.recordFormats || []).map((entry) => entry.name).join(', ');
      return `- ${file.name}${flags.length ? ` [${flags.join(', ')}]` : ''}${recordFormats ? ` record formats: ${recordFormats}` : ''}`;
    }).join('\n')
    : '- None detected';

  return `## Native File I/O\n- Native Files: ${summary.fileCount || 0}\n- Read-Only Files: ${summary.readOnlyFileCount || 0}\n- Mutating Files: ${summary.mutatingFileCount || 0}\n- Interactive Files: ${summary.interactiveFileCount || 0}\n- Workstation Files: ${summary.workstationFileCount || 0}\n- Printer Files: ${summary.printerFileCount || 0}\n- Keyed Files: ${summary.keyedFileCount || 0}\n- Record Formats: ${summary.recordFormatCount || 0}\n\n${detailLines}\n`;
}

function generateMarkdownReport(context, tokenReport) {
  const summary = context.summary || {};
  const dependencies = context.dependencies || {};
  const sql = context.sql || {};
  const graph = context.graph || {};
  const crossProgramGraph = context.crossProgramGraph || {};
  const procedureAnalysis = context.procedureAnalysis || {};
  const nativeFileUsage = context.nativeFileUsage || {};
  const db2Metadata = context.db2Metadata || {};
  const testData = context.testData || {};
  const unresolvedPrograms = crossProgramGraph.unresolvedPrograms || [];
  const unresolvedText = unresolvedPrograms.length > 0
    ? unresolvedPrograms.join(', ')
    : 'None';
  const db2Section = db2Metadata.status === 'exported'
    ? `## DB2 Metadata\nDB2 metadata was exported for ${db2Metadata.tableCount || 0} tables.\n\nSee:\n- ${db2Metadata.file || 'db2-metadata.json'}\n- ${db2Metadata.markdownFile || 'db2-metadata.md'}\n`
    : `## DB2 Metadata\nDB2 metadata export was skipped because ${db2Metadata.reason || 'no DB2 connection configuration was available'}.\n`;
  const testDataSection = testData.status === 'exported'
    ? `## Test Data Extract\nSample data was extracted for ${testData.tableCount || 0} tables.\n\n- Row Limit per Table: ${testData.rowLimit || 0}\n\nSee:\n- ${testData.file || 'test-data.json'}\n- ${testData.markdownFile || 'test-data.md'}\n`
    : `## Test Data Extract\nTest data extraction was skipped because ${testData.reason || 'no DB2 connection configuration was available'}.\n`;
  const procedureSection = `## Procedure Semantics\n- Procedures: ${(procedureAnalysis.summary && procedureAnalysis.summary.procedureCount) || 0}\n- Prototypes: ${(procedureAnalysis.summary && procedureAnalysis.summary.prototypeCount) || 0}\n- Procedure Calls: ${(procedureAnalysis.summary && procedureAnalysis.summary.procedureCallCount) || 0}\n- Internal Calls: ${(procedureAnalysis.summary && procedureAnalysis.summary.internalCallCount) || 0}\n- External Calls: ${(procedureAnalysis.summary && procedureAnalysis.summary.externalCallCount) || 0}\n- Dynamic Calls: ${(procedureAnalysis.summary && procedureAnalysis.summary.dynamicCallCount) || 0}\n- Unresolved Calls: ${(procedureAnalysis.summary && procedureAnalysis.summary.unresolvedCallCount) || 0}\n`;

  return `# Zeus RPG Analysis Report\n\n## Overview\n- Program: ${context.program}\n- Scanned At: ${context.scannedAt}\n- Source Root: ${context.sourceRoot}\n- Source File Count: ${summary.sourceFileCount || 0}\n- Table Count: ${summary.tableCount || 0}\n- Program Call Count: ${summary.programCallCount || 0}\n- Copy Member Count: ${summary.copyMemberCount || 0}\n- SQL Statement Count: ${summary.sqlStatementCount || 0}\n${summary.text ? `- Summary: ${summary.text}\n` : ''}\n${optimizationSection(tokenReport)}\n## Source Files\n${sectionList(context.sourceFiles)}\n\n## Tables\n${sectionList(dependencies.tables)}\n\n## Program Calls\n${sectionList(dependencies.programCalls)}\n\n## Copy Members\n${sectionList(dependencies.copyMembers)}\n\n${procedureSection}\n${nativeFileUsageSection(nativeFileUsage)}\n## SQL Statements\n${sectionList(sql.statements)}\n\n${db2Section}\n${testDataSection}\n## Dependency Graph\nDependency graph generated for ${context.program}.\n\n- Nodes: ${graph.nodeCount || 0}\n- Edges: ${graph.edgeCount || 0}\n- Tables: ${graph.tableCount || 0}\n- Programs Called: ${graph.programCallCount || 0}\n- Copy Members: ${graph.copyMemberCount || 0}\n\nSee files:\n- ${(graph.files && graph.files.json) || 'dependency-graph.json'}\n- ${(graph.files && graph.files.mermaid) || 'dependency-graph.mmd'}\n- ${(graph.files && graph.files.markdown) || 'dependency-graph.md'}\n\n## Cross Program Dependency Graph\nA recursive program dependency graph was generated for ${context.program}.\n\n- Programs discovered: ${crossProgramGraph.programCount || 0}\n- Unresolved program calls: ${unresolvedPrograms.length}\n- Unresolved list: ${unresolvedText}\n\nSee:\n- ${(crossProgramGraph.files && crossProgramGraph.files.json) || 'program-call-tree.json'}\n- ${(crossProgramGraph.files && crossProgramGraph.files.mermaid) || 'program-call-tree.mmd'}\n- ${(crossProgramGraph.files && crossProgramGraph.files.markdown) || 'program-call-tree.md'}\n\n## Impact Analysis\nImpact analysis can identify affected programs if a component changes.\n\nSee:\n- impact-analysis.json\n- impact-analysis.md\n\n## Interactive Architecture Viewer\nAn interactive architecture visualization has been generated.\n\nOpen:\n- architecture.html\n\nin your browser to explore program dependencies visually.\n\n## Architecture\n- See architecture-report.md for a full architecture overview.\n\n## Next Steps\n- Validate detected dependencies with the application design and naming standards.\n- Use canonical-analysis.json as the semantic source and context.json or optimized-context.json as prompt-ready projections.\n- Enrich with DB metadata and sample test data when available to improve table-level reasoning.\n- Create a portable bundle with \`zeus bundle --program ${context.program}\`.\n`;
}

module.exports = {
  generateMarkdownReport,
};
