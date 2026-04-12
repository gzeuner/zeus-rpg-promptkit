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

const IFS_PATH_REPORT_SCHEMA_VERSION = 1;
const PATH_PATTERN = /(^|[^A-Z0-9_])((?:\/[A-Z0-9._$#@%+-]+)+)/ig;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function classifyPathFamily(pathValue) {
  const normalized = normalizePath(pathValue).toUpperCase();
  if (normalized.startsWith('/QSYS.LIB/')) return 'QSYS_LIB';
  if (normalized.startsWith('/QDLS/')) return 'QDLS';
  if (normalized.startsWith('/HOME/')) return 'HOME';
  if (normalized.startsWith('/TMP/') || normalized === '/TMP') return 'TEMP';
  if (normalized.startsWith('/WWW/')) return 'WEB';
  return 'IFS';
}

function buildEvidence(file, line, text) {
  return {
    file: normalizePath(file),
    line: Number(line) || 1,
    text: String(text || '').trim(),
  };
}

function collectFilePaths(relativePath, content) {
  const lines = String(content || '').split('\n');
  const findings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let match = PATH_PATTERN.exec(line);
    while (match) {
      const candidate = normalizePath(match[2]);
      if (candidate.length >= 2 && /\/[A-Z0-9]/i.test(candidate)) {
        findings.push({
          path: candidate,
          family: classifyPathFamily(candidate),
          evidence: buildEvidence(relativePath, index + 1, line),
        });
      }
      match = PATH_PATTERN.exec(line);
    }
    PATH_PATTERN.lastIndex = 0;
  }

  return findings;
}

function summarizeFamilies(paths) {
  const counts = {};
  for (const entry of asArray(paths)) {
    counts[entry.family] = Number(counts[entry.family] || 0) + 1;
  }
  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .reduce((result, key) => {
      result[key] = counts[key];
      return result;
    }, {});
}

function scanIfsPaths(sourceTextByRelativePath, options = {}) {
  const enabled = Boolean(options.enabled);
  if (!enabled) {
    return {
      schemaVersion: IFS_PATH_REPORT_SCHEMA_VERSION,
      kind: 'ifs-path-report',
      enabled: false,
      summary: {
        uniquePathCount: 0,
        evidenceCount: 0,
        fileCount: 0,
        familyCounts: {},
      },
      paths: [],
      notes: [],
    };
  }

  const findings = [];
  const entries = sourceTextByRelativePath instanceof Map
    ? Array.from(sourceTextByRelativePath.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    : [];

  for (const [relativePath, content] of entries) {
    findings.push(...collectFilePaths(relativePath, content));
  }

  const grouped = new Map();
  for (const finding of findings) {
    if (!grouped.has(finding.path)) {
      grouped.set(finding.path, {
        path: finding.path,
        family: finding.family,
        evidence: [],
      });
    }
    const target = grouped.get(finding.path);
    const evidenceKey = JSON.stringify(finding.evidence);
    const exists = target.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
    if (!exists) {
      target.evidence.push(finding.evidence);
    }
  }

  const paths = Array.from(grouped.values())
    .map((entry) => ({
      path: entry.path,
      family: entry.family,
      evidence: [...entry.evidence].sort((a, b) => {
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        return a.line - b.line;
      }),
    }))
    .sort((a, b) => {
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.path.localeCompare(b.path);
    });

  return {
    schemaVersion: IFS_PATH_REPORT_SCHEMA_VERSION,
    kind: 'ifs-path-report',
    enabled: true,
    summary: {
      uniquePathCount: paths.length,
      evidenceCount: paths.reduce((sum, entry) => sum + entry.evidence.length, 0),
      fileCount: new Set(paths.flatMap((entry) => entry.evidence.map((evidence) => evidence.file))).size,
      familyCounts: summarizeFamilies(paths),
    },
    paths,
    notes: [],
  };
}

function renderIfsPathMarkdown(report) {
  const lines = [
    '# IFS Path Usage',
    '',
    `Enabled: ${report && report.enabled ? 'yes' : 'no'}`,
    '',
  ];

  if (!report || !report.enabled) {
    lines.push('IFS path scanning was not enabled for this run.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Unique Paths: ${report.summary.uniquePathCount}`);
  lines.push(`Evidence Locations: ${report.summary.evidenceCount}`);
  lines.push(`Files With Matches: ${report.summary.fileCount}`);
  lines.push('');

  const familyKeys = Object.keys(report.summary.familyCounts || {});
  if (familyKeys.length > 0) {
    lines.push('## Families');
    for (const key of familyKeys) {
      lines.push(`- ${key}: ${report.summary.familyCounts[key]}`);
    }
    lines.push('');
  }

  if (asArray(report.paths).length === 0) {
    lines.push('No likely IFS paths were detected.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const entry of report.paths) {
    lines.push(`## ${entry.path}`);
    lines.push(`Family: ${entry.family}`);
    lines.push('');
    for (const evidence of entry.evidence || []) {
      lines.push(`- ${evidence.file}:${evidence.line} ${evidence.text}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  IFS_PATH_REPORT_SCHEMA_VERSION,
  classifyPathFamily,
  renderIfsPathMarkdown,
  scanIfsPaths,
};
