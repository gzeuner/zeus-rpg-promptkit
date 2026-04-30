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
const { runWorkflowEngine } = require('../workflow/workflowRunner');
const { executeFetch } = require('../core/fetchService');
const { executeAnalyze } = require('../core/analyzeService');
const { executeQueryTable } = require('../core/queryService');
const {
  executeListRuns,
  executeReadArtifact,
  executeReadRun,
  executeReadRunViews,
} = require('../core/runExplorerService');

async function runWorkflow(profile, preset, options = {}) {
  const { runtime = {}, ...args } = options;
  return runWorkflowEngine({
    profile,
    preset,
    ...args,
  }, runtime);
}

async function fetch(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeFetch({
    profile,
    ...args,
  }, runtime);
}

function analyze(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeAnalyze({
    profile,
    ...args,
  }, runtime);
}

function queryTable(profile, table, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeQueryTable({
    profile,
    table,
    ...args,
  }, runtime);
}

function listRuns(profile, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeListRuns({
    profile,
    ...args,
  }, runtime);
}

function readRun(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRun({
    profile,
    program,
    ...args,
  }, runtime);
}

function readRunViews(profile, program, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadRunViews({
    profile,
    program,
    ...args,
  }, runtime);
}

function readArtifact(profile, program, artifactPath, options = {}) {
  const { runtime = {}, ...args } = options;
  return executeReadArtifact({
    profile,
    program,
    artifactPath,
    ...args,
  }, runtime);
}

module.exports = {
  analyze,
  fetch,
  listRuns,
  queryTable,
  readArtifact,
  readRun,
  readRunViews,
  runWorkflow,
};
