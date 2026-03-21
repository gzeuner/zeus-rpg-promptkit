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

const NATIVE_IO_OPCODES = new Set([
  'CHAIN',
  'SETLL',
  'SETGT',
  'READ',
  'READE',
  'READP',
  'READPE',
  'WRITE',
  'UPDATE',
  'DELETE',
  'EXFMT',
]);

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isCommentLine(rawLine) {
  if (!rawLine) return true;
  if (rawLine.length >= 7 && rawLine[6] === '*') {
    return true;
  }

  const trimmed = rawLine.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('//')) return true;
  return false;
}

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function normalizeTableName(rawName) {
  const cleaned = String(rawName || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '.');
  if (!cleaned) return '';
  const segments = cleaned.split('.').filter(Boolean);
  const table = segments.length > 0 ? segments[segments.length - 1] : cleaned;
  return normalizeName(table);
}

function toRelativeProgramName(filePath) {
  return normalizeName(path.basename(String(filePath || ''), path.extname(String(filePath || ''))));
}

function normalizeDefinitionName(rawName, fallbackName) {
  const normalized = normalizeName(rawName);
  if (!normalized || normalized === '*N') {
    return normalizeName(fallbackName);
  }
  return normalized;
}

function uniqueSortedStrings(values) {
  return Array.from(new Set((values || []).map((value) => normalizeName(value)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function addEntity(map, name, payload) {
  const normalized = normalizeName(name);
  if (!normalized) return;

  if (!map.has(normalized)) {
    map.set(normalized, {
      ...payload,
      name: normalized,
      evidence: [],
    });
  }

  const entity = map.get(normalized);
  const evidenceKey = JSON.stringify(payload.evidence);
  const hasEvidence = entity.evidence.some((item) => JSON.stringify(item) === evidenceKey);
  if (!hasEvidence) {
    entity.evidence.push(payload.evidence);
  }
}

function addStructuredItem(map, key, payload) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, {
      ...payload,
      evidence: [],
    });
  }

  const item = map.get(key);
  const evidenceList = payload.evidence || [];
  for (const evidence of evidenceList) {
    const evidenceKey = JSON.stringify(evidence);
    const exists = item.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
    if (!exists) {
      item.evidence.push(evidence);
    }
  }
}

function detectSqlType(sqlText) {
  const normalized = normalizeWhitespace(sqlText).toUpperCase();
  if (/\bSELECT\b/.test(normalized)) return 'SELECT';
  if (/\bINSERT\b/.test(normalized)) return 'INSERT';
  if (/\bUPDATE\b/.test(normalized)) return 'UPDATE';
  if (/\bDELETE\b/.test(normalized)) return 'DELETE';
  if (/\bMERGE\b/.test(normalized)) return 'MERGE';
  return 'OTHER';
}

function extractSqlTables(sqlText) {
  const tables = new Set();
  const regex = /\b(?:FROM|JOIN|UPDATE|INTO|MERGE\s+INTO)\s+("[^"]+"|[A-Z0-9_#$@./]+)/gi;
  let match = regex.exec(sqlText);

  while (match) {
    const normalized = normalizeTableName(match[1]);
    if (normalized) {
      tables.add(normalized);
    }
    match = regex.exec(sqlText);
  }

  return Array.from(tables).sort();
}

function createDefinition({
  filePath,
  ownerProgram,
  name,
  kind,
  startLine,
  endLine,
  sourceForm,
  exported = false,
  imported = false,
  externalName = null,
  text = '',
}) {
  return {
    name,
    kind,
    ownerProgram,
    sourceFile: filePath,
    startLine,
    endLine,
    sourceForm,
    exported: Boolean(exported),
    imported: Boolean(imported),
    externalName: externalName ? normalizeName(externalName) : null,
    evidence: [{
      file: filePath,
      startLine,
      endLine,
      text: normalizeWhitespace(text),
    }],
  };
}

function createProcedureCall({
  filePath,
  ownerProgram,
  ownerName,
  ownerKind,
  lineNo,
  text,
  name,
  resolution,
  targetKind,
  targetProgram = null,
}) {
  return {
    name: normalizeName(name),
    ownerProgram: normalizeName(ownerProgram),
    ownerName: normalizeName(ownerName),
    ownerKind: normalizeName(ownerKind),
    resolution: normalizeName(resolution),
    targetKind: normalizeName(targetKind),
    targetProgram: targetProgram ? normalizeName(targetProgram) : null,
    ownerFile: filePath,
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createNativeFileDeclaration({
  filePath,
  ownerProgram,
  name,
  kind,
  lineNo,
  declaredAccess,
  keyed,
  text,
}) {
  return {
    name: normalizeName(name),
    ownerProgram: normalizeName(ownerProgram),
    sourceFile: filePath,
    kind: normalizeName(kind || 'FILE') || 'FILE',
    declaredAccess: uniqueSortedStrings(declaredAccess),
    keyed: Boolean(keyed),
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function createNativeFileAccess({
  filePath,
  ownerProgram,
  ownerName,
  ownerKind,
  lineNo,
  text,
  fileName,
  fileKind,
  opcode,
  accessKind,
  recordFormat = null,
  keyed = false,
  interactive = false,
  mutating = false,
}) {
  return {
    fileName: normalizeName(fileName),
    fileKind: normalizeName(fileKind || 'FILE') || 'FILE',
    opcode: normalizeName(opcode),
    accessKind: normalizeName(accessKind),
    recordFormat: recordFormat ? normalizeName(recordFormat) : null,
    keyed: Boolean(keyed),
    interactive: Boolean(interactive),
    mutating: Boolean(mutating),
    ownerProgram: normalizeName(ownerProgram),
    ownerName: normalizeName(ownerName),
    ownerKind: normalizeName(ownerKind),
    ownerFile: filePath,
    evidence: [{
      file: filePath,
      line: lineNo,
      text: normalizeWhitespace(text),
    }],
  };
}

function parseFixedPrototype(rawLine) {
  const match = rawLine.match(/^\s*D\s+([A-Z0-9_#$@*]+)\s+PR\b(.*)$/i);
  if (!match) return null;
  return {
    name: match[1],
    detail: match[2] || '',
  };
}

function inferNativeFileKind(detail) {
  const upper = String(detail || '').toUpperCase();
  if (upper.includes('WORKSTN')) return 'WORKSTN';
  if (upper.includes('PRINTER')) return 'PRINTER';
  if (upper.includes('DISK')) return 'DISK';
  return 'FILE';
}

function parseDeclaredAccess(detail) {
  const upper = String(detail || '').toUpperCase();
  const usageMatch = upper.match(/\bUSAGE\s*\(\s*([^)]+)\)/);
  const modes = new Set();
  const tokens = usageMatch ? usageMatch[1].split(/[:\s,]+/) : [];

  for (const token of tokens) {
    const normalized = token.replace(/^\*/, '');
    if (normalized === 'INPUT') {
      modes.add('READ');
    } else if (normalized === 'OUTPUT' || normalized === 'ADD') {
      modes.add('WRITE');
    } else if (normalized === 'UPDATE') {
      modes.add('READ');
      modes.add('UPDATE');
    }
  }

  return Array.from(modes).sort((a, b) => a.localeCompare(b));
}

function parseFixedDeclaredAccess(rawLine) {
  const match = rawLine.match(/^\s*F[A-Z0-9_#$@]+\s+([A-Z]{1,3})\b/i);
  const token = match ? normalizeName(match[1]) : '';
  const modes = new Set();

  if (token.includes('I')) {
    modes.add('READ');
  }
  if (token.includes('O')) {
    modes.add('WRITE');
  }
  if (token.includes('U')) {
    modes.add('READ');
    modes.add('UPDATE');
  }

  return Array.from(modes).sort((a, b) => a.localeCompare(b));
}

function collectDefinitions(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const proceduresMap = new Map();
  const prototypesMap = new Map();

  let currentProcedure = null;
  let currentPrototype = null;
  let currentSubroutine = null;

  function finalizeProcedure(endLine) {
    if (!currentProcedure) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentProcedure.name,
      kind: 'PROCEDURE',
      startLine: currentProcedure.startLine,
      endLine,
      sourceForm: 'FREE_FORM',
      exported: currentProcedure.exported,
      text: currentProcedure.text,
    });
    addStructuredItem(
      proceduresMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentProcedure = null;
  }

  function finalizePrototype(endLine) {
    if (!currentPrototype) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentPrototype.name,
      kind: 'PROTOTYPE',
      startLine: currentPrototype.startLine,
      endLine,
      sourceForm: currentPrototype.sourceForm,
      exported: currentPrototype.exported,
      imported: currentPrototype.imported,
      externalName: currentPrototype.externalName,
      text: currentPrototype.text,
    });
    addStructuredItem(
      prototypesMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentPrototype = null;
  }

  function finalizeSubroutine(endLine) {
    if (!currentSubroutine) return;
    const definition = createDefinition({
      filePath,
      ownerProgram,
      name: currentSubroutine.name,
      kind: 'SUBROUTINE',
      startLine: currentSubroutine.startLine,
      endLine,
      sourceForm: 'FIXED_FORM',
      text: currentSubroutine.text,
    });
    addStructuredItem(
      proceduresMap,
      `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
      definition,
    );
    currentSubroutine = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();

    if (currentPrototype) {
      if (/\bend-pr\b/i.test(trimmed)) {
        finalizePrototype(lineNo);
      }
      continue;
    }

    if (currentProcedure) {
      if (/\bend-proc\b/i.test(trimmed)) {
        finalizeProcedure(lineNo);
      }
      continue;
    }

    if (currentSubroutine) {
      if (/^\s*endsr\b/i.test(trimmed) || /\bENDSR\b/i.test(trimmed)) {
        finalizeSubroutine(lineNo);
      }
      continue;
    }

    const dclPrMatch = trimmed.match(/^dcl-pr\s+([A-Z0-9_#$@*]+)\b(.*)$/i);
    if (dclPrMatch) {
      const detail = dclPrMatch[2] || '';
      const externalMatch = detail.match(/\bext(?:proc|pgm)\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i);
      currentPrototype = {
        name: normalizeDefinitionName(dclPrMatch[1], ownerProgram),
        startLine: lineNo,
        sourceForm: 'FREE_FORM',
        imported: Boolean(externalMatch),
        exported: /\bexport\b/i.test(detail),
        externalName: externalMatch ? externalMatch[1] : null,
        text: trimmed,
      };
      if (/\bend-pr\b/i.test(trimmed)) {
        finalizePrototype(lineNo);
      }
      continue;
    }

    const fixedPrototype = parseFixedPrototype(rawLine);
    if (fixedPrototype) {
      const externalMatch = String(fixedPrototype.detail || '').match(/\bEXT(?:PROC|PGM)\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i);
      const definition = createDefinition({
        filePath,
        ownerProgram,
        name: normalizeDefinitionName(fixedPrototype.name, ownerProgram),
        kind: 'PROTOTYPE',
        startLine: lineNo,
        endLine: lineNo,
        sourceForm: 'FIXED_FORM',
        imported: Boolean(externalMatch),
        externalName: externalMatch ? externalMatch[1] : null,
        text: trimmed,
      });
      addStructuredItem(
        prototypesMap,
        `${definition.ownerProgram}|${definition.sourceFile}|${definition.kind}|${definition.name}|${definition.startLine}`,
        definition,
      );
      continue;
    }

    const dclProcMatch = trimmed.match(/^dcl-proc\s+([A-Z0-9_#$@*]+)\b(.*)$/i);
    if (dclProcMatch) {
      currentProcedure = {
        name: normalizeDefinitionName(dclProcMatch[1], ownerProgram),
        startLine: lineNo,
        exported: /\bexport\b/i.test(dclProcMatch[2] || ''),
        text: trimmed,
      };
      if (/\bend-proc\b/i.test(trimmed)) {
        finalizeProcedure(lineNo);
      }
      continue;
    }

    const freeBegsrMatch = trimmed.match(/^begsr\s+([A-Z0-9_#$@*]+)\b/i);
    if (freeBegsrMatch) {
      currentSubroutine = {
        name: normalizeDefinitionName(freeBegsrMatch[1], ownerProgram),
        startLine: lineNo,
        text: trimmed,
      };
      continue;
    }

    const fixedBegsrMatch = rawLine.match(/^\s*C?\s*([A-Z0-9_#$@*]+)\s+BEGSR\b/i);
    if (fixedBegsrMatch) {
      currentSubroutine = {
        name: normalizeDefinitionName(fixedBegsrMatch[1], ownerProgram),
        startLine: lineNo,
        text: trimmed,
      };
    }
  }

  if (currentPrototype) {
    finalizePrototype(lines.length);
  }
  if (currentProcedure) {
    finalizeProcedure(lines.length);
  }
  if (currentSubroutine) {
    finalizeSubroutine(lines.length);
  }

  const procedures = Array.from(proceduresMap.values()).sort((a, b) => {
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.name.localeCompare(b.name);
  });
  const localProcedureNames = new Set(procedures.map((entry) => entry.name));
  const prototypes = Array.from(prototypesMap.values())
    .map((prototype) => ({
      ...prototype,
      imported: prototype.imported || !localProcedureNames.has(prototype.name),
    }))
    .sort((a, b) => {
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    });

  return {
    ownerProgram,
    procedures,
    prototypes,
  };
}

function collectNativeFileDeclarations(filePath, lines) {
  const ownerProgram = toRelativeProgramName(filePath);
  const nativeFilesMap = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();
    const dclFMatch = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)\b(.*)$/i);
    if (dclFMatch) {
      const declaration = createNativeFileDeclaration({
        filePath,
        ownerProgram,
        name: dclFMatch[1],
        kind: inferNativeFileKind(dclFMatch[2] || ''),
        lineNo,
        declaredAccess: parseDeclaredAccess(dclFMatch[2] || ''),
        keyed: /\bKEYED\b/i.test(dclFMatch[2] || ''),
        text: trimmed,
      });
      addStructuredItem(nativeFilesMap, declaration.name, declaration);
      continue;
    }

    const fixedFSpecMatch = rawLine.match(/^\s*F[A-Z0-9_#$@]/i);
    if (!fixedFSpecMatch) {
      continue;
    }

    const trimmedUpper = trimmed.toUpperCase();
    if (trimmedUpper.startsWith('FROM ')) {
      continue;
    }

    const tokenMatch = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
    const fIndex = rawLine.search(/F/i);
    const fixedColName = fIndex >= 0 ? rawLine.slice(fIndex + 1, fIndex + 11).replace(/\s+/g, '') : '';
    const tableName = ((tokenMatch ? tokenMatch[1] : '') || fixedColName).trim();
    if (!tableName) {
      continue;
    }

    const declaration = createNativeFileDeclaration({
      filePath,
      ownerProgram,
      name: tableName,
      kind: inferNativeFileKind(rawLine),
      lineNo,
      declaredAccess: parseFixedDeclaredAccess(rawLine),
      keyed: /\bK\b/i.test(rawLine),
      text: trimmed,
    });
    addStructuredItem(nativeFilesMap, declaration.name, declaration);
  }

  return Array.from(nativeFilesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function findCurrentOwner(lineNo, ownerProgram, procedures) {
  const active = (procedures || []).find((procedure) => lineNo >= procedure.startLine && lineNo <= procedure.endLine);
  if (active) {
    return {
      ownerProgram,
      ownerName: active.name,
      ownerKind: active.kind,
    };
  }
  return {
    ownerProgram,
    ownerName: ownerProgram,
    ownerKind: 'PROGRAM',
  };
}

function classifyProcedureCall(targetName, localProcedures, prototypes, forceInternalSubroutine = false) {
  const normalized = normalizeName(targetName);
  if (!normalized) {
    return {
      resolution: 'DYNAMIC',
      targetKind: 'DYNAMIC',
      targetProgram: null,
      name: '<DYNAMIC>',
    };
  }

  if (forceInternalSubroutine) {
    const subroutine = (localProcedures || []).find((entry) => entry.kind === 'SUBROUTINE' && entry.name === normalized);
    if (subroutine) {
      return {
        resolution: 'INTERNAL',
        targetKind: 'SUBROUTINE',
        targetProgram: subroutine.ownerProgram,
        name: normalized,
      };
    }
    return {
      resolution: 'UNRESOLVED',
      targetKind: 'UNRESOLVED',
      targetProgram: null,
      name: normalized,
    };
  }

  const localProcedure = (localProcedures || []).find((entry) => entry.name === normalized);
  if (localProcedure) {
    return {
      resolution: 'INTERNAL',
      targetKind: localProcedure.kind,
      targetProgram: localProcedure.ownerProgram,
      name: normalized,
    };
  }

  const prototype = (prototypes || []).find((entry) => entry.name === normalized);
  if (prototype) {
    return {
      resolution: 'EXTERNAL',
      targetKind: 'PROTOTYPE',
      targetProgram: prototype.ownerProgram,
      name: normalized,
    };
  }

  return {
    resolution: 'UNRESOLVED',
    targetKind: 'UNRESOLVED',
    targetProgram: null,
    name: normalized,
  };
}

function looksLikeStandaloneSql(text) {
  const normalized = normalizeWhitespace(text).toUpperCase();
  if (/^SELECT\b.*\bFROM\b/.test(normalized)) return true;
  if (/^INSERT\b.*\bINTO\b/.test(normalized)) return true;
  if (/^UPDATE\b.*\bSET\b/.test(normalized)) return true;
  if (/^DELETE\b\s+FROM\b/.test(normalized)) return true;
  if (/^MERGE\b\s+INTO\b/.test(normalized)) return true;
  if (/^WITH\b/.test(normalized)) return true;
  return false;
}

function mapNativeOpcode(opcode) {
  const normalized = normalizeName(opcode);
  if (['CHAIN', 'READ', 'READE', 'READP', 'READPE'].includes(normalized)) {
    return {
      accessKind: 'READ',
      keyed: ['CHAIN', 'READE', 'READPE'].includes(normalized),
      interactive: false,
      mutating: false,
    };
  }
  if (['SETLL', 'SETGT'].includes(normalized)) {
    return {
      accessKind: 'POSITION',
      keyed: true,
      interactive: false,
      mutating: false,
    };
  }
  if (normalized === 'WRITE') {
    return {
      accessKind: 'WRITE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'UPDATE') {
    return {
      accessKind: 'UPDATE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'DELETE') {
    return {
      accessKind: 'DELETE',
      keyed: false,
      interactive: false,
      mutating: true,
    };
  }
  if (normalized === 'EXFMT') {
    return {
      accessKind: 'DISPLAY',
      keyed: false,
      interactive: true,
      mutating: false,
    };
  }
  return null;
}

function extractTargetToken(text) {
  const matches = String(text || '').match(/[A-Z0-9_#$@*]+/gi);
  if (!matches || matches.length === 0) return '';
  return matches[matches.length - 1];
}

function parseFreeFormNativeIo(trimmed) {
  if (!trimmed || looksLikeStandaloneSql(trimmed)) {
    return null;
  }

  const opcodeMatch = trimmed.match(/^(CHAIN|SETLL|SETGT|READPE|READP|READE|READ|WRITE|UPDATE|DELETE|EXFMT)\b(?:\s*\([^)]*\))?\s+(.+)$/i);
  if (!opcodeMatch) {
    return null;
  }

  const opcode = normalizeName(opcodeMatch[1]);
  if (!NATIVE_IO_OPCODES.has(opcode)) {
    return null;
  }

  const target = extractTargetToken(opcodeMatch[2].replace(/[;)]\s*$/, ''));
  if (!target) {
    return null;
  }

  return {
    opcode,
    target: normalizeName(target),
  };
}

function parseFixedFormNativeIo(rawLine) {
  const match = rawLine.match(/^\s*C\b.*?\b(CHAIN|SETLL|SETGT|READPE|READP|READE|READ|WRITE|UPDATE|DELETE|EXFMT)\b\s+([A-Z0-9_#$@*]+)/i);
  if (!match) {
    return null;
  }

  const opcode = normalizeName(match[1]);
  if (!NATIVE_IO_OPCODES.has(opcode)) {
    return null;
  }

  return {
    opcode,
    target: normalizeName(match[2]),
  };
}

function resolveNativeFileTarget(targetName, opcode, nativeFiles) {
  const normalizedTarget = normalizeName(targetName);
  if (!normalizedTarget) {
    return null;
  }

  const direct = (nativeFiles || []).find((entry) => entry.name === normalizedTarget);
  if (direct) {
    return {
      fileName: direct.name,
      fileKind: direct.kind || 'FILE',
      keyed: Boolean(direct.keyed),
      recordFormat: null,
    };
  }

  if (normalizeName(opcode) === 'EXFMT') {
    const workstationFiles = (nativeFiles || []).filter((entry) => entry.kind === 'WORKSTN');
    if (workstationFiles.length === 1) {
      return {
        fileName: workstationFiles[0].name,
        fileKind: workstationFiles[0].kind,
        keyed: Boolean(workstationFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }
  }

  if (normalizeName(opcode) === 'WRITE') {
    const printerFiles = (nativeFiles || []).filter((entry) => entry.kind === 'PRINTER');
    if (printerFiles.length === 1) {
      return {
        fileName: printerFiles[0].name,
        fileKind: printerFiles[0].kind,
        keyed: Boolean(printerFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }

    const workstationFiles = (nativeFiles || []).filter((entry) => entry.kind === 'WORKSTN');
    if (workstationFiles.length === 1) {
      return {
        fileName: workstationFiles[0].name,
        fileKind: workstationFiles[0].kind,
        keyed: Boolean(workstationFiles[0].keyed),
        recordFormat: normalizedTarget,
      };
    }
  }

  return null;
}

function scanContent(filePath, content) {
  const lines = content.split(/\r?\n/);
  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  const procedureCallsMap = new Map();
  const nativeFileAccessesMap = new Map();
  const sqlStatements = [];

  const { ownerProgram, procedures, prototypes } = collectDefinitions(filePath, lines);
  const nativeFiles = collectNativeFileDeclarations(filePath, lines);

  let inExecSql = false;
  let execStartLine = 0;
  let execBuffer = [];

  const finalizeExecSql = (endLine) => {
    if (execBuffer.length === 0) return;

    const sqlText = normalizeWhitespace(execBuffer.join(' '));
    const tables = extractSqlTables(sqlText);
    sqlStatements.push({
      type: detectSqlType(sqlText),
      text: sqlText,
      tables,
      evidence: [
        {
          file: filePath,
          startLine: execStartLine,
          endLine,
        },
      ],
    });

    for (const tableName of tables) {
      addEntity(tablesMap, tableName, {
        kind: 'SQL',
        evidence: { file: filePath, line: execStartLine, text: sqlText },
      });
    }

    execBuffer = [];
    inExecSql = false;
    execStartLine = 0;
  };

  const addProcedureCallEntry = (call) => {
    addStructuredItem(
      procedureCallsMap,
      [
        call.ownerProgram,
        call.ownerFile,
        call.ownerName,
        call.ownerKind,
        call.name,
        call.resolution,
        call.targetKind,
        call.targetProgram || '',
        (call.evidence && call.evidence[0] && (call.evidence[0].line || call.evidence[0].startLine)) || 0,
      ].join('|'),
      call,
    );
  };

  const addNativeFileAccessEntry = (access) => {
    addStructuredItem(
      nativeFileAccessesMap,
      [
        access.fileName,
        access.ownerProgram,
        access.ownerFile,
        access.ownerName,
        access.ownerKind,
        access.opcode,
        access.accessKind,
        access.recordFormat || '',
        (access.evidence && access.evidence[0] && access.evidence[0].line) || 0,
      ].join('|'),
      access,
    );
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;

    if (isCommentLine(rawLine)) {
      continue;
    }

    const trimmed = rawLine.trim();
    const owner = findCurrentOwner(lineNo, ownerProgram, procedures);

    const dclFMatch = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)/i);
    if (dclFMatch) {
      const upperLine = rawLine.toUpperCase();
      let kind = 'FILE';
      if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
      if (upperLine.includes('PRINTER')) kind = 'PRINTER';
      if (upperLine.includes('DISK')) kind = 'DISK';
      addEntity(tablesMap, dclFMatch[1], {
        kind,
        evidence: { file: filePath, line: lineNo, text: trimmed },
      });
    }

    const fixedFSpecMatch = rawLine.match(/^\s*F[A-Z0-9_#$@]/i);
    if (fixedFSpecMatch) {
      const trimmedUpper = trimmed.toUpperCase();
      if (!trimmedUpper.startsWith('FROM ')) {
        const tokenMatch = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
        const fIndex = rawLine.search(/F/i);
        const fixedColName = fIndex >= 0 ? rawLine.slice(fIndex + 1, fIndex + 11).replace(/\s+/g, '') : '';
        const tableName = ((tokenMatch ? tokenMatch[1] : '') || fixedColName).trim();
        if (tableName) {
          const upperLine = rawLine.toUpperCase();
          let kind = 'FILE';
          if (upperLine.includes('WORKSTN')) kind = 'WORKSTN';
          if (upperLine.includes('PRINTER')) kind = 'PRINTER';
          if (upperLine.includes('DISK')) kind = 'DISK';
          addEntity(tablesMap, tableName, {
            kind,
            evidence: { file: filePath, line: lineNo, text: trimmed },
          });
        }
      }
    }

    const copyMatch = rawLine.match(/^\s*\/(?:COPY|INCLUDE)\s+(.+)$/i) || rawLine.match(/^\s*COPY\s+(.+)$/i);
    if (copyMatch) {
      const copyName = normalizeName(copyMatch[1].replace(/["']/g, '').trim());
      if (copyName) {
        addEntity(copyMembersMap, copyName, {
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    const nativeIoMatch = parseFreeFormNativeIo(trimmed) || parseFixedFormNativeIo(rawLine);
    if (nativeIoMatch) {
      const resolvedTarget = resolveNativeFileTarget(nativeIoMatch.target, nativeIoMatch.opcode, nativeFiles);
      const opcodeAttributes = mapNativeOpcode(nativeIoMatch.opcode);
      if (resolvedTarget && opcodeAttributes) {
        addNativeFileAccessEntry(createNativeFileAccess({
          filePath,
          ownerProgram: owner.ownerProgram,
          ownerName: owner.ownerName,
          ownerKind: owner.ownerKind,
          lineNo,
          text: trimmed,
          fileName: resolvedTarget.fileName,
          fileKind: resolvedTarget.fileKind,
          opcode: nativeIoMatch.opcode,
          accessKind: opcodeAttributes.accessKind,
          recordFormat: resolvedTarget.recordFormat,
          keyed: opcodeAttributes.keyed || resolvedTarget.keyed,
          interactive: opcodeAttributes.interactive || resolvedTarget.fileKind === 'WORKSTN',
          mutating: opcodeAttributes.mutating,
        }));
      }
    }

    const programCallPatterns = [
      /\bCALL\s+PGM\s*\(\s*['"]?([A-Z0-9_#$@./]+)['"]?\s*\)/i,
      /\bCALL\s+['"]([A-Z0-9_#$@]+)['"]/i,
      /\bCALL\s+(?!PGM\b)([A-Z0-9_#$@]+)\b/i,
    ];

    for (const regex of programCallPatterns) {
      const match = rawLine.match(regex);
      if (match) {
        addEntity(callsMap, match[1], {
          kind: 'PROGRAM',
          evidence: { file: filePath, line: lineNo, text: trimmed },
        });
      }
    }

    const staticProcedureCallPatterns = [
      /\bCALLP\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i,
      /\bCALLP\s+([A-Z0-9_#$@]+)\b/i,
      /\bCALLPRC\s*\(\s*['"]([A-Z0-9_#$@]+)['"]\s*\)/i,
      /\bCALLPRC\s*\(\s*([A-Z0-9_#$@]+)\s*\)/i,
      /\bCALLB\s+['"]?([A-Z0-9_#$@]+)['"]?/i,
    ];

    for (const regex of staticProcedureCallPatterns) {
      const match = rawLine.match(regex);
      if (match) {
        const classification = classifyProcedureCall(match[1], procedures, prototypes);
        addProcedureCallEntry(createProcedureCall({
          filePath,
          ownerProgram: owner.ownerProgram,
          ownerName: owner.ownerName,
          ownerKind: owner.ownerKind,
          lineNo,
          text: trimmed,
          name: classification.name,
          resolution: classification.resolution,
          targetKind: classification.targetKind,
          targetProgram: classification.targetProgram,
        }));
      }
    }

    const exsrMatch = trimmed.match(/^exsr\s+([A-Z0-9_#$@*]+)\b/i) || rawLine.match(/\bEXSR\s+([A-Z0-9_#$@*]+)\b/i);
    if (exsrMatch) {
      const classification = classifyProcedureCall(exsrMatch[1], procedures, prototypes, true);
      addProcedureCallEntry(createProcedureCall({
        filePath,
        ownerProgram: owner.ownerProgram,
        ownerName: owner.ownerName,
        ownerKind: owner.ownerKind,
        lineNo,
        text: trimmed,
        name: classification.name,
        resolution: classification.resolution,
        targetKind: classification.targetKind,
        targetProgram: classification.targetProgram,
      }));
    }

    const dynamicProcedurePatterns = [
      /\bCALLP\s*\((?!\s*['"][A-Z0-9_#$@]+['"]\s*\))/i,
      /\bCALLPRC\s*\((?!\s*['"][A-Z0-9_#$@]+['"]\s*\))(?!\s*[A-Z0-9_#$@]+\s*\))/i,
    ];
    if (dynamicProcedurePatterns.some((regex) => regex.test(rawLine))) {
      addProcedureCallEntry(createProcedureCall({
        filePath,
        ownerProgram: owner.ownerProgram,
        ownerName: owner.ownerName,
        ownerKind: owner.ownerKind,
        lineNo,
        text: trimmed,
        name: '<DYNAMIC>',
        resolution: 'DYNAMIC',
        targetKind: 'DYNAMIC',
      }));
    }

    const execSqlMatch = rawLine.match(/\bEXEC\s+SQL\b/i);
    if (execSqlMatch) {
      if (inExecSql) {
        finalizeExecSql(lineNo - 1);
      }

      inExecSql = true;
      execStartLine = lineNo;
      const sqlPart = rawLine.slice(execSqlMatch.index);
      execBuffer.push(sqlPart.trim());
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (inExecSql) {
      execBuffer.push(trimmed);
      if (rawLine.includes(';')) {
        finalizeExecSql(lineNo);
      }
      continue;
    }

    if (looksLikeStandaloneSql(rawLine)) {
      const sqlText = normalizeWhitespace(trimmed);
      const tables = extractSqlTables(sqlText);
      sqlStatements.push({
        type: detectSqlType(sqlText),
        text: sqlText,
        tables,
        evidence: [
          {
            file: filePath,
            startLine: lineNo,
            endLine: lineNo,
          },
        ],
      });

      for (const tableName of tables) {
        addEntity(tablesMap, tableName, {
          kind: 'SQL',
          evidence: { file: filePath, line: lineNo, text: sqlText },
        });
      }
    }
  }

  if (inExecSql) {
    finalizeExecSql(lines.length);
  }

  return {
    sourceFile: {
      path: filePath,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      lines: lines.length,
    },
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements,
    procedures,
    prototypes,
    procedureCalls: Array.from(procedureCallsMap.values()).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.resolution.localeCompare(b.resolution);
    }),
    nativeFiles,
    nativeFileAccesses: Array.from(nativeFileAccessesMap.values()).sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.opcode !== b.opcode) return a.opcode.localeCompare(b.opcode);
      return ((a.evidence && a.evidence[0] && a.evidence[0].line) || 0) - ((b.evidence && b.evidence[0] && b.evidence[0].line) || 0);
    }),
    notes: [],
  };
}

function scanRpgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return scanContent(filePath, content);
}

function mergeEntities(targetMap, entities, withKind) {
  for (const entity of entities || []) {
    const key = normalizeName(entity.name);
    if (!key) continue;
    if (!targetMap.has(key)) {
      const base = {
        name: key,
        evidence: [],
      };
      if (withKind) {
        base.kind = entity.kind || withKind;
      }
      targetMap.set(key, base);
    }

    const target = targetMap.get(key);
    if (withKind && !target.kind && entity.kind) {
      target.kind = entity.kind;
    }

    for (const evidence of entity.evidence || []) {
      const evidenceKey = JSON.stringify(evidence);
      const exists = target.evidence.some((item) => JSON.stringify(item) === evidenceKey);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
}

function mergeStructuredItems(scanResults, key, identityBuilder, merger) {
  const map = new Map();
  for (const result of scanResults || []) {
    for (const item of result[key] || []) {
      const identity = identityBuilder(item);
      if (!identity) continue;
      if (!map.has(identity)) {
        map.set(identity, {
          ...item,
          evidence: [],
        });
      }
      const target = map.get(identity);
      if (typeof merger === 'function') {
        merger(target, item);
      }
      for (const evidence of item.evidence || []) {
        const evidenceKey = JSON.stringify(evidence);
        const exists = target.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
        if (!exists) {
          target.evidence.push(evidence);
        }
      }
    }
  }
  return Array.from(map.values());
}

function mergeSqlStatements(scanResults) {
  const map = new Map();
  for (const result of scanResults || []) {
    for (const sql of result.sqlStatements || []) {
      const key = `${sql.type}|${sql.text.toUpperCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          type: sql.type,
          text: sql.text,
          tables: Array.from(new Set(sql.tables || [])).sort(),
          evidence: [],
        });
      }

      const item = map.get(key);
      item.tables = Array.from(new Set([...(item.tables || []), ...(sql.tables || [])])).sort();

      for (const evidence of sql.evidence || []) {
        const evidenceKey = JSON.stringify(evidence);
        const exists = item.evidence.some((entry) => JSON.stringify(entry) === evidenceKey);
        if (!exists) {
          item.evidence.push(evidence);
        }
      }
    }
  }
  return Array.from(map.values());
}

function scanSourceFiles(filePaths, options = {}) {
  const scanResults = [];
  const notes = [];
  const scanCache = options && options.scanCache ? options.scanCache : null;

  for (const filePath of filePaths || []) {
    try {
      const result = scanCache && typeof scanCache.getOrScan === 'function'
        ? scanCache.getOrScan(filePath, scanRpgFile)
        : scanRpgFile(filePath);
      scanResults.push(result);
    } catch (error) {
      notes.push(`Skipped file ${filePath}: ${error.message}`);
    }
  }

  const sourceFiles = [];
  for (const result of scanResults) {
    sourceFiles.push(result.sourceFile);
  }

  const tablesMap = new Map();
  const callsMap = new Map();
  const copyMembersMap = new Map();
  mergeEntities(tablesMap, scanResults.flatMap((item) => item.tables || []), 'FILE');
  mergeEntities(callsMap, scanResults.flatMap((item) => item.calls || []), 'PROGRAM');
  mergeEntities(copyMembersMap, scanResults.flatMap((item) => item.copyMembers || []));

  return {
    sourceFiles,
    tables: Array.from(tablesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calls: Array.from(callsMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    copyMembers: Array.from(copyMembersMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sqlStatements: mergeSqlStatements(scanResults),
    procedures: mergeStructuredItems(
      scanResults,
      'procedures',
      (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
    ).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    }),
    prototypes: mergeStructuredItems(
      scanResults,
      'prototypes',
      (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
    ).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    }),
    procedureCalls: mergeStructuredItems(
      scanResults,
      'procedureCalls',
      (item) => [
        item.ownerProgram,
        item.ownerFile,
        item.ownerName,
        item.ownerKind,
        item.name,
        item.resolution,
        item.targetKind,
        item.targetProgram || '',
        (item.evidence && item.evidence[0] && (item.evidence[0].line || item.evidence[0].startLine)) || 0,
      ].join('|'),
    ).sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.resolution.localeCompare(b.resolution);
    }),
    nativeFiles: mergeStructuredItems(
      scanResults,
      'nativeFiles',
      (item) => item.name,
      (target, item) => {
        target.kind = target.kind === 'FILE' && item.kind ? item.kind : (target.kind || item.kind || 'FILE');
        target.keyed = Boolean(target.keyed || item.keyed);
        target.declaredAccess = uniqueSortedStrings([...(target.declaredAccess || []), ...(item.declaredAccess || [])]);
      },
    ).sort((a, b) => a.name.localeCompare(b.name)),
    nativeFileAccesses: mergeStructuredItems(
      scanResults,
      'nativeFileAccesses',
      (item) => [
        item.fileName,
        item.ownerProgram,
        item.ownerFile,
        item.ownerName,
        item.ownerKind,
        item.opcode,
        item.accessKind,
        item.recordFormat || '',
        (item.evidence && item.evidence[0] && item.evidence[0].line) || 0,
      ].join('|'),
    ).sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.opcode !== b.opcode) return a.opcode.localeCompare(b.opcode);
      return ((a.evidence && a.evidence[0] && a.evidence[0].line) || 0) - ((b.evidence && b.evidence[0] && b.evidence[0].line) || 0);
    }),
    notes,
  };
}

module.exports = {
  scanRpgFile,
  scanSourceFiles,
};
