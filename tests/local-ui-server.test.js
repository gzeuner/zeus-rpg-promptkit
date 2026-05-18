const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { startLocalUiServer } = require('../src/ui/localUiServer');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');

function createUiFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-'));
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');
  const safeDir = path.join(programDir, 'safe-sharing');
  fs.mkdirSync(safeDir, { recursive: true });

  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n\nSummary.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'context.json'), `${JSON.stringify({
    program: 'ORDERPGM',
    dependencies: {
      tables: [{ name: 'ORDERS' }, { name: 'CUSTOMER' }],
      programCalls: [{ name: 'INVPGM' }],
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'architecture.html'), '<!doctype html><title>Architecture Viewer</title>', 'utf8');
  fs.writeFileSync(path.join(programDir, 'program-call-tree.json'), `${JSON.stringify({
    rootProgram: 'ORDERPGM',
    nodes: [
      { id: 'ORDERPGM', type: 'PROGRAM' },
      { id: 'INVPGM', type: 'PROGRAM' },
      { id: 'ORDERS', type: 'TABLE' },
    ],
    edges: [
      { from: 'ORDERPGM', to: 'INVPGM', type: 'CALLS_PROGRAM' },
      { from: 'ORDERPGM', to: 'ORDERS', type: 'USES_TABLE' },
    ],
    summary: {
      programCount: 2,
      tableCount: 1,
      edgeCount: 2,
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'db2-metadata.json'), `${JSON.stringify({
    tables: [{
      schema: 'MYLIB',
      table: 'ORDERS',
      sourceLink: {
        matchStatus: 'resolved',
        sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
      },
    }],
    summary: {
      tableCount: 1,
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'test-data.json'), `${JSON.stringify({
    tables: [{
      schema: 'MYLIB',
      table: 'ORDERS',
      rows: [{ ORDER_ID: '1001' }],
      policyDecision: {
        eligibility: 'allowed',
        maskedColumns: ['EMAIL'],
      },
      sourceLink: {
        matchStatus: 'resolved',
        sourceEvidence: [{ file: 'ORDERPGM.rpgle', startLine: 1 }],
      },
    }],
    summary: {
      tableCount: 1,
      policySummary: {
        maskedTableCount: 1,
      },
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'ai_prompt_documentation.md'), '# Documentation Prompt\n\nExplain ORDERPGM.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'ai_prompt_modernization.md'), '# Modernization Prompt\n\nModernize ORDERPGM.\n', 'utf8');
  fs.writeFileSync(path.join(safeDir, 'report.md'), '# Safe Report\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'analyze-run-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: {
      status: 'succeeded',
      completedAt: '2026-04-13T12:00:00.000Z',
    },
    inputs: {
      sourceRoot: 'C:/temp/src',
      options: {
        guidedMode: { name: 'modernization' },
        workflowPreset: { name: 'modernization-review' },
        reproducibleEnabled: false,
      },
      sourceSnapshot: {
        fileCount: 2,
      },
    },
    summary: {
      stageCount: 8,
      diagnosticCount: 1,
    },
    artifacts: [
      { path: 'context.json', kind: 'json', sizeBytes: 24, sha256: 'a' },
      { path: 'report.md', kind: 'markdown', sizeBytes: 18, sha256: 'b' },
      { path: 'architecture.html', kind: 'html', sizeBytes: 48, sha256: 'c' },
      { path: 'program-call-tree.json', kind: 'json', sizeBytes: 48, sha256: 'd' },
      { path: 'db2-metadata.json', kind: 'json', sizeBytes: 48, sha256: 'e' },
      { path: 'test-data.json', kind: 'json', sizeBytes: 48, sha256: 'f' },
      { path: 'ai_prompt_documentation.md', kind: 'markdown', sizeBytes: 48, sha256: 'g' },
      { path: 'ai_prompt_modernization.md', kind: 'markdown', sizeBytes: 48, sha256: 'h' },
    ],
  }, null, 2)}\n`, 'utf8');

  return {
    tempRoot,
    outputRoot,
    templateStorePath: path.join(tempRoot, 'config', 'local-only', 'prompt-workbench', 'templates.json'),
  };
}

test('local UI server exposes run explorer data and Prompt Workbench routes through a local-only API', async () => {
  const { tempRoot, outputRoot, templateStorePath } = createUiFixture();
  let started = null;

  try {
    started = await startLocalUiServer({
      outputRoot,
      port: 0,
      templateStorePath,
    });

    const health = await fetch(`${started.url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const analyses = await fetch(`${started.url}/api/analyses`).then((response) => response.json());
    assert.equal(Array.isArray(analyses.workspaces), true);
    assert.equal(analyses.workspaces.length, 1);
    assert.equal(analyses.workspaces[0].id, 'default');

    const runs = await fetch(`${started.url}/api/runs`).then((response) => response.json());
    assert.equal(runs.length, 1);
    assert.equal(runs[0].program, 'ORDERPGM');
    assert.equal(runs[0].workflowPreset, 'modernization-review');

    const detail = await fetch(`${started.url}/api/runs/ORDERPGM`).then((response) => response.json());
    assert.equal(detail.summary.program, 'ORDERPGM');
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'architecture.html'));
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'safe-sharing/report.md'));
    assert.equal(detail.views.graph.available, true);
    assert.equal(detail.views.db2.metadataAvailable, true);
    assert.equal(detail.views.db2.testDataAvailable, true);
    assert.equal(detail.views.prompts.artifacts.length, 2);
    assert.ok(detail.views.graph.nodes.some((node) => node.id === 'ORDERS' && node.relatedArtifactPaths.includes('test-data.json')));

    const views = await fetch(`${started.url}/api/runs/ORDERPGM/views`).then((response) => response.json());
    assert.equal(views.summary.graphNodeCount, 3);
    assert.equal(views.summary.db2TableCount, 1);
    assert.equal(views.graph.nodes.find((node) => node.id === 'ORDERPGM').relatedPromptPaths.includes('ai_prompt_documentation.md'), true);
    assert.equal(views.db2.tables[0].sampleRowCount, 1);
    assert.deepEqual(views.db2.tables[0].relatedArtifactPaths, ['db2-metadata.json', 'test-data.json']);
    assert.equal(views.prompts.artifacts[0].path.startsWith('ai_prompt_'), true);

    const artifact = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=report.md`).then((response) => response.json());
    assert.equal(artifact.kind, 'markdown');
    assert.match(artifact.content, /Summary\./);

    const rawArtifactResponse = await fetch(`${started.url}/runs/ORDERPGM/artifacts/raw?path=architecture.html`);
    assert.equal(rawArtifactResponse.status, 200);
    assert.match(rawArtifactResponse.headers.get('content-type'), /text\/html/);
    assert.match(await rawArtifactResponse.text(), /Architecture Viewer/);

    const shellHtml = await fetch(`${started.url}/`).then((response) => response.text());
    assert.match(shellHtml, /Zeus RPG PromptKit/);
    assert.match(shellHtml, /Home/);
    assert.match(shellHtml, /Graph Explorer|Graph/);
    assert.match(shellHtml, /DB2\/Test Data/);
    assert.match(shellHtml, /Prompt Compare/);
    assert.match(shellHtml, /Prompt Workbench/);
    assert.match(shellHtml, /Prompt Canvas/);
    assert.match(shellHtml, /Output Context Source/);
    assert.match(shellHtml, /Quick Actions|Open Prompt Workbench/);
    const scriptMatch = shellHtml.match(/<script>([\s\S]*)<\/script>/);
    assert.ok(scriptMatch);
    assert.doesNotThrow(() => new Function(scriptMatch[1]));

    const promptContracts = await fetch(`${started.url}/api/prompt-builder/contracts`).then((response) => response.json());
    assert.equal(promptContracts.version, 1);
    assert.equal(promptContracts.routes.preview.path, '/api/prompt-builder/preview');

    const useCasesPayload = await fetch(`${started.url}/api/prompt-builder/use-cases`).then((response) => response.json());
    assert.ok(Array.isArray(useCasesPayload.useCases));
    assert.ok(useCasesPayload.useCases.some((entry) => entry.id === 'documentation-generation'));

    const modulesPayload = await fetch(`${started.url}/api/prompt-builder/modules`).then((response) => response.json());
    assert.ok(Array.isArray(modulesPayload.modules));
    assert.ok(modulesPayload.modules.some((entry) => entry.id === 'system-role'));

    const previewPayload = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        useCaseId: 'documentation-generation',
        fields: {
          goal: 'Document Prompt Workbench implementation for maintainers.',
          language: 'English',
        },
        additionalRequirements: 'Reference changed files and test scope.',
      }),
    }).then((response) => response.json());
    assert.equal(previewPayload.preview.useCase.id, 'documentation-generation');
    assert.ok(previewPayload.preview.estimatedTokens > 0);
    assert.match(previewPayload.preview.content, /Prompt Workbench/);

    const emptyTemplates = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.deepEqual(emptyTemplates.templates, []);

    const createdTemplate = await fetch(`${started.url}/api/prompt-builder/templates`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Workbench API Contract Review',
        description: 'Template for API-first implementation review.',
        useCaseId: 'impact-change-analysis',
        moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'quality-guardrails'],
        fields: {
          goal: 'Assess impact of new prompt builder routes.',
        },
      }),
    }).then((response) => response.json());
    assert.equal(typeof createdTemplate.template.id, 'string');
    assert.equal(createdTemplate.template.useCaseId, 'impact-change-analysis');

    const listedTemplates = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.equal(listedTemplates.templates.length, 1);
    const templateId = listedTemplates.templates[0].id;

    const loadedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`).then((response) => response.json());
    assert.equal(loadedTemplate.template.id, templateId);
    assert.equal(loadedTemplate.template.name, 'Workbench API Contract Review');

    const updatedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Workbench API Contract Review v2',
        description: 'Updated template',
        useCaseId: 'impact-change-analysis',
        moduleIds: ['system-role', 'toolset-context', 'implementation-task', 'output-contract'],
        fields: {
          goal: 'Assess impact and regression risks of prompt builder APIs.',
        },
      }),
    }).then((response) => response.json());
    assert.equal(updatedTemplate.template.id, templateId);
    assert.equal(updatedTemplate.template.name, 'Workbench API Contract Review v2');

    const deletedTemplate = await fetch(`${started.url}/api/prompt-builder/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
    }).then((response) => response.json());
    assert.equal(deletedTemplate.deleted.id, templateId);

    const templatesAfterDelete = await fetch(`${started.url}/api/prompt-builder/templates`).then((response) => response.json());
    assert.deepEqual(templatesAfterDelete.templates, []);

    const promptBuilderMethodError = await fetch(`${started.url}/api/prompt-builder/use-cases`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(promptBuilderMethodError.status, 405);
    assert.match(promptBuilderMethodError.headers.get('allow') || '', /GET/);

    const invalidPreviewJson = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"useCaseId":',
    });
    assert.equal(invalidPreviewJson.status, 400);

    const invalidPreviewPayload = await fetch(`${started.url}/api/prompt-builder/preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fields: {},
      }),
    });
    assert.equal(invalidPreviewPayload.status, 400);

    const templateNotFound = await fetch(`${started.url}/api/prompt-builder/templates/does-not-exist`);
    assert.equal(templateNotFound.status, 404);

    const contextSources = await fetch(`${started.url}/api/prompt-builder/context-sources`).then((response) => response.json());
    assert.equal(contextSources.contextSources.length, 1);
    assert.equal(contextSources.contextSources[0].program, 'ORDERPGM');
    assert.ok(contextSources.contextSources[0].promptArtifacts.some((entry) => entry.path === 'ai_prompt_documentation.md'));

    const contextPrompts = await fetch(`${started.url}/api/prompt-builder/context-sources/ORDERPGM/prompts`).then((response) => response.json());
    assert.equal(contextPrompts.program, 'ORDERPGM');
    assert.ok(contextPrompts.promptArtifacts.some((entry) => entry.path === 'ai_prompt_modernization.md'));

    const importedPrompt = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
        path: 'ai_prompt_documentation.md',
      }),
    }).then((response) => response.json());
    assert.equal(importedPrompt.seed.program, 'ORDERPGM');
    assert.equal(importedPrompt.seed.path, 'ai_prompt_documentation.md');
    assert.match(importedPrompt.seed.content, /Documentation Prompt/);

    const invalidImportedPrompt = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
        path: 'report.md',
      }),
    });
    assert.equal(invalidImportedPrompt.status, 400);

    const missingImportedPromptPayload = await fetch(`${started.url}/api/prompt-builder/context-sources/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        program: 'ORDERPGM',
      }),
    });
    assert.equal(missingImportedPromptPayload.status, 400);

    const missingRunContextPrompts = await fetch(`${started.url}/api/prompt-builder/context-sources/UNKNOWNPGM/prompts`);
    assert.equal(missingRunContextPrompts.status, 404);

    const traversal = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=..%2Fsecret.txt`);
    assert.equal(traversal.status, 400);

    const readOnlyRouteMethodError = await fetch(`${started.url}/api/runs`, {
      method: 'POST',
    });
    assert.equal(readOnlyRouteMethodError.status, 405);
    assert.match(readOnlyRouteMethodError.headers.get('allow') || '', /GET/);
  } finally {
    if (started) {
      await new Promise((resolve) => started.server.close(resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('serve CLI boots the local UI shell on loopback and answers health checks', async () => {
  const { tempRoot, outputRoot } = createUiFixture();

  try {
    const child = spawn(process.execPath, [cliPath, 'serve', '--source-output-root', outputRoot, '--port', '0'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const started = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`serve command did not start in time\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        const match = stdout.match(/Zeus local UI available at: (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`serve command exited early with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }
      });
    });

    const health = await fetch(`${started}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
