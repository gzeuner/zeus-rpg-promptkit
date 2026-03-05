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

function generateMarkdownReport(context) {
  return `# Zeus RPG Analysis Report\n\n## Overview\n- Program: ${context.program}\n- Scanned At: ${context.scannedAt}\n- Source File Count: ${context.sourceFiles.length}\n\n## Source Files\n${sectionList(context.sourceFiles)}\n\n## Tables\n${sectionList(context.tables)}\n\n## Program Calls\n${sectionList(context.calls)}\n\n## Copy Members\n${sectionList(context.copyMembers)}\n\n## SQL Statements\n${sectionList(context.sqlStatements)}\n\n## Next Steps\n- Validate table and call detection against known application design.\n- Enrich table metadata with java/Db2MetadataExporter.java if DB2 access is available.\n- Use generated AI prompts to produce deep documentation and error analysis.\n`;
}

module.exports = {
  generateMarkdownReport,
};
