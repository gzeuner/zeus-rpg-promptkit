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

const { runAnalyze } = require('../src/cli/commands/analyzeCommand');
const { runImpact } = require('../src/cli/commands/impactCommand');
const { runBundle } = require('../src/cli/commands/bundleCommand');
const { runFetch } = require('../src/cli/commands/fetchCommand');
const { runWorkflow } = require('../src/cli/commands/workflowCommand');

function printHelp() {
  console.log('Usage:');
  console.log('  zeus analyze --source <path> --program <name> [--profile <name>] [--out <path>] [--extensions .rpgle,.rpg] [--mode <name>] [--list-modes] [--list-diagnostic-packs] [--optimize-context] [--scan-ifs-paths] [--search-terms a,b] [--search-ignore path1,path2] [--search-max-results <n>] [--diagnostic-packs a,b] [--diagnostic-params k=v] [--host <hostname>] [--user <username>] [--password <password>] [--safe-sharing] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]');
  console.log('  zeus workflow --preset <name> --source <path> --program <name> [--profile <name>] [--out <path>] [--bundle-output <path>] [--extensions .rpgle,.rpg] [--list-presets] [--safe-sharing] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]');
  console.log('  zeus bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--safe-sharing] [--reproducible] [--profile <name>] [--verbose]');
  console.log('  zeus impact --target <name> [--program <name>] [--out <path>] [--profile <name>] [--source <path>] [--reproducible] [--verbose]');
  console.log('  zeus fetch --host <hostname> --user <username> --password <password> --source-lib <lib> --ifs-dir <ifsPath> --out <localPath> [--files <list>] [--members <list>] [--replace true|false] [--streamfile-ccsid <ccsid>] [--transport auto|sftp|jt400|ftp] [--profile <name>] [--verbose]');
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

  if (command === 'workflow') {
    runWorkflow(args);
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
