'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  maskSecretsInText,
  maskSensitiveTermsInText,
  collectSensitiveTermsFromEnv,
} = require('../security/secretMasking');
const { validateWorkspacePath } = require('../generationValidation/pathSafety');

const EXPERIENCE_SCHEMA_VERSION = 1;
const DEFAULT_EXPERIENCE_LOG = '.zeus/agent-experience.jsonl';
const MAX_TEXT_LENGTH = 1600;
const MAX_TAGS = 12;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_LOG_LINES = 5000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const OUTCOMES = Object.freeze(['success', 'partial', 'failed', 'blocked']);
const EVENT_TYPES = Object.freeze(['failure', 'outcome', 'lesson']);
const SAFE_TEXT_FIELDS = Object.freeze([
  'goal',
  'command',
  'failureCode',
  'symptom',
  'workaround',
  'lesson',
  'nextStep',
  'sessionId',
  'profile',
  'program',
]);

const SECRET_OPTION_PATTERN =
  /(--?(?:password|passwd|pwd|pass|secret|token|api[-_]?key|authorization|auth|credential|credentials|private[-_]?key|license)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi;

function createExperienceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function truncateText(value) {
  const text = String(value || '').trim();
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

function redactAgentText(value) {
  if (value === undefined || value === null) return '';
  const sensitiveTerms = collectSensitiveTermsFromEnv(process.env);
  let text = maskSecretsInText(String(value));
  text = maskSensitiveTermsInText(text, sensitiveTerms);
  text = text.replace(SECRET_OPTION_PATTERN, '$1[REDACTED]');
  return truncateText(text);
}

function normalizeEnum(value, allowed, label, fallback = null) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized && fallback !== null) return fallback;
  if (!allowed.includes(normalized)) {
    throw createExperienceError(
      'TOOL_INVALID_ARGUMENTS',
      `${label} must be one of: ${allowed.join(', ')}`
    );
  }
  return normalized;
}

function normalizeCode(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.-]/g, '_')
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [];
  for (const item of raw) {
    const tag = redactAgentText(item)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function resolveExperienceLogPath({ cwd = process.cwd(), out = DEFAULT_EXPERIENCE_LOG } = {}) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const raw = String(out || DEFAULT_EXPERIENCE_LOG).trim();
  const result = validateWorkspacePath(raw, {
    workspaceRoot,
    allowedRelativeRoots: ['.zeus'],
    allowAbsolute: false,
  });
  if (!result.ok) {
    throw createExperienceError(
      'PATH_OUTSIDE_WORKSPACE',
      'Agent experience log must be a relative JSONL path inside .zeus/.'
    );
  }
  if (!result.relativePath.toLowerCase().endsWith('.jsonl')) {
    throw createExperienceError('TOOL_INVALID_ARGUMENTS', 'Agent experience log must use .jsonl.');
  }
  return {
    workspaceRoot,
    relativePath: result.relativePath,
    absolutePath: result.absolutePath,
  };
}

function normalizeRecordedAt(value) {
  if (value == null || String(value).trim() === '') return new Date().toISOString();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw createExperienceError('TOOL_INVALID_ARGUMENTS', 'recordedAt must be a valid timestamp.');
  }
  return date.toISOString();
}

function normalizeExperienceEvent(input = {}) {
  const outcome = normalizeEnum(input.outcome, OUTCOMES, 'outcome');
  const event = normalizeEnum(
    input.event,
    EVENT_TYPES,
    'event',
    outcome === 'success' ? 'outcome' : 'failure'
  );
  const command = redactAgentText(input.command);
  if (!command) {
    throw createExperienceError(
      'TOOL_INVALID_ARGUMENTS',
      'command is required for an experience record.'
    );
  }

  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    eventId: redactAgentText(input.eventId) || crypto.randomUUID(),
    recordedAt: normalizeRecordedAt(input.recordedAt),
    event,
    outcome,
    failureCode: normalizeCode(input.failureCode, outcome === 'success' ? 'NONE' : 'UNCLASSIFIED'),
    goal: redactAgentText(input.goal) || null,
    command,
    symptom: redactAgentText(input.symptom) || null,
    workaround: redactAgentText(input.workaround) || null,
    lesson: redactAgentText(input.lesson) || null,
    nextStep: redactAgentText(input.nextStep) || null,
    sessionId: redactAgentText(input.sessionId) || null,
    profile: redactAgentText(input.profile) || null,
    program: redactAgentText(input.program) || null,
    tags: normalizeTags(input.tags || input.tag),
    redaction: {
      applied: true,
      policy: 'secretMasking+credential-option-redaction',
    },
  };
}

function appendAgentExperience(input = {}, options = {}) {
  const location = resolveExperienceLogPath(options);
  const event = normalizeExperienceEvent(input);
  fs.mkdirSync(path.dirname(location.absolutePath), { recursive: true });
  fs.appendFileSync(location.absolutePath, `${JSON.stringify(event)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(location.absolutePath, 0o600);
  } catch {
    // chmod is not supported or meaningful on every platform; the path is still workspace-bound.
  }
  return {
    ok: true,
    operation: 'record',
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    path: location.relativePath,
    event,
  };
}

function normalizeStoredEvent(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const event = {};
  for (const field of SAFE_TEXT_FIELDS) {
    event[field] = parsed[field] == null ? null : redactAgentText(parsed[field]);
  }
  const outcome = String(parsed.outcome || '').toLowerCase();
  const eventType = String(parsed.event || '').toLowerCase();
  if (!OUTCOMES.includes(outcome) || !EVENT_TYPES.includes(eventType) || !event.command)
    return null;
  event.schemaVersion = EXPERIENCE_SCHEMA_VERSION;
  event.eventId = redactAgentText(parsed.eventId) || 'legacy-event';
  event.recordedAt = normalizeRecordedAt(parsed.recordedAt);
  event.event = eventType;
  event.outcome = outcome;
  event.failureCode = normalizeCode(
    parsed.failureCode,
    outcome === 'success' ? 'NONE' : 'UNCLASSIFIED'
  );
  event.tags = normalizeTags(parsed.tags);
  event.redaction = {
    applied: true,
    policy: 'secretMasking+credential-option-redaction',
  };
  return event;
}

function buildExperienceSummary(events) {
  const byOutcome = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
  const byFailureCode = new Map();
  for (const event of events) {
    byOutcome[event.outcome] += 1;
    if (event.outcome !== 'success') {
      byFailureCode.set(event.failureCode, (byFailureCode.get(event.failureCode) || 0) + 1);
    }
  }
  const recurringFailureCodes = [...byFailureCode.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([failureCode, count]) => ({ failureCode, count }));
  const lessons = events
    .filter(event => event.lesson)
    .slice(-10)
    .reverse()
    .map(event => ({
      eventId: event.eventId,
      failureCode: event.failureCode,
      lesson: event.lesson,
    }));
  return { total: events.length, byOutcome, recurringFailureCodes, lessons };
}

function listAgentExperience(options = {}) {
  const location = resolveExperienceLogPath(options);
  if (!fs.existsSync(location.absolutePath)) {
    return {
      ok: true,
      operation: 'list',
      schemaVersion: EXPERIENCE_SCHEMA_VERSION,
      path: location.relativePath,
      exists: false,
      eventCount: 0,
      malformedCount: 0,
      truncated: false,
      events: [],
      summary: buildExperienceSummary([]),
    };
  }
  const stats = fs.statSync(location.absolutePath);
  if (stats.size > MAX_LOG_BYTES) {
    throw createExperienceError(
      'AGENT_EXPERIENCE_LOG_TOO_LARGE',
      'Agent experience log is too large; archive it before reading more records.'
    );
  }
  const lines = fs.readFileSync(location.absolutePath, 'utf8').split(/\r?\n/).filter(Boolean);
  const parsedEvents = [];
  let malformedCount = 0;
  for (const line of lines.slice(-MAX_LOG_LINES)) {
    try {
      const event = normalizeStoredEvent(JSON.parse(line));
      if (event) parsedEvents.push(event);
      else malformedCount += 1;
    } catch {
      malformedCount += 1;
    }
  }
  const limitRaw = options.limit == null ? DEFAULT_LIST_LIMIT : Number(options.limit);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;
  return {
    ok: true,
    operation: 'list',
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    path: location.relativePath,
    exists: true,
    eventCount: parsedEvents.length,
    malformedCount,
    truncated: lines.length > MAX_LOG_LINES,
    events: parsedEvents.slice(-limit).reverse(),
    summary: buildExperienceSummary(parsedEvents),
  };
}

module.exports = {
  DEFAULT_EXPERIENCE_LOG,
  EVENT_TYPES,
  EXPERIENCE_SCHEMA_VERSION,
  MAX_LIST_LIMIT,
  OUTCOMES,
  appendAgentExperience,
  buildExperienceSummary,
  listAgentExperience,
  normalizeExperienceEvent,
  redactAgentText,
  resolveExperienceLogPath,
};
