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
const fs = require('fs');
const path = require('path');
const { collectSourceFiles } = require('../collector/sourceCollector');
const { buildSourceCatalog } = require('../source/sourceCatalog');
const { executeFetch, findMissingFetchFields } = require('../core/fetchService');
const { executeCopyToWorkspace } = require('../core/workCopyService');
const { executeAnalyze } = require('../core/analyzeService');
const { executeImpact } = require('../core/impactService');
const { executeQueryTable } = require('../core/queryService');
const { resolveFetchConfig } = require('../config/runtimeConfig');

const WORKFLOW_STEP_ORDER = Object.freeze(['fetch', 'copy', 'analyze', 'impact', 'query-table', 'report']);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    || 'entry';
}

function directoryHasFiles(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return false;
  }
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile()) {
        return true;
      }
      if (entry.isDirectory()) {
        pending.push(path.join(current, entry.name));
      }
    }
  }
  return false;
}

function summarizeError(error) {
  return {
    message: String(error && error.message ? error.message : error || 'Unknown error'),
    code: error && error.code ? String(error.code) : '',
  };
}

function resolveAnalyzeSourceRoot(state) {
  if (state.runtime.workspaceRoot && directoryHasFiles(state.runtime.workspaceRoot)) {
    return state.runtime.workspaceRoot;
  }
  if (state.runtime.fetchRoot && directoryHasFiles(state.runtime.fetchRoot)) {
    return state.runtime.fetchRoot;
  }
  if (state.profile && state.profile.sourceRoot) {
    return path.resolve(state.cwd, state.profile.sourceRoot);
  }
  return '';
}

function discoverMembersForSourceRoot(sourceRoot, extensions) {
  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return [];
  }
  const sourceFiles = collectSourceFiles(sourceRoot, extensions);
  const catalog = buildSourceCatalog({
    sourceRoot,
    sourceFiles,
  });
  return Array.from(catalog.byMemberName.keys()).sort((a, b) => a.localeCompare(b));
}

function resolveWorkflowMembers(state, sourceRoot) {
  const configuredMembers = state.plan.members && state.plan.members.length > 0
    ? state.plan.members
    : [];
  if (configuredMembers.length > 0) {
    return configuredMembers;
  }
  const fetchMembers = state.fetchConfig && Array.isArray(state.fetchConfig.members) && state.fetchConfig.members.length > 0
    ? state.fetchConfig.members
    : [];
  if (fetchMembers.length > 0) {
    return fetchMembers;
  }
  return discoverMembersForSourceRoot(sourceRoot, state.runtime.analyzeExtensions);
}

function buildWorkflowReport(state) {
  const stepLines = state.stepResults.map((step) => `- ${step.name}: ${step.status} (${step.durationMs} ms)${step.note ? ` — ${step.note}` : ''}`).join('\n');
  const analyzeEntries = Array.isArray(state.results.analyze && state.results.analyze.entries)
    ? state.results.analyze.entries
    : [];
  const impactEntries = Array.isArray(state.results.impact && state.results.impact.entries)
    ? state.results.impact.entries
    : [];
  const queryEntries = Array.isArray(state.results['query-table'] && state.results['query-table'].entries)
    ? state.results['query-table'].entries
    : [];

  return `# Zeus Workflow Report

## Run
- Run ID: ${state.runId}
- Profile: ${state.profileName}
- Preset: ${state.plan.presetName || 'none'}
- Status: ${state.status}
- Run Root: ${state.paths.runRoot}

## Steps
${stepLines || '- none'}

## Analyze
${analyzeEntries.length === 0
    ? '- No analyze entries.'
    : analyzeEntries.map((entry) => `- ${entry.member} [${entry.mode}] -> ${entry.outputProgramDir}`).join('\n')}

## Impact
${impactEntries.length === 0
    ? '- No impact entries.'
    : impactEntries.map((entry) => `- ${entry.target} -> ${entry.outputProgramDir}`).join('\n')}

## DB
${queryEntries.length === 0
    ? '- No DB catalog queries.'
    : queryEntries.map((entry) => `- ${entry.tableLookup} -> ${entry.outputPath}`).join('\n')}

## Paths
- Fetch: ${state.paths.fetchRoot}
- Workspace: ${state.paths.workspaceRoot}
- Analyze: ${state.paths.analyzeRoot}
- DB: ${state.paths.dbRoot}
- Context: ${state.paths.contextPath}
`;
}

async function runFetchStep(state) {
  const missing = findMissingFetchFields(state.fetchConfig);
  if (missing.length > 0) {
    return {
      status: 'skipped',
      note: `Fetch configuration incomplete: ${missing.join(', ')}`,
      data: {
        missing,
      },
    };
  }

  ensureDir(state.paths.fetchRoot);
  const execution = await executeFetch({
    ...state.args,
    profile: state.profileName,
    out: state.paths.fetchRoot,
  }, {
    cwd: state.cwd,
    env: state.env,
  });
  state.runtime.fetchRoot = execution.summary.localDestination;

  return {
    status: 'passed',
    note: `Downloaded ${execution.summary.downloadedCount} file(s)`,
    data: execution,
  };
}

async function runCopyStep(state) {
  const sourceRoot = fs.existsSync(state.paths.fetchRoot)
    ? state.paths.fetchRoot
    : path.resolve(state.cwd, state.fetchConfig.out);

  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return {
      status: 'skipped',
      note: `Copy source not found: ${sourceRoot || 'n/a'}`,
      data: {
        sourceRoot,
      },
    };
  }

  ensureDir(state.paths.workspaceRoot);
  const execution = executeCopyToWorkspace({
    ...state.args,
    profile: state.profileName,
  }, {
    cwd: state.cwd,
    env: state.env,
    sourceRoot,
    targetRoot: state.paths.workspaceRoot,
    workCopyMode: 'original',
    force: true,
  });
  state.runtime.workspaceRoot = execution.targetRoot;

  return {
    status: execution.result.errorCount > 0 ? 'failed' : 'passed',
    note: `Copied ${execution.result.copiedCount} member(s)`,
    data: execution,
  };
}

async function runAnalyzeStep(state) {
  const sourceRoot = resolveAnalyzeSourceRoot(state);
  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return {
      status: 'skipped',
      note: 'No analyze source root available.',
      data: {
        sourceRoot,
      },
    };
  }

  const members = resolveWorkflowMembers(state, sourceRoot);
  if (members.length === 0) {
    return {
      status: 'skipped',
      note: 'No members resolved for analysis.',
      data: {
        sourceRoot,
        members,
      },
    };
  }

  const entries = [];
  const errors = [];

  for (const mode of state.plan.analyzeModes) {
    const modeOutputRoot = path.join(state.paths.analyzeRoot, sanitizeFilePart(mode));
    ensureDir(modeOutputRoot);

    for (const member of members) {
      try {
        const execution = executeAnalyze({
          ...state.args,
          profile: state.profileName,
          source: sourceRoot,
          out: modeOutputRoot,
          member,
          mode,
        }, {
          cwd: state.cwd,
        });
        entries.push({
          member,
          mode,
          program: execution.program,
          outputProgramDir: execution.outputProgramDir,
          manifestStatus: execution.analyzeManifest && execution.analyzeManifest.run
            ? execution.analyzeManifest.run.status
            : 'succeeded',
        });
      } catch (error) {
        const summary = summarizeError(error);
        errors.push({
          member,
          mode,
          ...summary,
        });
        if (!state.plan.continueOnError) {
          error.workflowPartial = {
            entries,
            errors,
          };
          throw error;
        }
      }
    }
  }

  state.runtime.analyzeSourceRoot = sourceRoot;
  state.runtime.primaryAnalyzeMode = sanitizeFilePart(state.plan.analyzeModes[0] || 'documentation');

  return {
    status: errors.length > 0 ? 'failed' : 'passed',
    note: `Analyze runs: ${entries.length}, errors: ${errors.length}`,
    data: {
      sourceRoot,
      members,
      analyzeModes: [...state.plan.analyzeModes],
      entries,
      errors,
    },
  };
}

async function runImpactStep(state) {
  const configured = Array.isArray(state.plan.impact) ? state.plan.impact : [];
  if (configured.length === 0) {
    return {
      status: 'skipped',
      note: 'No impact targets configured.',
      data: {
        entries: [],
      },
    };
  }

  const outputRoot = path.join(state.paths.analyzeRoot, state.runtime.primaryAnalyzeMode || 'documentation');
  if (!fs.existsSync(outputRoot)) {
    return {
      status: 'skipped',
      note: `Analyze output not found for impact: ${outputRoot}`,
      data: {
        entries: [],
      },
    };
  }

  const entries = [];
  const errors = [];

  for (const definition of configured) {
    try {
      const execution = executeImpact({
        ...state.args,
        profile: state.profileName,
        source: state.runtime.analyzeSourceRoot,
        out: outputRoot,
        target: definition.target || definition.field,
        field: definition.field || definition.target,
        program: definition.program,
        member: definition.member,
      }, {
        cwd: state.cwd,
      });
      entries.push({
        target: execution.target,
        program: execution.program,
        outputProgramDir: execution.outputProgramDir,
      });
    } catch (error) {
      errors.push({
        target: definition.target || definition.field,
        ...summarizeError(error),
      });
      if (!state.plan.continueOnError) {
        throw error;
      }
    }
  }

  return {
    status: errors.length > 0 ? 'failed' : 'passed',
    note: `Impact runs: ${entries.length}, errors: ${errors.length}`,
    data: {
      entries,
      errors,
    },
  };
}

async function runQueryTableStep(state) {
  const definitions = Array.isArray(state.plan.tables) ? state.plan.tables : [];
  if (definitions.length === 0) {
    return {
      status: 'skipped',
      note: 'No tables configured.',
      data: {
        entries: [],
      },
    };
  }

  ensureDir(state.paths.dbRoot);
  const entries = [];
  const errors = [];

  for (const definition of definitions) {
    try {
      const execution = executeQueryTable({
        ...state.args,
        profile: state.profileName,
        table: definition.table,
        schema: definition.schema || undefined,
        filter: definition.filter || undefined,
      }, {
        cwd: state.cwd,
      });
      const baseName = sanitizeFilePart(`${execution.schema || 'AUTO'}-${execution.table}`);
      const outputPath = path.join(state.paths.dbRoot, `${baseName}.json`);
      fs.writeFileSync(outputPath, `${JSON.stringify({
        table: execution.table,
        schema: execution.schema,
        requestedSchema: execution.requestedSchema,
        filter: execution.filter,
        tableInfo: execution.tableInfo.rows || [],
        columns: execution.columns.rows || [],
      }, null, 2)}\n`, 'utf8');
      entries.push({
        tableLookup: execution.schema ? `${execution.schema}.${execution.table}` : execution.table,
        rowCount: (execution.columns.rows || []).length,
        outputPath,
      });
    } catch (error) {
      errors.push({
        table: definition.table,
        ...summarizeError(error),
      });
      if (!state.plan.continueOnError) {
        throw error;
      }
    }
  }

  return {
    status: errors.length > 0 ? 'failed' : 'passed',
    note: `DB queries: ${entries.length}, errors: ${errors.length}`,
    data: {
      entries,
      errors,
    },
  };
}

async function runReportStep(state) {
  const content = buildWorkflowReport(state);
  fs.writeFileSync(state.paths.reportPath, content, 'utf8');
  return {
    status: 'passed',
    note: `Report written to ${state.paths.reportPath}`,
    data: {
      reportPath: state.paths.reportPath,
    },
  };
}

const workflowStepHandlers = Object.freeze({
  fetch: runFetchStep,
  copy: runCopyStep,
  analyze: runAnalyzeStep,
  impact: runImpactStep,
  'query-table': runQueryTableStep,
  report: runReportStep,
});

module.exports = {
  WORKFLOW_STEP_ORDER,
  buildWorkflowReport,
  discoverMembersForSourceRoot,
  summarizeError,
  workflowStepHandlers,
};
