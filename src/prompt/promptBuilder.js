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
  return values.map((value) => `- ${value}`).join('\n');
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
    program,
    tables: asBulletList(context.tables),
    calls: asBulletList(context.calls),
    copyMembers: asBulletList(context.copyMembers),
    sqlStatements: asBulletList(context.sqlStatements),
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