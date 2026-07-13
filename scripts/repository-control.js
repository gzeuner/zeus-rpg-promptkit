#!/usr/bin/env node
'use strict';

/**
 * Repository Control for Pull Requests and Main
 * Read-only decision gate and reporter.
 *
 * Usage examples:
 *   node scripts/repository-control.js --scope pr --pr 123
 *   npm run repo:control -- --scope main --wait
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { DEFAULTS, loadConfig } = require('./repository-control/config');
const EXIT_CODES = require('./repository-control/exitCodes');

const {
  getCurrentBranchSha,
  compareWithMain,
  getLocalSha,
} = require('./repository-control/gitProbe');
const {
  fetchPrDetails,
  fetchChecksForSha,
  fetchMainDetails,
  fetchCompare,
  fetchBranches,
  fetchReleases,
} = require('./repository-control/githubProbe');
const {
  evaluatePr,
  evaluateMain,
  evaluateOverview,
} = require('./repository-control/checkEvaluation');
const { renderJsonReport, renderMarkdownReport } = require('./repository-control/reportRenderer');

function printHelp() {
  console.log(`
Repository Control (read-only)

Usage:
  node scripts/repository-control.js [options]

Options:
  --scope <pr|main|overview>     Control scope (default: overview)
  --pr <number>                  Pull request number (required for --scope pr)
  --local-sha <sha>              Local candidate SHA to compare against remote PR head
  --wait                         Poll until ready/healthy or timeout
  --timeout-seconds <n>          Max wait time (default 1800)
  --poll-seconds <n>             Poll interval (default 15, min 5, max 60)
  --strict                       Treat warnings and unknowns as blockers
  --json                         Output machine-readable JSON to stdout
  --json-output <path>           Write JSON report to file
  --markdown-output <path>       Write Markdown report to file
  --reproducible                 Normalize volatile data (timestamps)
  --config <path>                Path to config (default .github/repository-control.json)
  --help                         Show help

Exit codes:
  0  HEALTHY / READY
  1  BLOCKED / UNHEALTHY
  2  UNKNOWN / insufficient data
  64 INVALID USAGE

This tool is strictly read-only. It never merges, approves, or modifies the repository.
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let options;
  try {
    const { values } = parseArgs({
      args,
      options: {
        scope: { type: 'string', default: 'overview' },
        pr: { type: 'string' },
        'local-sha': { type: 'string' },
        wait: { type: 'boolean', default: false },
        'timeout-seconds': { type: 'string' },
        'poll-seconds': { type: 'string' },
        strict: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'json-output': { type: 'string' },
        'markdown-output': { type: 'string' },
        reproducible: { type: 'boolean', default: false },
        config: { type: 'string' },
      },
      strict: false,
    });
    options = values;
  } catch (err) {
    console.error('Invalid arguments:', err.message);
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  const scope = options.scope;
  const prNumber = options.pr ? Number(options.pr) : null;
  const localSha = options['local-sha'] || null;
  const wait = !!options.wait;
  const timeoutSeconds = options['timeout-seconds']
    ? Number(options['timeout-seconds'])
    : DEFAULTS.timeoutSeconds;
  const pollSeconds = options['poll-seconds']
    ? Number(options['poll-seconds'])
    : DEFAULTS.pollSeconds;
  const strict = !!options.strict;
  const outputJson = !!options.json;
  const jsonOutputPath = options['json-output'] || null;
  const mdOutputPath = options['markdown-output'] || null;
  const reproducible = !!options.reproducible;
  const configPath = options.config || '.github/repository-control.json';

  if (!['pr', 'main', 'overview'].includes(scope)) {
    console.error(`Invalid --scope: ${scope}`);
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  if (scope === 'pr' && !prNumber) {
    console.error('--pr <number> is required when --scope pr');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  if (localSha && !/^[0-9a-f]{40}$/i.test(localSha)) {
    console.error('--local-sha must be a full 40-character SHA');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  if (pollSeconds < 5 || pollSeconds > 60) {
    console.error('--poll-seconds must be between 5 and 60');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  const config = loadConfig(configPath);

  const report = {
    schemaVersion: 'repository-control-report/v1',
    repository: {
      nameWithOwner: config.repository,
      defaultBranch: config.defaultBranch,
    },
    scope,
    decision: 'UNKNOWN',
    observedSha: null,
    localCandidateSha: localSha,
    blockers: [],
    warnings: [],
    unknowns: [],
    checks: [],
    pullRequests: [],
    branches: [],
    main: null,
    release: null,
    observedAt: reproducible ? 'REPRODUCIBLE' : new Date().toISOString(),
    reproducible,
    configPath,
  };

  try {
    if (scope === 'pr') {
      await evaluatePr({
        report,
        prNumber,
        localSha,
        wait,
        timeoutSeconds,
        pollSeconds,
        strict,
        config,
      });
    } else if (scope === 'main') {
      await evaluateMain({ report, wait, timeoutSeconds, pollSeconds, strict, config });
    } else {
      await evaluateOverview({ report, wait, timeoutSeconds, pollSeconds, strict, config });
    }

    // Final decision logic
    if (report.blockers.length > 0) {
      report.decision = 'BLOCKED';
    } else if (report.unknowns.length > 0 && strict) {
      report.decision = 'BLOCKED';
    } else if (report.unknowns.length > 0) {
      report.decision = 'UNKNOWN';
    } else if (report.warnings.length > 0 && strict) {
      report.decision = 'BLOCKED';
    } else {
      report.decision = scope === 'pr' ? 'READY' : 'HEALTHY';
    }

    // Render outputs
    const jsonReport = JSON.stringify(report, null, 2);

    if (outputJson) {
      console.log(jsonReport);
    }

    if (jsonOutputPath) {
      fs.mkdirSync(path.dirname(jsonOutputPath), { recursive: true });
      fs.writeFileSync(jsonOutputPath, jsonReport + '\n');
    }

    if (mdOutputPath) {
      const md = renderMarkdownReport(report);
      fs.mkdirSync(path.dirname(mdOutputPath), { recursive: true });
      fs.writeFileSync(mdOutputPath, md);
    }

    if (!outputJson && !jsonOutputPath && !mdOutputPath) {
      // Default human output
      console.log(renderMarkdownReport(report));
    }

    // Exit code
    if (report.decision === 'READY' || report.decision === 'HEALTHY') {
      process.exit(EXIT_CODES.HEALTHY);
    } else if (report.decision === 'BLOCKED' || report.decision === 'UNHEALTHY') {
      process.exit(EXIT_CODES.BLOCKED);
    } else {
      process.exit(EXIT_CODES.UNKNOWN);
    }
  } catch (err) {
    report.decision = 'UNKNOWN';
    report.unknowns.push({
      code: 'INTERNAL_ERROR',
      message: String((err && err.message) || err),
      source: 'repository-control',
    });
    console.error('Repository control encountered an error:', err);
    if (outputJson) {
      console.log(JSON.stringify(report, null, 2));
    }
    process.exit(EXIT_CODES.UNKNOWN);
  }
}

main().catch(err => {
  console.error('Unhandled error in repository-control:', err);
  process.exit(EXIT_CODES.UNKNOWN);
});
