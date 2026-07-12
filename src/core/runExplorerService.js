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
const path = require('path');

const { resolveBundleConfig } = require('../config/runtimeConfig');
const { listAnalysisRuns, readAnalysisRun, readArtifactContent } = require('../ui/localUiDataApi');

function resolveExplorerOutputRoot(args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const explicitOutputRoot = args.outputRoot || args.sourceOutputRoot || args['source-output-root'];
  if (explicitOutputRoot) {
    return path.resolve(cwd, explicitOutputRoot);
  }

  const config = resolveBundleConfig(
    {
      profile: args.profile,
    },
    { cwd, env }
  );
  return path.resolve(cwd, config.sourceOutputRoot);
}

function executeListRuns(args = {}, runtime = {}) {
  const outputRoot = resolveExplorerOutputRoot(args, runtime);
  return {
    outputRoot,
    runs: listAnalysisRuns(outputRoot),
  };
}

function executeReadRun(args = {}, runtime = {}) {
  const outputRoot = resolveExplorerOutputRoot(args, runtime);
  return {
    outputRoot,
    run: readAnalysisRun(outputRoot, args.program),
  };
}

function executeReadRunViews(args = {}, runtime = {}) {
  const outputRoot = resolveExplorerOutputRoot(args, runtime);
  return {
    outputRoot,
    program: String(args.program || '').trim(),
    views: readAnalysisRun(outputRoot, args.program).views,
  };
}

function executeReadArtifact(args = {}, runtime = {}) {
  const outputRoot = resolveExplorerOutputRoot(args, runtime);
  return {
    outputRoot,
    artifact: readArtifactContent(outputRoot, args.program, args.path || args.artifactPath),
  };
}

module.exports = {
  executeListRuns,
  executeReadArtifact,
  executeReadRun,
  executeReadRunViews,
  resolveExplorerOutputRoot,
};
