/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const path = require('path');
const { generateImpactAnalysis, normalizeId } = require('../impact/impactAnalyzer');
const { resolveAnalyzeConfig } = require('../config/runtimeConfig');
const { findImpactGraph } = require('../cli/helpers/impactGraphResolver');
const { resolveMemberProgram } = require('../cli/helpers/memberResolver');
const { normalizeReproducibilitySettings } = require('../reproducibility/reproducibility');

function executeImpact(args, { cwd = process.cwd() } = {}) {
  const normalizedArgs = { ...args };
  if (!normalizedArgs.target && normalizedArgs.field) {
    normalizedArgs.target = normalizedArgs.field;
  }
  if (!normalizedArgs.target || !String(normalizedArgs.target).trim()) {
    const error = new Error('Missing required option: --target <name>');
    error.code = 'TARGET_REQUIRED';
    throw error;
  }

  const config = resolveAnalyzeConfig(normalizedArgs, { cwd });
  const resolvedSourceRoot = config.sourceRoot ? path.resolve(cwd, config.sourceRoot) : '';
  let resolvedProgram = normalizedArgs.program;
  if ((!resolvedProgram || !String(resolvedProgram).trim()) && normalizedArgs.member) {
    if (!resolvedSourceRoot || !String(resolvedSourceRoot).trim()) {
      const error = new Error('Missing required option: --source <path>');
      error.code = 'SOURCE_REQUIRED';
      throw error;
    }
    resolvedProgram = resolveMemberProgram({
      member: normalizedArgs.member,
      sourceRoot: resolvedSourceRoot,
      extensions: config.extensions,
    }).program;
  }

  const outputRoot = path.resolve(cwd, config.outputRoot);
  const resolved = findImpactGraph({
    outputRoot,
    target: normalizedArgs.target,
    program: resolvedProgram,
  });

  const result = generateImpactAnalysis({
    graphPath: resolved.graphPath,
    target: normalizedArgs.target,
    jsonOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.json'),
    markdownOutputPath: path.join(resolved.outputProgramDir, 'impact-analysis.md'),
    reproducibility: normalizeReproducibilitySettings(Boolean(normalizedArgs.reproducible)),
  });

  return {
    config,
    target: normalizeId(normalizedArgs.target),
    outputRoot,
    outputProgramDir: resolved.outputProgramDir,
    graphPath: resolved.graphPath,
    program: resolved.program,
    result,
  };
}

module.exports = {
  executeImpact,
};
