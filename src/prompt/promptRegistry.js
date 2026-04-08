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
const PROMPT_REGISTRY = Object.freeze({
  documentation: Object.freeze({
    name: 'documentation',
    version: 1,
    templateFile: 'documentation',
    workflow: 'documentation',
    outputFileName: 'ai_prompt_documentation.md',
    requiredInputs: Object.freeze([
      Object.freeze({ path: 'kind', equals: 'ai-knowledge-projection' }),
      Object.freeze({ path: 'program', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.documentation.summary', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.documentation.tables', type: 'array' }),
      Object.freeze({ path: 'workflows.documentation.sqlStatements', type: 'array' }),
      Object.freeze({ path: 'workflows.documentation.evidenceHighlights', type: 'array' }),
    ]),
    preferredOutputShape: Object.freeze([
      'Program purpose and high-level flow',
      'Business logic and decision points',
      'Data access behavior',
      'Integration points',
      'Evidence-backed references',
    ]),
    budget: Object.freeze({
      targetTokens: 1400,
      maxTokens: 2200,
    }),
  }),
  'error-analysis': Object.freeze({
    name: 'error-analysis',
    version: 1,
    templateFile: 'error-analysis',
    workflow: 'errorAnalysis',
    outputFileName: 'ai_prompt_error_analysis.md',
    requiredInputs: Object.freeze([
      Object.freeze({ path: 'kind', equals: 'ai-knowledge-projection' }),
      Object.freeze({ path: 'program', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.errorAnalysis.summary', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.errorAnalysis.sqlStatements', type: 'array' }),
      Object.freeze({ path: 'workflows.errorAnalysis.evidenceHighlights', type: 'array' }),
      Object.freeze({ path: 'workflows.errorAnalysis.riskMarkers', type: 'array' }),
    ]),
    preferredOutputShape: Object.freeze([
      'Likely failure points',
      'Risky SQL behavior',
      'Weak error handling',
      'Risky calls and dependencies',
      'Evidence-backed findings',
    ]),
    budget: Object.freeze({
      targetTokens: 1400,
      maxTokens: 2200,
    }),
  }),
  'defect-analysis': Object.freeze({
    name: 'defect-analysis',
    version: 1,
    templateFile: 'defect-analysis',
    workflow: 'errorAnalysis',
    outputFileName: 'ai_prompt_defect_analysis.md',
    requiredInputs: Object.freeze([
      Object.freeze({ path: 'kind', equals: 'ai-knowledge-projection' }),
      Object.freeze({ path: 'program', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.errorAnalysis.summary', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.errorAnalysis.sqlStatements', type: 'array' }),
      Object.freeze({ path: 'workflows.errorAnalysis.evidenceHighlights', type: 'array' }),
      Object.freeze({ path: 'workflows.errorAnalysis.rankedEvidence', type: 'array' }),
    ]),
    preferredOutputShape: Object.freeze([
      'Defect hypotheses',
      'Trigger conditions',
      'Blast radius and affected data',
      'Suggested verification steps',
      'Evidence-backed references',
    ]),
    budget: Object.freeze({
      targetTokens: 1500,
      maxTokens: 2300,
    }),
  }),
  modernization: Object.freeze({
    name: 'modernization',
    version: 1,
    templateFile: 'modernization',
    workflow: 'documentation',
    outputFileName: 'ai_prompt_modernization.md',
    requiredInputs: Object.freeze([
      Object.freeze({ path: 'kind', equals: 'ai-knowledge-projection' }),
      Object.freeze({ path: 'program', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.documentation.summary', type: 'string', nonEmpty: true }),
      Object.freeze({ path: 'workflows.documentation.tables', type: 'array' }),
      Object.freeze({ path: 'workflows.documentation.programCalls', type: 'array' }),
      Object.freeze({ path: 'workflows.documentation.evidenceHighlights', type: 'array' }),
    ]),
    preferredOutputShape: Object.freeze([
      'Modernization candidates',
      'Safe extraction boundaries',
      'Data and integration dependencies',
      'Risk hotspots that block change',
      'Evidence-backed migration guidance',
    ]),
    budget: Object.freeze({
      targetTokens: 1500,
      maxTokens: 2400,
    }),
  }),
});

function getPromptContract(templateName) {
  const contract = PROMPT_REGISTRY[String(templateName || '').trim()];
  if (!contract) {
    throw new Error(`Unknown prompt template: ${templateName}`);
  }
  return contract;
}

function listPromptContracts() {
  return Object.values(PROMPT_REGISTRY);
}

module.exports = {
  getPromptContract,
  listPromptContracts,
  PROMPT_REGISTRY,
};
