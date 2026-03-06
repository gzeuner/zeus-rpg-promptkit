const fs = require('fs');
const path = require('path');

function loadTemplate(templateFileName) {
  const templatePath = path.join(__dirname, 'templates', templateFileName);
  return fs.readFileSync(templatePath, 'utf8');
}

function asBulletList(values) {
  if (!values || values.length === 0) {
    return '- None detected';
  }
  return values.map((value) => {
    if (typeof value === 'string') {
      return `- ${value}`;
    }

    if (value && typeof value === 'object') {
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

function dependenciesList(entries) {
  return asBulletList((entries || []).map((entry) => {
    if (!entry || typeof entry !== 'object') return String(entry);
    if (entry.kind) return `${entry.name} (${entry.kind})`;
    return entry.name;
  }));
}

function sqlStatementList(statements) {
  return asBulletList((statements || []).map((statement) => {
    if (!statement || typeof statement !== 'object') return String(statement);
    return `[${statement.type}] ${statement.text}`;
  }));
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : '';
  });
}

function buildPrompts({ program, context, sourceSnippet }) {
  const docsTemplate = loadTemplate('documentation.md');
  const errorTemplate = loadTemplate('error-analysis.md');

  const renderData = {
    program: context.program || program,
    tables: dependenciesList(context.dependencies && context.dependencies.tables),
    calls: dependenciesList(context.dependencies && context.dependencies.programCalls),
    copyMembers: dependenciesList(context.dependencies && context.dependencies.copyMembers),
    sqlStatements: sqlStatementList(context.sql && context.sql.statements),
    sourceSnippet,
  };

  return {
    documentation: renderTemplate(docsTemplate, renderData),
    errorAnalysis: renderTemplate(errorTemplate, renderData),
  };
}

module.exports = {
  buildPrompts,
};
