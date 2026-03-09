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

function generateMarkdownReport(context, tokenReport) {
  const summary = context.summary || {};
  const dependencies = context.dependencies || {};
  const sql = context.sql || {};
  const graph = context.graph || {};

  return `# Zeus RPG Analysis Report\n\n## Overview\n- Program: ${context.program}\n- Scanned At: ${context.scannedAt}\n- Source Root: ${context.sourceRoot}\n- Source File Count: ${summary.sourceFileCount || 0}\n- Table Count: ${summary.tableCount || 0}\n- Program Call Count: ${summary.programCallCount || 0}\n- Copy Member Count: ${summary.copyMemberCount || 0}\n- SQL Statement Count: ${summary.sqlStatementCount || 0}\n${summary.text ? `- Summary: ${summary.text}\n` : ''}\n${optimizationSection(tokenReport)}\n## Source Files\n${sectionList(context.sourceFiles)}\n\n## Tables\n${sectionList(dependencies.tables)}\n\n## Program Calls\n${sectionList(dependencies.programCalls)}\n\n## Copy Members\n${sectionList(dependencies.copyMembers)}\n\n## SQL Statements\n${sectionList(sql.statements)}\n\n## Dependency Graph\n- Nodes: ${graph.nodeCount || 0}\n- Edges: ${graph.edgeCount || 0}\n- JSON: ${(graph.files && graph.files.json) || 'dependency-graph.json'}\n- Mermaid: ${(graph.files && graph.files.mermaid) || 'dependency-graph.mmd'}\n- Markdown: ${(graph.files && graph.files.markdown) || 'dependency-graph.md'}\n\n## Architecture\n- See architecture-report.md for a full architecture overview.\n\n## Next Steps\n- Validate detected dependencies with the application design and naming standards.\n- Use context.json as the canonical AI input and generated prompts for deeper analysis.\n- Enrich with DB metadata when available to improve table-level reasoning.\n`;
}

module.exports = {
  generateMarkdownReport,
};
