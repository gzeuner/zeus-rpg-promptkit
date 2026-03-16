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

function finalizeStageState(state, stageReport, stageReports) {
  return {
    ...state,
    stageReports,
    diagnostics: stageReports.flatMap((report) => report.diagnostics || []),
    currentStage: stageReport.id,
  };
}

function runStages(stages, initialState) {
  return stages.reduce((state, stage) => {
    if (!stage || typeof stage.run !== 'function') {
      throw new Error('Invalid analyze stage: missing run function');
    }

    const startedAt = new Date().toISOString();
    const startedNs = process.hrtime.bigint();

    try {
      const result = stage.run(state);
      const durationMs = Number((process.hrtime.bigint() - startedNs) / 1000000n);
      const stageReport = {
        id: stage.id || 'anonymous-stage',
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        metadata: normalizeStageMetadata(result && result.stageMetadata),
        diagnostics: normalizeStageDiagnostics(result && result.stageDiagnostics),
      };
      const nextState = {
        ...(result || {}),
      };
      delete nextState.stageMetadata;
      delete nextState.stageDiagnostics;

      const stageReports = [...(state.stageReports || []), stageReport];
      return finalizeStageState(nextState, stageReport, stageReports);
    } catch (error) {
      const durationMs = Number((process.hrtime.bigint() - startedNs) / 1000000n);
      const stageReport = {
        id: stage.id || 'anonymous-stage',
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs,
        metadata: {},
        diagnostics: [{
          severity: 'error',
          code: 'STAGE_FAILED',
          message: error.message,
        }],
      };
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
