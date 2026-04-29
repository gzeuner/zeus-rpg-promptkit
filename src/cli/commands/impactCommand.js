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
const path = require('path');
const { generateImpactAnalysis, normalizeId } = require('../../impact/impactAnalyzer');
const { resolveAnalyzeConfig } = require('../../config/runtimeConfig');
const { findImpactGraph } = require('../helpers/impactGraphResolver');
const { resolveMemberProgram } = require('../helpers/memberResolver');
const { normalizeReproducibilitySettings } = require('../../reproducibility/reproducibility');

function runImpact(args) {
  const verbose = Boolean(args.verbose);
  const logVerbose = (message) => {
    if (verbose) {
      console.log(`[verbose] ${message}`);
    }
  };

  if (!args.target && args.field) {
    args.target = args.field;
  }

  if (!args.target || !String(args.target).trim()) {
    console.error('Missing required option: --target <name>');
    process.exit(2);
  }

  const config = resolveAnalyzeConfig(args);
  let resolvedProgram = args.program;
  if ((!resolvedProgram || !String(resolvedProgram).trim()) && args.member) {
    if (!config.sourceRoot || !String(config.sourceRoot).trim()) {
      console.error('Missing required option: --source <path>');
      process.exit(2);
    }
    try {
      const memberResolution = resolveMemberProgram({
        member: args.member,
        sourceRoot: config.sourceRoot,
        extensions: config.extensions,
      });
      resolvedProgram = memberResolution.program;
    } catch (error) {
      console.error(error.message);
      process.exit(2);
    }
  }

  const outputRoot = path.resolve(process.cwd(), config.outputRoot);
  const resolved = findImpactGraph({
    outputRoot,
    target: args.target,
    program: resolvedProgram,
  });

  logVerbose(`Target: ${normalizeId(args.target)}`);
  logVerbose(`Graph path: ${resolved.graphPath}`);
  logVerbose(`Output program: ${resolved.program}`);

  const result = generateImpactAnalysis({
    graphPath: resolved.graphPath,
    target: args.target,
    jsonOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.json'),
    markdownOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.md'),
    reproducibility: normalizeReproducibilitySettings(Boolean(args.reproducible)),
  });

  console.log(`Impact analysis complete for target ${result.target}`);
  console.log(`Type: ${result.type}`);
  console.log(`Total affected programs: ${result.totalAffectedPrograms || 0}`);
  console.log(`Output written to: ${resolved.outputProgramDir}`);
}

module.exports = {
  runImpact,
};
