'use strict';

const path = require('path');
const { inspectInventory } = require('./test-inventory');

const ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS = {
  'test runner removes ambient credentials and runtime injection from child environment':
    'TEST-REPRO-ENV',
  'test evidence fails closed when reporter output is missing or malformed': 'TEST-REPRO-REPORTER',
  'test evidence records skips and failures without private diagnostics': 'TEST-REPRO-REDACTION',
  'failed source export cannot validate stale bytes from a previous fetch': 'SOURCE-IMPORT-FAILURE',
  'source validation excludes old bytes when their manifest export failed': 'SOURCE-IMPORT-FAILURE',
};

function skipReason(value) {
  if (/powershell|pwsh/i.test(String(value))) return 'POWERSHELL_UNAVAILABLE';
  if (/symlink|junction/i.test(String(value))) return 'LINK_CAPABILITY_UNAVAILABLE';
  if (/windows|win32|linux|platform/i.test(String(value))) return 'PLATFORM_CONDITION';
  if (/java|javac|jdk/i.test(String(value))) return 'JAVA_UNAVAILABLE';
  return 'DECLARED_SKIP';
}

function createEvidenceCollector(
  runtime = { node: process.version, platform: process.platform, ci: process.env.CI === 'true' }
) {
  const maintained = new Set(inspectInventory().maintained);
  const results = new Map();
  return {
    observe(event) {
      if (!['test:pass', 'test:fail'].includes(event.type)) return;
      const data = event.data || {};
      if (data.details?.type === 'suite' || typeof data.file !== 'string') return;
      const file = path.relative(ROOT, path.resolve(ROOT, data.file)).split(path.sep).join('/');
      if (!maintained.has(file)) return;
      const requirement = REQUIREMENTS[data.name] || 'MAINTAINED-TESTS';
      const key = `${file}:${requirement}`;
      if (!results.has(key))
        results.set(key, {
          file,
          requirement,
          scope: /contribution-http|mcp-tool-gateway|mcp-server/.test(file)
            ? 'offline-and-loopback'
            : 'offline',
          executed: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          skipReasons: [],
        });
      const result = results.get(key);
      if (data.skip) {
        result.skipped += 1;
        const reason = skipReason(data.skip);
        if (!result.skipReasons.includes(reason)) result.skipReasons.push(reason);
      } else {
        result.executed += 1;
        result[event.type === 'test:pass' ? 'passed' : 'failed'] += 1;
      }
    },
    report() {
      const rows = [...results.values()]
        .sort((left, right) =>
          left.file < right.file
            ? -1
            : left.file > right.file
              ? 1
              : left.requirement < right.requirement
                ? -1
                : left.requirement > right.requirement
                  ? 1
                  : 0
        )
        .map(result => ({
          ...result,
          status: result.failed
            ? 'failed'
            : result.skipped
              ? 'skipped'
              : result.executed
                ? 'passed'
                : 'not_available',
          skipReasons: [...result.skipReasons].sort(),
        }));
      const counts = rows.reduce(
        (total, result) => {
          for (const key of Object.keys(total)) total[key] += result[key];
          return total;
        },
        { executed: 0, passed: 0, failed: 0, skipped: 0 }
      );
      return {
        schemaVersion: '1.0.0',
        kind: 'zeus-test-evidence',
        runtime: {
          node: runtime.node,
          platform: runtime.platform,
          scope: runtime.ci ? 'ci' : 'local',
        },
        counts,
        results: rows,
        matrix: ['win32', 'linux'].flatMap(platform =>
          [20, 22].map(nodeMajor => ({
            platform,
            nodeMajor,
            status:
              platform === runtime.platform &&
              nodeMajor === Number(runtime.node.split('.')[0].replace('v', '')) &&
              counts.executed > 0
                ? 'executed'
                : 'not_available',
            reason:
              platform === runtime.platform &&
              nodeMajor === Number(runtime.node.split('.')[0].replace('v', '')) &&
              counts.executed > 0
                ? 'THIS_RUN_ONLY'
                : 'NOT_EXECUTED_IN_THIS_RUN',
            requirement: 'TEST-REPRO-PLATFORM-MATRIX',
          }))
        ),
        remote: {
          status: 'not_available',
          reason: 'IBM_I_REQUIRES_SEPARATE_APPROVAL',
          requirement: 'IBM-I-REMOTE-ACCEPTANCE',
        },
        windowsCI: {
          status: runtime.ci && runtime.platform === 'win32' ? 'executed' : 'not_available',
          reason:
            runtime.ci && runtime.platform === 'win32'
              ? 'THIS_RUN_ONLY'
              : 'NO_APPROVED_WINDOWS_CI_EVIDENCE',
          requirement: 'TEST-REPRO-WINDOWS-CI',
        },
      };
    },
  };
}

async function* reporter(source) {
  const collector = createEvidenceCollector();
  for await (const event of source) collector.observe(event);
  yield `${JSON.stringify(collector.report(), null, 2)}\n`;
}

module.exports = reporter;
module.exports.createEvidenceCollector = createEvidenceCollector;
