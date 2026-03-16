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
const fs = require('fs');
const path = require('path');
const { normalizeId } = require('../../impact/impactAnalyzer');

function findImpactGraph({ outputRoot, target, program }) {
  const normalizedTarget = normalizeId(target);
  if (!normalizedTarget) {
    throw new Error('Impact analysis requires --target <name>');
  }

  if (program && String(program).trim()) {
    const resolvedProgram = normalizeId(program);
    const outputProgramDir = path.join(outputRoot, resolvedProgram);
    const graphPath = path.join(outputProgramDir, 'program-call-tree.json');
    if (!fs.existsSync(graphPath)) {
      throw new Error(`Cross-program graph not found: ${graphPath}. Run analyze first.`);
    }
    return { program: resolvedProgram, graphPath, outputProgramDir };
  }

  if (!fs.existsSync(outputRoot)) {
    throw new Error(`Output directory not found: ${outputRoot}`);
  }

  const candidateDirs = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const candidates = [];
  for (const directory of candidateDirs) {
    const outputProgramDir = path.join(outputRoot, directory);
    const graphPath = path.join(outputProgramDir, 'program-call-tree.json');
    if (!fs.existsSync(graphPath)) continue;

    const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const nodeIds = new Set(((parsed && parsed.nodes) || []).map((node) => normalizeId(node.id)).filter(Boolean));
    candidates.push({
      program: normalizeId(directory),
      graphPath,
      outputProgramDir,
      hasTarget: nodeIds.has(normalizedTarget),
    });
  }

  if (candidates.length === 0) {
    throw new Error(`No program-call-tree.json found under ${outputRoot}. Run analyze first.`);
  }

  const matching = candidates.filter((entry) => entry.hasTarget);
  if (matching.length > 1) {
    const options = matching.map((entry) => entry.program).join(', ');
    throw new Error(`Target "${normalizedTarget}" found in multiple program graphs (${options}). Use --program to disambiguate.`);
  }
  if (matching.length === 1) {
    return matching[0];
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const options = candidates.map((entry) => entry.program).join(', ');
  throw new Error(`Could not infer graph for target "${normalizedTarget}". Available program outputs: ${options}. Use --program.`);
}

module.exports = {
  findImpactGraph,
};
