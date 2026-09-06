'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildWorkingContextView } = require('../context/workingContext');
const { loadProfiles } = require('../config/runtimeConfig');
const { listAgentExperience } = require('./agentExperience');
const { buildCliAgentBootstrapPayload, readPackageVersion } = require('./agentBootstrap');
const { buildCliWorkflowSuggestion } = require('./workflowSuggestion');
const { sanitizeValue } = require('../security/secretMasking');

const PREFLIGHT_SCHEMA_VERSION = 1;
const GLOBAL_PROFILE_KEYS = new Set(['contextOptimizer', 'testData', 'analysisLimits', 'presets']);

function readProfileInventory({ cwd, args = {} } = {}) {
  try {
    const profiles = loadProfiles({ cwd, env: process.env, args });
    const names = Object.keys(profiles)
      .filter(name => !GLOBAL_PROFILE_KEYS.has(name) && !name.startsWith('_'))
      .sort((left, right) => left.localeCompare(right));
    return {
      status: names.length > 0 ? 'available' : 'empty',
      count: names.length,
      names,
      failureCode: null,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      count: 0,
      names: [],
      failureCode: String(error.code || 'PROFILE_CONFIG_UNAVAILABLE'),
      message: sanitizeValue(error.message || 'Profile configuration could not be loaded.'),
    };
  }
}

function buildContextSummary(context) {
  const active = context.active || {};
  return {
    activeKind: context.activeKind,
    profile: context.profile || active.profile || null,
    active: {
      system: active.system || null,
      library: active.library || active.schema || null,
      sourceFile: active.sourceFile || null,
      table: active.table || null,
      member: active.member || null,
      localRoot: active.localRoot || null,
      path: active.path || null,
      ifsPath: active.ifsPath || null,
    },
    updatedAt: context.updatedAt || null,
    containsCredentials: false,
  };
}

function buildPreflightSuggestion({ goal, profile, program, source, out } = {}) {
  const normalizedGoal = String(goal || '').trim();
  if (!normalizedGoal) return null;
  return buildCliWorkflowSuggestion({
    goal: normalizedGoal,
    profile: profile || null,
    program: program || null,
    source: source || null,
    out: out || null,
  });
}

function readExperienceInventory({ cwd, limit, goal } = {}) {
  try {
    return listAgentExperience({ cwd, limit, goal });
  } catch (error) {
    return {
      ok: false,
      operation: 'list',
      schemaVersion: 1,
      path: '.zeus/agent-experience.jsonl',
      exists: true,
      eventCount: 0,
      malformedCount: 0,
      truncated: false,
      events: [],
      summary: {
        total: 0,
        byOutcome: { success: 0, partial: 0, failed: 0, blocked: 0 },
        recurringFailureCodes: [],
        lessons: [],
      },
      intelligence: {
        recurringFailures: [],
        reusableLessons: [],
        goal: goal ? sanitizeValue(goal) : null,
        matchedEventCount: 0,
        suggestions: [],
      },
      failureCode: String(error.code || 'AGENT_EXPERIENCE_UNAVAILABLE'),
      message: sanitizeValue(error.message || 'Agent experience could not be read.'),
    };
  }
}

function buildCliAgentPreflightPayload({
  cwd = process.cwd(),
  goal = null,
  profile = null,
  program = null,
  source = null,
  out = null,
  experienceLimit = 5,
} = {}) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const context = buildWorkingContextView({ cwd: workspaceRoot, includeStoragePath: false });
  const effectiveProfile =
    String(profile || '').trim() || context.profile || context.active?.profile || null;
  const profileInventory = readProfileInventory({
    cwd: workspaceRoot,
    args: effectiveProfile ? { profile: effectiveProfile } : {},
  });
  const normalizedGoal = String(goal || '').trim() || null;
  const experience = readExperienceInventory({
    cwd: workspaceRoot,
    limit: experienceLimit,
    goal: normalizedGoal,
  });
  const suggestion = buildPreflightSuggestion({
    goal: normalizedGoal,
    profile: effectiveProfile,
    program,
    source,
    out,
  });
  const contextStatePath = path.resolve(workspaceRoot, '.zeus', 'working-context.json');
  const status = profileInventory.status === 'unavailable' ? 'needs-attention' : 'ready';

  const bootstrap = buildCliAgentBootstrapPayload();
  const nextCommands = normalizedGoal
    ? [
        suggestion.next,
        'node cli/zeus.js agent prompt --goal "<goal>" --json',
        'node cli/zeus.js tools describe <command> --json',
      ]
    : [
        'node cli/zeus.js agent log list --json',
        'node cli/zeus.js tools guide --json',
        'node cli/zeus.js context show --json',
        'node cli/zeus.js agent suggest --goal "<goal>" --json',
      ];

  return {
    ok: true,
    operation: 'preflight',
    service: 'zeus-rpg-promptkit',
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    status,
    packageVersion: readPackageVersion(),
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    readOnly: true,
    executionStarted: false,
    workspace: {
      root: workspaceRoot,
      stateDirectory: '.zeus',
      contextStatePath: contextStatePath,
    },
    goal: normalizedGoal,
    effectiveProfile,
    context: buildContextSummary(context),
    profileInventory,
    experience: {
      path: experience.path,
      exists: experience.exists,
      eventCount: experience.eventCount,
      recentEvents: experience.events,
      summary: experience.summary,
      intelligence: experience.intelligence,
    },
    capabilities: {
      cli: true,
      localReadOnly: true,
      localArtifactGeneration: true,
      remoteReadOnly: Boolean(effectiveProfile),
      controlledWrites: true,
      mcp: 'optional-adapter',
      commandDiscovery: bootstrap.discovery,
    },
    checks: {
      localWorkspace: { status: 'ready', safety: 'S0' },
      workingContext: {
        status: fs.existsSync(contextStatePath) ? 'configured' : 'not-configured',
        safety: 'S0',
      },
      profileCatalog: {
        status: profileInventory.status,
        safety: 'S0',
        failureCode: profileInventory.failureCode,
      },
      experienceLog: {
        status: experience.ok === false ? 'unavailable' : experience.exists ? 'available' : 'empty',
        safety: 'S0',
        failureCode: experience.failureCode || null,
      },
    },
    suggestion,
    warnings:
      profileInventory.status === 'unavailable'
        ? ['Profile catalog could not be loaded; local-only orientation remains available.']
        : [],
    nextCommands,
    sessionPrompt: {
      available: Boolean(normalizedGoal),
      command: 'node cli/zeus.js agent prompt --goal "<goal>" --json',
      requiresGoal: !normalizedGoal,
    },
    docs: bootstrap.docs,
    safety: {
      level: 'S0',
      approvalRequired: false,
      rule: 'Preflight only inspects local metadata and does not contact remote systems or execute a workflow.',
    },
  };
}

module.exports = {
  GLOBAL_PROFILE_KEYS,
  PREFLIGHT_SCHEMA_VERSION,
  buildCliAgentPreflightPayload,
  buildContextSummary,
  readProfileInventory,
  readExperienceInventory,
};
