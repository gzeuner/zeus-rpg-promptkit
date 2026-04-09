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
const { estimateTokens } = require('../ai/tokenEstimator');
const { getPromptContract } = require('./promptRegistry');

const DEFAULT_PROMPT_TEMPLATES = Object.freeze(['documentation', 'error-analysis']);

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
  const nativeFiles = sortByName((context.nativeFileUsage && context.nativeFileUsage.files) || context.nativeFiles || []);
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
    nativeFiles,
    sqlStatements,
  };
}

function formatSqlStatements(sqlStatements) {
  return asBulletList(sqlStatements, (item) => {
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
  });
}

function formatEvidenceHighlights(workflow) {
  return workflow && Array.isArray(workflow.evidenceHighlights) && workflow.evidenceHighlights.length > 0
    ? workflow.evidenceHighlights.map((entry) => {
      const location = entry.file ? `${entry.file}:${entry.startLine || 1}` : '';
      const snippet = entry.snippet ? ` ${entry.snippet.replace(/\s+/g, ' ').trim()}` : '';
      const rank = Number(entry.rank) || 0;
      const score = Number(entry.score) || 0;
      return `#${rank || '?'} ${entry.label || 'Evidence'} @ ${location}${score ? ` [score ${score}]` : ''}${snippet}`;
    }).join('\n')
    : 'No source snippet available.';
}

function formatEvidencePackSummary(workflow) {
  const packs = workflow && workflow.evidencePacks ? workflow.evidencePacks : {};
  const labels = [
    ['sql', 'SQL'],
    ['calls', 'Calls'],
    ['fileUsage', 'File Usage'],
    ['conditionals', 'Conditionals'],
    ['errorPaths', 'Error Paths'],
  ];
  return labels.map(([key, label]) => `${label}: ${Array.isArray(packs[key]) ? packs[key].length : 0}`).join(', ');
}

function formatBudgetHint(contract, estimatedTokens) {
  const budget = contract && contract.budget ? contract.budget : {};
  if (!budget.maxTokens) return 'No contract budget defined.';
  const targetText = budget.targetTokens ? `target ${budget.targetTokens}` : 'no target';
  return `Prompt contract budget: ${targetText}, max ${budget.maxTokens}, current estimate ${estimatedTokens}.`;
}

function formatDb2Hint(db2Metadata, workflow) {
  const workflowTables = workflow && Array.isArray(workflow.db2Tables) ? workflow.db2Tables : [];
  if (workflowTables.length > 0) {
    const unresolvedCount = workflowTables.filter((entry) => entry.matchStatus === 'unresolved').length;
    const ambiguousCount = workflowTables.filter((entry) => entry.matchStatus === 'ambiguous').length;
    return `DB2 schema context is available for ${workflowTables.length} workflow-relevant table${workflowTables.length === 1 ? '' : 's'}${unresolvedCount > 0 ? `; unresolved matches: ${unresolvedCount}` : ''}${ambiguousCount > 0 ? `; ambiguous matches: ${ambiguousCount}` : ''}.`;
  }

  if (db2Metadata && db2Metadata.status === 'exported') {
    return `DB2 schema context is available for ${db2Metadata.tableCount || 0} table${(db2Metadata.tableCount || 0) === 1 ? '' : 's'}.`;
  }

  return '';
}

function getPathValue(value, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === undefined || current === null) return undefined;
      return current[segment];
    }, value);
}

function validateRequirement(input, requirement) {
  const value = getPathValue(input, requirement.path);
  if (requirement.equals !== undefined && value !== requirement.equals) {
    return `Expected ${requirement.path} to equal ${JSON.stringify(requirement.equals)}.`;
  }
  if (requirement.type === 'string') {
    if (typeof value !== 'string') {
      return `Expected ${requirement.path} to be a string.`;
    }
    if (requirement.nonEmpty && String(value).trim().length === 0) {
      return `Expected ${requirement.path} to be a non-empty string.`;
    }
  }
  if (requirement.type === 'array') {
    if (!Array.isArray(value)) {
      return `Expected ${requirement.path} to be an array.`;
    }
    if (Number.isInteger(requirement.minItems) && value.length < requirement.minItems) {
      return `Expected ${requirement.path} to contain at least ${requirement.minItems} item(s).`;
    }
  }
  return null;
}

function validatePromptApplicability(templateName, input) {
  const contract = getPromptContract(templateName);
  if (!isAiProjection(input)) {
    const failures = [];
    if (!input || typeof input !== 'object') {
      failures.push('Legacy prompt input must be an object.');
    }
    if (!input || typeof input.program !== 'string' || String(input.program).trim().length === 0) {
      failures.push('Legacy prompt input must include a non-empty program.');
    }
    return {
      applicable: failures.length === 0,
      failures,
      contract,
    };
  }

  const failures = (contract.requiredInputs || [])
    .map((requirement) => validateRequirement(input, requirement))
    .filter(Boolean);

  return {
    applicable: failures.length === 0,
    failures,
    contract,
  };
}

function buildTemplateData(context, sourceSnippet, contract) {
  const { tables, programCalls, copyMembers, nativeFiles, sqlStatements } = extractSections(context);
  const summary = context.summary && context.summary.text
    ? context.summary.text
    : `Program ${context.program || ''} has ${tables.length} tables, ${programCalls.length} program calls, ${copyMembers.length} copy members, and ${sqlStatements.length} SQL statements.`;
  const graph = context.graph || {};
  const testData = context.testData || {};
  const dependencyGraphSummary = `Nodes: ${graph.nodeCount || 0}, Edges: ${graph.edgeCount || 0}`;
  const testDataHint = testData.status === 'exported'
    ? `Representative sample rows are available in ${testData.file || 'test-data.json'} and ${testData.markdownFile || 'test-data.md'} for ${testData.tableCount || 0} tables.`
    : 'Representative sample rows are not available in this analysis run.';
  const promptEstimate = estimateTokens(summary);
  const db2Hint = formatDb2Hint(context.db2Metadata || {}, null);

  return {
    program: context.program || '',
    summary: [summary, db2Hint].filter(Boolean).join(' '),
    tables: asBulletList(tables, (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    programCalls: asBulletList(programCalls, (item) => (item.kind ? `${item.name} (${item.kind})` : item.name || item)),
    copyMembers: asBulletList(copyMembers, (item) => item.name || item),
    nativeFiles: asBulletList(nativeFiles, (item) => {
      const flags = [];
      if (item.mutating || (item.access && item.access.mutating)) flags.push('MUTATING');
      if (item.interactive || (item.access && item.access.interactive)) flags.push('INTERACTIVE');
      if (item.keyed) flags.push('KEYED');
      return `${item.name || item}${flags.length ? ` (${flags.join(', ')})` : ''}`;
    }),
    sqlStatements: formatSqlStatements(sqlStatements),
    dependencyGraphSummary,
    testDataHint,
    sourceSnippet: sourceSnippet || 'No source snippet available.',
    riskMarkers: asBulletList((context.aiContext && context.aiContext.riskHints) || []),
    uncertaintyMarkers: '- None detected',
    evidencePackSummary: 'No evidence packs available.',
    contractBudget: formatBudgetHint(contract, promptEstimate),
  };
}

function resolveWorkflow(aiProjection, contract) {
  const workflowName = contract.workflow;
  return aiProjection && aiProjection.workflows ? aiProjection.workflows[workflowName] : null;
}

function buildTemplateDataFromProjection(aiProjection, contract) {
  const workflow = resolveWorkflow(aiProjection, contract);
  const graph = workflow && workflow.dependencyGraphSummary ? workflow.dependencyGraphSummary : {};
  const testData = workflow && workflow.testData ? workflow.testData : {};
  const dependencyGraphSummary = `Nodes: ${graph.nodeCount || 0}, Edges: ${graph.edgeCount || 0}`;
  const testDataHint = testData.status === 'exported'
    ? `Representative sample rows are available in ${testData.file || 'test-data.json'} and ${testData.markdownFile || 'test-data.md'} for ${testData.tableCount || 0} tables.`
    : 'Representative sample rows are not available in this analysis run.';
  const evidenceHighlights = formatEvidenceHighlights(workflow);
  const summaryParts = [
    workflow && workflow.summary ? workflow.summary : '',
    formatDb2Hint(null, workflow),
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
    nativeFiles: asBulletList((workflow && workflow.nativeFiles) || [], (item) => {
      const flags = [];
      if (item.mutating) flags.push('MUTATING');
      if (item.interactive) flags.push('INTERACTIVE');
      if (item.keyed) flags.push('KEYED');
      return `${item.name || item}${flags.length ? ` (${flags.join(', ')})` : ''}`;
    }),
    sqlStatements: formatSqlStatements((workflow && workflow.sqlStatements) || []),
    dependencyGraphSummary,
    testDataHint,
    sourceSnippet: evidenceHighlights,
    riskMarkers: asBulletList((workflow && workflow.riskMarkers) || []),
    uncertaintyMarkers: asBulletList((workflow && workflow.uncertaintyMarkers) || []),
    evidencePackSummary: formatEvidencePackSummary(workflow),
    contractBudget: formatBudgetHint(contract, Number(workflow && workflow.estimatedTokens) || 0),
  };
}

function renderPrompt(templateName, contextOrProjection, options = {}) {
  const contract = getPromptContract(templateName);
  const applicability = validatePromptApplicability(templateName, contextOrProjection);
  if (!applicability.applicable) {
    throw new Error(`Prompt contract validation failed for ${templateName}: ${applicability.failures.join(' ')}`);
  }

  const template = loadTemplate(contract.templateFile || templateName);
  const data = isAiProjection(contextOrProjection)
    ? buildTemplateDataFromProjection(contextOrProjection, contract)
    : buildTemplateData(contextOrProjection, options.sourceSnippet, contract);
  const resolved = renderTemplate(template, data);
  const generatedAt = contextOrProjection.generatedAt || contextOrProjection.scannedAt || new Date().toISOString();
  const content = `Generated by: zeus-rpg-promptkit\nProgram: ${contextOrProjection.program || ''}\nGenerated at: ${generatedAt}\nPrompt Contract: ${contract.name}@${contract.version}\n\n${resolved}`;
  const estimatedTokens = estimateTokens(content);

  if (contract.budget && contract.budget.maxTokens && estimatedTokens > contract.budget.maxTokens) {
    throw new Error(`Prompt contract budget exceeded for ${templateName}: estimated ${estimatedTokens} tokens exceeds max ${contract.budget.maxTokens}.`);
  }

  return {
    content,
    estimatedTokens,
    contract,
  };
}

function buildPrompt(templateName, contextOrProjection, outputPath, options = {}) {
  const rendered = renderPrompt(templateName, contextOrProjection, options);
  fs.writeFileSync(outputPath, rendered.content, 'utf8');
  return rendered.content;
}

function buildPrompts({ context, aiProjection, outputDir, sourceSnippet, templates }) {
  const selected = resolvePromptTemplates(templates);
  const outputs = {};
  const input = aiProjection || context;

  for (const templateName of selected) {
    const contract = getPromptContract(templateName);
    const outputPath = path.join(outputDir, contract.outputFileName || `ai_prompt_${templateName.replace(/-/g, '_')}.md`);
    outputs[templateName] = buildPrompt(templateName, input, outputPath, { sourceSnippet });
  }

  return outputs;
}

function resolvePromptTemplates(templates) {
  if (Array.isArray(templates)) {
    return templates.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return [...DEFAULT_PROMPT_TEMPLATES];
}

module.exports = {
  DEFAULT_PROMPT_TEMPLATES,
  buildPrompt,
  buildPrompts,
  renderPrompt,
  resolvePromptTemplates,
  validatePromptApplicability,
};
