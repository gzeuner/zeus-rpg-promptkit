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
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_EXTENSIONS,
  DEFAULT_WORKFLOW_ANALYZE_MODES,
  DEFAULT_WORKFLOW_STEPS,
  loadProfiles,
  readWorkflowConfig,
  resolveFetchConfig,
  resolveProfile,
  resolveWorkflowPresetConfig,
} = require('../config/runtimeConfig');
const { workflowStepHandlers, WORKFLOW_STEP_ORDER, summarizeError } = require('./workflowSteps');

function buildRunId(now = new Date()) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return iso.replace('T', 'T');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseMembersArg(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toUpperCase()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeWorkflowPlan({ workflowConfig, preset, args, fetchConfig }) {
  const requestedSteps = preset && preset.steps.length > 0
    ? preset.steps
    : [...DEFAULT_WORKFLOW_STEPS];
  const included = new Set(requestedSteps);
  if (!preset && Array.isArray(workflowConfig.impact) && workflowConfig.impact.length > 0) {
    included.add('impact');
  }
  if (!preset && Array.isArray(workflowConfig.tables) && workflowConfig.tables.length > 0) {
    included.add('query-table');
  }

  return {
    presetName: preset ? preset.name : '',
    steps: WORKFLOW_STEP_ORDER.filter((step) => included.has(step)),
    analyzeModes: preset && preset.analyzeModes.length > 0
      ? preset.analyzeModes
      : (workflowConfig.analyzeModes.length > 0 ? workflowConfig.analyzeModes : [...DEFAULT_WORKFLOW_ANALYZE_MODES]),
    members: parseMembersArg(args.members).length > 0
      ? parseMembersArg(args.members)
      : (preset && preset.members.length > 0 ? preset.members : workflowConfig.members),
    tables: preset && preset.tables.length > 0 ? preset.tables : workflowConfig.tables,
    impact: preset && preset.impact.length > 0 ? preset.impact : workflowConfig.impact,
    continueOnError: Boolean(args['continue-on-error']) || Boolean((preset && preset.continueOnError) || workflowConfig.continueOnError),
    fetchConfigured: Boolean(fetchConfig && fetchConfig.host && fetchConfig.user && fetchConfig.password),
  };
}

function createWorkflowPaths(cwd, baseOutputRoot, runId) {
  const runRoot = path.resolve(cwd, baseOutputRoot, 'runs', runId);
  return {
    baseOutputRoot: path.resolve(cwd, baseOutputRoot),
    runRoot,
    fetchRoot: path.join(runRoot, 'fetch'),
    workspaceRoot: path.join(runRoot, 'workspace'),
    analyzeRoot: path.join(runRoot, 'analyze'),
    dbRoot: path.join(runRoot, 'db'),
    reportPath: path.join(runRoot, 'report.md'),
    contextPath: path.join(runRoot, 'context.json'),
    logPath: path.join(runRoot, 'workflow-log.json'),
  };
}

function buildInitialState({ args, cwd, env, profiles, profileName, profile, workflowConfig, plan, fetchConfig, runId, paths }) {
  return {
    args,
    cwd,
    env,
    profiles,
    profileName,
    profile,
    workflowConfig,
    plan,
    fetchConfig,
    runId,
    paths,
    runtime: {
      fetchRoot: paths.fetchRoot,
      workspaceRoot: paths.workspaceRoot,
      analyzeExtensions: Array.from(new Set([...(profile.extensions || DEFAULT_EXTENSIONS), '.txt', '.work'])),
      primaryAnalyzeMode: '',
      analyzeSourceRoot: '',
    },
    status: 'running',
    results: {},
    stepResults: [],
    log: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function writeWorkflowState(state) {
  writeJson(state.paths.contextPath, {
    runId: state.runId,
    profile: state.profileName,
    preset: state.plan.presetName || null,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    plan: state.plan,
    paths: state.paths,
    steps: state.stepResults,
    results: state.results,
  });
  writeJson(state.paths.logPath, state.log);
}

function logWorkflowEvent(state, event) {
  state.log.push({
    at: new Date().toISOString(),
    ...event,
  });
}

async function runWorkflowEngine(args, { cwd = process.cwd(), env = process.env } = {}) {
  if (!args.profile || !String(args.profile).trim()) {
    const error = new Error('Missing required option: --profile <name>');
    error.code = 'PROFILE_REQUIRED';
    throw error;
  }

  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const workflowConfig = readWorkflowConfig(profiles, profile, env);
  const presetName = args.preset || workflowConfig.defaultPreset || '';
  const preset = presetName ? resolveWorkflowPresetConfig(profiles, profile, presetName, env) : null;
  const fetchConfig = resolveFetchConfig({
    ...args,
    out: path.join(args.out || workflowConfig.outputRoot || profile.outputRoot || 'analysis', 'runs', 'placeholder'),
  }, { cwd, env });
  const plan = normalizeWorkflowPlan({
    workflowConfig,
    preset,
    args,
    fetchConfig,
  });
  const runId = buildRunId();
  const paths = createWorkflowPaths(cwd, args.out || workflowConfig.outputRoot || profile.outputRoot || 'analysis', runId);

  ensureDir(paths.runRoot);
  ensureDir(paths.fetchRoot);
  ensureDir(paths.workspaceRoot);
  ensureDir(paths.analyzeRoot);
  ensureDir(paths.dbRoot);

  const state = buildInitialState({
    args,
    cwd,
    env,
    profiles,
    profileName: args.profile,
    profile,
    workflowConfig,
    plan,
    fetchConfig: resolveFetchConfig({
      ...args,
      out: paths.fetchRoot,
    }, { cwd, env }),
    runId,
    paths,
  });
  writeWorkflowState(state);

  for (const stepName of plan.steps) {
    const handler = workflowStepHandlers[stepName];
    if (typeof handler !== 'function') {
      throw new Error(`Workflow step "${stepName}" is not implemented.`);
    }

    const started = Date.now();
    logWorkflowEvent(state, {
      type: 'step-start',
      step: stepName,
    });
    console.log(`[workflow] start ${stepName}`);

    try {
      const stepResult = await handler(state);
      const durationMs = Date.now() - started;
      const entry = {
        name: stepName,
        status: stepResult.status,
        note: stepResult.note || '',
        durationMs,
      };
      state.stepResults.push(entry);
      state.results[stepName] = stepResult.data || {};
      logWorkflowEvent(state, {
        type: 'step-end',
        step: stepName,
        status: stepResult.status,
        durationMs,
      });
      writeWorkflowState(state);
      console.log(`[workflow] ${stepResult.status} ${stepName} (${durationMs} ms)`);

      if (stepResult.status === 'failed' && !plan.continueOnError && stepName !== 'report') {
        state.status = 'failed';
        state.completedAt = new Date().toISOString();
        writeWorkflowState(state);
        return state;
      }
    } catch (error) {
      const durationMs = Date.now() - started;
      const summary = summarizeError(error);
      state.stepResults.push({
        name: stepName,
        status: 'failed',
        note: summary.message,
        durationMs,
      });
      state.results[stepName] = {
        error: summary,
        partial: error.workflowPartial || null,
      };
      logWorkflowEvent(state, {
        type: 'step-error',
        step: stepName,
        durationMs,
        error: summary,
      });
      writeWorkflowState(state);
      console.log(`[workflow] failed ${stepName} (${durationMs} ms)`);
      if (!plan.continueOnError) {
        state.status = 'failed';
        state.completedAt = new Date().toISOString();
        writeWorkflowState(state);
        return state;
      }
    }
  }

  state.status = state.stepResults.some((entry) => entry.status === 'failed') ? 'failed' : 'succeeded';
  state.completedAt = new Date().toISOString();
  writeWorkflowState(state);
  return state;
}

module.exports = {
  buildRunId,
  createWorkflowPaths,
  runWorkflowEngine,
};
