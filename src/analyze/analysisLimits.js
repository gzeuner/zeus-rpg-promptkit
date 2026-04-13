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
const DEFAULT_ANALYSIS_LIMITS = {
  maxProgramDepth: 25,
  maxPrograms: 500,
  maxNodes: 5000,
  maxEdges: 4000,
  maxScannedFiles: 500,
  maxProgramCallsPerProgram: 200,
};

function normalizeAnalysisLimits(value) {
  const patch = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_ANALYSIS_LIMITS,
    ...patch,
  };
}

module.exports = {
  DEFAULT_ANALYSIS_LIMITS,
  normalizeAnalysisLimits,
};
