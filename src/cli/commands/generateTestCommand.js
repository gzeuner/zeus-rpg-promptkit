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

const fs = require('fs');
const path = require('path');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const { generateJestTestTemplate, generateMarkdownTestPlan, generateChangeTestScenario } = require('../../investigation/testScenarioGenerator');

async function runGenerateTest(args) {
  const verbose = Boolean(args.verbose);

  // Validate arguments
  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  try {
    const program = String(args.program).trim().toUpperCase();
    const cwd = process.cwd();
    const config = resolveAnalyzeConfig(args, { cwd });
    const outputRoot = path.resolve(cwd, config.outputRoot);
    const programDir = path.join(outputRoot, program);

    // Check if analysis exists
    const analysisPath = path.join(programDir, 'canonical-analysis.json');
    if (!fs.existsSync(analysisPath)) {
      console.error(`Analysis not found for program "${program}" at ${analysisPath}`);
      console.error('Run "zeus analyze --program ' + program + '" first.');
      process.exit(2);
    }

    const canonicalAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    const format = String(args.format || 'markdown').trim().toLowerCase();
    if (format !== 'markdown' && format !== 'jest') {
      console.error(`Invalid format "${format}". Use --format markdown or --format jest.`);
      process.exit(2);
    }
    const isCritical = args.critical === true || args.critical === 'true';

    if (verbose) {
      console.log(`[verbose] Program: ${program}`);
      console.log(`[verbose] Format: ${format}`);
      console.log(`[verbose] Analysis path: ${analysisPath}`);
    }

    // Generate based on format
    let output;
    let extension;

    if (format === 'jest') {
      output = generateJestTestTemplate(program, canonicalAnalysis, { isCritical });
      extension = '.test.js';
    } else {
      output = generateMarkdownTestPlan(program, canonicalAnalysis, { isCriticalPath: isCritical });
      extension = '.test-plan.md';
    }

    // If --change is specified, add change-specific scenario
    if (args.change) {
      const changeScenario = generateChangeTestScenario(program, {
        table: args.table || 'UNKNOWN',
        column: args.column || 'UNKNOWN',
        oldType: args.oldType,
        newType: args.newType,
        affectedPrograms: args.affectedPrograms ? args.affectedPrograms.split(',').map((p) => ({ name: p, accessType: 'UNKNOWN' })) : [],
      });
      output += '\n\n' + changeScenario;
    }

    // Write output
    const outputPath = path.join(programDir, `test-scenarios${extension}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');

    console.log(`Test scenarios generated successfully`);
    console.log(`Program: ${program}`);
    console.log(`Format: ${format}`);
    console.log(`Output: ${outputPath}`);

    if (verbose) {
      console.log(`[verbose] File size: ${output.length} bytes`);
      console.log(`[verbose] Format: ${format}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runGenerateTest,
};
