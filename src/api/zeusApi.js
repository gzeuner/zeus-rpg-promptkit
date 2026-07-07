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
const { runWorkflowEngine } = require('../workflow/workflowRunner');
const { executeFetch } = require('../core/fetchService');
const { executeAnalyze } = require('../core/analyzeService');
const { executeQueryTable } = require('../core/queryService');
const {
  executeListRuns,
  executeReadArtifact,
  executeReadRun,
  executeReadRunViews,
} = require('../core/runExplorerService');

const { createAnalyzeStageRegistry } = require('../analyze/stageRegistry');
const analyzeStageRegistry = createAnalyzeStageRegistry();

// Populate with core stages on load (for zeus.analyzeStages consumers)
try {
  const { registerCoreAnalyzeStages } = require('../analyze/analyzePipeline');
  registerCoreAnalyzeStages(analyzeStageRegistry);
} catch (e) { /* ignore if circular or early */ }

/**
 * Zeus API - Central service object for extensibility.
 * Inspired by platform patterns for pluggable components and registries.
 * Allows registering custom analyzers, tools, etc.
 */

// Simple registry for pluggable components (analyzers, tools, etc.)
class ComponentRegistry {
  constructor() {
    this.components = new Map();
  }

  register(id, component) {
    if (!id || typeof id !== 'string') {
      throw new Error('Component id must be a non-empty string');
    }
    if (this.components.has(id)) {
      throw new Error(`Component with id ${id} already registered`);
    }
    this.components.set(id, {
      id,
      ...component,
      registeredAt: new Date().toISOString(),
    });
    return this;
  }

  get(id) {
    return this.components.get(id) || null;
  }

  list() {
    return Array.from(this.components.values());
  }

  unregister(id) {
    return this.components.delete(id);
  }
}

// Analyzer registry (for pluggable analysis logic)
class AnalyzerRegistry extends ComponentRegistry {
  registerAnalyzer(id, analyzer) {
    if (typeof analyzer.run !== 'function') {
      throw new Error(`Analyzer ${id} must have a run function`);
    }
    return this.register(id, { type: 'analyzer', ...analyzer });
  }
}

// MCP Tool registry for dynamic tools - delegates to mcp layer
class McpToolRegistry extends ComponentRegistry {
  registerTool(name, toolDef) {
    if (!toolDef || typeof toolDef !== 'object') {
      throw new Error('Tool definition required');
    }
    const { registerMcpTool } = require('../mcp/mcpTools');
    registerMcpTool(name, toolDef);
    return this.register(name, { type: 'mcp-tool', ...toolDef });
  }
}

const analyzers = new AnalyzerRegistry();
const mcpTools = new McpToolRegistry();
const knowledgeProviders = new ComponentRegistry();

// Core functions
async function runWorkflow(profile, preset, options = {}) {
  const { runtime = {}, ...args } = options;
  return runWorkflowEngine({
    profile,
    preset,
    ...args,
  }, runtime);
}

async function fetch(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeFetch({
    profile,
    ...args,
  }, runtime);
}

function analyze(profile, options = {}) {
  const { runtime = {}, analyzers: customAnalyzers, ...args } = options;
  // If custom analyzers passed, temporarily register them for this call
  const tempRegistered = [];
  if (Array.isArray(customAnalyzers)) {
    customAnalyzers.forEach((a, idx) => {
      const id = a.id || `custom-${idx}`;
      analyzers.registerAnalyzer(id, a);
      tempRegistered.push(id);
    });
  }
  try {
    return executeAnalyze({
      profile,
      ...args,
    }, runtime);
  } finally {
    // cleanup temp
    tempRegistered.forEach(id => analyzers.unregister(id));
  }
}

function queryTable(profile, table, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeQueryTable({
    profile,
    table,
    ...args,
  }, runtime);
}

function listRuns(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeListRuns({
    profile,
    ...args,
  }, runtime);
}

function readRun(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRun({
    profile,
    program,
    ...args,
  }, runtime);
}

function readRunViews(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRunViews({
    profile,
    program,
    ...args,
  }, runtime);
}

function readArtifact(profile, program, artifactPath, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadArtifact({
    profile,
    program,
    artifactPath,
    ...args,
  }, runtime);
}

function readKnowledge(options = {}) {
  return {
    available: false,
    status: 'disabled',
    reason: 'Knowledge API is disabled until a final privacy-gated project-neutral catalog exists.',
  };
}

// Central Zeus API object
const zeus = {
  analyze,
  fetch,
  listRuns,
  queryTable,
  readArtifact,
  readKnowledge,
  readRun,
  readRunViews,
  runWorkflow,

  analyzers,
  mcpTools,
  knowledgeProviders,
  components: new ComponentRegistry(),
  analyzeStages: analyzeStageRegistry,

  // Convenience for plugins (inspired by platform extensibility)
  registerPlugin(plugin) {
    if (typeof plugin === 'function') {
      plugin(this);
      return this;
    }
    if (plugin && typeof plugin.register === 'function') {
      plugin.register(this);
      return this;
    }
    if (plugin && plugin.analyzers) {
      Object.entries(plugin.analyzers || {}).forEach(([id, a]) => this.analyzers.registerAnalyzer(id, a));
    }
    return this;
  },

  version: require('../../package.json').version,
};

zeus.ComponentRegistry = ComponentRegistry;
zeus.AnalyzerRegistry = AnalyzerRegistry;
zeus.McpToolRegistry = McpToolRegistry;

module.exports = {
  analyze,
  fetch,
  listRuns,
  queryTable,
  readArtifact,
  readKnowledge,
  readRun,
  readRunViews,
  runWorkflow,

  zeus,
  createZeus: () => ({ ...zeus }),
};
