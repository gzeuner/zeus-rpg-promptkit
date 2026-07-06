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
const { runQAPipeline, generateQAReport } = require('../../qa/qaIntegration');
const { createJsonOutput } = require('../helpers/jsonOutput');

function normalizeFormat(value) {
  const format = String(value || 'markdown').trim().toLowerCase();
  if (!['jira', 'markdown', 'json'].includes(format)) {
    throw new Error('Invalid option: --format must be one of jira, markdown, json');
  }
  return format;
}

function normalizeStrict(value) {
  const strict = String(value || 'LENIENT').trim().toUpperCase();
  if (!['LENIENT', 'STRICT'].includes(strict)) {
    throw new Error('Invalid option: --strict must be LENIENT or STRICT');
  }
  return strict;
}

function resolveInputPath(args, cwd) {
  const raw = args.input || args['input'];
  if (!raw) {
    return null;
  }
  return path.resolve(cwd, String(raw).trim());
}

function loadCanonicalAnalysis(inputPath) {
  if (!inputPath) {
    return null;
  }

  const stats = fs.existsSync(inputPath) ? fs.statSync(inputPath) : null;
  if (!stats) {
    throw new Error(`Input path not found: ${inputPath}`);
  }

  const canonicalPath = stats.isDirectory()
    ? path.join(inputPath, 'canonical-analysis.json')
    : inputPath;

  if (!fs.existsSync(canonicalPath)) {
    throw new Error(`canonical-analysis.json not found at: ${canonicalPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse canonical analysis JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid canonical analysis payload.');
  }
  return parsed;
}

function renderReport(report) {
  if (report && report.format === 'json') {
    const json = createJsonOutput({ format: 'json' });
    return json.stringify(report) || `${JSON.stringify(report, null, 2)}\n`;
  }
  return `${report && report.content ? report.content : ''}\n`;
}

async function run(args, config = {}) {
  try {
    const cwd = process.cwd();
    const format = normalizeFormat(args.format);
    const strict = normalizeStrict(args.strict);
    const inputPath = resolveInputPath(args, cwd);

    const canonicalAnalysis = loadCanonicalAnalysis(inputPath);
    const context = {
      canonicalAnalysis: canonicalAnalysis || {},
      sourceFiles: [],
      config,
    };

    const qaResults = await runQAPipeline(context, {
      qa: {
        qaMode: true,
        qaStrict: strict,
      },
    });

    if (qaResults.status === 'SKIPPED') {
      console.log(qaResults.message || 'QA skipped.');
      return;
    }

    const report = generateQAReport(qaResults, { format });
    process.stdout.write(renderReport(report));

    if (args['post-comment'] && args['jira-ticket'] && report.canPostToJira) {
      console.log(`[INFO] Jira helper enabled for ticket ${args['jira-ticket']}.`);
    }

    process.exitCode = qaResults.status === 'SUCCESS' ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  loadCanonicalAnalysis,
  normalizeFormat,
  normalizeStrict,
  resolveInputPath,
  run,
};
