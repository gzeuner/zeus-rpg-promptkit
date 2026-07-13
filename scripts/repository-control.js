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

const { ConfigError, loadConfig, resolveSafePath } = require('./repository-control/config');
const EXIT_CODES = require('./repository-control/exitCodes');

const { getOperations } = require('./repository-control/githubProbe');
const {
  evaluatePr,
  evaluateMain,
  evaluateOverview,
  finalizeDecision,
} = require('./repository-control/checkEvaluation');
const { renderMarkdownReport } = require('./repository-control/reportRenderer');

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
      strict: true,
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
  let timeoutSeconds = options['timeout-seconds'] ? Number(options['timeout-seconds']) : null;
  let pollSeconds = options['poll-seconds'] ? Number(options['poll-seconds']) : null;
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

  if (scope === 'pr' && (!Number.isSafeInteger(prNumber) || prNumber <= 0)) {
    console.error('--pr <number> is required when --scope pr');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  if (localSha && !/^[0-9a-f]{40}$/i.test(localSha)) {
    console.error('--local-sha must be a full 40-character SHA');
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  let config;
  let safeJsonOutputPath;
  let safeMdOutputPath;
  try {
    config = loadConfig(configPath);
    timeoutSeconds ??= config.polling.defaultTimeoutSeconds;
    pollSeconds ??= config.polling.defaultPollSeconds;
    if (
      !Number.isInteger(pollSeconds) ||
      pollSeconds < config.polling.minPollSeconds ||
      pollSeconds > config.polling.maxPollSeconds
    ) {
      throw new ConfigError(
        `--poll-seconds must be between ${config.polling.minPollSeconds} and ${config.polling.maxPollSeconds}`
      );
    }
    if (
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds <= 0 ||
      timeoutSeconds > config.polling.maxTimeoutSeconds
    ) {
      throw new ConfigError(
        `--timeout-seconds must be between 1 and ${config.polling.maxTimeoutSeconds}`
      );
    }
    safeJsonOutputPath = jsonOutputPath
      ? resolveSafePath(jsonOutputPath, { purpose: 'JSON output path' })
      : null;
    safeMdOutputPath = mdOutputPath
      ? resolveSafePath(mdOutputPath, { purpose: 'Markdown output path' })
      : null;
  } catch (error) {
    console.error(`Invalid repository-control configuration or path: ${error.message}`);
    process.exit(EXIT_CODES.INVALID_USAGE);
  }

  const report = {
    schemaVersion: 'repository-control-report/v1',
    repository: {
      nameWithOwner: config.repository,
      defaultBranch: config.defaultBranch,
    },
    scope,
    decision: 'UNKNOWN',
    technicalDecision: 'UNKNOWN',
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
    githubOperations: [],
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

    finalizeDecision(report, scope, strict);
    report.githubOperations = getOperations();

    // Render outputs
    const jsonReport = JSON.stringify(report, null, 2);

    if (outputJson) {
      console.log(jsonReport);
    }

    if (safeJsonOutputPath) {
      writeSafeFile(safeJsonOutputPath, jsonReport + '\n');
    }

    if (safeMdOutputPath) {
      const md = renderMarkdownReport(report);
      writeSafeFile(safeMdOutputPath, md);
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

function writeSafeFile(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Revalidate after directory creation and reject a last-moment symlink swap.
  const safe = resolveSafePath(target, { purpose: 'output path' });
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(safe, flags, 0o600);
  try {
    fs.writeFileSync(fd, contents, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

main().catch(err => {
  console.error('Unhandled error in repository-control:', err);
  process.exit(EXIT_CODES.UNKNOWN);
});
