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
const investigationSession = require('../investigation/investigationSession');
const { executeQueryTable } = require('../core/queryService');
const {
  executeListRuns,
  executeReadArtifact,
  executeReadRun,
  executeReadRunViews,
} = require('../core/runExplorerService');

const { createAnalyzeStageRegistry } = require('../analyze/stageRegistry');
const analyzeStageRegistry = createAnalyzeStageRegistry();

// @ts-ignore - provided by node types / d.ts in scoped check
const path = require('path');
// @ts-ignore - provided by node types / d.ts in scoped check
const fs = require('fs');

// Populate with core stages on load (for zeus.analyzeStages consumers)
try {
  const { registerCoreAnalyzeStages } = require('../analyze/analyzePipeline');
  registerCoreAnalyzeStages(analyzeStageRegistry);
} catch (e) {
  /* ignore if circular or early */
}

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

const { createSchemaRegistry } = require('../core/contracts');
const schemaRegistry = createSchemaRegistry();

// Seed the initial metadata shells from package 02 (additive, no migration)
try {
  const { INITIAL_SCHEMAS } = require('../core/contracts/schemas');
  for (const [id, def] of Object.entries(INITIAL_SCHEMAS)) {
    schemaRegistry.register({ id, version: def.version, schema: def.schema });
  }
} catch (e) {
  // Graceful: callers can always create their own isolated registries.
}

const { createCapabilityRegistry, TINY_VERSION_CAPABILITY } = require('../core/capabilityRegistry');
const capabilityRegistry = createCapabilityRegistry();

try {
  capabilityRegistry.register(TINY_VERSION_CAPABILITY);
  // Foundation only: seal can be called by bootstrap in future packages
} catch (e) {
  // ignore in early load
}

// Package 06: register foundation commands as capabilities (authoritative metadata + execution)
try {
  const { runDoctorChecks } = require('../cli/commands/doctorCommand');
  capabilityRegistry.register({
    id: 'configure.doctor',
    version: 1,
    title: 'Environment Doctor',
    description: 'Validate runtime wiring, Java, and DB/fetch environment contracts.',
    category: 'configure',
    safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
    aliases: ['doctor'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
    docs: { examples: ['zeus doctor --profile dev --probe --show-resolved'], notes: [] },
    execute: async (context, input) => {
      const args = { ...(context && context.args ? context.args : {}), ...input };
      return runDoctorChecks(args);
    },
  });

  capabilityRegistry.register({
    id: 'configure.profiles',
    version: 1,
    title: 'Profiles Overview',
    description: 'List available profiles and show masked connection defaults.',
    category: 'configure',
    safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
    aliases: ['profiles'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
    docs: { examples: ['zeus profiles --profile dev --show-env'], notes: [] },
    execute: async (context, input) => {
      const { loadProfiles, resolveProfile } = require('../config/runtimeConfig');
      const { describeConnectionTarget } = require('../config/connectionTargetMetadata');
      const cwd = (context && context.cwd) || process.cwd();
      const env = (context && context.env) || process.env;
      const args = { ...(context && context.args ? context.args : {}), ...input };
      const profiles = loadProfiles({ cwd, env, args });
      const filterName = args.profile ? String(args.profile).trim() : null;
      const names = Object.keys(profiles || {});
      const toShow = filterName ? names.filter(n => n === filterName) : names; // simplified for cap
      const jsonProfiles = {};
      for (const name of toShow) {
        try {
          jsonProfiles[name] = resolveProfile(profiles, name, { env });
        } catch (_) {
          jsonProfiles[name] = profiles[name];
        }
      }
      return { profiles: jsonProfiles, count: toShow.length };
    },
  });

  // For resources and discover, use the command run for data
  const { runResources } = require('../cli/commands/resourcesCommand');
  capabilityRegistry.register({
    id: 'configure.resources',
    version: 1,
    title: 'Resources',
    description: 'Show resolved resource model (Source/Objects/Metadata/Data) per system.',
    category: 'configure',
    safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
    aliases: ['resources'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
    docs: { examples: ['zeus resources --profile dev --json'], notes: [] },
    execute: async (context, input) => {
      // Since runResources prints, for cap we simulate by calling internal, but for foundation return placeholder structured
      // To keep simple and correct, the cap will be used for metadata; execution for API will be added in later
      const args = { ...(context && context.args ? context.args : {}), ...input };
      // For now, to support direct API, we can invoke a wrapped
      return { message: 'resources capability - see CLI for full', args };
    },
  });

  const { runDiscoverEnvironment } = require('../cli/commands/discoverEnvironmentCommand');
  capabilityRegistry.register({
    id: 'configure.discover-environment',
    version: 1,
    title: 'Discover Environment',
    description:
      'Read-only auto-discovery of libraries/source-files/members/tables + resource suggestion.',
    category: 'configure',
    safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
    aliases: ['discover-environment'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
    docs: { examples: ['zeus discover-environment --profile dev --json'], notes: [] },
    execute: async (context, input) => {
      const args = { ...(context && context.args ? context.args : {}), ...input };
      return { message: 'discover-environment capability', args };
    },
  });

  capabilityRegistry.register({
    id: 'analysis.analyze',
    version: 1,
    title: 'Analyze Workspace',
    description: 'Analyze RPG/CL/DDS and emit structured evidence artifacts.',
    category: 'analysis',
    safety: { level: 'S1', sideEffects: ['local-artifact-write'], requiresExplicitApproval: false },
    aliases: ['analyze'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: true, vscode: true },
    docs: { examples: ['zeus analyze --source ./src --program MYPROG --out ./out'], notes: [] },
    execute: (context, input) => {
      const args = { ...(context && context.args ? context.args : {}), ...input };
      const { executeAnalyze } = require('../core/analyzeService');
      return executeAnalyze(args, { cwd: (context && context.cwd) || process.cwd() });
    },
  });

  capabilityRegistry.register({
    id: 'analysis.workflow',
    version: 1,
    title: 'Workflow Execution',
    description: 'Run preset-guided analyze and bundle flow.',
    category: 'analysis',
    safety: { level: 'S1', sideEffects: ['local-artifact-write'], requiresExplicitApproval: false },
    aliases: ['workflow'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: true, vscode: true },
    docs: {
      examples: [
        'zeus workflow --preset architecture-review --source ./src --program MYPROG --out ./out',
      ],
      notes: [],
    },
    execute: async (context, input) => {
      const args = { ...(context && context.args ? context.args : {}), ...input };
      return runWorkflowEngine(args, {
        cwd: (context && context.cwd) || process.cwd(),
        env: (context && context.env) || process.env,
      });
    },
  });

  const { buildOutputBundle } = require('../bundle/outputBundleBuilder');
  capabilityRegistry.register({
    id: 'bundle.create',
    version: 1,
    title: 'Bundle Creation',
    description: 'Package analysis artifacts for sharing and review.',
    category: 'bundle',
    safety: { level: 'S1', sideEffects: ['local-artifact-write'], requiresExplicitApproval: false },
    aliases: ['bundle'],
    inputContract: null,
    outputContract: null,
    availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
    docs: { examples: ['zeus bundle --program MYPROG --source-output-root ./out'], notes: [] },
    execute: (context, input) => {
      const args = { ...(context && context.args ? context.args : {}), ...input };
      const config = require('../config/runtimeConfig').resolveBundleConfig
        ? require('../config/runtimeConfig').resolveBundleConfig(args)
        : {};
      return buildOutputBundle({
        program: String(args.program || '').trim(),
        sourceOutputRoot: config.sourceOutputRoot || (context && context.cwd),
        bundleOutputRoot: config.bundleOutputRoot,
        includeJson: !!args['include-json'],
        includeMd: !!args['include-md'],
        includeHtml: !!args['include-html'],
        safeSharingEnabled: !!args['safe-sharing'],
        reproducibility:
          require('../reproducibility/reproducibility').normalizeReproducibilitySettings(
            !!args.reproducible
          ),
        artifactPaths: Array.isArray(args['artifact-paths']) ? args['artifact-paths'] : null,
        workflowPreset: args['workflow-preset-settings'] || null,
        bundleFileName: args['bundle-file-name'] || null,
      });
    },
  });

  // Package 08: investigation and review capabilities (additive registration)
  try {
    const { executeImpact } = require('../core/impactService');
    capabilityRegistry.register({
      id: 'investigation.impact',
      version: 1,
      title: 'Impact Analysis',
      description: 'Build reverse-impact evidence for target programs or fields.',
      category: 'investigation',
      safety: {
        level: 'S1',
        sideEffects: ['local-artifact-write'],
        requiresExplicitApproval: false,
      },
      aliases: ['impact'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus impact --target MYFIELD --program MYPROG --out ./out'], notes: [] },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        return executeImpact(args, { cwd: (context && context.cwd) || process.cwd() });
      },
    });

    const { assessCanonicalModel } = require('../impact/riskAssessmentAnalyzer');
    capabilityRegistry.register({
      id: 'investigation.assess-risk',
      version: 1,
      title: 'Assess Risk',
      description: 'Produce risk-oriented summary for a program.',
      category: 'investigation',
      safety: {
        level: 'S1',
        sideEffects: ['local-artifact-write'],
        requiresExplicitApproval: false,
      },
      aliases: ['assess-risk'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus assess-risk --program MYPROG --out ./out'], notes: [] },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        const cwd = (context && context.cwd) || process.cwd();
        const outputRoot = path.resolve(cwd, 'output');
        const program = String(args.program || '')
          .trim()
          .toUpperCase();
        const analysisPath = path.join(outputRoot, program, 'canonical-analysis.json');
        if (!fs.existsSync(analysisPath)) {
          return { error: 'Analysis not found', program };
        }
        const canonical = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        return assessCanonicalModel(canonical, { verbose: !!args.verbose });
      },
    });

    const {
      generateJestTestTemplate,
      generateMarkdownTestPlan,
      generateChangeTestScenario,
    } = require('../investigation/testScenarioGenerator');
    capabilityRegistry.register({
      id: 'investigation.generate-test',
      version: 1,
      title: 'Generate Test',
      description: 'Generate test plan or test template artifacts.',
      category: 'investigation',
      safety: {
        level: 'S1',
        sideEffects: ['local-artifact-write'],
        requiresExplicitApproval: false,
      },
      aliases: ['generate-test'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: {
        examples: ['zeus generate-test --program MYPROG --format markdown --out ./out'],
        notes: [],
      },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        const cwd = (context && context.cwd) || process.cwd();
        const outputRoot = path.resolve(cwd, 'output');
        const program = String(args.program || '')
          .trim()
          .toUpperCase();
        const analysisPath = path.join(outputRoot, program, 'canonical-analysis.json');
        let canonical = null;
        if (fs.existsSync(analysisPath)) {
          try {
            canonical = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
          } catch (_) {}
        }
        const format = String(args.format || 'markdown').toLowerCase();
        if (format === 'jest') {
          return generateJestTestTemplate({
            program,
            canonical,
            critical: !!args.critical,
            change: !!args.change,
          });
        }
        return generateMarkdownTestPlan({ program, canonical });
      },
    });

    const {
      generateDeploymentChecklist,
      estimateDeploymentTimeline,
    } = require('../report/deploymentChecklistBuilder');
    capabilityRegistry.register({
      id: 'investigation.generate-checklist',
      version: 1,
      title: 'Generate Checklist',
      description: 'Generate deployment and change checklist artifacts.',
      category: 'investigation',
      safety: {
        level: 'S1',
        sideEffects: ['local-artifact-write'],
        requiresExplicitApproval: false,
      },
      aliases: ['generate-checklist'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus generate-checklist --program MYPROG --out ./out'], notes: [] },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        const cwd = (context && context.cwd) || process.cwd();
        const outputRoot = path.resolve(cwd, 'output');
        const program = String(args.program || '')
          .trim()
          .toUpperCase();
        const analysisPath = path.join(outputRoot, program, 'canonical-analysis.json');
        let canonical = null;
        if (fs.existsSync(analysisPath)) {
          try {
            canonical = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
          } catch (_) {}
        }
        const checklist = generateDeploymentChecklist({
          program,
          canonical,
          type: args.type,
          impact: args.impact,
          affected: args.affected,
        });
        const timeline = estimateDeploymentTimeline(checklist);
        return { checklist, timeline };
      },
    });

    const { runQAPipeline, generateQAReport } = require('../qa/qaIntegration');
    capabilityRegistry.register({
      id: 'investigation.qa',
      version: 1,
      title: 'QA Validation',
      description: 'Render QA validations/checks to jira, markdown, or json.',
      category: 'investigation',
      safety: {
        level: 'S1',
        sideEffects: ['local-artifact-write'],
        requiresExplicitApproval: false,
      },
      aliases: ['qa'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: {
        examples: ['zeus qa --input ./out/MYPROG --format markdown --strict STRICT'],
        notes: [],
      },
      execute: async (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        const cwd = (context && context.cwd) || process.cwd();
        const inputPath = args.input ? path.resolve(cwd, String(args.input)) : null;
        let canonicalAnalysis = null;
        if (inputPath) {
          const stats = fs.existsSync(inputPath) ? fs.statSync(inputPath) : null;
          const canonicalPath =
            stats && stats.isDirectory()
              ? path.join(inputPath, 'canonical-analysis.json')
              : inputPath;
          if (canonicalPath && fs.existsSync(canonicalPath)) {
            try {
              canonicalAnalysis = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
            } catch (_) {}
          }
        }
        const qaResults = await runQAPipeline(
          { canonicalAnalysis: canonicalAnalysis || {}, sourceFiles: [], config: {} },
          { qa: { qaMode: true, qaStrict: args.strict || 'LENIENT' } }
        );
        const format = args.format || 'markdown';
        return generateQAReport(qaResults, { format });
      },
    });

    const { executeSearchSource } = require('../core/searchSourceService');
    capabilityRegistry.register({
      id: 'investigation.search-source',
      version: 1,
      title: 'Search Source',
      description: 'Searches local source files for term/member/table matches (read-only).',
      category: 'investigation',
      safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
      aliases: ['search-source'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus search-source --source-root ./src --search-term ORDER'], notes: [] },
      execute: async (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input };
        return await executeSearchSource(args, { onWarning: () => {} });
      },
    });

    // field-search uses fieldXrefService; delegate via run with guard for unified path
    capabilityRegistry.register({
      id: 'investigation.field-search',
      version: 1,
      title: 'Field Search',
      description: 'Find field/table usage in local sources and or remote members.',
      category: 'investigation',
      safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
      aliases: ['field-search'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus field-search --profile dev --field MYFIELD --mode all'], notes: [] },
      execute: async (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input, _cap: true };
        const { runFieldSearch } = require('../cli/commands/fieldSearchCommand');
        const r = await runFieldSearch(args);
        return r || { executed: true, via: 'investigation.field-search' };
      },
    });

    // trace and xref
    const { runTrace } = require('../cli/commands/traceCommand');
    capabilityRegistry.register({
      id: 'investigation.trace',
      version: 1,
      title: 'Trace Lineage',
      description: 'Trace data/value lineage across programs and tables.',
      category: 'investigation',
      safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
      aliases: ['trace'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus trace --value 123 --start-table ORDERS'], notes: [] },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input, _cap: true };
        return runTrace(args);
      },
    });

    const { runXref } = require('../cli/commands/xrefCommand');
    capabilityRegistry.register({
      id: 'investigation.xref',
      version: 1,
      title: 'Cross Reference',
      description: 'Fast who-calls / who-uses cross-reference.',
      category: 'investigation',
      safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
      aliases: ['xref'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: { examples: ['zeus xref --program MYPROG'], notes: [] },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input, _cap: true };
        return runXref(args);
      },
    });

    // qa already registered above; investigate uses session
    const { runInvestigate } = require('../cli/commands/investigateCommand');
    capabilityRegistry.register({
      id: 'investigation.investigate',
      version: 1,
      title: 'Investigation',
      description: 'Start or continue a focused, stateful investigation.',
      category: 'investigation',
      safety: { level: 'S0', sideEffects: [], requiresExplicitApproval: false },
      aliases: ['investigate', 'investigation'],
      inputContract: null,
      outputContract: null,
      availability: { cli: true, mcp: true, api: true, viewer: false, vscode: true },
      docs: {
        examples: [
          'zeus investigate --program MYPROG --goal "understand orders" --search "customer"',
        ],
        notes: [],
      },
      execute: (context, input) => {
        const args = { ...(context && context.args ? context.args : {}), ...input, _cap: true };
        return runInvestigate(args);
      },
    });
  } catch (e) {
    // graceful, registration errors are non-fatal in foundation
  }
} catch (e) {
  // graceful
}

// Core functions
async function runWorkflow(profile, preset, options = {}) {
  const { runtime = {}, ...args } = options;
  // Route through capability (package 07)
  const cap =
    capabilityRegistry && capabilityRegistry.resolve
      ? capabilityRegistry.resolve('analysis.workflow')
      : null;
  if (cap && typeof cap.execute === 'function') {
    const ctx = { ...runtime, args: { profile, preset, ...args } };
    const res = await cap.execute(ctx, { profile, preset, ...args });
    if (res && res.ok && res.result) {
      return res.result;
    }
  }
  return runWorkflowEngine(
    {
      profile,
      preset,
      ...args,
    },
    runtime
  );
}

async function fetch(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeFetch(
    {
      profile,
      ...args,
    },
    runtime
  );
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
    // Route through capability (package 07)
    const cap =
      capabilityRegistry && capabilityRegistry.resolve
        ? capabilityRegistry.resolve('analysis.analyze')
        : null;
    if (cap && typeof cap.execute === 'function') {
      const ctx = { ...runtime, args: { profile, ...args } };
      const res = cap.execute(ctx, { profile, ...args });
      if (res && res.ok && res.result) {
        return res.result;
      }
    }
    return executeAnalyze(
      {
        profile,
        ...args,
      },
      runtime
    );
  } finally {
    // cleanup temp
    tempRegistered.forEach(id => analyzers.unregister(id));
  }
}

function queryTable(profile, table, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeQueryTable(
    {
      profile,
      table,
      ...args,
    },
    runtime
  );
}

function listRuns(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeListRuns(
    {
      profile,
      ...args,
    },
    runtime
  );
}

function readRun(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRun(
    {
      profile,
      program,
      ...args,
    },
    runtime
  );
}

function readRunViews(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRunViews(
    {
      profile,
      program,
      ...args,
    },
    runtime
  );
}

function readArtifact(profile, program, artifactPath, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadArtifact(
    {
      profile,
      program,
      artifactPath,
      ...args,
    },
    runtime
  );
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

  // Package 05: unified capability registry foundation (additive)
  capabilities: capabilityRegistry,
  createCapabilityRegistry,

  // Package 02: versioned domain schema registry (additive)
  contracts: {
    schemaRegistry,
    createSchemaRegistry,
  },

  // Investigation Sessions (Prio 1)
  investigations: {
    createOrLoad: investigationSession.createOrLoadSession,
    list: investigationSession.listSessions,
    recordEvent: investigationSession.recordInvestigationEvent,
    updateFocus: investigationSession.updateFocus,
  },

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
      Object.entries(plugin.analyzers || {}).forEach(([id, a]) =>
        this.analyzers.registerAnalyzer(id, a)
      );
    }
    return this;
  },

  version: require('../../package.json').version,
};

zeus.ComponentRegistry = ComponentRegistry;
zeus.AnalyzerRegistry = AnalyzerRegistry;
zeus.McpToolRegistry = McpToolRegistry;
zeus.InvestigationSession = investigationSession; // for advanced use

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

  // Schema / contract foundation (package 02)
  createSchemaRegistry,
  contracts: zeus.contracts,

  // Capability registry foundation (package 05)
  createCapabilityRegistry,
  capabilities: zeus.capabilities,

  zeus,
  createZeus: () => ({ ...zeus }),
};
