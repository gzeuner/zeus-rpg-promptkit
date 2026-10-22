'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hostname } = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');
const {
  CONTRACTS,
  contractRef,
  normalizeRequest,
  validatePlainData,
} = require('../providers/contracts');
const { evaluateEgressPolicy } = require('../providers/egressPolicy');
const { redactAgentText } = require('./agentExperience');
const { sanitizeValue } = require('../security/secretMasking');

const MAX_RECORD_BYTES = 512 * 1024;
const MAX_TASKS = 128;
const MAX_EVENTS = 128;
const MAX_MESSAGES = 32;
const MAX_PROVIDER_REQUEST_BYTES = 8192;
const TASK_STATES = new Set([
  'ready',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
const ACTORS = new Set(['human', 'agent', 'reviewer']);
const AUTHORITY = Object.freeze({
  mode: 'local-only',
  remoteAccess: false,
  approvalGranted: false,
});
const BUDGET = Object.freeze({
  maxAttempts: 8,
  maxWallMs: 15000,
  maxTotalMs: 60000,
  maxInputBytes: 2 * 1024 * 1024,
});
const activeWorkspaces = new Map();
const activeProviderInvocations = new Set();
const RECORD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'id',
  'revision',
  'createdAt',
  'updatedAt',
  'goal',
  'scope',
  'authority',
  'budget',
  'usage',
  'state',
  'messages',
  'events',
  'result',
  'failureCode',
  'integrity',
  'execution',
]);
const OPERATION_KEYS = Object.freeze({
  list: [],
  providers: [],
  show: ['id'],
  handoff: ['id'],
  events: ['id', 'afterSequence'],
  create: ['goal', 'actor', 'scope'],
  message: ['id', 'actor', 'text', 'expectedRevision'],
  run: ['id', 'expectedRevision'],
  cancel: ['id', 'expectedRevision'],
  recover: ['id', 'expectedRevision'],
  'provider-preview': ['id', 'expectedRevision', 'providerId', 'modelId'],
  'provider-invoke': ['id', 'expectedRevision', 'providerId', 'modelId', 'previewHash'],
});

function requireTask(condition, message) {
  if (!condition) {
    const error = new Error(`Collaboration: ${message}`);
    error.code = 'COLLABORATION_INVALID';
    throw error;
  }
}

function taskId(value) {
  requireTask(
    typeof value === 'string' && /^task-[a-f0-9-]{36}$/.test(value),
    'invalid task identifier'
  );
  return value;
}

function textValue(value, label) {
  requireTask(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 4000,
    `${label} must contain 1..4000 characters`
  );
  return redactAgentText(value.trim());
}

function actorValue(value) {
  requireTask(ACTORS.has(value), 'invalid actor');
  return value;
}

function digest(record) {
  const content = { ...record };
  delete content.integrity;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function createCollaborationService({
  workspaceRoot = process.cwd(),
  providerRegistry = null,
  providerPolicy,
  providerClassification,
  providerExecutionEnabled = false,
  providerTimeoutMs = 5000,
  providerSensitiveTerms = [],
} = {}) {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  function activeRuns() {
    if (!activeWorkspaces.has(root)) activeWorkspaces.set(root, new Map());
    return activeWorkspaces.get(root);
  }

  function location(relativePath) {
    const resolved = validateWorkspacePath(relativePath, {
      workspaceRoot: root,
      allowAbsolute: false,
    });
    requireTask(resolved.ok, 'invalid workspace-relative path');
    let current = root;
    for (const part of resolved.relativePath.split('/')) {
      current = path.join(current, part);
      if (fs.existsSync(current))
        requireTask(!fs.lstatSync(current).isSymbolicLink(), 'linked paths are forbidden');
    }
    return resolved.absolutePath;
  }

  function taskPath(id) {
    return location(`.zeus/collaboration/${taskId(id)}.json`);
  }

  function scopeValue(scope) {
    requireTask(scope && typeof scope === 'object' && !Array.isArray(scope), 'invalid scope');
    requireTask(
      Object.keys(scope).every(key => ['catalog', 'glossary'].includes(key)),
      'unsupported scope field'
    );
    const normalized = {};
    for (const key of ['catalog', 'glossary']) {
      if (scope[key] === undefined) continue;
      requireTask(typeof scope[key] === 'string' && scope[key].length <= 512, 'invalid scope path');
      location(scope[key]);
      normalized[key] = scope[key];
    }
    return normalized;
  }

  function validate(record) {
    requireTask(
      validatePlainData(record, {
        maxDepth: 24,
        maxKeys: 100000,
        maxItems: 10000,
        maxStringBytes: 128 * 1024,
        maxTotalBytes: MAX_RECORD_BYTES,
      }).length === 0,
      'invalid bounded task data'
    );
    requireTask(
      record &&
        typeof record === 'object' &&
        Object.keys(record).every(key => RECORD_KEYS.has(key)),
      'invalid record'
    );
    requireTask(
      record.schemaVersion === 1 && record.kind === 'collaboration-task',
      'unsupported task schema'
    );
    taskId(record.id);
    requireTask(
      JSON.stringify(record.authority) === JSON.stringify(AUTHORITY),
      'invalid authority'
    );
    requireTask(JSON.stringify(record.budget) === JSON.stringify(BUDGET), 'invalid budget');
    requireTask(
      record.usage &&
        Number.isInteger(record.usage.attempts) &&
        record.usage.attempts >= 0 &&
        record.usage.attempts <= BUDGET.maxAttempts,
      'invalid attempt budget'
    );
    requireTask(
      Number.isFinite(record.usage.durationMs) && record.usage.durationMs >= 0,
      'invalid duration'
    );
    requireTask(record.integrity === digest(record), 'record integrity mismatch');
    requireTask(
      Number.isInteger(record.revision) && record.revision >= 1 && record.revision <= MAX_EVENTS,
      'invalid revision'
    );
    requireTask(TASK_STATES.has(record.state), 'invalid state');
    const executing = ['running', 'cancelling'].includes(record.state);
    requireTask(
      executing
        ? record.execution &&
            Number.isSafeInteger(record.execution.pid) &&
            record.execution.pid > 0 &&
            typeof record.execution.host === 'string' &&
            /^[a-f0-9-]{36}$/.test(record.execution.attemptId)
        : record.execution === null,
      'invalid execution owner'
    );
    requireTask(
      Number.isFinite(Date.parse(record.createdAt)) &&
        Number.isFinite(Date.parse(record.updatedAt)),
      'invalid timestamps'
    );
    textValue(record.goal, 'goal');
    scopeValue(record.scope);
    requireTask(
      Array.isArray(record.events) && record.events.length === record.revision,
      'invalid event sequence'
    );
    requireTask(
      Array.isArray(record.messages) && record.messages.length <= MAX_MESSAGES,
      'message budget exceeded'
    );
    record.messages.forEach(message => {
      actorValue(message.actor);
      textValue(message.text, 'message');
      requireTask(
        ['request', 'answer'].includes(message.kind) && Number.isFinite(Date.parse(message.at)),
        'invalid message kind or timestamp'
      );
    });
    record.events.forEach((event, index) => {
      requireTask(
        event.sequence === index + 1 && Number.isFinite(Date.parse(event.at)),
        'invalid event'
      );
    });
    return record;
  }

  function read(id) {
    const file = taskPath(id);
    const stat = fs.lstatSync(file);
    requireTask(stat.isFile() && stat.size <= MAX_RECORD_BYTES, 'invalid task file size');
    const bytes = fs.readFileSync(file);
    requireTask(bytes.length <= MAX_RECORD_BYTES, 'task byte budget exceeded');
    const record = validate(JSON.parse(bytes.toString('utf8')));
    requireTask(record.id === id, 'task identity mismatch');
    return record;
  }

  function store(record) {
    record.integrity = digest(record);
    validate(record);
    const bytes = `${JSON.stringify(record, null, 2)}\n`;
    requireTask(Buffer.byteLength(bytes) <= MAX_RECORD_BYTES, 'task byte budget exceeded');
    const file = taskPath(record.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return structuredClone(record);
  }

  function locked(id, operation, create = false) {
    const file = taskPath(id);
    if (create) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    location(`.zeus/collaboration/${id}.json`);
    const lock = `${file}.lock`;
    const descriptor = fs.openSync(lock, 'wx', 0o600);
    try {
      return operation();
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }

  function taskNames() {
    const directory = location('.zeus/collaboration');
    if (!fs.existsSync(directory)) return [];
    const names = [];
    const entries = fs.opendirSync(directory);
    try {
      let entry;
      let count = 0;
      while ((entry = entries.readSync())) {
        requireTask(++count <= MAX_TASKS * 3, 'directory budget exceeded');
        if (entry.name.endsWith('.json')) names.push(entry.name.slice(0, -5));
      }
    } finally {
      entries.closeSync();
    }
    requireTask(names.length <= MAX_TASKS, 'task count budget exceeded');
    return names;
  }

  function create({ goal, actor = 'human', scope = {} }) {
    const normalizedGoal = textValue(goal, 'goal');
    const normalizedActor = actorValue(actor);
    const normalizedScope = scopeValue(scope);
    const id = `task-${randomUUID()}`;
    return locked(
      id,
      () => {
        const creationLock = location('.zeus/collaboration/create.lock');
        const descriptor = fs.openSync(creationLock, 'wx', 0o600);
        try {
          requireTask(
            taskNames().length < MAX_TASKS,
            'task count budget exceeded; archive explicitly'
          );
          const timestamp = new Date().toISOString();
          return store({
            schemaVersion: 1,
            kind: 'collaboration-task',
            id,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            goal: normalizedGoal,
            scope: normalizedScope,
            authority: { ...AUTHORITY },
            budget: { ...BUDGET },
            usage: { attempts: 0, durationMs: 0 },
            state: 'ready',
            execution: null,
            messages: [
              { actor: normalizedActor, kind: 'request', text: normalizedGoal, at: timestamp },
            ],
            events: [{ sequence: 1, type: 'created', at: timestamp }],
            result: null,
            failureCode: null,
          });
        } finally {
          fs.closeSync(descriptor);
          fs.unlinkSync(creationLock);
        }
      },
      true
    );
  }

  function mutate(id, expectedRevision, eventType, operation) {
    requireTask(
      Number.isInteger(expectedRevision) && expectedRevision > 0,
      'expected revision required'
    );
    return locked(id, () => {
      const record = read(id);
      requireTask(
        record.revision === expectedRevision,
        'revision conflict; reload before continuing'
      );
      requireTask(record.revision < MAX_EVENTS, 'event budget exceeded');
      operation(record);
      record.revision += 1;
      record.updatedAt = new Date().toISOString();
      record.events.push({ sequence: record.revision, type: eventType, at: record.updatedAt });
      return store(record);
    });
  }

  function message(id, { actor, text, expectedRevision }) {
    const normalizedActor = actorValue(actor);
    const normalizedText = textValue(text, 'message');
    return mutate(id, expectedRevision, 'message', record => {
      requireTask(
        !['running', 'cancelling'].includes(record.state),
        'cannot change messages while running'
      );
      requireTask(record.messages.length < MAX_MESSAGES, 'message budget exceeded');
      requireTask(record.revision <= MAX_EVENTS - 4, 'insufficient remaining event budget');
      record.messages.push({
        actor: normalizedActor,
        kind: 'request',
        text: normalizedText,
        at: new Date().toISOString(),
      });
      record.state = 'ready';
      record.result = null;
      record.failureCode = null;
    });
  }

  function readInput(relativePath) {
    const file = location(relativePath);
    const stat = fs.lstatSync(file);
    requireTask(stat.isFile() && stat.size <= BUDGET.maxInputBytes, 'input byte budget exceeded');
    const bytes = fs.readFileSync(file);
    requireTask(bytes.length <= BUDGET.maxInputBytes, 'input byte budget exceeded');
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      reference: {
        path: relativePath,
        hash: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
      },
    };
  }

  async function run(id, { expectedRevision, signal }) {
    requireTask(!signal?.aborted, 'execution already aborted');
    requireTask(
      activeRuns().size < 2 && !activeRuns().has(id),
      'local concurrency budget exceeded'
    );
    const current = read(id);
    requireTask(current.scope.catalog, 'explicit catalog scope required');
    requireTask(
      !['running', 'cancelling'].includes(current.state),
      'task already running; cancellation or owner recovery required'
    );
    requireTask(
      current.state === 'ready',
      'only a ready task can run; add a request before retrying'
    );
    requireTask(
      current.usage.attempts < BUDGET.maxAttempts && current.usage.durationMs < BUDGET.maxTotalMs,
      'execution budget exceeded'
    );
    requireTask(
      current.revision <= MAX_EVENTS - 3 && current.messages.length < MAX_MESSAGES,
      'insufficient remaining conversation budget'
    );
    const catalog = readInput(current.scope.catalog);
    const glossary = current.scope.glossary ? readInput(current.scope.glossary) : null;
    requireTask(
      catalog.reference.bytes + (glossary?.reference.bytes || 0) <= BUDGET.maxInputBytes,
      'combined input byte budget exceeded'
    );
    mutate(id, expectedRevision, 'started', record => {
      record.state = 'running';
      record.execution = { pid: process.pid, host: hostname(), attemptId: randomUUID() };
      record.result = null;
      record.failureCode = null;
      record.usage.attempts += 1;
    });
    const started = performance.now();
    const entry = { worker: null, reason: null, termination: null };
    activeRuns().set(id, entry);
    let timer;
    let cancellationCheck;
    let result = null;
    let outcome = 'failed';
    const abort = () => {
      entry.reason = 'cancelled';
      if (entry.worker && !entry.termination) entry.termination = entry.worker.terminate();
    };
    try {
      const worker = new Worker(path.join(__dirname, 'collaborationWorker.js'), {
        workerData: {
          catalog: catalog.text,
          glossary: glossary?.text || null,
          question: current.messages.findLast(item => item.kind === 'request').text,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 96,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      entry.worker = worker;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const answer = await new Promise((resolve, reject) => {
        worker.once('message', payload =>
          payload.ok ? resolve(payload.result) : reject(new Error('Local retrieval failed'))
        );
        worker.once('error', reject);
        worker.once('exit', () => reject(new Error('Local worker stopped')));
        timer = setTimeout(
          () => {
            entry.reason = 'timeout';
            entry.termination = worker.terminate();
          },
          Math.min(BUDGET.maxWallMs, BUDGET.maxTotalMs - current.usage.durationMs)
        );
        cancellationCheck = setInterval(() => {
          try {
            if (read(id).state === 'cancelling' && !entry.termination) {
              entry.reason = 'cancelled';
              entry.termination = worker.terminate();
            }
          } catch {
            entry.reason = 'invalid-state';
            entry.termination = worker.terminate();
          }
        }, 250);
      });
      requireTask(
        Buffer.byteLength(JSON.stringify(answer)) <= 128 * 1024,
        'result byte budget exceeded'
      );
      const sanitizedAnswer = JSON.parse(JSON.stringify(answer), (key, value) =>
        typeof value === 'string' ? redactAgentText(value) : value
      );
      result = {
        advisory: true,
        sourceOfTruth: false,
        producer: 'deterministic-process-query',
        answer: sanitizedAnswer,
        inputs: {
          catalog: catalog.reference,
          ...(glossary ? { glossary: glossary.reference } : {}),
        },
      };
      outcome = 'completed';
    } catch {
      outcome = entry.reason === 'cancelled' ? 'cancelled' : 'failed';
    } finally {
      clearTimeout(timer);
      clearInterval(cancellationCheck);
      signal?.removeEventListener('abort', abort);
      if (entry.worker) await (entry.termination || entry.worker.terminate());
      activeRuns().delete(id);
      if (activeRuns().size === 0) activeWorkspaces.delete(root);
    }
    const latest = read(id);
    if (latest.state === 'cancelling' || entry.reason === 'cancelled') outcome = 'cancelled';
    let failureCode = null;
    if (outcome === 'failed')
      failureCode = entry.reason === 'timeout' ? 'TASK_TIMEOUT' : 'LOCAL_RETRIEVAL_FAILED';
    return mutate(id, latest.revision, outcome, record => {
      record.state = outcome;
      record.execution = null;
      record.result = outcome === 'completed' ? result : null;
      record.failureCode = failureCode;
      record.usage.durationMs += Math.round(performance.now() - started);
      if (outcome === 'completed') {
        requireTask(record.messages.length < MAX_MESSAGES, 'message budget exceeded');
        const fullAnswer = result.answer.answer;
        record.messages.push({
          actor: 'agent',
          kind: 'answer',
          text: textValue(fullAnswer.slice(0, 3900), 'answer'),
          omittedCharacters: Math.max(0, fullAnswer.length - 3900),
          at: new Date().toISOString(),
        });
      }
    });
  }

  function cancel(id, { expectedRevision }) {
    const current = read(id);
    requireTask(
      current.revision === expectedRevision,
      'revision conflict; reload before continuing'
    );
    if (['cancelling', 'cancelled'].includes(current.state)) return current;
    requireTask(['ready', 'running'].includes(current.state), 'terminal task cannot be cancelled');
    const updated = mutate(id, expectedRevision, 'cancel-requested', record => {
      requireTask(record.revision <= MAX_EVENTS - 2, 'terminal event budget reserved');
      record.state = ['running', 'cancelling'].includes(record.state) ? 'cancelling' : 'cancelled';
      record.result = null;
    });
    const active = activeRuns().get(id);
    if (active?.worker && !active.termination) {
      active.reason = 'cancelled';
      active.termination = active.worker.terminate();
    }
    return updated;
  }

  function recover(id, { expectedRevision }) {
    return mutate(id, expectedRevision, 'interrupted', record => {
      requireTask(
        ['running', 'cancelling'].includes(record.state),
        'only an abandoned execution can be recovered'
      );
      requireTask(record.execution.host === hostname(), 'execution belongs to another host');
      let gone = false;
      try {
        process.kill(record.execution.pid, 0);
      } catch (error) {
        gone = error.code === 'ESRCH';
      }
      requireTask(gone, 'execution owner is alive or unverifiable');
      record.state = 'interrupted';
      record.execution = null;
      record.result = null;
      record.failureCode = 'OWNER_EXITED';
      record.usage.durationMs += BUDGET.maxWallMs;
    });
  }

  function inspectInputIntegrity(task) {
    let inputIntegrity = 'not-checked';
    if (task.result) {
      try {
        inputIntegrity = Object.values(task.result.inputs).every(
          reference => readInput(reference.path).reference.hash === reference.hash
        )
          ? 'unchanged'
          : 'changed';
      } catch {
        inputIntegrity = 'unverifiable';
      }
    }
    return inputIntegrity;
  }

  function handoff(id) {
    const task = read(id);
    const inputIntegrity = inspectInputIntegrity(task);
    const handoffTask = { ...task };
    delete handoffTask.integrity;
    return {
      schemaVersion: 1,
      kind: 'collaboration-handoff',
      approvalGranted: false,
      task: {
        ...handoffTask,
        events: task.events.slice(-4),
        messages: task.messages.slice(-4),
        result: task.result ? { ...task.result, answer: undefined } : null,
      },
      inputIntegrity,
      analysisFreshness: task.result?.answer.freshness || { status: 'unknown' },
      omitted: {
        events: Math.max(0, task.events.length - 4),
        messages: Math.max(0, task.messages.length - 4),
      },
      nextSafeStep:
        'Read the task and explicitly request a local execution; this handoff grants no authority.',
    };
  }

  function list() {
    return taskNames()
      .map(id => {
        const record = read(id);
        return {
          id,
          goal: record.goal.slice(0, 180),
          state: record.state,
          revision: record.revision,
          updatedAt: record.updatedAt,
        };
      })
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
      );
  }

  function providers() {
    const models = providerRegistry
      ? providerRegistry.list().filter(entry => entry.descriptor.kind === 'model')
      : [];
    return {
      schemaVersion: 1,
      kind: 'collaboration-provider-list',
      configured: Boolean(providerRegistry),
      providers: models.slice(0, 32).map(({ descriptor, status }) => ({
        providerId: descriptor.id,
        displayName: descriptor.displayName,
        trustZone: descriptor.trustZone,
        models: descriptor.models.slice(0, 16),
        omittedModels: Math.max(0, descriptor.models.length - 16),
        health: status.health,
        availability: status.availability,
      })),
      omittedProviders: Math.max(0, models.length - 32),
      approvalGranted: false,
      executionAvailable: providerExecutionEnabled === true,
    };
  }

  function providerPreview(id, { expectedRevision, providerId, modelId } = {}) {
    const task = read(id);
    requireTask(task.revision === expectedRevision, 'revision conflict');
    for (const value of [providerId, modelId]) {
      requireTask(
        typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value),
        'explicit provider and model identifiers are required'
      );
    }
    const preview = {
      schemaVersion: 1,
      kind: 'collaboration-provider-preview',
      task: { id: task.id, revision: task.revision, integrity: task.integrity },
      providerId,
      modelId,
      approvalGranted: false,
      executionAvailable: false,
      maxRequestBytes: MAX_PROVIDER_REQUEST_BYTES,
    };
    const finish = (reasonCode, request = null) => {
      const result = {
        ...preview,
        status: request ? 'prepared' : 'blocked',
        reasonCode,
        request,
      };
      return { ...result, previewHash: digest(result) };
    };
    if (!providerRegistry) return finish('PROVIDER_NOT_CONFIGURED');
    const registered = providerRegistry.get(providerId);
    if (!registered) return finish('UNKNOWN_PROVIDER');
    const descriptor = registered.descriptor;
    if (descriptor.kind !== 'model') return finish('PROVIDER_KIND_UNSUPPORTED');
    if (!descriptor.models.includes(modelId)) return finish('MODEL_NOT_SUPPORTED');
    preview.trustZone = descriptor.trustZone;
    preview.providerHash = digest(descriptor);
    preview.egress = evaluateEgressPolicy({
      providerId,
      correlationId: task.id,
      classification: providerClassification,
      trustZone: descriptor.trustZone,
      policy: providerPolicy,
    });
    if (!preview.egress.allowed) return finish(preview.egress.denial.reasonCode);
    preview.policyHash = digest(providerPolicy);
    if (task.state !== 'completed' || !task.result) return finish('LOCAL_RESULT_REQUIRED');
    preview.inputIntegrity = inspectInputIntegrity(task);
    if (preview.inputIntegrity !== 'unchanged') return finish('LOCAL_EVIDENCE_UNVERIFIED');
    const request = {
      schemaVersion: 1,
      contract: contractRef(CONTRACTS.MODEL_REQUEST),
      providerId,
      modelId,
      correlationId: `${task.id}.r${task.revision}`,
      classification: providerClassification,
      input: {
        classification: providerClassification,
        content: {
          advisory: true,
          sourceOfTruth: false,
          instructionAuthority: false,
          question: task.messages.findLast(message => message.kind === 'request').text,
          answer: task.result.answer,
          inputs: Object.fromEntries(
            Object.entries(task.result.inputs).map(([key, reference]) => [
              key,
              { hash: reference.hash, bytes: reference.bytes },
            ])
          ),
          inputIntegrity: preview.inputIntegrity,
          analysisFreshness: task.result.answer.freshness || { status: 'unknown' },
        },
      },
      evidenceReferences: [
        { id: `${task.id}.r${task.revision}`, contract: 'collaboration-task@1' },
      ],
      maxOutputBytes: MAX_PROVIDER_REQUEST_BYTES,
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    if (requestBytes > MAX_PROVIDER_REQUEST_BYTES) return finish('CONTEXT_LIMIT_EXCEEDED');
    const normalized = normalizeRequest('model', request);
    if (!normalized.ok) return finish('PROVIDER_CONTEXT_INVALID');
    if (
      JSON.stringify(
        sanitizeValue(normalized.value, { sensitiveTerms: providerSensitiveTerms })
      ) !== JSON.stringify(normalized.value)
    )
      return finish('PROVIDER_CONTEXT_REDACTED');
    preview.requestBytes = requestBytes;
    return finish(null, normalized.value);
  }

  async function providerInvoke(
    id,
    { expectedRevision, providerId, modelId, previewHash, signal = null } = {}
  ) {
    requireTask(
      typeof previewHash === 'string' && /^[a-f0-9]{64}$/.test(previewHash),
      'an explicit preview hash is required'
    );
    const selection = { expectedRevision, providerId, modelId };
    const preview = providerPreview(id, selection);
    const result = {
      schemaVersion: 1,
      kind: 'collaboration-provider-response',
      task: preview.task,
      providerId,
      modelId,
      previewHash,
      advisory: true,
      sourceOfTruth: false,
      approvalGranted: false,
      status: 'blocked',
      reasonCode: null,
      response: null,
    };
    if (providerExecutionEnabled !== true)
      return { ...result, reasonCode: 'PROVIDER_EXECUTION_DISABLED' };
    if (preview.status !== 'prepared') return { ...result, reasonCode: preview.reasonCode };
    if (preview.previewHash !== previewHash)
      return { ...result, reasonCode: 'PROVIDER_PREVIEW_CHANGED' };
    const activeKey = `${root}\0${id}`;
    if (activeProviderInvocations.has(activeKey) || activeProviderInvocations.size >= MAX_TASKS)
      return { ...result, reasonCode: 'PROVIDER_INVOCATION_BUSY' };
    activeProviderInvocations.add(activeKey);
    try {
      const invocation = await providerRegistry.invoke(providerId, preview.request, {
        policy: providerPolicy,
        timeoutMs: providerTimeoutMs,
        signal,
      });
      if (!invocation.ok)
        return {
          ...result,
          status: invocation.error.code === 'PROVIDER_CANCELLED' ? 'cancelled' : 'failed',
          reasonCode: invocation.error.code,
        };
      let current;
      try {
        current = providerPreview(id, selection);
      } catch {
        return { ...result, status: 'stale', reasonCode: 'PROVIDER_CONTEXT_CHANGED' };
      }
      if (current.previewHash !== previewHash)
        return { ...result, status: 'stale', reasonCode: 'PROVIDER_CONTEXT_CHANGED' };
      return { ...result, status: 'completed', response: invocation.response };
    } finally {
      activeProviderInvocations.delete(activeKey);
    }
  }

  function events(id, afterSequence = 0) {
    requireTask(Number.isInteger(afterSequence) && afterSequence >= 0, 'invalid event cursor');
    const task = read(id);
    return {
      id,
      revision: task.revision,
      state: task.state,
      events: task.events.filter(event => event.sequence > afterSequence).slice(0, 32),
    };
  }

  return Object.freeze({
    create,
    read,
    message,
    run,
    cancel,
    recover,
    handoff,
    list,
    events,
    providers,
    providerPreview,
    providerInvoke,
  });
}

async function executeCollaborationRequest(request, options = {}) {
  requireTask(request && typeof request === 'object' && !Array.isArray(request), 'invalid request');
  const operation = request.operation;
  requireTask(Object.hasOwn(OPERATION_KEYS, operation), 'unsupported operation');
  const allowed = new Set(['operation', ...OPERATION_KEYS[operation]]);
  requireTask(
    Object.keys(request).every(key => allowed.has(key)),
    'unsupported request field'
  );
  const service = createCollaborationService(options);
  const { id, expectedRevision, actor, text, goal, scope, afterSequence } = request;
  let result;
  switch (operation) {
    case 'show':
      result = service.read(id);
      break;
    case 'list':
      result = service.list();
      break;
    case 'providers':
      result = service.providers();
      break;
    case 'handoff':
      result = service.handoff(id);
      break;
    case 'events':
      result = service.events(id, afterSequence);
      break;
    case 'provider-preview':
      result = service.providerPreview(id, {
        expectedRevision,
        providerId: request.providerId,
        modelId: request.modelId,
      });
      break;
    case 'provider-invoke':
      result = await service.providerInvoke(id, {
        expectedRevision,
        providerId: request.providerId,
        modelId: request.modelId,
        previewHash: request.previewHash,
        signal: options.signal,
      });
      break;
    case 'create':
      result = service.create({ goal, actor, scope });
      break;
    case 'message':
      result = service.message(id, { expectedRevision, actor, text });
      break;
    case 'run':
      result = await service.run(id, { expectedRevision, signal: options.signal });
      break;
    case 'recover':
      result = service.recover(id, { expectedRevision });
      break;
    case 'cancel':
      result = service.cancel(id, { expectedRevision });
      break;
  }
  let safetyLevel = 'S1';
  if (['show', 'list', 'handoff', 'events', 'providers', 'provider-preview'].includes(operation))
    safetyLevel = 'S0';
  else if (operation === 'provider-invoke') safetyLevel = 'S2';
  return {
    ok: true,
    schemaVersion: 1,
    operation,
    approvalGranted: false,
    safety: {
      level: safetyLevel,
      mode: operation === 'provider-invoke' ? 'policy-gated-provider' : 'local-only',
    },
    result,
  };
}

module.exports = { createCollaborationService, executeCollaborationRequest };
