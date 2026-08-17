'use strict';

/**
 * Pure deterministic projections from the canonical vector set.
 * Statically allowlisted serializers only — no caller functions, module paths,
 * templates, dynamic require, or code execution.
 */

const { LIMITS, FRAMEWORK_IDS, REASON_CODES } = require('./constants');
const { utf8ByteLength, stableSortBy, strcmp } = require('./util');

function escapeMarkdown(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(text) {
  return escapeHtml(text);
}

function formatAssignmentValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'object' && value !== null) {
    if (value.kind === 'decimal-string') return String(value.value);
    if (value.kind) return `${value.kind}:${value.value}`;
  }
  return String(value);
}

function formatAssignments(assignments) {
  const keys = Object.keys(assignments || {}).sort(strcmp);
  return keys.map(k => `${k}=${formatAssignmentValue(assignments[k])}`).join(', ');
}

/**
 * Deterministic Markdown projection of a canonical vector set.
 */
function exportMarkdown(vectorSet) {
  if (!vectorSet || typeof vectorSet !== 'object') {
    return {
      ok: false,
      reasonCode: REASON_CODES.INPUT_INVALID,
      message: 'Vector set is required.',
    };
  }
  const lines = [];
  lines.push('# Db2 Test Intelligence — Vector Set');
  lines.push('');
  lines.push(
    `Contract: \`${escapeMarkdown(vectorSet.contractRef || vectorSet.contractId || '')}\``
  );
  lines.push('');
  lines.push('## Non-claims');
  lines.push('');
  lines.push('- databaseExecuted: false');
  lines.push('- programExecuted: false');
  lines.push('- compiled: false');
  lines.push('- productionValidated: false');
  lines.push('- businessCorrect: false');
  lines.push('');
  lines.push('## Quality report');
  lines.push('');
  const qr = vectorSet.qualityReport || {};
  lines.push(`| Metric | Count |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| supported | ${Number(qr.supported) || 0} |`);
  lines.push(`| unsupported | ${Number(qr.unsupported) || 0} |`);
  lines.push(`| missing-evidence | ${Number(qr.missingEvidence) || 0} |`);
  lines.push(`| unknown-business-validity | ${Number(qr.unknownBusinessValidity) || 0} |`);
  lines.push(`| gaps | ${Number(qr.gapCount) || 0} |`);
  lines.push(`| vectors | ${Number(qr.vectorCount) || 0} |`);
  lines.push('');
  lines.push('## Vectors');
  lines.push('');

  const vectors = Array.isArray(vectorSet.vectors) ? vectorSet.vectors : [];
  const ordered = stableSortBy(vectors, v => String(v.id || ''));
  for (const v of ordered) {
    lines.push(`### ${escapeMarkdown(v.id)}`);
    lines.push('');
    lines.push(`- category: ${escapeMarkdown(v.category)}`);
    lines.push(`- supportStatus: ${escapeMarkdown(v.supportStatus)}`);
    lines.push(
      `- expectation: ${escapeMarkdown(v.expectation && v.expectation.outcome)} / ${escapeMarkdown(
        v.expectation && v.expectation.technical
      )}`
    );
    lines.push(`- input: ${escapeMarkdown(formatAssignments(v.input && v.input.assignments))}`);
    lines.push(`- rationale: ${escapeMarkdown(v.rationale)}`);
    if (Array.isArray(v.provenance) && v.provenance.length) {
      lines.push('- provenance:');
      for (const p of v.provenance) {
        lines.push(
          `  - ${escapeMarkdown(p.kind)}: ${escapeMarkdown(p.reason)}${
            p.source ? ` (${escapeMarkdown(p.source)})` : ''
          }`
        );
      }
    }
    lines.push('');
  }

  if (Array.isArray(vectorSet.gaps) && vectorSet.gaps.length) {
    lines.push('## Gaps');
    lines.push('');
    for (const g of stableSortBy(vectorSet.gaps, x => `${x.kind}|${x.message}`)) {
      lines.push(
        `- **${escapeMarkdown(g.kind)}**: ${escapeMarkdown(g.message)}${
          g.table ? ` _(table ${escapeMarkdown(g.table)})_` : ''
        }${g.column ? ` _(column ${escapeMarkdown(g.column)})_` : ''}`
      );
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  const notes = Array.isArray(vectorSet.notes) ? vectorSet.notes : [];
  for (const n of notes) {
    lines.push(`- ${escapeMarkdown(n)}`);
  }
  lines.push('');

  const text = lines.join('\n');
  if (utf8ByteLength(text) > LIMITS.maxMarkdownBytes) {
    return {
      ok: false,
      reasonCode: REASON_CODES.BOUNDS_EXCEEDED,
      message: 'Markdown export exceeds size bound.',
    };
  }
  return { ok: true, text, bytes: utf8ByteLength(text) };
}

/**
 * JUnit-style XML projection (data-only; values escaped; not executed).
 */
function exportJunitXml(vectorSet) {
  const vectors = Array.isArray(vectorSet.vectors)
    ? stableSortBy(vectorSet.vectors, v => String(v.id || ''))
    : [];
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuite name="zeus-pro.db2-test-vector-set" tests="${vectors.length}" assertions="0" errors="0" failures="0" skipped="0">`
  );
  lines.push(
    '  <!-- Advisory projection only. databaseExecuted=false programExecuted=false compiled=false productionValidated=false businessCorrect=false -->'
  );
  for (const v of vectors) {
    const classname = escapeXml(v.category || 'vector');
    const name = escapeXml(v.id || 'vector');
    const assignments = escapeXml(formatAssignments(v.input && v.input.assignments));
    const outcome = escapeXml(v.expectation && v.expectation.outcome);
    lines.push(`  <testcase classname="${classname}" name="${name}">`);
    lines.push(`    <system-out>${assignments} expectation=${outcome}</system-out>`);
    lines.push('  </testcase>');
  }
  lines.push('</testsuite>');
  lines.push('');
  const text = lines.join('\n');
  if (utf8ByteLength(text) > LIMITS.maxFrameworkOutputBytes) {
    return {
      ok: false,
      reasonCode: REASON_CODES.BOUNDS_EXCEEDED,
      message: 'JUnit export exceeds size bound.',
    };
  }
  return { ok: true, text, bytes: utf8ByteLength(text) };
}

/**
 * Neutralize CR/LF and Robot Framework-significant syntax so values stay inert data.
 * Collapses every field to a single physical line without section/table injection.
 */
function inertRobotField(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\*{2,}/g, '*') // break *** section markers
    .replace(/\|/g, '/') // break table cells
    .replace(/\$\{/g, '$(') // break variable interpolation
    .replace(/@\{/g, '@(')
    .replace(/&\{/g, '&(')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Robot Framework-style data projection (inert literals only).
 */
function exportRobotFramework(vectorSet) {
  const vectors = Array.isArray(vectorSet.vectors)
    ? stableSortBy(vectorSet.vectors, v => String(v.id || ''))
    : [];
  const lines = [];
  lines.push('*** Settings ***');
  lines.push('Documentation    Advisory Db2 test vectors (not executed).');
  lines.push('...              databaseExecuted=false programExecuted=false');
  lines.push('');
  lines.push('*** Variables ***');
  lines.push('${NONCLAIM_DATABASE_EXECUTED}    false');
  lines.push('${NONCLAIM_BUSINESS_CORRECT}    false');
  lines.push('');
  lines.push('*** Test Cases ***');
  for (const v of vectors) {
    // Robot names: keep alphanumeric and underscores from id
    const name = String(v.id || 'vector').replace(/[^A-Za-z0-9_]/g, '_');
    lines.push(name);
    const doc = inertRobotField(v.rationale || '').slice(0, 200);
    lines.push(`    [Documentation]    ${doc}`);
    lines.push(
      `    # category=${inertRobotField(v.category)} support=${inertRobotField(v.supportStatus)}`
    );
    lines.push(
      `    # assignments=${inertRobotField(formatAssignments(v.input && v.input.assignments))}`
    );
    lines.push(
      `    # expectation=${inertRobotField(v.expectation && v.expectation.outcome)}/${inertRobotField(
        v.expectation && v.expectation.technical
      )}`
    );
    lines.push('    No Operation');
    lines.push('');
  }
  const text = lines.join('\n');
  if (utf8ByteLength(text) > LIMITS.maxFrameworkOutputBytes) {
    return {
      ok: false,
      reasonCode: REASON_CODES.BOUNDS_EXCEEDED,
      message: 'Robot Framework export exceeds size bound.',
    };
  }
  return { ok: true, text, bytes: utf8ByteLength(text) };
}

const FRAMEWORK_EXPORTERS = Object.freeze({
  'junit-xml': exportJunitXml,
  'robot-framework': exportRobotFramework,
});

/**
 * Export a statically allowlisted framework projection.
 */
function exportFramework(vectorSet, frameworkId) {
  if (!FRAMEWORK_IDS.includes(frameworkId)) {
    return {
      ok: false,
      reasonCode: REASON_CODES.INPUT_INVALID,
      message: 'Framework id is not allowlisted.',
    };
  }
  if (!vectorSet || typeof vectorSet !== 'object') {
    return {
      ok: false,
      reasonCode: REASON_CODES.INPUT_INVALID,
      message: 'Vector set is required.',
    };
  }
  const fn = FRAMEWORK_EXPORTERS[frameworkId];
  return fn(vectorSet);
}

module.exports = {
  escapeMarkdown,
  escapeHtml,
  escapeXml,
  inertRobotField,
  exportMarkdown,
  exportJunitXml,
  exportRobotFramework,
  exportFramework,
  FRAMEWORK_EXPORTERS,
};
