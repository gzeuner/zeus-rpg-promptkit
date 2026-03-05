#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { collectSourceFiles } = require('../src/collector/sourceCollector');
const { scanSourceFiles } = require('../src/scanner/rpgScanner');
const { buildContext } = require('../src/context/contextBuilder');
const { buildPrompts } = require('../src/prompt/promptBuilder');
const { generateMarkdownReport } = require('../src/report/markdownReport');
const { writeJsonReport } = require('../src/report/jsonReport');

function printHelp() {
  console.log('Usage: zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.rpg] [--verbose]');
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
  return JSON.parse(raw);
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
    : ((profile && profile.extensions) || ['.rpg', '.rpgle', '.sqlrpgle', '.rpgile', '.clle', '.dds', '.dspf', '.prtf', '.pf', '.lf']);

  return {
    sourceRoot,
    outputRoot,
    extensions,
    db: (profile && profile.db) || null,
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

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exit(1);
  }

  const command = argv[0];
  if (command !== 'analyze') {
    printHelp();
    process.exit(1);
  }

  const args = parseArgs(argv.slice(1));
  const verbose = Boolean(args.verbose);

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
    sourceFiles: scanSummary.sourceFiles || [],
    dependencies,
    notes,
  });

  const sourceSnippet = pickSourceSnippet(scanSummary.sourceFiles, program);
  const prompts = buildPrompts({
    program,
    context,
    sourceSnippet,
  });

  const reportMarkdown = generateMarkdownReport(context);

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });
  logVerbose(`Writing output to ${outputProgramDir}`);

  writeJsonReport(path.join(outputProgramDir, 'context.json'), context);
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'ai_prompt_documentation.md'), prompts.documentation, 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'ai_prompt_error_analysis.md'), prompts.errorAnalysis, 'utf8');

  console.log(`Analysis complete for program ${program}`);
  console.log(`Source files scanned: ${(scanSummary.sourceFiles || []).length}`);
  console.log(`Output written to: ${outputProgramDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
