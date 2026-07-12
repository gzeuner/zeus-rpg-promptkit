/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

function normalizeString(value, fallback = '') {
  const normalized = String(value === undefined || value === null ? '' : value).trim();
  return normalized || fallback;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(entry => String(entry || '').trim()).filter(Boolean);
}

function asMarkdownList(values, emptyText = '- none') {
  const lines = normalizeArray(values);
  if (lines.length === 0) return emptyText;
  return lines.map(line => `- ${line}`).join('\n');
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of normalizeArray(values)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

const MODULE_REGISTRY = Object.freeze({
  'system-role': Object.freeze({
    id: 'system-role',
    title: 'System Role',
    category: 'foundation',
    description: 'Sets the assistant role, scope, and engineering mode.',
    configFields: Object.freeze([
      Object.freeze({ name: 'assistantRole', type: 'string', required: false }),
      Object.freeze({ name: 'language', type: 'string', required: false }),
    ]),
    render(context) {
      const role = normalizeString(
        context.fields.assistantRole,
        'Senior Node.js and AI Engineer for zeus-rpg-promptkit'
      );
      const language = normalizeString(context.fields.language, 'German');
      return [
        '## Role',
        `You are a ${role}.`,
        'Work directly in the zeus-rpg-promptkit repository and optimize for production-ready implementation quality.',
        `Response language: ${language}.`,
      ].join('\n');
    },
  }),
  'toolset-context': Object.freeze({
    id: 'toolset-context',
    title: 'Toolset Context',
    category: 'context',
    description:
      'Pins work to the toolset implementation scope and current repository constraints.',
    configFields: Object.freeze([
      Object.freeze({ name: 'repoName', type: 'string', required: false }),
      Object.freeze({ name: 'livingDocPath', type: 'string', required: false }),
      Object.freeze({ name: 'technicalStrategy', type: 'string', required: false }),
    ]),
    render(context) {
      const repoName = normalizeString(context.fields.repoName, 'zeus-rpg-promptkit');
      const livingDocPath = normalizeString(
        context.fields.livingDocPath,
        'config/local-only/GUI_PROMPT_BUILDER_LIVING_DOC.md'
      );
      const technicalStrategy = normalizeString(context.fields.technicalStrategy, 'Node.js-first');
      return [
        '## Project Context',
        `- Repository: \`${repoName}\``,
        `- Living document: \`${livingDocPath}\``,
        `- Technical strategy: ${technicalStrategy}`,
        '- Focus: implement Prompt Workbench capabilities in the toolset itself (not source-program analysis output writing).',
      ].join('\n');
    },
  }),
  'implementation-task': Object.freeze({
    id: 'implementation-task',
    title: 'Implementation Task',
    category: 'task',
    description: 'Defines the concrete implementation goal for the selected use case.',
    configFields: Object.freeze([
      Object.freeze({ name: 'goal', type: 'string', required: false }),
      Object.freeze({ name: 'inScope', type: 'array', required: false }),
      Object.freeze({ name: 'outOfScope', type: 'array', required: false }),
    ]),
    render(context) {
      const goal = normalizeString(context.fields.goal, context.useCase.defaultGoal);
      const inScope = normalizeArray(context.fields.inScope);
      const outOfScope = normalizeArray(context.fields.outOfScope);
      const lines = ['## Task', goal];
      if (inScope.length > 0) {
        lines.push('', '### In Scope', asMarkdownList(inScope));
      }
      if (outOfScope.length > 0) {
        lines.push('', '### Out Of Scope', asMarkdownList(outOfScope));
      }
      return lines.join('\n');
    },
  }),
  'output-contract': Object.freeze({
    id: 'output-contract',
    title: 'Output Contract',
    category: 'quality',
    description: 'Defines the expected delivery structure and acceptance shape.',
    configFields: Object.freeze([
      Object.freeze({ name: 'outputSections', type: 'array', required: false }),
      Object.freeze({ name: 'deliverables', type: 'array', required: false }),
    ]),
    render(context) {
      const outputSections = normalizeArray(context.fields.outputSections);
      const deliverables = normalizeArray(context.fields.deliverables);
      const sectionList =
        outputSections.length > 0 ? outputSections : context.useCase.defaultOutputSections;
      const deliverableList =
        deliverables.length > 0 ? deliverables : context.useCase.defaultDeliverables;

      return [
        '## Output Contract',
        '### Required Sections',
        asMarkdownList(sectionList),
        '',
        '### Deliverables',
        asMarkdownList(deliverableList),
      ].join('\n');
    },
  }),
  'quality-guardrails': Object.freeze({
    id: 'quality-guardrails',
    title: 'Quality Guardrails',
    category: 'quality',
    description: 'Adds non-functional constraints to keep changes safe and reviewable.',
    configFields: Object.freeze([
      Object.freeze({ name: 'qualityRules', type: 'array', required: false }),
      Object.freeze({ name: 'riskNotes', type: 'array', required: false }),
    ]),
    render(context) {
      const rules = normalizeArray(context.fields.qualityRules);
      const risks = normalizeArray(context.fields.riskNotes);
      const effectiveRules = rules.length > 0 ? rules : context.useCase.defaultQualityRules;

      const lines = ['## Guardrails', asMarkdownList(effectiveRules)];
      if (risks.length > 0) {
        lines.push('', '### Risks To Watch', asMarkdownList(risks));
      }
      return lines.join('\n');
    },
  }),
  'additional-requirements': Object.freeze({
    id: 'additional-requirements',
    title: 'Additional Requirements',
    category: 'input',
    description: 'Appends free-form requirements from the Prompt Canvas input field.',
    configFields: Object.freeze([
      Object.freeze({ name: 'additionalRequirements', type: 'string', required: false }),
    ]),
    render(context) {
      const additional = normalizeString(
        context.additionalRequirements || context.fields.additionalRequirements
      );
      return ['## Additional Requirements', additional || '- none'].join('\n');
    },
  }),
});

const USE_CASES = Object.freeze([
  Object.freeze({
    id: 'documentation-generation',
    title: 'Documentation Generation',
    description:
      'Generate implementation-focused documentation prompts for the Prompt Workbench feature set.',
    priority: 'high',
    defaultGoal:
      'Produce concise technical documentation for the Prompt Workbench implementation changes.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'Feature summary and intent',
      'Architecture and module boundaries',
      'API and contract notes',
      'Testing and validation notes',
      'Open risks and follow-ups',
    ]),
    defaultDeliverables: Object.freeze([
      'Markdown implementation summary',
      'List of changed files and why they changed',
      'Verification checklist',
    ]),
    defaultQualityRules: Object.freeze([
      'Do not invent files or behavior that is not present in repository code.',
      'Keep explanations grounded in actual module boundaries and contracts.',
      'Highlight residual uncertainty explicitly.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'goal', label: 'Goal', type: 'string' }),
      Object.freeze({ name: 'inScope', label: 'In Scope', type: 'array' }),
      Object.freeze({ name: 'outOfScope', label: 'Out Of Scope', type: 'array' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
  Object.freeze({
    id: 'impact-change-analysis',
    title: 'Impact / Change Analysis',
    description:
      'Assess blast radius and regression risks of Prompt Workbench code changes before merge.',
    priority: 'high',
    defaultGoal:
      'Analyze implementation change impact across Local UI, API contracts, and workflow integration points.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'Scope and assumptions',
      'Potentially affected modules and routes',
      'Regression risk table',
      'Backward compatibility checks',
      'Recommended mitigation and test plan',
    ]),
    defaultDeliverables: Object.freeze([
      'Impact summary',
      'Risk-ranked change matrix',
      'Go/No-Go recommendation with checks',
    ]),
    defaultQualityRules: Object.freeze([
      'Separate confirmed impact from inferred impact.',
      'Call out compatibility risks for existing CLI and Local UI flows.',
      'No merge recommendation without verification steps.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'goal', label: 'Planned Change', type: 'string' }),
      Object.freeze({ name: 'riskNotes', label: 'Risk Notes', type: 'array' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
  Object.freeze({
    id: 'security-access-review',
    title: 'Security & Access Review',
    description:
      'Review Prompt Workbench endpoint behavior, storage safety, and access assumptions.',
    priority: 'high',
    defaultGoal:
      'Identify security and access-control risks in Prompt Workbench backend and local template storage flows.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'Threat surface overview',
      'Input validation and serialization risks',
      'Storage and path safety checks',
      'Error handling and disclosure risks',
      'Hardening actions by priority',
    ]),
    defaultDeliverables: Object.freeze([
      'Risk finding list (high/medium/low)',
      'Mitigation checklist',
      'Verification tests for critical controls',
    ]),
    defaultQualityRules: Object.freeze([
      'Every finding must include evidence and proposed mitigation.',
      'Differentiate exploitable paths from theoretical concerns.',
      'Flag unsafe filesystem or request-body handling explicitly.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'complianceContext', label: 'Compliance Context', type: 'string' }),
      Object.freeze({ name: 'riskNotes', label: 'Risk Notes', type: 'array' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
  Object.freeze({
    id: 'modernization-roadmap',
    title: 'Modernization Roadmap',
    description:
      'Plan phased delivery of Prompt Workbench capabilities in the current Node.js architecture.',
    priority: 'high',
    defaultGoal:
      'Create a phased implementation roadmap for Prompt Workbench with safe incremental delivery steps.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'Current baseline and blockers',
      'Target architecture slices',
      'Phase plan with dependencies',
      'Quick wins and reversible steps',
      'Risk controls and exit criteria',
    ]),
    defaultDeliverables: Object.freeze([
      'Phased roadmap',
      'Dependency-aware sequencing plan',
      'Pilot slice recommendation',
    ]),
    defaultQualityRules: Object.freeze([
      'Prefer additive and reversible increments.',
      'Keep architecture aligned with existing Local UI server foundation.',
      'Include explicit validation checkpoint for each phase.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'timeline', label: 'Timeline', type: 'string' }),
      Object.freeze({ name: 'inScope', label: 'In Scope', type: 'array' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
  Object.freeze({
    id: 'test-case-generation',
    title: 'Test-Case Generation',
    description:
      'Produce test strategy prompts for Prompt Workbench backend and integration routes.',
    priority: 'medium',
    defaultGoal:
      'Generate a risk-based test plan for Prompt Workbench APIs, template storage, and regression safety.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'Test scope and priorities',
      'Endpoint and contract test cases',
      'Negative and boundary tests',
      'Regression coverage expectations',
      'Minimal CI-ready test pack',
    ]),
    defaultDeliverables: Object.freeze([
      'Test matrix',
      'Example assertions per risk area',
      'Execution checklist',
    ]),
    defaultQualityRules: Object.freeze([
      'Prioritize tests around behavior regressions and unsafe input paths.',
      'Include negative tests for invalid payloads and path handling.',
      'Keep test proposals directly mapped to implementation contracts.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'testGoal', label: 'Test Goal', type: 'string' }),
      Object.freeze({ name: 'qualityRules', label: 'Quality Rules', type: 'array' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
  Object.freeze({
    id: 'onboarding-knowledge-transfer',
    title: 'Onboarding / Knowledge Transfer',
    description:
      'Create structured prompts for handing Prompt Workbench implementation context to new contributors.',
    priority: 'medium',
    defaultGoal:
      'Prepare onboarding guidance for engineers extending Prompt Workbench in zeus-rpg-promptkit.',
    defaultModuleIds: Object.freeze([
      'system-role',
      'toolset-context',
      'implementation-task',
      'output-contract',
      'quality-guardrails',
      'additional-requirements',
    ]),
    defaultOutputSections: Object.freeze([
      'What was built and why',
      'How the architecture is organized',
      'How to run and validate locally',
      'Common pitfalls and review notes',
      'First safe contribution path',
    ]),
    defaultDeliverables: Object.freeze([
      'Onboarding summary',
      'Step-by-step contributor checklist',
      'Open questions for handover',
    ]),
    defaultQualityRules: Object.freeze([
      'Keep guidance practical and repo-specific.',
      'Map onboarding steps to actual files and commands.',
      'Call out assumptions and prerequisites clearly.',
    ]),
    fieldHints: Object.freeze([
      Object.freeze({ name: 'targetRole', label: 'Target Role', type: 'string' }),
      Object.freeze({ name: 'onboardingWindow', label: 'Onboarding Window', type: 'string' }),
      Object.freeze({
        name: 'additionalRequirements',
        label: 'Additional Requirements',
        type: 'string',
      }),
    ]),
  }),
]);

const USE_CASE_MAP = Object.freeze(new Map(USE_CASES.map(entry => [entry.id, entry])));

function listUseCases() {
  return USE_CASES.map(entry => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    priority: entry.priority,
    defaultModuleIds: [...entry.defaultModuleIds],
    fieldHints: [...entry.fieldHints],
  }));
}

function listModules() {
  return Object.values(MODULE_REGISTRY).map(module => ({
    id: module.id,
    title: module.title,
    category: module.category,
    description: module.description,
    configFields: [...module.configFields],
  }));
}

function resolveUseCase(useCaseId) {
  const normalized = normalizeString(useCaseId);
  const useCase = USE_CASE_MAP.get(normalized);
  if (!useCase) {
    throw new Error(`Unknown prompt-builder use case: ${useCaseId}`);
  }
  return useCase;
}

function resolveModule(moduleId) {
  const normalized = normalizeString(moduleId);
  const module = MODULE_REGISTRY[normalized];
  if (!module) {
    throw new Error(`Unknown prompt-builder module: ${moduleId}`);
  }
  return module;
}

function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return {};
  }
  return fields;
}

function buildPromptPreview(input = {}) {
  const useCase = resolveUseCase(input.useCaseId);
  const requestedModuleIds =
    Array.isArray(input.moduleIds) && input.moduleIds.length > 0
      ? input.moduleIds
      : useCase.defaultModuleIds;

  const moduleIds = dedupe(requestedModuleIds);
  if (moduleIds.length === 0) {
    throw new Error('Prompt-builder preview requires at least one module.');
  }

  const fields = normalizeFields(input.fields);
  const additionalRequirements = normalizeString(
    input.additionalRequirements || fields.additionalRequirements
  );

  const context = {
    useCase,
    fields,
    additionalRequirements,
  };

  const renderedModules = moduleIds.map(moduleId => {
    const module = resolveModule(moduleId);
    return {
      id: module.id,
      title: module.title,
      content: module.render(context),
    };
  });

  const header = [
    '# Zeus Prompt Workbench Prompt',
    '',
    `Use Case: ${useCase.title} (${useCase.id})`,
  ].join('\n');

  const body = renderedModules.map(entry => entry.content).join('\n\n');

  const content = `${header}\n\n${body}\n`;

  return {
    useCase: {
      id: useCase.id,
      title: useCase.title,
      priority: useCase.priority,
    },
    moduleIds,
    modules: renderedModules.map(entry => ({
      id: entry.id,
      title: entry.title,
    })),
    content,
    warnings: [],
  };
}

module.exports = {
  MODULE_REGISTRY,
  USE_CASES,
  buildPromptPreview,
  listModules,
  listUseCases,
  resolveModule,
  resolveUseCase,
};
