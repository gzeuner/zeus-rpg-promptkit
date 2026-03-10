#!/usr/bin/env node

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
  console.log('  zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.rpg] [--optimize-context] [--verbose]');
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

  logVerbose(`Program: ${program}`);
  logVerbose(`Source root: ${sourceRoot}`);
  logVerbose(`Output root: ${outputRoot}`);
  logVerbose(`Extensions: ${config.extensions.join(', ')}`);
  logVerbose(`Context optimization: ${optimizeContextEnabled ? 'enabled' : 'disabled'}`);

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
  if (config.db) {
    notes.push('DB profile found. Run java/Db2MetadataExporter.java separately to enrich table metadata.');
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
