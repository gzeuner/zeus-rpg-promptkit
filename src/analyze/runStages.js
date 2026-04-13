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
const {
  normalizeReproducibilitySettings,
  resolveDurationMs,
  resolveTimestamp,
} = require('../reproducibility/reproducibility');

function normalizeStageMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata;
}

function normalizeStageDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  return diagnostics
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      severity: entry.severity === 'error' ? 'error' : (entry.severity === 'warning' ? 'warning' : 'info'),
      message: String(entry.message || '').trim(),
      ...(entry.code ? { code: String(entry.code).trim() } : {}),
      ...(entry.details && typeof entry.details === 'object' ? { details: entry.details } : {}),
    }))
    .filter((entry) => entry.message);
}

function normalizeStageDefinition(stage) {
  if (!stage || typeof stage !== 'object') {
    return null;
  }

  const pluginName = stage.pluginName ? String(stage.pluginName).trim() : '';
  const title = stage.title ? String(stage.title).trim() : '';
  const description = stage.description ? String(stage.description).trim() : '';
  const category = stage.category ? String(stage.category).trim() : '';
  const registrationOrder = Number.isInteger(stage.registrationOrder) ? stage.registrationOrder : null;
  const before = Array.isArray(stage.before) ? stage.before.map((entry) => String(entry).trim()).filter(Boolean) : [];
  const after = Array.isArray(stage.after) ? stage.after.map((entry) => String(entry).trim()).filter(Boolean) : [];

  if (!pluginName && !title && !description && !category && registrationOrder === null && before.length === 0 && after.length === 0) {
    return null;
  }

  return {
    pluginName: pluginName || 'core',
    title: title || null,
    description: description || null,
    category: category || null,
    registrationOrder,
    before,
    after,
  };
}

function normalizeLifecycleHooks(lifecycleHooks) {
  if (!Array.isArray(lifecycleHooks)) {
    return [];
  }

  return lifecycleHooks
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      beforeStage: typeof entry.beforeStage === 'function' ? entry.beforeStage : null,
      afterStage: typeof entry.afterStage === 'function' ? entry.afterStage : null,
      onStageError: typeof entry.onStageError === 'function' ? entry.onStageError : null,
      pluginName: entry.pluginName ? String(entry.pluginName).trim() : 'core',
    }))
    .filter((entry) => entry.beforeStage || entry.afterStage || entry.onStageError);
}

function buildStageLifecycleHandlers(stage, lifecycleHooks) {
  const beforeHandlers = lifecycleHooks
    .map((entry) => entry.beforeStage)
    .filter(Boolean);
  const afterHandlers = lifecycleHooks
    .map((entry) => entry.afterStage)
    .filter(Boolean);
  const errorHandlers = lifecycleHooks
    .map((entry) => entry.onStageError)
    .filter(Boolean);

  if (typeof stage.beforeRun === 'function') {
    beforeHandlers.push((payload) => stage.beforeRun(payload));
  }
  if (typeof stage.afterRun === 'function') {
    afterHandlers.push((payload) => stage.afterRun(payload));
  }
  if (typeof stage.onError === 'function') {
    errorHandlers.push((payload) => stage.onError(payload));
  }

  return {
    beforeHandlers,
    afterHandlers,
    errorHandlers,
  };
}

function invokeLifecycleHandlers(handlers, payload) {
  for (const handler of handlers) {
    handler(payload);
  }
}

function finalizeStageState(state, stageReport, stageReports) {
  return {
    ...state,
    stageReports,
    diagnostics: stageReports.flatMap((report) => report.diagnostics || []),
    currentStage: stageReport.id,
  };
}

function runStages(stages, initialState, options = {}) {
  const lifecycleHooks = normalizeLifecycleHooks(options.lifecycleHooks);
  return stages.reduce((state, stage) => {
    if (!stage || typeof stage.run !== 'function') {
      throw new Error('Invalid analyze stage: missing run function');
    }

    const reproducibility = normalizeReproducibilitySettings(state.reproducibility);
    const startedAt = resolveTimestamp(reproducibility);
    const startedNs = process.hrtime.bigint();
    const { beforeHandlers, afterHandlers, errorHandlers } = buildStageLifecycleHandlers(stage, lifecycleHooks);

    try {
      invokeLifecycleHandlers(beforeHandlers, {
        stage,
        state,
      });
      const result = stage.run(state);
      const durationMs = resolveDurationMs(reproducibility, Number((process.hrtime.bigint() - startedNs) / 1000000n));
      const stageReport = {
        id: stage.id || 'anonymous-stage',
        status: 'completed',
        startedAt,
        completedAt: resolveTimestamp(reproducibility),
        durationMs,
        metadata: normalizeStageMetadata(result && result.stageMetadata),
        diagnostics: normalizeStageDiagnostics(result && result.stageDiagnostics),
        definition: normalizeStageDefinition(stage),
      };
      const nextState = {
        ...(result || {}),
      };
      delete nextState.stageMetadata;
      delete nextState.stageDiagnostics;

      invokeLifecycleHandlers(afterHandlers, {
        stage,
        state,
        nextState,
        stageReport,
      });

      const stageReports = [...(state.stageReports || []), stageReport];
      return finalizeStageState(nextState, stageReport, stageReports);
    } catch (error) {
      const durationMs = resolveDurationMs(reproducibility, Number((process.hrtime.bigint() - startedNs) / 1000000n));
      const stageReport = {
        id: stage.id || 'anonymous-stage',
        status: 'failed',
        startedAt,
        completedAt: resolveTimestamp(reproducibility),
        durationMs,
        metadata: {},
        diagnostics: [{
          severity: 'error',
          code: 'STAGE_FAILED',
          message: error.message,
        }],
        definition: normalizeStageDefinition(stage),
      };
      invokeLifecycleHandlers(errorHandlers, {
        stage,
        state,
        error,
        stageReport,
      });
      error.stageId = stageReport.id;
      error.stageReports = [...(state.stageReports || []), stageReport];
      throw error;
    }
  }, {
    ...initialState,
    stageReports: Array.isArray(initialState && initialState.stageReports) ? initialState.stageReports : [],
    diagnostics: Array.isArray(initialState && initialState.diagnostics) ? initialState.diagnostics : [],
  });
}

module.exports = {
  runStages,
};
