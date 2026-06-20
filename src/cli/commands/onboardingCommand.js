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

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const {
  loadProfiles,
  getProfilesMetadata,
  resolveProfile,
  resolveProfilesConfigPaths,
} = require('../../config/runtimeConfig');

const EXAMPLE_PROFILE_PATH = 'config/profiles.example.json';
const LOCAL_PROFILE_PATH = 'config/local-only/profiles.json';

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function confirm(rl, prompt = 'Continue? (y/N) ') {
  if (!rl) return true; // non-interactive: assume yes for flow
  const ans = (await question(rl, prompt)).toLowerCase();
  return ans === 'y' || ans === 'yes';
}

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ZEUS ONBOARDING WIZARD - ${title}`);
  console.log('='.repeat(60) + '\n');
}

function printStep(step, total, title) {
  console.log(`\n[Step ${step}/${total}] ${title}\n`);
}

async function ensureProfiles(rl) {
  printStep(1, 8, 'Profile Setup');

  const cwd = process.cwd();
  const localPath = path.join(cwd, LOCAL_PROFILE_PATH);
  const examplePath = path.join(cwd, EXAMPLE_PROFILE_PATH);

  if (fs.existsSync(localPath)) {
    console.log(`✓ Local profile file exists: ${LOCAL_PROFILE_PATH}`);
    const useExisting = await confirm(rl, 'Use existing profiles? (Y/n) ');
    if (useExisting !== false) {
      return localPath;
    }
  }

  if (!fs.existsSync(examplePath)) {
    console.error('ERROR: profiles.example.json not found. Is this a fresh clone?');
    process.exit(1);
  }

  console.log('No local profiles found. Copying example...');
  const profilesDir = path.dirname(localPath);
  if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
  }
  fs.copyFileSync(examplePath, localPath);
  console.log(`✓ Created ${LOCAL_PROFILE_PATH} from example.`);

  console.log('\nIMPORTANT: Edit this file and replace placeholders with your IBM i details.');
  console.log('Or set environment variables (ZEUS_FETCH_HOST, ZEUS_DB_HOST, etc.) - they take precedence.');
  await question(rl, 'Press ENTER after you have reviewed/edited the profile...');

  return localPath;
}

async function selectProfile(rl, profilesPath) {
  printStep(2, 8, 'Select or Create Profile');

  let profiles;
  try {
    profiles = loadProfiles({ cwd: process.cwd(), env: process.env, args: {} });
  } catch (e) {
    console.error('Failed to load profiles:', e.message);
    process.exit(1);
  }

  const names = Object.keys(profiles).filter(k => !k.startsWith('_') && !['qa', 'contextOptimizer', 'analysisLimits', 'testData', 'presets'].includes(k));

  if (names.length > 0) {
    console.log('Available profiles:');
    names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
    const choice = await question(rl, `\nSelect profile number (or enter new name): `);
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < names.length) {
      return names[idx];
    }
    if (choice) return choice.trim();
  }

  const newName = await question(rl, 'Enter new profile name (e.g. dev, prod, myibmi): ');
  return newName || 'dev';
}

async function runDoctor(profile) {
  printStep(3, 8, 'Environment & Connection Check (doctor)');

  console.log(`Running: node cli/zeus.js doctor --profile ${profile} --show-resolved`);
  const result = spawnSync(process.execPath, ['cli/zeus.js', 'doctor', '--profile', profile, '--show-resolved'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    console.log('\nDoctor reported issues. Fix them before continuing.');
  }

  const probe = await confirm('Run with --probe (live remote checks)? (y/N) ');
  if (probe) {
    console.log(`Running: node cli/zeus.js doctor --profile ${profile} --probe --show-resolved`);
    spawnSync(process.execPath, ['cli/zeus.js', 'doctor', '--profile', profile, '--probe', '--show-resolved'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  }
}

async function discoverSource(profile) {
  printStep(4, 8, 'Source Discovery');

  console.log('Common source file libraries on IBM i: QRPGLESRC, QCLSRC, QDDSSRC, QCPYSRC, QSQLSRC, QSRVSRC...');
  const lib = await question('Enter main source library (e.g. APPLIB or QRPGLESRC): ');

  if (lib) {
    console.log(`\nTip: Use this with fetch:`);
    console.log(`  node cli/zeus.js fetch --profile ${profile} --source-lib ${lib}`);
    console.log(`Or set ZEUS_FETCH_SOURCE_LIB=${lib}`);
  }

  const wantSearch = await confirm('Run search-source example after you have sources? (Y/n) ');
  if (wantSearch) {
    console.log('After fetching sources, run e.g.:');
    console.log('  node cli/zeus.js search-source --source-root ./rpg_sources --search-term "ORDER"');
  }
}

async function objectAndTableDiscovery(profile) {
  printStep(5, 8, 'Object & Table Discovery');

  const lib = await question('Library for objects (e.g. PRODLIB or APPDATA): ');
  const pgm = await question('Example program name (optional): ');
  const tbl = await question('Example table name (optional): ');

  if (lib && pgm) {
    console.log(`\nInspect program:`);
    console.log(`  node cli/zeus.js inspect-object --profile ${profile} --lib ${lib} --name ${pgm} --type *PGM`);
  }
  if (lib && tbl) {
    console.log(`Resolve / query table:`);
    console.log(`  node cli/zeus.js resolve-object --profile ${profile} --table ${tbl}`);
    console.log(`  node cli/zeus.js query-table --profile ${profile} --table ${tbl} --schema ${lib}`);
  }

  console.log('\nFor catalog discovery use query-sql against QSYS2.SYSTABLES etc.');
}

async function runFetchOrAnalyze(profile, preSource = null, preProgram = null) {
  printStep(6, 8, 'Fetch Sources or Analyze Local');

  let src = preSource;
  let prog = preProgram;

  if (!src && !preSource) {
    const hasSources = await confirm('Do you have local sources ready (or want to fetch now)? (y/N) ');
    if (hasSources) {
      const doFetch = await confirm('Run fetch now? (requires fetch config) (y/N) ');
      if (doFetch) {
        spawnSync(process.execPath, ['cli/zeus.js', 'fetch', '--profile', profile], { stdio: 'inherit' });
      }
    }
    src = await question('Source directory (default ./rpg_sources): ') || './rpg_sources';
  } else {
    src = src || './rpg_sources';
  }

  if (!prog) {
    prog = await question('Program to analyze (e.g. ORDERPGM, or leave blank to skip): ');
  }

  if (prog) {
    console.log(`\nRecommended first analysis (onboarding preset):`);
    console.log(`  node cli/zeus.js workflow --preset onboarding --profile ${profile} --source ${src} --program ${prog} --out ./output`);
    const runNow = await confirm('Run it now? (y/N) ');
    if (runNow) {
      spawnSync(process.execPath, [
        'cli/zeus.js', 'workflow', '--preset', 'onboarding',
        '--profile', profile, '--source', src, '--program', prog, '--out', './output'
      ], { stdio: 'inherit' });
    }
  }
}

async function finalSteps(profile) {
  printStep(7, 8, 'Review & Next Steps');

  console.log('Typical next commands:');
  console.log(`  node cli/zeus.js doctor --profile ${profile}`);
  console.log(`  node cli/zeus.js analyses list --profile ${profile}`);
  console.log(`  node cli/zeus.js bundle --program <PGM> --source-output-root ./output`);

  console.log('\nFor AI agents:');
  console.log('  - Use the generated ai_prompt_*.md + report.md + canonical-analysis.json');
  console.log('  - Start MCP with limited tools for safe agent use.');

  const mcp = await confirm('Start MCP server now with safe onboarding tools? (y/N) ');
  if (mcp) {
    console.log('Starting MCP (use Ctrl+C to stop later):');
    spawnSync(process.execPath, [
      'cli/zeus.js', 'mcp', 'serve', '--verbose',
      '--allow-tools', 'zeus.health,zeus.doctor,zeus.profiles,zeus.resolve-object,zeus.query-table,zeus.search-source,zeus.validate-rpg-sql'
    ], { stdio: 'inherit' });
  }
}

async function runOnboarding(args = {}) {
  const nonInteractive = !!(args.yes || args['yes'] || args.y || args.nonInteractive || args['non-interactive']);
  const preProfile = args.profile ? String(args.profile).trim() : null;
  const preSource = args.source ? String(args.source).trim() : null;
  const preProgram = args.program ? String(args.program).trim() : null;

  if (nonInteractive && !preProfile) {
    console.error('Non-interactive mode (--yes) requires --profile');
    process.exit(2);
  }

  const rl = nonInteractive ? null : createInterface();

  try {
    printHeader('Welcome');

    console.log('This wizard helps you connect Zeus to a new IBM i system and run your first analysis safely.');
    console.log('All actions are read-oriented by default. You stay in control.\n');

    if (rl && !await confirm(rl, 'Start the onboarding wizard? (Y/n) ')) {
      console.log('Aborted.');
      return;
    }

    let profile = preProfile;
    if (!profile) {
      const profilesPath = await ensureProfiles(rl);
      profile = await selectProfile(rl, profilesPath);
    } else {
      console.log(`Using pre-selected profile: ${profile}`);
    }

    await runDoctor(profile);

    if (preSource) {
      console.log(`Using pre-provided source root: ${preSource}`);
    }
    await discoverSource(profile);

    await objectAndTableDiscovery(profile);

    const effectiveSource = preSource || './rpg_sources';
    const effectiveProgram = preProgram;
    await runFetchOrAnalyze(profile, effectiveSource, effectiveProgram);

    printStep(8, 8, 'Wrap-up');
    console.log('\n✓ Onboarding wizard complete.');
    console.log(`Profile in use: ${profile}`);
    console.log('Review the generated ./output directory (if any).');
    console.log('See docs/quickstart/onboarding-new-ibm-i.md for full details.\n');

    await finalSteps(profile);

    // Generate a simple setup script for repeatability
    const setupScript = generateSetupScript(profile, preSource, preProgram);
    const setupPath = path.join(process.cwd(), 'onboarding-setup.sh');
    fs.writeFileSync(setupPath, setupScript, 'utf8');
    console.log(`\nGenerated repeatable setup script: ${setupPath}`);
    console.log('Source it or run it in future sessions.');

  } finally {
    if (rl) rl.close();
  }
}

function generateSetupScript(profile, source, program) {
  const src = source || '${ZEUS_SOURCE_ROOT:-./rpg_sources}';
  const prog = program || 'YOUR_PROGRAM';
  return `#!/bin/bash
# Generated by zeus-onboarding-wizard
# Source this or run to prepare environment for profile: ${profile}

# Load your env (adjust as needed)
# source ./config/load-env.sh project

echo "Using profile: ${profile}"
node cli/zeus.js doctor --profile ${profile} --show-resolved

# Example discovery
# node cli/zeus.js resolve-object --profile ${profile} --table YOUR_TABLE

# First analysis example
# node cli/zeus.js workflow --preset onboarding --profile ${profile} --source ${src} --program ${prog} --out ./output

echo "Onboarding setup ready. See docs/quickstart/onboarding-new-ibm-i.md"
`;
}

module.exports = {
  runOnboarding,
  run: runOnboarding,
};
