'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createCollaborationService,
  executeCollaborationRequest,
} = require('../src/agent/collaborationService');

function catalogFixture() {
  const zpi = require('../src/projectIntelligence');
  const process = zpi.fixtures.businessProcess({
    processId: 'process:order-flow',
    processVersionId: 'process:order-flow:v1',
    name: 'Order processing flow',
    entryPoints: [{ id: 'PROGRAM:ORDERPGM', kind: 'program', name: 'ORDERPGM' }],
    claimIds: ['claim:order-flow:1'],
    relationshipIds: [],
  });
  const version = zpi.fixtures.processVersion({
    processId: process.processId,
    processVersionId: process.processVersionId,
    title: process.name,
    stepIds: ['step:order-flow:1'],
    claimIds: process.claimIds,
    relationshipIds: [],
  });
  const step = zpi.fixtures.processStep({
    processId: process.processId,
    processVersionId: version.processVersionId,
    stepId: 'step:order-flow:1',
    title: 'Read order input',
    technicalRefs: ['PROGRAM:ORDERPGM'],
  });
  const claim = zpi.fixtures.processClaim({
    processId: process.processId,
    processVersionId: version.processVersionId,
    claimId: 'claim:order-flow:1',
    text: 'ORDERPGM reads the incoming order.',
    supportingRefs: ['PROGRAM:ORDERPGM'],
  });
  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId: 'proj-demo',
    snapshotId: 'snap-001',
    freshness: { status: 'published', checkedAt: '2026-09-08T12:00:00.000Z' },
    candidates: [{ process, version, steps: [step], claims: [claim], relationships: [] }],
  };
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-collaboration-'));
  const catalogPath = 'process-catalog.json';
  fs.writeFileSync(path.join(root, catalogPath), JSON.stringify(catalogFixture()));
  return { root, catalogPath };
}

test('local collaboration task preserves revisions and answers from an explicit catalog', async () => {
  const { root, catalogPath } = workspace();
  try {
    const service = createCollaborationService({ workspaceRoot: root });
    const task = service.create({
      goal: 'What does PROGRAM:ORDERPGM do?',
      scope: { catalog: catalogPath },
    });
    assert.equal(task.authority.remoteAccess, false);
    assert.equal(task.authority.approvalGranted, false);
    assert.equal(task.state, 'ready');
    assert.equal(service.providers().executionAvailable, false);
    assert.throws(
      () => service.message(task.id, { actor: 'human', text: 'stale', expectedRevision: 0 }),
      /revision/i
    );

    const completed = await service.run(task.id, { expectedRevision: task.revision });
    assert.equal(completed.state, 'completed');
    assert.equal(completed.result.advisory, true);
    assert.equal(completed.result.sourceOfTruth, false);
    assert.equal(completed.result.inputs.catalog.path, catalogPath);
    assert.match(completed.result.answer.answer, /Order processing flow/i);
    assert.equal(service.handoff(task.id).inputIntegrity, 'unchanged');

    fs.appendFileSync(path.join(root, catalogPath), '\n');
    assert.equal(service.handoff(task.id).inputIntegrity, 'changed');
    const invoke = await executeCollaborationRequest(
      {
        operation: 'provider-invoke',
        id: task.id,
        expectedRevision: completed.revision,
        providerId: 'missing',
        modelId: 'missing',
        previewHash: '0'.repeat(64),
      },
      { workspaceRoot: root }
    );
    assert.equal(invoke.result.reasonCode, 'PROVIDER_EXECUTION_DISABLED');
    assert.equal(invoke.approvalGranted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local collaboration cancellation is revision-bound and terminal tasks cannot run again', async () => {
  const { root, catalogPath } = workspace();
  try {
    const service = createCollaborationService({ workspaceRoot: root });
    const task = service.create({ goal: 'Check a local process', scope: { catalog: catalogPath } });
    const cancelled = service.cancel(task.id, { expectedRevision: task.revision });
    assert.equal(cancelled.state, 'cancelled');
    await assert.rejects(
      service.run(task.id, { expectedRevision: cancelled.revision }),
      /ready task/i
    );
    assert.throws(() => service.cancel(task.id, { expectedRevision: task.revision }), /revision/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local task cancellation stops an active worker and records the terminal revision', async () => {
  const { root, catalogPath } = workspace();
  try {
    const service = createCollaborationService({ workspaceRoot: root });
    const task = service.create({
      goal: 'What does PROGRAM:ORDERPGM do?',
      scope: { catalog: catalogPath },
    });
    const run = service.run(task.id, { expectedRevision: task.revision });
    const running = service.read(task.id);
    assert.equal(running.state, 'running');
    const cancelling = service.cancel(task.id, { expectedRevision: running.revision });
    assert.equal(cancelling.state, 'cancelling');
    const finished = await run;
    assert.equal(finished.state, 'cancelled');
    assert.equal(finished.execution, null);
    assert.equal(finished.result, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('local task recovery requires and records a verifiably dead owner', () => {
  const { root } = workspace();
  try {
    const service = createCollaborationService({ workspaceRoot: root });
    const task = service.create({ goal: 'Recover a task after process exit', scope: {} });
    const file = path.join(root, '.zeus', 'collaboration', `${task.id}.json`);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.state = 'running';
    record.revision += 1;
    record.updatedAt = new Date().toISOString();
    record.execution = {
      pid: 2147483000,
      host: os.hostname(),
      attemptId: '11111111-1111-4111-8111-111111111111',
    };
    record.usage.attempts = 1;
    record.events.push({ sequence: record.revision, type: 'started', at: record.updatedAt });
    const content = { ...record };
    delete content.integrity;
    record.integrity = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

    const recovered = service.recover(task.id, { expectedRevision: record.revision });
    assert.equal(recovered.state, 'interrupted');
    assert.equal(recovered.failureCode, 'OWNER_EXITED');
    assert.equal(recovered.execution, null);
    assert.equal(recovered.result, null);
    assert.equal(recovered.revision, record.revision + 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('provider preview is advisory and blocked until a provider is configured', () => {
  const { root } = workspace();
  try {
    const service = createCollaborationService({ workspaceRoot: root });
    const task = service.create({ goal: 'Review a local process', scope: {} });
    const preview = service.providerPreview(task.id, {
      expectedRevision: task.revision,
      providerId: 'host-model',
      modelId: 'model-v1',
    });
    assert.equal(preview.status, 'blocked');
    assert.equal(preview.reasonCode, 'PROVIDER_NOT_CONFIGURED');
    assert.equal(preview.approvalGranted, false);
    assert.equal(preview.executionAvailable, false);
    assert.equal(service.read(task.id).revision, task.revision);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('API and opt-in MCP adapters use the same local task service', async () => {
  const { root } = workspace();
  try {
    const api = require('../src/api/zeusApi');
    const apiTask = await api.runCollaborationTask(
      { operation: 'create', goal: 'API local task', actor: 'human', scope: {} },
      { cwd: root }
    );
    assert.equal(apiTask.result.goal, 'API local task');

    const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('../src/mcp/mcpPolicy');
    const { listMcpTools } = require('../src/mcp/mcpTools');
    assert.ok(listMcpTools().some(tool => tool.name === 'zeus.agent.task'));
    assert.equal(DEFAULT_MCP_SAFE_TOOL_NAMES.includes('zeus.agent.task'), false);
    const { createMcpServer } = require('../src/mcp/mcpServer');
    const mcp = createMcpServer({ cwd: root, allowlistedTools: ['zeus.agent.task'] });
    const response = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'zeus.agent.task',
        arguments: { operation: 'create', goal: 'MCP local task', actor: 'human', scope: {} },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.result.goal, 'MCP local task');
    assert.equal(response.result.structuredContent.approvalGranted, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
