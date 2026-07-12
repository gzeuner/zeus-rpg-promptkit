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
const { generateDeploymentChecklist, estimateDeploymentTimeline, identifyRiskAreas } = require('../../report/deploymentChecklistBuilder');

async function runGenerateChecklist(args) {
  // Route through capability (package 08) - additive; cap uses checklist builder directly
  try {
    const { capabilities } = require('../../api/zeusApi');
    const res = capabilities && typeof capabilities.execute === 'function' ? await capabilities.execute('investigation.generate-checklist', { cwd: process.cwd(), env: process.env, args }, args) : null;
    if (res && res.ok && res.result) {
      const out = (typeof res.result === 'string') ? res.result : JSON.stringify(res.result, null, 2);
      console.log(out);
      return;
    }
  } catch (e) {
    // fallthrough
  }

  const verbose = Boolean(args.verbose);

  // Validate arguments
  if (!args.program || !String(args.program).trim()) {
    console.error('Missing required option: --program <name>');
    process.exit(2);
  }

  try {
    const program = String(args.program).trim().toUpperCase();
    const changeType = String(args.type || 'CODE_CHANGE').trim().toUpperCase(); // 'DDL_CHANGE', 'CODE_CHANGE', 'BOTH'
    if (!['DDL_CHANGE', 'CODE_CHANGE', 'BOTH'].includes(changeType)) {
      console.error(`Invalid type "${changeType}". Use --type DDL_CHANGE, CODE_CHANGE, or BOTH.`);
      process.exit(2);
    }

    const cwd = process.cwd();
    const config = resolveAnalyzeConfig(args, { cwd });
    const outputRoot = path.resolve(cwd, config.outputRoot);
    const programDir = path.join(outputRoot, program);

    // Check if analysis exists
    const analysisPath = path.join(programDir, 'canonical-analysis.json');
    let canonicalAnalysis = null;
    if (fs.existsSync(analysisPath)) {
      canonicalAnalysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    }

    // Check for risk assessment
    const riskPath = path.join(programDir, 'risk-assessment.json');
    let riskAssessment = null;
    if (fs.existsSync(riskPath)) {
      riskAssessment = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
    }

    if (verbose) {
      console.log(`[verbose] Program: ${program}`);
      console.log(`[verbose] Change type: ${changeType}`);
      console.log(`[verbose] Analysis path: ${analysisPath}`);
      console.log(`[verbose] Risk assessment available: ${Boolean(riskAssessment)}`);
    }

    // Generate checklist
    const hasCriticalPath = riskAssessment && riskAssessment.summary && riskAssessment.summary.riskLevel === 'RED';
    const affectedPrograms = args.affected ? args.affected.split(',') : [program];

    const checklist = generateDeploymentChecklist({
      program,
      table: args.table,
      changeType,
      affectedPrograms,
      hasCriticalPath,
      estimatedImpact: args.impact || (hasCriticalPath ? 'HIGH' : 'MEDIUM'),
    });

    // Generate timeline
    const timeline = estimateDeploymentTimeline({
      changeType,
      affectedProgramCount: affectedPrograms.length,
      hasCriticalPath,
    });

    // Generate risk areas
    let riskAreas = [];
    if (canonicalAnalysis) {
      riskAreas = identifyRiskAreas(canonicalAnalysis, { program, changeType });
    }

    // Build complete document
    let document = checklist;

    if (timeline) {
      document += `\n## Timeline Estimate\n\n`;
      document += `**Total Time:** ${timeline.totalHours} hours (${timeline.workDays} working days)\n\n`;
      document += `| Phase | Hours |\n`;
      document += `|-------|-------|\n`;
      Object.entries(timeline.hours).forEach(([phase, hours]) => {
        document += `| ${phase} | ${hours}h |\n`;
      });
      document += '\n';
    }

    if (riskAreas.length > 0) {
      document += `\n## Identified Risk Areas\n\n`;
      riskAreas.forEach((risk) => {
        const sevEmoji = risk.severity === 'CRITICAL' ? '🔴' : '🟡';
        document += `${sevEmoji} **${risk.type}** (${risk.severity})\n`;
        document += `   Description: ${risk.description}\n`;
        document += `   Mitigation: ${risk.mitigation}\n\n`;
      });
    }

    // Write output
    const outputPath = path.join(programDir, 'deployment-checklist.md');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, document, 'utf8');

    console.log(`Deployment checklist generated successfully`);
    console.log(`Program: ${program}`);
    console.log(`Change type: ${changeType}`);
    console.log(`Estimated time: ${timeline.totalHours} hours`);
    console.log(`Has critical paths: ${hasCriticalPath ? 'YES' : 'NO'}`);
    console.log(`Output: ${outputPath}`);

    if (verbose) {
      console.log(`[verbose] File size: ${document.length} bytes`);
      console.log(`[verbose] Risk areas identified: ${riskAreas.length}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runGenerateChecklist,
};
