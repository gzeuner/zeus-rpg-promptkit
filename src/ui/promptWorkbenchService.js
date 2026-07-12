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

const path = require('path');
const { estimateTokens } = require('../ai/tokenEstimator');
const {
  buildPromptPreview,
  listModules,
  listUseCases,
  resolveUseCase,
} = require('./promptWorkbenchRegistry');
const {
  createTemplate,
  deleteTemplate,
  listTemplates,
  normalizeTemplateStorePath,
  readTemplate,
  updateTemplate,
} = require('./promptWorkbenchTemplateStore');
const { listAnalysisRuns, readAnalysisRun, readArtifactContent } = require('./localUiDataApi');

const CONTEXT_PROMPT_PATTERN = /(^|\/)ai_prompt_.*\.md$/i;

const PROMPT_WORKBENCH_CONTRACT = Object.freeze({
  version: 1,
  routes: Object.freeze({
    useCases: Object.freeze({
      path: '/api/prompt-builder/use-cases',
      method: 'GET',
      response: '{ useCases: UseCase[] }',
    }),
    modules: Object.freeze({
      path: '/api/prompt-builder/modules',
      method: 'GET',
      response: '{ modules: Module[] }',
    }),
    preview: Object.freeze({
      path: '/api/prompt-builder/preview',
      method: 'POST',
      request:
        '{ useCaseId: string, moduleIds?: string[], fields?: object, additionalRequirements?: string }',
      response: '{ preview: PromptPreview }',
    }),
    templatesList: Object.freeze({
      path: '/api/prompt-builder/templates',
      method: 'GET',
      response: '{ templates: PromptTemplateSummary[] }',
    }),
    templatesCreate: Object.freeze({
      path: '/api/prompt-builder/templates',
      method: 'POST',
      request:
        '{ name: string, useCaseId: string, moduleIds: string[], description?: string, fields?: object, additionalRequirements?: string, tags?: string[] }',
      response: '{ template: PromptTemplate }',
    }),
    templatesRead: Object.freeze({
      path: '/api/prompt-builder/templates/:templateId',
      method: 'GET',
      response: '{ template: PromptTemplate }',
    }),
    templatesUpdate: Object.freeze({
      path: '/api/prompt-builder/templates/:templateId',
      method: 'PUT',
      request:
        '{ name: string, useCaseId: string, moduleIds: string[], description?: string, fields?: object, additionalRequirements?: string, tags?: string[] }',
      response: '{ template: PromptTemplate }',
    }),
    templatesDelete: Object.freeze({
      path: '/api/prompt-builder/templates/:templateId',
      method: 'DELETE',
      response: '{ deleted: PromptTemplateSummary }',
    }),
    contextSourcesList: Object.freeze({
      path: '/api/prompt-builder/context-sources',
      method: 'GET',
      response: '{ contextSources: PromptContextSource[] }',
    }),
    contextSourcesPrompts: Object.freeze({
      path: '/api/prompt-builder/context-sources/:program/prompts',
      method: 'GET',
      response: '{ program: string, promptArtifacts: PromptArtifact[] }',
    }),
    contextSourcesImport: Object.freeze({
      path: '/api/prompt-builder/context-sources/import',
      method: 'POST',
      request: '{ program: string, path: string }',
      response: '{ seed: PromptSeed }',
    }),
  }),
});

function normalizeInputObject(value, errorMessage) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

function validatePreviewInput(value) {
  const input = normalizeInputObject(value, 'Prompt preview payload must be an object.');
  if (typeof input.useCaseId !== 'string' || input.useCaseId.trim().length === 0) {
    throw new Error('Prompt preview payload requires useCaseId.');
  }

  if (input.moduleIds !== undefined && !Array.isArray(input.moduleIds)) {
    throw new Error('Prompt preview payload moduleIds must be an array when provided.');
  }

  if (
    input.fields !== undefined &&
    (typeof input.fields !== 'object' || Array.isArray(input.fields) || input.fields === null)
  ) {
    throw new Error('Prompt preview payload fields must be an object when provided.');
  }

  return {
    useCaseId: input.useCaseId,
    moduleIds: Array.isArray(input.moduleIds) ? input.moduleIds : undefined,
    fields: input.fields || {},
    additionalRequirements: input.additionalRequirements,
  };
}

function validateTemplatePayload(value) {
  const input = normalizeInputObject(value, 'Prompt template payload must be an object.');
  const useCaseId = String(input.useCaseId || '').trim();
  if (!useCaseId) {
    throw new Error('Prompt template payload requires useCaseId.');
  }
  resolveUseCase(useCaseId);

  return {
    name: input.name,
    description: input.description,
    useCaseId,
    moduleIds: input.moduleIds,
    fields: input.fields,
    additionalRequirements: input.additionalRequirements,
    tags: input.tags,
  };
}

function isPromptArtifactPath(artifactPath) {
  return CONTEXT_PROMPT_PATTERN.test(String(artifactPath || '').trim());
}

function normalizePromptArtifact(artifact, fallbackProgram) {
  const relativePath = String((artifact && artifact.path) || '').trim();
  return {
    program: String((artifact && artifact.program) || fallbackProgram || '').trim(),
    path: relativePath,
    title: String((artifact && artifact.title) || relativePath).trim() || relativePath,
    kind: String((artifact && artifact.kind) || '').trim() || 'markdown',
    sizeBytes: Number(artifact && artifact.sizeBytes) || 0,
  };
}

function listPromptArtifactsFromRunDetail(runDetail) {
  const views = runDetail && runDetail.views ? runDetail.views : {};
  const artifacts =
    views.prompts && Array.isArray(views.prompts.artifacts) ? views.prompts.artifacts : [];

  return artifacts
    .filter(entry => isPromptArtifactPath(entry.path))
    .map(entry =>
      normalizePromptArtifact(entry, runDetail && runDetail.summary && runDetail.summary.program)
    );
}

function validateImportPayload(value) {
  const input = normalizeInputObject(value, 'Prompt context import payload must be an object.');
  const program = String(input.program || '').trim();
  const artifactPath = String(input.path || '').trim();
  if (!program) {
    throw new Error('Prompt context import payload requires program.');
  }
  if (!artifactPath) {
    throw new Error('Prompt context import payload requires path.');
  }
  if (!isPromptArtifactPath(artifactPath)) {
    throw new Error('Prompt context import path must target ai_prompt_*.md artifacts.');
  }
  return {
    program,
    artifactPath,
  };
}

function createPromptWorkbenchService(options = {}) {
  const templateStorePath = normalizeTemplateStorePath(options.templateStorePath, options.cwd);
  const resolvedOutputRoot = path.resolve(
    options.outputRoot || options.sourceOutputRoot || 'output'
  );

  return {
    getContract() {
      return {
        ...PROMPT_WORKBENCH_CONTRACT,
        templateStorePath,
        outputRoot: resolvedOutputRoot,
      };
    },

    listUseCases() {
      return {
        useCases: listUseCases(),
      };
    },

    listModules() {
      return {
        modules: listModules(),
      };
    },

    previewPrompt(payload) {
      const validated = validatePreviewInput(payload);
      const preview = buildPromptPreview(validated);
      return {
        preview: {
          ...preview,
          estimatedTokens: estimateTokens(preview.content),
        },
      };
    },

    listTemplates() {
      return {
        templates: listTemplates(templateStorePath),
      };
    },

    readTemplate(templateId) {
      return {
        template: readTemplate(templateStorePath, templateId),
      };
    },

    createTemplate(payload) {
      const validated = validateTemplatePayload(payload);
      return {
        template: createTemplate(templateStorePath, validated),
      };
    },

    updateTemplate(templateId, payload) {
      const validated = validateTemplatePayload(payload);
      return {
        template: updateTemplate(templateStorePath, templateId, validated),
      };
    },

    deleteTemplate(templateId) {
      return {
        deleted: deleteTemplate(templateStorePath, templateId),
      };
    },

    listContextSources() {
      const runs = listAnalysisRuns(resolvedOutputRoot);
      const contextSources = runs.map(run => {
        let promptArtifacts = [];
        try {
          const runDetail = readAnalysisRun(resolvedOutputRoot, run.program);
          promptArtifacts = listPromptArtifactsFromRunDetail(runDetail);
        } catch (error) {
          promptArtifacts = [];
        }
        return {
          program: run.program,
          status: run.status,
          completedAt: run.completedAt,
          workflowMode: run.workflowMode,
          workflowPreset: run.workflowPreset,
          promptArtifactCount: promptArtifacts.length,
          promptArtifacts,
        };
      });

      return {
        contextSources,
      };
    },

    listContextSourcePrompts(program) {
      const normalizedProgram = String(program || '').trim();
      if (!normalizedProgram) {
        throw new Error('Prompt context source program is required.');
      }

      const runDetail = readAnalysisRun(resolvedOutputRoot, normalizedProgram);
      return {
        program: normalizedProgram,
        promptArtifacts: listPromptArtifactsFromRunDetail(runDetail),
      };
    },

    importContextPrompt(payload) {
      const validated = validateImportPayload(payload);
      const artifact = readArtifactContent(
        resolvedOutputRoot,
        validated.program,
        validated.artifactPath
      );
      return {
        seed: {
          program: validated.program,
          path: artifact.path,
          kind: artifact.kind,
          content: artifact.content,
          estimatedTokens: estimateTokens(artifact.content),
        },
      };
    },
  };
}

module.exports = {
  PROMPT_WORKBENCH_CONTRACT,
  createPromptWorkbenchService,
};
