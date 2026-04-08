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
const path = require('path');

function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, 'templates', `${templateName}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Prompt template not found: ${templateName}`);
  }
  return fs.readFileSync(templatePath, 'utf8');
}

function sortByName(values) {
  return [...(values || [])].sort((a, b) => {
    const an = String((a && a.name) || a || '').toUpperCase();
    const bn = String((b && b.name) || b || '').toUpperCase();
    return an.localeCompare(bn);
  });
}

function isAiProjection(value) {
  return Boolean(value) && typeof value === 'object' && value.kind === 'ai-knowledge-projection';
}

function asBulletList(values, transform) {
  if (!values || values.length === 0) {
    return '- None detected';
  }
  return values.map((raw) => {
    const value = transform ? transform(raw) : raw;
    return `- ${String(value)}`;
  }).join('\n');
}

function renderTemplate(template, data) {
  let rendered = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    rendered = rendered.replace(regex, value !== undefined ? String(value) : '');
  }
  return rendered.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '');
}

function extractSections(context) {
  const tables = sortByName((context.dependencies && context.dependencies.tables) || context.tables || []);
  const programCalls = sortByName((context.dependencies && context.dependencies.programCalls) || context.calls || []);
  const copyMembers = sortByName((context.dependencies && context.dependencies.copyMembers) || context.copyMembers || []);
  const sqlStatements = [...(((context.sql && context.sql.statements) || context.sqlStatements || []) || [])]
    .sort((a, b) => {
      const at = String((a && a.type) || '').toUpperCase();
      const bt = String((b && b.type) || '').toUpperCase();
      if (at !== bt) return at.localeCompare(bt);
      const aText = String((a && (a.text || a.snippet)) || '');
      const bText = String((b && (b.text || b.snippet)) || '');
      return aText.localeCompare(bText);
    });

  return {
    tables,
    programCalls,
    copyMembers,
    sqlStatements,
  };
}

function buildTemplateData(context, sourceSnippet) {
  const { tables, programCalls, copyMembers, sqlStatements } = extractSections(context);
  const summary = context.summary && context.summary.text
    ? context.summary.text
    : `Program ${context.program || ''} has ${tables.length} tables, ${programCalls.length} program calls, ${copyMembers.length} copy members, and ${sqlStatements.length} SQL statements.`;
  const graph = context.graph || {};
  const testData = context.testData || {};
  const dependencyGraphSummary = `Nodes: ${graph.nodeCount || 0}, Edges: ${graph.edgeCount || 0}`;
  const testDataHint = testData.status === 'exported'
    ? `Representative sample rows are available in ${testData.file || 'test-data.json'} and ${testData.markdownFile || 'test-data.md'} for ${testData.tableCount || 0} tables.`
    : 'Representative sample rows are not available in this analysis run.';

  return {
    program: context.program || '',
    summary,
    tables: asBulletList(tables, (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    programCalls: asBulletList(programCalls, (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    copyMembers: asBulletList(copyMembers, (item) => item.name || item),
    sqlStatements: asBulletList(sqlStatements, (item) => {
      const text = (item && (item.text || item.snippet)) || '';
      if (item && item.type && text) {
        const flags = [];
        if (item.intent && item.intent !== 'OTHER') flags.push(item.intent);
        if (item.dynamic) flags.push('DYNAMIC');
        if (item.unresolved) flags.push('UNRESOLVED');
        const tables = Array.isArray(item.tables) && item.tables.length > 0
          ? ` tables: ${item.tables.join(', ')}`
          : '';
        return `[${item.type}${flags.length ? `/${flags.join('/')}` : ''}] ${text}${tables}`;
      }
      return item;
    }),
    dependencyGraphSummary,
    testDataHint,
    sourceSnippet: sourceSnippet || 'No source snippet available.',
  };
}

function buildTemplateDataFromProjection(aiProjection, templateName) {
  const workflowName = templateName === 'error-analysis' ? 'errorAnalysis' : 'documentation';
  const workflow = aiProjection && aiProjection.workflows ? aiProjection.workflows[workflowName] : null;
  const graph = workflow && workflow.dependencyGraphSummary ? workflow.dependencyGraphSummary : {};
  const testData = workflow && workflow.testData ? workflow.testData : {};
  const dependencyGraphSummary = `Nodes: ${graph.nodeCount || 0}, Edges: ${graph.edgeCount || 0}`;
  const testDataHint = testData.status === 'exported'
    ? `Representative sample rows are available in ${testData.file || 'test-data.json'} and ${testData.markdownFile || 'test-data.md'} for ${testData.tableCount || 0} tables.`
    : 'Representative sample rows are not available in this analysis run.';
  const evidenceHighlights = workflow && Array.isArray(workflow.evidenceHighlights) && workflow.evidenceHighlights.length > 0
    ? workflow.evidenceHighlights.map((entry) => {
      const location = entry.file ? `${entry.file}:${entry.startLine || 1}` : '';
      const snippet = entry.snippet ? ` ${entry.snippet.replace(/\s+/g, ' ').trim()}` : '';
      return `${entry.label || 'Evidence'} @ ${location}${snippet}`;
    }).join('\n')
    : 'No source snippet available.';
  const summaryParts = [
    workflow && workflow.summary ? workflow.summary : '',
    workflow && Array.isArray(workflow.riskMarkers) && workflow.riskMarkers.length > 0
      ? `Risk markers: ${workflow.riskMarkers.join(', ')}.`
      : '',
    workflow && Array.isArray(workflow.uncertaintyMarkers) && workflow.uncertaintyMarkers.length > 0
      ? `Uncertainty markers: ${workflow.uncertaintyMarkers.join(', ')}.`
      : '',
  ].filter(Boolean);

  return {
    program: aiProjection.program || '',
    summary: summaryParts.join(' '),
    tables: asBulletList((workflow && workflow.tables) || [], (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    programCalls: asBulletList((workflow && workflow.programCalls) || [], (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    copyMembers: asBulletList((workflow && workflow.copyMembers) || [], (item) => item.name || item),
    sqlStatements: asBulletList((workflow && workflow.sqlStatements) || [], (item) => {
      const text = item && item.text ? item.text : '';
      if (item && item.type && text) {
        const flags = [];
        if (item.intent && item.intent !== 'OTHER') flags.push(item.intent);
        if (item.dynamic) flags.push('DYNAMIC');
        if (item.unresolved) flags.push('UNRESOLVED');
        const tables = Array.isArray(item.tables) && item.tables.length > 0
          ? ` tables: ${item.tables.join(', ')}`
          : '';
        return `[${item.type}${flags.length ? `/${flags.join('/')}` : ''}] ${text}${tables}`;
      }
      return item;
    }),
    dependencyGraphSummary,
    testDataHint,
    sourceSnippet: evidenceHighlights,
  };
}

function buildPrompt(templateName, contextOrProjection, outputPath, options = {}) {
  const template = loadTemplate(templateName);
  const data = isAiProjection(contextOrProjection)
    ? buildTemplateDataFromProjection(contextOrProjection, templateName)
    : buildTemplateData(contextOrProjection, options.sourceSnippet);
  const resolved = renderTemplate(template, data);
  const generatedAt = contextOrProjection.generatedAt || contextOrProjection.scannedAt || new Date().toISOString();
  const content = `Generated by: zeus-rpg-promptkit\nProgram: ${contextOrProjection.program || ''}\nGenerated at: ${generatedAt}\n\n${resolved}`;
  fs.writeFileSync(outputPath, content, 'utf8');
  return content;
}

function buildPrompts({ context, aiProjection, outputDir, sourceSnippet, templates }) {
  const selected = Array.isArray(templates) && templates.length > 0
    ? templates
    : ['documentation', 'error-analysis'];
  const outputs = {};
  const input = aiProjection || context;

  for (const templateName of selected) {
    const outputFileName = `ai_prompt_${templateName.replace(/-/g, '_')}.md`;
    const outputPath = path.join(outputDir, outputFileName);
    outputs[templateName] = buildPrompt(templateName, input, outputPath, { sourceSnippet });
  }

  return outputs;
}

module.exports = {
  buildPrompt,
  buildPrompts,
};

