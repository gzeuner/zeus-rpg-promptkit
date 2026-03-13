#!/usr/bin/env node

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
const { collectSourceFiles } = require('../src/collector/sourceCollector');
const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildContext } = require('../src/context/contextBuilder');
const { buildPrompts } = require('../src/prompt/promptBuilder');
const { generateMarkdownReport } = require('../src/report/markdownReport');
const { writeJsonReport } = require('../src/report/jsonReport');
const { generateArchitectureReport } = require('../src/report/architectureReport');
const { optimizeContext, DEFAULT_CONTEXT_OPTIMIZER_OPTIONS } = require('../src/ai/contextOptimizer');
const { estimateTokensFromObject, computeReduction } = require('../src/ai/tokenEstimator');
const { generateArchitectureViewer } = require('../src/viewer/architectureViewerGenerator');
const { generateImpactAnalysis, normalizeId } = require('../src/impact/impactAnalyzer');
const { exportDb2Metadata } = require('../src/db2/metadataExportService');
const { exportTestData, DEFAULT_TEST_DATA_LIMIT } = require('../src/db2/testDataExportService');
const { buildOutputBundle } = require('../src/bundle/outputBundleBuilder');
const {
  buildDependencyGraph,
  buildGraphSummary,
} = require('../src/dependency/dependencyGraphBuilder');
const { buildCrossProgramGraph } = require('../src/dependency/crossProgramGraphBuilder');
const {
  renderJson,
  renderMermaid,
  renderMarkdown,
  renderCrossProgramMarkdown,
} = require('../src/dependency/graphSerializer');
const { fetchSources, DEFAULT_SOURCE_FILES, DEFAULT_TRANSPORT } = require('../src/fetch/fetchService');

function printHelp() {
  console.log('Usage:');
  console.log('  zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.rpg] [--optimize-context] [--test-data-limit <n>] [--skip-test-data] [--verbose]');
  console.log('  zeus bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--profile <name>] [--verbose]');
  console.log('  zeus impact --target <name> [--program <name>] [--out <path>] [--profile <name>] [--source <path>] [--verbose]');
  console.log('  zeus fetch --host <hostname> --user <username> --password <password> --source-lib <lib> --ifs-dir <ifsPath> --out <localPath> [--files <list>] [--members <list>] [--replace true|false] [--transport auto|sftp|jt400|ftp] [--profile <name>] [--verbose]');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function loadProfiles() {
  const configDir = path.resolve(process.cwd(), 'config');
  const preferredPath = path.join(configDir, 'profiles.json');
  const fallbackPath = path.join(configDir, 'profiles.example.json');
  const profilePath = fs.existsSync(preferredPath) ? preferredPath : fallbackPath;

  if (!fs.existsSync(profilePath)) {
    return {};
  }

  const raw = fs.readFileSync(profilePath, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function readContextOptimizerConfig(profiles, profile) {
  const globalConfig = profiles && typeof profiles.contextOptimizer === 'object'
    ? profiles.contextOptimizer
    : {};
  const profileConfig = profile && typeof profile.contextOptimizer === 'object'
    ? profile.contextOptimizer
    : {};

  return {
    ...DEFAULT_CONTEXT_OPTIMIZER_OPTIONS,
    ...globalConfig,
    ...profileConfig,
  };
}

function readTestDataConfig(profiles, profile) {
  const globalConfig = profiles && typeof profiles.testData === 'object'
    ? profiles.testData
    : {};
  const profileConfig = profile && typeof profile.testData === 'object'
    ? profile.testData
    : {};

  return {
    limit: DEFAULT_TEST_DATA_LIMIT,
    maskColumns: [],
    ...globalConfig,
    ...profileConfig,
  };
}

function resolveConfig(args) {
  const profiles = loadProfiles();
  const profileName = args.profile;
  const profile = profileName ? profiles[profileName] : null;

  if (profileName && !profile) {
    throw new Error(`Profile "${profileName}" not found in config/profiles.json or config/profiles.example.json`);
  }

  const sourceRoot = args.source || (profile && profile.sourceRoot);
  const outputRoot = args.out || args.output || (profile && profile.outputRoot) || 'output';

  const extensions = args.extensions
    ? String(args.extensions).split(',').map((ext) => ext.trim()).filter(Boolean)
    : ((profile && profile.extensions) || ['.rpg', '.rpgle', '.sqlrpgle', '.rpgile', '.clp', '.clle', '.dds', '.dspf', '.prtf', '.pf', '.lf']);

  return {
    sourceRoot,
    outputRoot,
    extensions,
    db: (profile && profile.db) || null,
    contextOptimizer: readContextOptimizerConfig(profiles, profile),
    testData: readTestDataConfig(profiles, profile),
  };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseCsv(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).map((item) => item.toUpperCase());
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toUpperCase());
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveFetchConfig(args) {
  const profiles = loadProfiles();
  const profileName = args.profile;
  const profile = profileName ? profiles[profileName] : null;
  const fetchProfile = profile ? (profile.fetch || profile) : {};

  if (profileName && !profile) {
    throw new Error(`Profile "${profileName}" not found in config/profiles.json or config/profiles.example.json`);
  }

  return {
    host: args.host || fetchProfile.host,
    user: args.user || fetchProfile.user,
    password: args.password || fetchProfile.password,
    sourceLib: (args['source-lib'] || fetchProfile.sourceLib || '').toUpperCase(),
    ifsDir: args['ifs-dir'] || fetchProfile.ifsDir,
    out: args.out || fetchProfile.out || './rpg_sources',
    files: parseCsv(args.files || fetchProfile.files, [...DEFAULT_SOURCE_FILES]),
    members: parseCsv(args.members || fetchProfile.members, []),
    replace: parseBoolean(args.replace !== undefined ? args.replace : fetchProfile.replace, true),
    transport: (args.transport || fetchProfile.transport || DEFAULT_TRANSPORT).toLowerCase(),
  };
}

function resolveBundleConfig(args) {
  const profiles = loadProfiles();
  const profileName = args.profile;
  const profile = profileName ? profiles[profileName] : null;

  if (profileName && !profile) {
    throw new Error(`Profile "${profileName}" not found in config/profiles.json or config/profiles.example.json`);
  }

  return {
    sourceOutputRoot: args['source-output-root'] || (profile && profile.outputRoot) || 'output',
    bundleOutputRoot: args.output || args.out || 'bundles',
  };
}

function pickSourceSnippet(sourceFiles, programName) {
  if (!sourceFiles || sourceFiles.length === 0) {
    return 'No source files were found.';
  }

  const paths = sourceFiles.map((entry) => (typeof entry === 'string' ? entry : entry.path)).filter(Boolean);
  if (paths.length === 0) {
    return 'No source files were found.';
  }

  const normalizedProgram = String(programName || '').toLowerCase();
  const preferred = paths.find((file) => {
    const base = path.basename(file).toLowerCase();
    return base.startsWith(normalizedProgram);
  }) || paths[0];

  const content = fs.readFileSync(preferred, 'utf8');
  return content.split(/\r?\n/).slice(0, 120).join('\n');
}

function findImpactGraph({ outputRoot, target, program }) {
  const normalizedTarget = normalizeId(target);
  if (!normalizedTarget) {
    throw new Error('Impact analysis requires --target <name>');
  }

  if (program && String(program).trim()) {
    const resolvedProgram = normalizeId(program);
    const outputProgramDir = path.join(outputRoot, resolvedProgram);
    const graphPath = path.join(outputProgramDir, 'program-call-tree.json');
    if (!fs.existsSync(graphPath)) {
      throw new Error(`Cross-program graph not found: ${graphPath}. Run analyze first.`);
    }
    return { program: resolvedProgram, graphPath, outputProgramDir };
  }

  if (!fs.existsSync(outputRoot)) {
    throw new Error(`Output directory not found: ${outputRoot}`);
  }

  const candidateDirs = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const candidates = [];
  for (const directory of candidateDirs) {
    const outputProgramDir = path.join(outputRoot, directory);
    const graphPath = path.join(outputProgramDir, 'program-call-tree.json');
    if (!fs.existsSync(graphPath)) continue;

    const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const nodeIds = new Set(((parsed && parsed.nodes) || []).map((node) => normalizeId(node.id)).filter(Boolean));
    candidates.push({
      program: normalizeId(directory),
      graphPath,
      outputProgramDir,
      hasTarget: nodeIds.has(normalizedTarget),
    });
  }

  if (candidates.length === 0) {
    throw new Error(`No program-call-tree.json found under ${outputRoot}. Run analyze first.`);
  }

  const matching = candidates.filter((entry) => entry.hasTarget);
  if (matching.length > 1) {
    const options = matching.map((entry) => entry.program).join(', ');
    throw new Error(`Target "${normalizedTarget}" found in multiple program graphs (${options}). Use --program to disambiguate.`);
  }
  if (matching.length === 1) {
    return matching[0];
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const options = candidates.map((entry) => entry.program).join(', ');
  throw new Error(`Could not infer graph for target "${normalizedTarget}". Available program outputs: ${options}. Use --program.`);
}

function runAnalyze(args) {
  const verbose = Boolean(args.verbose);
  const optimizeContextEnabled = Boolean(args['optimize-context']);

  const logVerbose = (message) => {
    if (verbose) {
      console.log(`[verbose] ${message}`);
    }
  };

  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  const config = resolveConfig(args);
  if (!config.sourceRoot || !String(config.sourceRoot).trim()) {
    console.error('Missing required option: --source <path>');
    process.exit(2);
  }

  const sourceRoot = path.resolve(process.cwd(), config.sourceRoot);
  const outputRoot = path.resolve(process.cwd(), config.outputRoot);
  const program = String(args.program).trim();
  const testDataLimit = parsePositiveInteger(args['test-data-limit'], Number(config.testData.limit) || DEFAULT_TEST_DATA_LIMIT);
  const skipTestData = Boolean(args['skip-test-data']);

  if (testDataLimit === null) {
    console.error('Invalid option: --test-data-limit must be a positive integer');
    process.exit(2);
  }

  logVerbose(`Program: ${program}`);
  logVerbose(`Source root: ${sourceRoot}`);
  logVerbose(`Output root: ${outputRoot}`);
  logVerbose(`Extensions: ${config.extensions.join(', ')}`);
  logVerbose(`Context optimization: ${optimizeContextEnabled ? 'enabled' : 'disabled'}`);
  logVerbose(`Test data extraction: ${skipTestData ? 'disabled' : `enabled (limit ${testDataLimit})`}`);

  if (!fs.existsSync(sourceRoot)) {
    console.error(`Source directory not found: ${sourceRoot}. Provide a valid --source path.`);
    process.exit(2);
  }

  const sourceFiles = collectSourceFiles(sourceRoot, config.extensions);
  logVerbose(`Collected source files: ${sourceFiles.length}`);
  const scanSummary = scanSourceFiles(sourceFiles);
  const dependencies = {
    tables: scanSummary.tables,
    calls: scanSummary.calls,
    copyMembers: scanSummary.copyMembers,
    sqlStatements: scanSummary.sqlStatements,
  };

  const notes = [...(scanSummary.notes || [])];
  if (sourceFiles.length === 0) {
    const warning = 'No source files found for provided sourceRoot/extensions.';
    notes.push(warning);
    console.warn(`Warning: ${warning}`);
  }

  const context = buildContext({
    program,
    sourceRoot,
    sourceFiles: scanSummary.sourceFiles || [],
    dependencies,
    notes,
    graph: {
      nodeCount: 0,
      edgeCount: 0,
      tableCount: 0,
      programCallCount: 0,
      copyMemberCount: 0,
      files: {
        json: 'dependency-graph.json',
        mermaid: 'dependency-graph.mmd',
        markdown: 'dependency-graph.md',
      },
    },
  });

  const graph = buildDependencyGraph(context);
  context.graph = buildGraphSummary(graph);
  const crossProgramGraph = buildCrossProgramGraph({
    rootProgram: program,
    sourceFiles,
  });
  context.crossProgramGraph = {
    programCount: Number(crossProgramGraph.summary.programCount) || 0,
    tableCount: Number(crossProgramGraph.summary.tableCount) || 0,
    copyMemberCount: Number(crossProgramGraph.summary.copyMemberCount) || 0,
    edgeCount: Number(crossProgramGraph.summary.edgeCount) || 0,
    unresolvedPrograms: crossProgramGraph.unresolvedPrograms || [],
    files: {
      json: 'program-call-tree.json',
      mermaid: 'program-call-tree.mmd',
      markdown: 'program-call-tree.md',
    },
  };

  const sourceSnippet = pickSourceSnippet(scanSummary.sourceFiles, program);
  const contextTokens = estimateTokensFromObject(context);

  let promptContext = context;
  let optimizedContext = null;
  let optimizationReport = null;
  if (optimizeContextEnabled) {
    optimizedContext = optimizeContext(context, config.contextOptimizer);
    const optimizedTokens = estimateTokensFromObject(optimizedContext);
    const reductionPercent = computeReduction(contextTokens, optimizedTokens);
    optimizationReport = {
      enabled: true,
      contextTokens,
      optimizedTokens,
      reductionPercent,
      softTokenLimit: Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit,
      warning: optimizedTokens > (Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit),
    };
    promptContext = optimizedContext;
  } else {
    optimizationReport = {
      enabled: false,
      contextTokens,
      optimizedTokens: contextTokens,
      reductionPercent: 0,
      softTokenLimit: Number(config.contextOptimizer.softTokenLimit) || DEFAULT_CONTEXT_OPTIMIZER_OPTIONS.softTokenLimit,
      warning: false,
    };
  }

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  logVerbose(`Writing output to ${outputProgramDir}`);

  const db2Export = exportDb2Metadata({
    program,
    dependencies: context.dependencies,
    dbConfig: config.db,
    outputDir: outputProgramDir,
    verbose,
  });
  context.db2Metadata = db2Export.summary;
  if (db2Export.notes && db2Export.notes.length > 0) {
    context.notes = Array.from(new Set([...(context.notes || []), ...db2Export.notes])).sort((a, b) => a.localeCompare(b));
  }
  if (optimizedContext) {
    optimizedContext.db2Metadata = db2Export.summary;
    if (db2Export.notes && db2Export.notes.length > 0) {
      optimizedContext.notes = Array.from(new Set([...(optimizedContext.notes || []), ...db2Export.notes])).sort((a, b) => a.localeCompare(b));
    }
  }

  const testDataExport = exportTestData({
    program,
    dependencies: context.dependencies,
    dbConfig: config.db,
    outputDir: outputProgramDir,
    metadataPayload: db2Export.payload,
    testDataConfig: {
      ...config.testData,
      limit: testDataLimit,
    },
    skipTestData,
    verbose,
  });
  context.testData = testDataExport.summary;
  if (testDataExport.notes && testDataExport.notes.length > 0) {
    context.notes = Array.from(new Set([...(context.notes || []), ...testDataExport.notes])).sort((a, b) => a.localeCompare(b));
  }
  if (optimizedContext) {
    optimizedContext.testData = testDataExport.summary;
    if (testDataExport.notes && testDataExport.notes.length > 0) {
      optimizedContext.notes = Array.from(new Set([...(optimizedContext.notes || []), ...testDataExport.notes])).sort((a, b) => a.localeCompare(b));
    }
  }

  writeJsonReport(path.join(outputProgramDir, 'context.json'), context);
  if (optimizedContext) {
    writeJsonReport(path.join(outputProgramDir, 'optimized-context.json'), optimizedContext);
  }
  const programCallTreeJsonPath = path.join(outputProgramDir, 'program-call-tree.json');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.json'), renderJson(graph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.mmd'), renderMermaid(graph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'dependency-graph.md'), renderMarkdown(graph), 'utf8');
  fs.writeFileSync(programCallTreeJsonPath, renderJson(crossProgramGraph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'program-call-tree.mmd'), renderMermaid(crossProgramGraph), 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'program-call-tree.md'), renderCrossProgramMarkdown(crossProgramGraph), 'utf8');
  generateArchitectureViewer({
    graphPath: programCallTreeJsonPath,
    outputPath: path.join(outputProgramDir, 'architecture.html'),
  });
  const reportMarkdown = generateMarkdownReport(context, optimizationReport);
  generateArchitectureReport({
    contextPath: path.join(outputProgramDir, 'context.json'),
    graphPath: path.join(outputProgramDir, 'dependency-graph.json'),
    outputPath: path.join(outputProgramDir, 'architecture-report.md'),
    optimizedContextPath: optimizedContext ? path.join(outputProgramDir, 'optimized-context.json') : null,
    mermaidPath: path.join(outputProgramDir, 'dependency-graph.mmd'),
  });
  buildPrompts({
    context: promptContext,
    outputDir: outputProgramDir,
    sourceSnippet,
  });
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');

  console.log(`Analysis complete for program ${program}`);
  console.log(`Source files scanned: ${(scanSummary.sourceFiles || []).length}`);
  if (optimizationReport.enabled) {
    console.log(`Context tokens: ${optimizationReport.contextTokens}`);
    console.log(`Optimized tokens: ${optimizationReport.optimizedTokens}`);
    console.log(`Reduction: ${optimizationReport.reductionPercent}%`);
    if (optimizationReport.warning) {
      console.warn('Warning: optimized context may exceed safe prompt size.');
    }
  } else {
    console.log(`Context tokens: ${optimizationReport.contextTokens}`);
  }
  console.log(`Output written to: ${outputProgramDir}`);
}

function runImpact(args) {
  const verbose = Boolean(args.verbose);
  const logVerbose = (message) => {
    if (verbose) {
      console.log(`[verbose] ${message}`);
    }
  };

  if (!args.target || !String(args.target).trim()) {
    console.error('Missing required option: --target <name>');
    process.exit(2);
  }

  const config = resolveConfig(args);
  const outputRoot = path.resolve(process.cwd(), config.outputRoot);
  const resolved = findImpactGraph({
    outputRoot,
    target: args.target,
    program: args.program,
  });

  logVerbose(`Target: ${normalizeId(args.target)}`);
  logVerbose(`Graph path: ${resolved.graphPath}`);
  logVerbose(`Output program: ${resolved.program}`);

  const result = generateImpactAnalysis({
    graphPath: resolved.graphPath,
    target: args.target,
    jsonOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.json'),
    markdownOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.md'),
  });

  console.log(`Impact analysis complete for target ${result.target}`);
  console.log(`Type: ${result.type}`);
  console.log(`Total affected programs: ${result.totalAffectedPrograms || 0}`);
  console.log(`Output written to: ${resolved.outputProgramDir}`);
}

function runBundle(args) {
  const verbose = Boolean(args.verbose);

  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  const config = resolveBundleConfig(args);
  const result = buildOutputBundle({
    program: String(args.program).trim(),
    sourceOutputRoot: config.sourceOutputRoot,
    bundleOutputRoot: config.bundleOutputRoot,
    includeJson: args['include-json'] === true,
    includeMd: args['include-md'] === true,
    includeHtml: args['include-html'] === true,
  });

  if (verbose) {
    console.log(`[verbose] Program output: ${result.programOutputDir}`);
    console.log(`[verbose] Bundle output: ${result.bundleOutputRoot}`);
  }

  console.log(`Bundle created for program ${result.program}`);
  console.log(`Files included: ${result.manifest.summary.totalFiles}`);
  console.log(`Bundle written to: ${result.zipPath}`);
}

async function runFetch(args) {
  const verbose = Boolean(args.verbose);
  const config = resolveFetchConfig(args);

  const required = [
    ['host', '--host <hostname>'],
    ['user', '--user <username>'],
    ['password', '--password <password>'],
    ['sourceLib', '--source-lib <lib>'],
    ['ifsDir', '--ifs-dir <ifsPath>'],
    ['out', '--out <localPath>'],
  ];

  for (const [key, flag] of required) {
    if (!config[key] || !String(config[key]).trim()) {
      console.error(`Missing required option: ${flag}`);
      process.exit(2);
    }
  }

  if (verbose) {
    console.log(`[verbose] Fetch host: ${config.host}`);
    console.log(`[verbose] Source library: ${config.sourceLib}`);
    console.log(`[verbose] IFS dir: ${config.ifsDir}`);
    console.log(`[verbose] Local out: ${path.resolve(process.cwd(), config.out)}`);
    console.log(`[verbose] Source files: ${config.files.join(', ')}`);
    console.log(`[verbose] Download transport: ${config.transport}`);
    if (config.members.length > 0) {
      console.log(`[verbose] Members (global filter): ${config.members.join(', ')}`);
    }
  }

  const summary = await fetchSources({
    ...config,
    verbose,
  });

  console.log(`Exported streamfiles: ${summary.exportedSuccess}/${summary.exportedTotal}`);
  console.log(`Downloaded files: ${summary.downloadedCount}`);
  console.log(`Download transport used: ${summary.transportUsed}`);
  console.log(`Local destination: ${summary.localDestination}`);
  if (summary.notes.length > 0) {
    console.log('Notes:');
    for (const note of summary.notes) {
      console.log(`- ${note}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exit(1);
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (command === 'analyze') {
    runAnalyze(args);
    return;
  }

  if (command === 'impact') {
    runImpact(args);
    return;
  }

  if (command === 'bundle') {
    runBundle(args);
    return;
  }

  if (command === 'fetch') {
    await runFetch(args);
    return;
  }

  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
