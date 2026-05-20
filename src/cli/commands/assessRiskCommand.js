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
const { assessCanonicalModel, formatAssessmentMarkdown } = require('../../impact/riskAssessmentAnalyzer');

async function runAssessRisk(args) {
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

    if (verbose) {
      console.log(`[verbose] Program: ${program}`);
      console.log(`[verbose] Analysis path: ${analysisPath}`);
    }

    // Run risk assessment
    const assessment = assessCanonicalModel(canonicalAnalysis, {
      verbose,
    });

    // Generate markdown report
    const markdown = formatAssessmentMarkdown(assessment);

    // Print summary to console
    console.log(`Risk Assessment: ${program}`);
    console.log(`Overall Risk Level: ${assessment.summary.riskLevel}`);
    console.log(`Risk Distribution: ${assessment.summary.distribution}`);
    console.log(`Total Access Points: ${assessment.riskMetrics.totalAccesses}`);
    console.log(`Critical Paths: ${assessment.criticalPaths.length}`);

    if (assessment.recommendations.length > 0) {
      console.log('\nRecommendations:');
      assessment.recommendations.forEach((rec) => {
        console.log(`  • ${rec}`);
      });
    }

    // Write JSON output
    const jsonPath = path.join(programDir, 'risk-assessment.json');
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(assessment, null, 2), 'utf8');

    // Write markdown output
    const mdPath = path.join(programDir, 'risk-assessment.md');
    fs.writeFileSync(mdPath, markdown, 'utf8');

    console.log(`\nRisk assessment complete`);
    console.log(`JSON output: ${jsonPath}`);
    console.log(`Markdown report: ${mdPath}`);

    if (verbose) {
      console.log(`[verbose] Assessment details:`);
      console.log(JSON.stringify(assessment, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runAssessRisk,
};
