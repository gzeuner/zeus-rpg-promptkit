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
const fs = require('fs');
const path = require('path');

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeObjectName(value) {
  const normalized = normalizeName(value).replace(/^['"]|['"]$/g, '');
  if (!normalized) {
    return '';
  }
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function uniqueByName(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = item && item.name ? normalizeName(item.name) : '';
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        name: key,
        evidence: [],
      });
    }
    const target = map.get(key);
    for (const evidence of item.evidence || []) {
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === JSON.stringify(evidence));
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function detectDdsKind(filePath, lines, sourceType) {
  const normalizedType = normalizeName(sourceType);
  if (['DSPF', 'WORKSTN'].includes(normalizedType)) return 'WORKSTN';
  if (['PRTF', 'PRINTER'].includes(normalizedType)) return 'PRINTER';
  if (['PF', 'LF'].includes(normalizedType)) return 'DISK';

  const joined = (lines || []).join('\n').toUpperCase();
  if (joined.includes('WORKSTN')) return 'WORKSTN';
  if (joined.includes('PRINTER')) return 'PRINTER';
  return 'DISK';
}

function scanDdsContent(filePath, content, sourceType = '') {
  const lines = String(content || '').split('\n');
  const objectName = normalizeName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
  const fileKind = detectDdsKind(filePath, lines, sourceType);
  const recordFormats = [];
  const referencedFiles = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    const evidence = [{
      file: filePath,
      line: lineNumber,
      text: trimmed,
    }];

    const recordMatch = trimmed.match(/\bR\s+([A-Z0-9_#$@]+)\b/i);
    if (recordMatch) {
      recordFormats.push({
        name: normalizeName(recordMatch[1]),
        evidence,
      });
    }

    const referencePatterns = ['PFILE', 'REF', 'JFILE'];
    for (const keyword of referencePatterns) {
      const regex = new RegExp(`${keyword}\\(([^)]+)\\)`, 'ig');
      let match = regex.exec(trimmed);
      while (match) {
        const referencedName = normalizeObjectName(match[1]);
        if (referencedName) {
          referencedFiles.push({
            name: referencedName,
            kind: 'DDS_REF',
            evidence: evidence[0],
          });
        }
        match = regex.exec(trimmed);
      }
    }
  }

  return {
    sourceFile: {
      path: filePath,
      sizeBytes: Buffer.byteLength(String(content || ''), 'utf8'),
      lines: lines.length,
      sourceType: normalizeName(sourceType) || 'DDS',
    },
    tables: uniqueByName(referencedFiles),
    calls: [],
    copyMembers: [],
    sqlStatements: [],
    procedures: [],
    prototypes: [],
    procedureCalls: [],
    nativeFiles: [{
      name: objectName,
      kind: fileKind,
      declaredAccess: [],
      keyed: false,
      evidence: [{
        file: filePath,
        line: 1,
        text: `${objectName} ${fileKind}`,
      }],
    }],
    nativeFileAccesses: [],
    modules: [],
    bindingDirectories: [],
    servicePrograms: [],
    diagnostics: [],
    notes: [],
    commands: [],
    objectUsages: [],
    ddsFiles: [{
      name: objectName,
      kind: fileKind,
      sourceType: normalizeName(sourceType) || 'DDS',
      recordFormats: uniqueByName(recordFormats).map((entry) => entry.name),
      referencedFiles: uniqueByName(referencedFiles).map((entry) => entry.name),
      evidence: [{
        file: filePath,
        line: 1,
        text: objectName,
      }],
    }],
    sourceTypeAnalysis: {
      ownerProgram: objectName,
      sourceType: normalizeName(sourceType) || 'DDS',
    },
  };
}

function scanDdsFile(filePath, options = {}) {
  const content = options.content !== undefined ? String(options.content) : fs.readFileSync(filePath, 'utf8');
  return scanDdsContent(filePath, content, options.sourceType || '');
}

module.exports = {
  scanDdsContent,
  scanDdsFile,
};
