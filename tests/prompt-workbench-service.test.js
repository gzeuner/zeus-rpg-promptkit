const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPromptWorkbenchService } = require('../src/ui/promptWorkbenchService');

function createServiceFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-prompt-workbench-service-'));
  const templateStorePath = path.join(tempRoot, 'config', 'local-only', 'prompt-workbench', 'templates.json');
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');
  fs.mkdirSync(programDir, { recursive: true });
  fs.writeFileSync(path.join(programDir, 'ai_prompt_documentation.md'), '# Documentation Prompt\n\nExplain ORDERPGM.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'analyze-run-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: {
      status: 'succeeded',
      completedAt: '2026-04-14T12:00:00.000Z',
    },
    inputs: {
      sourceRoot: '/tmp/src',
      options: {
        guidedMode: { name: 'documentation' },
      },
      sourceSnapshot: {
        fileCount: 1,
      },
    },
    summary: {
      stageCount: 3,
      diagnosticCount: 0,
    },
    artifacts: [
      { path: 'ai_prompt_documentation.md', kind: 'markdown', sizeBytes: 42, sha256: 'a' },
    ],
  }, null, 2)}\n`, 'utf8');
  const service = createPromptWorkbenchService({ templateStorePath, outputRoot });
  return {
    tempRoot,
    templateStorePath,
    outputRoot,
    service,
  };
}

test('prompt workbench service exposes contracts, registries, preview, and template CRUD', () => {
  const fixture = createServiceFixture();
  try {
    const contract = fixture.service.getContract();
    assert.equal(contract.version, 1);
    assert.equal(contract.routes.preview.path, '/api/prompt-builder/preview');
    assert.equal(contract.routes.contextSourcesList.path, '/api/prompt-builder/context-sources');
    assert.equal(contract.routes.contextSourcesImport.path, '/api/prompt-builder/context-sources/import');

    const useCases = fixture.service.listUseCases();
    assert.ok(useCases.useCases.length >= 6);
    assert.ok(useCases.useCases.some((entry) => entry.id === 'documentation-generation'));

    const modules = fixture.service.listModules();
    assert.ok(modules.modules.length >= 6);
    assert.ok(modules.modules.some((entry) => entry.id === 'system-role'));

    const preview = fixture.service.previewPrompt({
      useCaseId: 'documentation-generation',
      fields: {
        goal: 'Document Prompt Workbench backend implementation details.',
        language: 'English',
      },
      additionalRequirements: 'Include route-level validation behavior.',
    });
    assert.equal(preview.preview.useCase.id, 'documentation-generation');
    assert.ok(preview.preview.estimatedTokens > 0);
    assert.match(preview.preview.content, /Output Contract/);

    assert.throws(() => fixture.service.previewPrompt({ fields: {} }), /useCaseId/);
    assert.throws(() => fixture.service.previewPrompt({
      useCaseId: 'documentation-generation',
      moduleIds: 'system-role',
    }), /moduleIds/);

    const created = fixture.service.createTemplate({
      name: 'Prompt Workbench API Implementation',
      description: 'Template for backend contract work.',
      useCaseId: 'impact-change-analysis',
      moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'quality-guardrails'],
      fields: {
        goal: 'Assess blast radius of API changes.',
      },
    });

    const templateId = created.template.id;
    assert.equal(typeof templateId, 'string');

    const listAfterCreate = fixture.service.listTemplates();
    assert.equal(listAfterCreate.templates.length, 1);

    const loaded = fixture.service.readTemplate(templateId);
    assert.equal(loaded.template.name, 'Prompt Workbench API Implementation');

    const updated = fixture.service.updateTemplate(templateId, {
      name: 'Prompt Workbench API Implementation v2',
      description: 'Updated template',
      useCaseId: 'impact-change-analysis',
      moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'output-contract'],
      fields: {
        goal: 'Assess blast radius and regression checks.',
      },
    });
    assert.equal(updated.template.name, 'Prompt Workbench API Implementation v2');

    const removed = fixture.service.deleteTemplate(templateId);
    assert.equal(removed.deleted.id, templateId);

    const listAfterDelete = fixture.service.listTemplates();
    assert.equal(listAfterDelete.templates.length, 0);

    const contextSources = fixture.service.listContextSources();
    assert.equal(contextSources.contextSources.length, 1);
    assert.equal(contextSources.contextSources[0].program, 'ORDERPGM');
    assert.ok(contextSources.contextSources[0].promptArtifacts.some((entry) => entry.path === 'ai_prompt_documentation.md'));

    const contextPrompts = fixture.service.listContextSourcePrompts('ORDERPGM');
    assert.equal(contextPrompts.program, 'ORDERPGM');
    assert.ok(contextPrompts.promptArtifacts.some((entry) => entry.path === 'ai_prompt_documentation.md'));

    const imported = fixture.service.importContextPrompt({
      program: 'ORDERPGM',
      path: 'ai_prompt_documentation.md',
    });
    assert.match(imported.seed.content, /Documentation Prompt/);
    assert.ok(imported.seed.estimatedTokens > 0);

    assert.throws(() => fixture.service.importContextPrompt({
      program: 'ORDERPGM',
      path: 'report.md',
    }), /ai_prompt_/);
    assert.throws(() => fixture.service.createTemplate({
      name: 'Invalid use case',
      useCaseId: 'not-real',
      moduleIds: ['system-role'],
    }), /Unknown prompt-builder use case/);
    assert.throws(() => fixture.service.listContextSourcePrompts(''), /program is required/i);
    assert.throws(() => fixture.service.importContextPrompt({
      program: '',
      path: '',
    }), /requires program/i);
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
});
