#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { collectSourceFiles } = require('../src/collector/sourceCollector');
const { scanRpgFile } = require('../src/scanner/rpgScanner');
const { aggregateDependencies } = require('../src/scanner/dependencyScanner');
const { buildContext } = require('../src/context/contextBuilder');
const { buildPrompts } = require('../src/prompt/promptBuilder');
const { generateMarkdownReport } = require('../src/report/markdownReport');
const { writeJsonReport } = require('../src/report/jsonReport');

function printHelp() {
  console.log('Usage: zeus analyze --source <dir> --program <name> [--profile <name>] [--output <dir>] [--extensions .rpgle,.rpg]');
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
  const profilePath = path.resolve(process.cwd(), 'config', 'profiles.example.json');
  if (!fs.existsSync(profilePath)) {
    return {};
  }

  const raw = fs.readFileSync(profilePath, 'utf8');
  return JSON.parse(raw);
}

function resolveConfig(args) {
  const profiles = loadProfiles();
  const profileName = args.profile;
  const profile = profileName ? profiles[profileName] : {};

  if (profileName && !profile) {
    throw new Error(`Profile "${profileName}" not found in config/profiles.example.json`);
  }

  const sourceRoot = args.source || profile.sourceRoot || './rpg';
  const outputRoot = args.output || profile.outputRoot || './output';

  const extensions = args.extensions
    ? String(args.extensions).split(',').map((ext) => ext.trim()).filter(Boolean)
    : (profile.extensions || ['.rpgle', '.rpg', '.sqlrpgle', '.rpgleinc']);

  return {
    sourceRoot,
    outputRoot,
    extensions,
    db: profile.db || null,
  };
}

function pickSourceSnippet(sourceFiles, programName) {
  if (!sourceFiles || sourceFiles.length === 0) {
    return 'No source files were found.';
  }

  const normalizedProgram = String(programName || '').toLowerCase();
  const preferred = sourceFiles.find((file) => {
    const base = path.basename(file).toLowerCase();
    return base.startsWith(normalizedProgram);
  }) || sourceFiles[0];

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

  if (!args.program) {
    console.error('Missing required option: --program <name>');
    process.exit(1);
  }

  const config = resolveConfig(args);
  const sourceRoot = path.resolve(process.cwd(), config.sourceRoot);
  const outputRoot = path.resolve(process.cwd(), config.outputRoot);
  const program = String(args.program);

  if (!fs.existsSync(sourceRoot)) {
    console.error(`Source directory not found: ${sourceRoot}`);
    process.exit(1);
  }

  const sourceFiles = collectSourceFiles(sourceRoot, config.extensions);
  const scanResults = sourceFiles.map((filePath) => scanRpgFile(filePath));
  const dependencies = aggregateDependencies(scanResults);

  const notes = [];
  if (sourceFiles.length === 0) {
    notes.push('No source files found for provided sourceRoot/extensions.');
  }
  if (config.db) {
    notes.push('DB profile found. Run java/Db2MetadataExporter.java separately to enrich table metadata.');
  }

  const context = buildContext({
    program,
    sourceFiles,
    dependencies,
    notes,
  });

  const sourceSnippet = pickSourceSnippet(sourceFiles, program);
  const prompts = buildPrompts({
    program,
    context,
    sourceSnippet,
  });

  const reportMarkdown = generateMarkdownReport(context);

  const outputProgramDir = path.join(outputRoot, program);
  fs.mkdirSync(outputProgramDir, { recursive: true });

  writeJsonReport(path.join(outputProgramDir, 'context.json'), context);
  fs.writeFileSync(path.join(outputProgramDir, 'report.md'), reportMarkdown, 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'ai_prompt_documentation.md'), prompts.documentation, 'utf8');
  fs.writeFileSync(path.join(outputProgramDir, 'ai_prompt_error_analysis.md'), prompts.errorAnalysis, 'utf8');

  console.log(`Analysis complete for program ${program}`);
  console.log(`Source files scanned: ${sourceFiles.length}`);
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