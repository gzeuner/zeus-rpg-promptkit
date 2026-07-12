#!/usr/bin/env node
'use strict';

/**
 * Offline documentation smoke test for the golden path.
 * - Uses only the public demo mini-system sources.
 * - Runs representative commands from the canonical journey.
 * - Verifies key artifacts are produced.
 * - Runs catalog generator.
 * - Performs basic existence and link sanity checks (no network).
 *
 * Run with: npm run docs:check
 * Requires node_modules present.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEMO_SRC = path.join(ROOT, 'examples/demo-rpg-mini-system/rpg_sources');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'zeus-docs-check-'));
const _OUT = path.join(TMP, 'out');

function sh(cmd, opts = {}) {
  console.log('> ' + cmd);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function exists(p) {
  return fs.existsSync(p);
}

function assertExists(p, msg) {
  if (!exists(p)) throw new Error('MISSING: ' + p + ' ' + (msg || ''));
  console.log('  OK ' + p);
}

try {
  if (!exists(DEMO_SRC)) throw new Error('Demo sources missing: ' + DEMO_SRC);

  // 1. install/runtime verify (assume done)
  console.log('=== 1. Runtime verify (doctor) ===');
  // Use a simple local doctor that doesn't require full profile for smoke
  try {
    sh('node cli/zeus.js doctor --help');
  } catch (_e) {
    console.log('optional: doctor --help (always works but caught for demo)');
  }

  // 2-3. Analyze demo (documentation mode, reproducible, local only) — REQUIRED golden path
  console.log('=== 2-3. Analyze demo source ===');
  const ANALYZE_OUT = path.join(TMP, 'output');
  sh(
    `node cli/zeus.js analyze --source ${DEMO_SRC} --program PROGRAM_100 --out ${ANALYZE_OUT} --mode documentation --reproducible --optimize-context`
  );

  const progOut = path.join(ANALYZE_OUT, 'PROGRAM_100');
  assertExists(path.join(progOut, 'report.md'), 'core report');
  assertExists(path.join(progOut, 'canonical-analysis.json'), 'canonical');
  assertExists(path.join(progOut, 'analyze-run-manifest.json'), 'manifest');

  // 4-5. Investigation + search/trace/xref — optional (may require more env)
  console.log('=== 4-5. Investigation + evidence deepening ===');
  try {
    sh(
      `node cli/zeus.js investigate --program PROGRAM_100 --out ${ANALYZE_OUT} --goal "Golden path demo: impact of ID field change" --search "ID,STATUS"`
    );
  } catch (e) {
    console.log('optional: investigate (', e.message, ')');
  }
  try {
    sh(`node cli/zeus.js trace --field ID --start-program PROGRAM_200 --source ${DEMO_SRC}`);
  } catch (e) {
    console.log('optional: trace (', e.message, ')');
  }
  try {
    sh(`node cli/zeus.js xref --program PROGRAM_200 --source ${DEMO_SRC}`);
  } catch (e) {
    console.log('optional: xref (', e.message, ')');
  }

  // 6-7. Impact, risk, generate — optional
  console.log('=== 6-7. Impact + risk + generate ===');
  try {
    sh(
      `node cli/zeus.js impact --target ID --program PROGRAM_100 --out ${ANALYZE_OUT} --source ${DEMO_SRC}`
    );
  } catch (e) {
    console.log('optional: impact (', e.message, ')');
  }
  try {
    sh(`node cli/zeus.js assess-risk --program PROGRAM_100 --out ${ANALYZE_OUT}`);
  } catch (e) {
    console.log('optional: assess-risk (', e.message, ')');
  }
  try {
    sh(
      `node cli/zeus.js generate-test --program PROGRAM_100 --format markdown --out ${ANALYZE_OUT}`
    );
  } catch (e) {
    console.log('optional: generate-test (', e.message, ')');
  }
  try {
    sh(`node cli/zeus.js generate-checklist --program PROGRAM_100 --out ${ANALYZE_OUT}`);
  } catch (e) {
    console.log('optional: generate-checklist (', e.message, ')');
  }

  // 8-9. QA + bundle (use same output root + source-output-root) — bundle assert required
  console.log('=== 8-9. QA + safe bundle ===');
  try {
    sh(`node cli/zeus.js qa --input ${progOut} --format markdown`);
  } catch (e) {
    console.log('optional: qa (', e.message, ')');
  }
  try {
    sh(
      `node cli/zeus.js bundle --program PROGRAM_100 --source-output-root ${ANALYZE_OUT} --output ${ANALYZE_OUT}/bundle --include-json`
    );
  } catch (e) {
    console.log('optional: bundle (', e.message, ')');
  }

  assertExists(path.join(ANALYZE_OUT, 'bundle'), 'bundle dir');

  // 10-11. Optional MCP surface + verify
  console.log('=== 10-11. MCP surface + verify ===');
  try {
    sh('node cli/zeus.js mcp --help');
  } catch (e) {
    console.log('optional: mcp --help (', e.message, ')');
  }

  // Verify bundle contents (basic)
  const bundleFiles = fs.readdirSync(path.join(ANALYZE_OUT, 'bundle'));
  if (bundleFiles.length === 0) throw new Error('Empty bundle');

  // Run catalog generator (validates examples against current metadata) — optional
  console.log('=== Catalog generation ===');
  try {
    sh('node cli/zeus.js docs:generate-catalog --output /tmp/zeus-docs-catalog.md');
  } catch (e) {
    console.log('optional: catalog gen (', e.message, ')');
  }

  // Basic link/file checks in key docs (offline)
  console.log('=== Basic doc sanity ===');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  if (!readme.includes('5-minutes.md') || !readme.includes('investigate')) {
    console.warn('README may need golden path links');
  }

  // Check that referenced quickstart exists
  if (!exists(path.join(ROOT, 'docs/quickstart/5-minutes.md'))) {
    throw new Error('5-minutes.md missing');
  }

  console.log('\n=== DOCS CHECK PASSED ===');
  console.log('Temp artifacts in', TMP);
} catch (err) {
  console.error('DOCS CHECK FAILED:', err.message);
  process.exit(1);
} finally {
  // leave TMP for inspection; CI can clean
}
