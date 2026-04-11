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
const path = require('path');
const {
  getImportManifestEntryExport,
  getImportManifestEntryOrigin,
  getImportManifestEntryValidation,
  summarizeImportManifest,
} = require('../fetch/importManifest');
const { normalizeRelativePath } = require('../source/sourceIntegrity');

const CANONICAL_ANALYSIS_SCHEMA_VERSION = 1;

function normalizeName(name) {
  return String(name || '').trim().toUpperCase();
}

function uniqueSortedStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeEvidenceList(evidenceList, sourceRoot) {
  return (evidenceList || [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const filePath = entry.file || entry.path || '';
      const normalizedFile = filePath
        ? normalizeRelativePath(sourceRoot, filePath)
        : filePath;
      return {
        ...entry,
        file: normalizedFile || filePath,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const af = String(a.file || '');
      const bf = String(b.file || '');
      if (af !== bf) return af.localeCompare(bf);
      const al = Number(a.line || a.startLine || 0);
      const bl = Number(b.line || b.startLine || 0);
      return al - bl;
    });
}

function dedupeByName(items, sourceRoot, withKind) {
  const map = new Map();

  for (const item of items || []) {
    const key = normalizeName(item && item.name ? item.name : item);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        name: key,
        kind: withKind ? normalizeName(item && item.kind ? item.kind : withKind) : undefined,
        evidence: [],
      });
    }

    const target = map.get(key);
    if (withKind && item && item.kind) {
      target.kind = normalizeName(item.kind);
    }
    for (const evidence of normalizeEvidenceList(item && item.evidence, sourceRoot)) {
      const marker = JSON.stringify(evidence);
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === marker);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      evidenceCount: entry.evidence.length,
      evidence: entry.evidence,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inferSqlIntent(type) {
  const normalizedType = normalizeName(type || 'OTHER') || 'OTHER';
  if (['SELECT', 'FETCH', 'VALUES'].includes(normalizedType)) return 'READ';
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(normalizedType)) return 'WRITE';
  if (['DECLARE_CURSOR', 'OPEN_CURSOR', 'CLOSE_CURSOR'].includes(normalizedType)) return 'CURSOR';
  if (normalizedType === 'CALL') return 'CALL';
  if (['COMMIT', 'ROLLBACK'].includes(normalizedType)) return 'TRANSACTION';
  return 'OTHER';
}

function sortSqlStatements(statements, sourceRoot) {
  const normalized = (statements || []).map((statement) => {
    const evidence = normalizeEvidenceList(statement.evidence || [], sourceRoot);
    const type = normalizeName(statement.type || 'OTHER') || 'OTHER';
    const intent = normalizeName(statement.intent || inferSqlIntent(type)) || 'OTHER';
    const readsData = typeof statement.readsData === 'boolean'
      ? statement.readsData
      : intent === 'READ';
    const writesData = typeof statement.writesData === 'boolean'
      ? statement.writesData
      : intent === 'WRITE';
    return {
      type,
      intent,
      text: String(statement.text || '').trim(),
      tables: uniqueSortedStrings((statement.tables || []).map((name) => normalizeName(name)).filter(Boolean)),
      hostVariables: uniqueSortedStrings((statement.hostVariables || []).map((name) => normalizeName(name)).filter(Boolean)),
      cursors: Array.from(new Map((statement.cursors || [])
        .map((cursor) => {
          const name = normalizeName(cursor && cursor.name);
          const action = normalizeName(cursor && cursor.action);
          return [`${name}:${action}`, { name, action }];
        })
        .filter((entry) => entry[1].name && entry[1].action))
        .values())
        .sort((a, b) => {
          if (a.name !== b.name) return a.name.localeCompare(b.name);
          return a.action.localeCompare(b.action);
        }),
      readsData: Boolean(readsData),
      writesData: Boolean(writesData),
      dynamic: Boolean(statement.dynamic),
      unresolved: Boolean(statement.unresolved),
      uncertainty: uniqueSortedStrings((statement.uncertainty || []).map((name) => normalizeName(name)).filter(Boolean)),
      evidence,
    };
  });

  return normalized.sort((a, b) => {
    const ae = a.evidence[0];
    const be = b.evidence[0];
    if (ae && be) {
      if (ae.file !== be.file) return String(ae.file).localeCompare(String(be.file));
      const aLine = Number(ae.startLine || ae.line || 0);
      const bLine = Number(be.startLine || be.line || 0);
      if (aLine !== bLine) return aLine - bLine;
    } else if (ae && !be) {
      return -1;
    } else if (!ae && be) {
      return 1;
    }

    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.text.localeCompare(b.text);
  });
}

function mergeSqlTablesIntoDependencies(tables, sqlTableNames) {
  const existing = new Set(tables.map((table) => table.name));
  const merged = [...tables];
  for (const tableName of sqlTableNames) {
    if (!existing.has(tableName)) {
      merged.push({
        name: tableName,
        kind: 'TABLE',
        evidenceCount: 0,
        evidence: [],
      });
      existing.add(tableName);
    }
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

function chooseMoreSpecificNativeFileKind(currentKind, nextKind) {
  const rank = {
    FILE: 0,
    DISK: 1,
    WORKSTN: 2,
    PRINTER: 2,
  };
  const current = normalizeName(currentKind || 'FILE') || 'FILE';
  const next = normalizeName(nextKind || 'FILE') || 'FILE';
  return (rank[next] || 0) > (rank[current] || 0) ? next : current;
}

function defaultNativeFileUsage() {
  return {
    summary: {
      fileCount: 0,
      readOnlyFileCount: 0,
      mutatingFileCount: 0,
      interactiveFileCount: 0,
      workstationFileCount: 0,
      printerFileCount: 0,
      keyedFileCount: 0,
      recordFormatCount: 0,
    },
    files: [],
  };
}

function defaultBindingAnalysis() {
  return {
    summary: {
      moduleCount: 0,
      noMainModuleCount: 0,
      serviceProgramCount: 0,
      binderSourceCount: 0,
      bindingDirectoryCount: 0,
      boundModuleCount: 0,
      unresolvedModuleCount: 0,
      exportCount: 0,
    },
    modules: [],
    servicePrograms: [],
    bindingDirectories: [],
  };
}

function defaultSqlAnalysis() {
  return {
    summary: {
      statementCount: 0,
      readStatementCount: 0,
      writeStatementCount: 0,
      dynamicStatementCount: 0,
      unresolvedStatementCount: 0,
      cursorStatementCount: 0,
      hostVariableCount: 0,
      cursorCount: 0,
    },
    tableNames: [],
    hostVariables: [],
    cursors: [],
  };
}

function summarizeSqlStatements(sqlStatements) {
  const statements = sqlStatements || [];
  const tableNames = uniqueSortedStrings(statements.flatMap((statement) => statement.tables || []).map((name) => normalizeName(name)));
  const hostVariables = uniqueSortedStrings(statements.flatMap((statement) => statement.hostVariables || []).map((name) => normalizeName(name)));

  const cursorMap = new Map();
  for (const statement of statements) {
    for (const cursor of statement.cursors || []) {
      const name = normalizeName(cursor && cursor.name);
      const action = normalizeName(cursor && cursor.action);
      if (!name || !action) continue;
      if (!cursorMap.has(name)) {
        cursorMap.set(name, new Set());
      }
      cursorMap.get(name).add(action);
    }
  }

  const cursors = Array.from(cursorMap.entries())
    .map(([name, actions]) => ({
      name,
      actions: Array.from(actions).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    summary: {
      statementCount: statements.length,
      readStatementCount: statements.filter((statement) => statement.readsData).length,
      writeStatementCount: statements.filter((statement) => statement.writesData).length,
      dynamicStatementCount: statements.filter((statement) => statement.dynamic).length,
      unresolvedStatementCount: statements.filter((statement) => statement.unresolved).length,
      cursorStatementCount: statements.filter((statement) => (statement.cursors || []).length > 0).length,
      hostVariableCount: hostVariables.length,
      cursorCount: cursors.length,
    },
    tableNames,
    hostVariables,
    cursors,
  };
}

function buildRiskHints(dependencies, sql, procedureCalls, nativeFileUsage) {
  const hints = [];
  if ((sql.statements || []).length > 0) {
    hints.push('Embedded SQL detected');
  }
  if ((sql.statements || []).some((statement) => statement.dynamic)) {
    hints.push('Dynamic SQL detected');
  }
  if ((sql.statements || []).some((statement) => statement.unresolved)) {
    hints.push('Unresolved SQL dependencies detected');
  }
  if ((dependencies.programCalls || []).length > 0) {
    hints.push('External program calls detected');
  }
  if ((procedureCalls || []).some((call) => call.resolution === 'DYNAMIC')) {
    hints.push('Dynamic procedure call detected');
  }
  if ((procedureCalls || []).some((call) => call.resolution === 'UNRESOLVED')) {
    hints.push('Unresolved procedure call detected');
  }
  if ((dependencies.copyMembers || []).length >= 5) {
    hints.push('Many copy members included');
  }
  if (((dependencies.tables || []).length + (dependencies.programCalls || []).length) >= 10) {
    hints.push('Many external dependencies');
  }
  if (nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.mutatingFileCount > 0) {
    hints.push('Mutating native file I/O detected');
  }
  if (nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.interactiveFileCount > 0) {
    hints.push('Interactive workstation I/O detected');
  }
  if (dependencies && dependencies.bindingAnalysis && dependencies.bindingAnalysis.summary && dependencies.bindingAnalysis.summary.unresolvedModuleCount > 0) {
    hints.push('Unresolved bind-time dependencies detected');
  }
  return hints;
}

function createManifestIndex(importManifest) {
  const map = new Map();
  if (!importManifest || !Array.isArray(importManifest.files)) {
    return map;
  }

  for (const entry of importManifest.files) {
    const origin = getImportManifestEntryOrigin(entry);
    const localPath = String(origin.localPath || '').trim().replace(/\\/g, '/');
    if (localPath) {
      map.set(localPath, entry);
    }
  }

  return map;
}

function normalizeSourceFiles(sourceFiles, sourceRoot, importManifest) {
  const manifestIndex = createManifestIndex(importManifest);
  return (sourceFiles || [])
    .map((entry) => {
      const absolutePath = entry && entry.path ? entry.path : String(entry || '');
      const relPath = absolutePath
        ? normalizeRelativePath(sourceRoot, absolutePath)
        : absolutePath;
      const manifestEntry = manifestIndex.get(relPath) || null;
      const manifestOrigin = manifestEntry ? getImportManifestEntryOrigin(manifestEntry) : null;
      const manifestExport = manifestEntry ? getImportManifestEntryExport(manifestEntry, importManifest) : null;
      const manifestValidation = manifestEntry ? getImportManifestEntryValidation(manifestEntry) : null;

      return {
        id: `FILE:${relPath}`,
        path: relPath || absolutePath,
        sizeBytes: Number(entry && entry.sizeBytes ? entry.sizeBytes : 0),
        lines: Number(entry && entry.lines ? entry.lines : 0),
        provenance: {
          origin: manifestEntry ? 'imported' : 'local',
          import: manifestEntry ? {
            sourceLib: normalizeName(manifestOrigin.sourceLib),
            sourceFile: normalizeName(manifestOrigin.sourceFile),
            member: normalizeName(manifestOrigin.member),
            memberPath: manifestOrigin.memberPath || '',
            remotePath: manifestOrigin.remotePath || '',
            localPath: manifestOrigin.localPath || relPath || absolutePath,
            sourceType: normalizeName(manifestOrigin.sourceType),
            sha256: manifestValidation.sha256 || null,
            transportRequested: manifestExport.transportRequested || null,
            transportUsed: manifestExport.transportUsed || null,
            fetchedAt: importManifest && importManifest.fetchedAt ? importManifest.fetchedAt : null,
            encodingPolicy: manifestExport.encodingPolicy || null,
            normalizationPolicy: manifestExport.normalizationPolicy || null,
            exportStatus: manifestExport.status || null,
            validationStatus: manifestValidation.status || null,
          } : null,
        },
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeStructuredItems(items, sourceRoot, mapper, identityBuilder) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const normalized = mapper(item, sourceRoot);
    const key = identityBuilder(normalized);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        ...normalized,
        evidence: [],
      });
    }
    const target = map.get(key);
    for (const evidence of normalized.evidence || []) {
      const serialized = JSON.stringify(evidence);
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === serialized);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }
  return Array.from(map.values());
}

function createEntityId(type, name) {
  return `${String(type || '').trim().toUpperCase()}:${String(name || '').trim()}`;
}

function createRelationId(type, from, to) {
  return `${String(type || '').trim().toUpperCase()}:${String(from || '')}->${String(to || '')}`;
}

function normalizeProgramCalls(calls, sourceRoot) {
  return dedupeByName(calls, sourceRoot, 'PROGRAM').map((call) => ({
    ...call,
    kind: call.kind || 'PROGRAM',
    id: createEntityId('PROGRAM', call.name),
  }));
}

function normalizeProcedures(procedures, sourceRoot) {
  return normalizeStructuredItems(
    procedures,
    sourceRoot,
    (item, rootDir) => ({
      name: normalizeName(item.name),
      kind: normalizeName(item.kind || 'PROCEDURE'),
      ownerProgram: normalizeName(item.ownerProgram),
      sourceFile: normalizeRelativePath(rootDir, item.sourceFile),
      startLine: Number(item.startLine) || 0,
      endLine: Number(item.endLine) || Number(item.startLine) || 0,
      sourceForm: normalizeName(item.sourceForm || ''),
      exported: Boolean(item.exported),
      imported: Boolean(item.imported),
      externalName: item.externalName ? normalizeName(item.externalName) : null,
      evidence: normalizeEvidenceList(item.evidence || [], rootDir),
    }),
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
  )
    .map((item) => ({
      ...item,
      id: createEntityId(item.kind === 'SUBROUTINE' ? 'SUBROUTINE' : 'PROCEDURE', `${item.ownerProgram}:${item.sourceFile}:${item.name}`),
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    });
}

function normalizePrototypes(prototypes, sourceRoot) {
  return normalizeStructuredItems(
    prototypes,
    sourceRoot,
    (item, rootDir) => ({
      name: normalizeName(item.name),
      kind: 'PROTOTYPE',
      ownerProgram: normalizeName(item.ownerProgram),
      sourceFile: normalizeRelativePath(rootDir, item.sourceFile),
      startLine: Number(item.startLine) || 0,
      endLine: Number(item.endLine) || Number(item.startLine) || 0,
      sourceForm: normalizeName(item.sourceForm || ''),
      exported: Boolean(item.exported),
      imported: Boolean(item.imported),
      externalName: item.externalName ? normalizeName(item.externalName) : null,
      evidence: normalizeEvidenceList(item.evidence || [], rootDir),
    }),
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name, item.startLine, item.endLine].join('|'),
  )
    .map((item) => ({
      ...item,
      id: createEntityId('PROTOTYPE', `${item.ownerProgram}:${item.sourceFile}:${item.name}`),
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.name.localeCompare(b.name);
    });
}

function normalizeProcedureCalls(procedureCalls, sourceRoot) {
  return normalizeStructuredItems(
    procedureCalls,
    sourceRoot,
    (item, rootDir) => ({
      name: normalizeName(item.name),
      ownerProgram: normalizeName(item.ownerProgram),
      ownerName: normalizeName(item.ownerName),
      ownerKind: normalizeName(item.ownerKind),
      ownerFile: normalizeRelativePath(rootDir, item.ownerFile || item.sourceFile || ''),
      resolution: normalizeName(item.resolution),
      targetKind: normalizeName(item.targetKind),
      targetProgram: item.targetProgram ? normalizeName(item.targetProgram) : null,
      evidence: normalizeEvidenceList(item.evidence || [], rootDir),
    }),
    (item) => [
      item.ownerProgram,
      item.ownerFile,
      item.ownerName,
      item.ownerKind,
      item.name,
      item.resolution,
      item.targetKind,
      item.targetProgram || '',
    ].join('|'),
  )
    .map((item) => ({
      ...item,
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.resolution.localeCompare(b.resolution);
    });
}

function normalizeNativeFiles(nativeFiles, sourceRoot) {
  const map = new Map();

  for (const item of nativeFiles || []) {
    if (!item || typeof item !== 'object') continue;
    const name = normalizeName(item.name);
    if (!name) continue;

    const normalized = {
      name,
      kind: normalizeName(item.kind || 'FILE') || 'FILE',
      declaredAccess: uniqueSortedStrings(item.declaredAccess || []),
      keyed: Boolean(item.keyed),
      evidence: normalizeEvidenceList(item.evidence || [], sourceRoot),
    };

    if (!map.has(name)) {
      map.set(name, {
        ...normalized,
        evidence: [],
      });
    }

    const target = map.get(name);
    target.kind = chooseMoreSpecificNativeFileKind(target.kind, normalized.kind);
    target.keyed = Boolean(target.keyed || normalized.keyed);
    target.declaredAccess = uniqueSortedStrings([...(target.declaredAccess || []), ...(normalized.declaredAccess || [])]);

    for (const evidence of normalized.evidence || []) {
      const serialized = JSON.stringify(evidence);
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === serialized);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      id: createEntityId('NATIVE_FILE', item.name),
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeNativeFileAccesses(nativeFileAccesses, sourceRoot) {
  return normalizeStructuredItems(
    nativeFileAccesses,
    sourceRoot,
    (item, rootDir) => ({
      fileName: normalizeName(item.fileName),
      fileKind: normalizeName(item.fileKind || 'FILE') || 'FILE',
      opcode: normalizeName(item.opcode),
      accessKind: normalizeName(item.accessKind),
      recordFormat: item.recordFormat ? normalizeName(item.recordFormat) : null,
      keyed: Boolean(item.keyed),
      interactive: Boolean(item.interactive),
      mutating: Boolean(item.mutating),
      ownerProgram: normalizeName(item.ownerProgram),
      ownerName: normalizeName(item.ownerName),
      ownerKind: normalizeName(item.ownerKind),
      ownerFile: normalizeRelativePath(rootDir, item.ownerFile || ''),
      evidence: normalizeEvidenceList(item.evidence || [], rootDir),
    }),
    (item) => [
      item.fileName,
      item.ownerProgram,
      item.ownerFile,
      item.ownerName,
      item.ownerKind,
      item.opcode,
      item.accessKind,
      item.recordFormat || '',
      ((item.evidence && item.evidence[0] && (item.evidence[0].line || item.evidence[0].startLine)) || 0),
    ].join('|'),
  )
    .map((item) => ({
      ...item,
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => {
      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.ownerName !== b.ownerName) return a.ownerName.localeCompare(b.ownerName);
      if (a.opcode !== b.opcode) return a.opcode.localeCompare(b.opcode);
      return (((a.evidence && a.evidence[0] && (a.evidence[0].line || a.evidence[0].startLine)) || 0)
        - ((b.evidence && b.evidence[0] && (b.evidence[0].line || b.evidence[0].startLine)) || 0));
    });
}

function normalizeBindingDirectories(bindingDirectories, sourceRoot) {
  return dedupeByName(bindingDirectories, sourceRoot, 'BINDING_DIRECTORY')
    .map((item) => ({
      ...item,
      kind: 'BINDING_DIRECTORY',
      id: createEntityId('BINDING_DIRECTORY', item.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeModules(modules, sourceRoot) {
  return normalizeStructuredItems(
    modules,
    sourceRoot,
    (item, rootDir) => ({
      name: normalizeName(item.name),
      kind: normalizeName(item.kind || 'PROGRAM_MODULE') || 'PROGRAM_MODULE',
      ownerProgram: normalizeName(item.ownerProgram),
      sourceFile: normalizeRelativePath(rootDir, item.sourceFile || ''),
      bindingDirectories: uniqueSortedStrings(item.bindingDirectories || []),
      servicePrograms: uniqueSortedStrings(item.servicePrograms || []),
      importedProcedures: uniqueSortedStrings(item.importedProcedures || []),
      evidence: normalizeEvidenceList(item.evidence || [], rootDir),
    }),
    (item) => [item.ownerProgram, item.sourceFile, item.kind, item.name].join('|'),
  )
    .map((item) => ({
      ...item,
      id: createEntityId('MODULE', `${item.ownerProgram}:${item.sourceFile}:${item.name}`),
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => {
      if (a.ownerProgram !== b.ownerProgram) return a.ownerProgram.localeCompare(b.ownerProgram);
      if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
      return a.name.localeCompare(b.name);
    });
}

function normalizeServicePrograms(servicePrograms, sourceRoot) {
  const map = new Map();

  for (const item of servicePrograms || []) {
    if (!item || typeof item !== 'object') continue;
    const name = normalizeName(item.name);
    if (!name) continue;

    const normalized = {
      name,
      sourceFile: item.sourceFile ? normalizeRelativePath(sourceRoot, item.sourceFile) : null,
      sourceKind: normalizeName(item.sourceKind || 'HINT') || 'HINT',
      exports: Array.from(new Map((item.exports || [])
        .map((entry) => {
          const symbol = normalizeName(entry && entry.symbol);
          const signatureLevel = normalizeName(entry && entry.signatureLevel ? entry.signatureLevel : 'CURRENT') || 'CURRENT';
          return [`${symbol}:${signatureLevel}`, { symbol, signatureLevel }];
        })
        .filter((entry) => entry[1].symbol))
        .values())
        .sort((a, b) => {
          if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
          return a.signatureLevel.localeCompare(b.signatureLevel);
        }),
      evidence: normalizeEvidenceList(item.evidence || [], sourceRoot),
    };

    if (!map.has(name)) {
      map.set(name, {
        ...normalized,
        evidence: [],
      });
    }

    const target = map.get(name);
    if (!target.sourceFile && normalized.sourceFile) {
      target.sourceFile = normalized.sourceFile;
    }
    if (target.sourceKind !== 'BINDER_SOURCE' && normalized.sourceKind === 'BINDER_SOURCE') {
      target.sourceKind = 'BINDER_SOURCE';
    }

    const exportSet = new Map((target.exports || []).map((entry) => [`${entry.symbol}:${entry.signatureLevel}`, entry]));
    for (const entry of normalized.exports || []) {
      exportSet.set(`${entry.symbol}:${entry.signatureLevel}`, entry);
    }
    target.exports = Array.from(exportSet.values()).sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return a.signatureLevel.localeCompare(b.signatureLevel);
    });

    for (const evidence of normalized.evidence || []) {
      const serialized = JSON.stringify(evidence);
      const exists = target.evidence.some((entry) => JSON.stringify(entry) === serialized);
      if (!exists) {
        target.evidence.push(evidence);
      }
    }
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      id: createEntityId('SERVICE_PROGRAM', item.name),
      evidenceCount: item.evidence.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeNativeFileUsage(nativeFiles, nativeFileAccesses) {
  const files = new Map();

  for (const nativeFile of nativeFiles || []) {
    files.set(nativeFile.name, {
      name: nativeFile.name,
      kind: nativeFile.kind || 'FILE',
      keyed: Boolean(nativeFile.keyed),
      declaredAccess: uniqueSortedStrings(nativeFile.declaredAccess || []),
      access: {
        read: (nativeFile.declaredAccess || []).includes('READ'),
        write: (nativeFile.declaredAccess || []).includes('WRITE'),
        update: (nativeFile.declaredAccess || []).includes('UPDATE'),
        delete: false,
        position: false,
        display: nativeFile.kind === 'WORKSTN',
        mutating: (nativeFile.declaredAccess || []).some((entry) => ['WRITE', 'UPDATE'].includes(entry)),
        interactive: nativeFile.kind === 'WORKSTN',
      },
      owners: [],
      recordFormats: [],
      evidenceCount: Number(nativeFile.evidenceCount) || (nativeFile.evidence || []).length || 0,
    });
  }

  for (const access of nativeFileAccesses || []) {
    if (!access.fileName) continue;
    if (!files.has(access.fileName)) {
      files.set(access.fileName, {
        name: access.fileName,
        kind: access.fileKind || 'FILE',
        keyed: Boolean(access.keyed),
        declaredAccess: [],
        access: {
          read: false,
          write: false,
          update: false,
          delete: false,
          position: false,
          display: false,
          mutating: false,
          interactive: false,
        },
        owners: [],
        recordFormats: [],
        evidenceCount: 0,
      });
    }

    const file = files.get(access.fileName);
    file.kind = chooseMoreSpecificNativeFileKind(file.kind, access.fileKind || 'FILE');
    file.keyed = Boolean(file.keyed || access.keyed);
    file.evidenceCount += Number(access.evidenceCount) || (access.evidence || []).length || 0;

    if (access.accessKind === 'READ') file.access.read = true;
    if (access.accessKind === 'WRITE') file.access.write = true;
    if (access.accessKind === 'UPDATE') file.access.update = true;
    if (access.accessKind === 'DELETE') file.access.delete = true;
    if (access.accessKind === 'POSITION') file.access.position = true;
    if (access.accessKind === 'DISPLAY') file.access.display = true;
    if (access.mutating) file.access.mutating = true;
    if (access.interactive) file.access.interactive = true;

    const ownerKey = `${access.ownerKind}:${access.ownerName}`;
    const ownerExists = file.owners.some((entry) => `${entry.kind}:${entry.name}` === ownerKey);
    if (!ownerExists) {
      file.owners.push({
        name: access.ownerName,
        kind: access.ownerKind,
      });
      file.owners.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.name.localeCompare(b.name);
      });
    }

    if (access.recordFormat) {
      let recordFormat = file.recordFormats.find((entry) => entry.name === access.recordFormat);
      if (!recordFormat) {
        recordFormat = {
          name: access.recordFormat,
          operations: [],
        };
        file.recordFormats.push(recordFormat);
      }
      recordFormat.operations = uniqueSortedStrings([...(recordFormat.operations || []), access.opcode]);
      file.recordFormats.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const fileList = Array.from(files.values())
    .map((file) => ({
      ...file,
      declaredAccess: uniqueSortedStrings(file.declaredAccess || []),
      recordFormats: (file.recordFormats || []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    summary: {
      fileCount: fileList.length,
      readOnlyFileCount: fileList.filter((file) => file.access.read && !file.access.mutating && !file.access.interactive).length,
      mutatingFileCount: fileList.filter((file) => file.access.mutating).length,
      interactiveFileCount: fileList.filter((file) => file.access.interactive).length,
      workstationFileCount: fileList.filter((file) => file.kind === 'WORKSTN').length,
      printerFileCount: fileList.filter((file) => file.kind === 'PRINTER').length,
      keyedFileCount: fileList.filter((file) => file.keyed || file.access.position).length,
      recordFormatCount: fileList.reduce((sum, file) => sum + ((file.recordFormats || []).length), 0),
    },
    files: fileList,
  };
}

function summarizeBindingAnalysis(modules, servicePrograms, bindingDirectories, procedures) {
  const exportedProcedureNames = new Set((procedures || []).filter((entry) => entry.exported).map((entry) => entry.name));
  const moduleList = (modules || []).map((module) => ({
    name: module.name,
    kind: module.kind,
    ownerProgram: module.ownerProgram,
    sourceFile: module.sourceFile,
    bindingDirectories: uniqueSortedStrings(module.bindingDirectories || []),
    servicePrograms: uniqueSortedStrings(module.servicePrograms || []),
    importedProcedures: uniqueSortedStrings(module.importedProcedures || []),
    unresolvedBindings: Boolean((module.importedProcedures || []).length > 0
      && (module.bindingDirectories || []).length === 0
      && (module.servicePrograms || []).length === 0),
  }));
  const serviceProgramList = (servicePrograms || []).map((serviceProgram) => ({
    name: serviceProgram.name,
    sourceFile: serviceProgram.sourceFile || null,
    sourceKind: serviceProgram.sourceKind || 'HINT',
    exports: (serviceProgram.exports || []).map((entry) => ({
      symbol: entry.symbol,
      signatureLevel: entry.signatureLevel || 'CURRENT',
      resolved: exportedProcedureNames.has(entry.symbol),
    })),
  }));
  const bindingDirectoryList = (bindingDirectories || []).map((entry) => ({
    name: entry.name,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    summary: {
      moduleCount: moduleList.length,
      noMainModuleCount: moduleList.filter((module) => module.kind === 'NOMAIN_MODULE').length,
      serviceProgramCount: serviceProgramList.length,
      binderSourceCount: serviceProgramList.filter((serviceProgram) => serviceProgram.sourceKind === 'BINDER_SOURCE').length,
      bindingDirectoryCount: bindingDirectoryList.length,
      boundModuleCount: moduleList.filter((module) => module.bindingDirectories.length > 0 || module.servicePrograms.length > 0).length,
      unresolvedModuleCount: moduleList.filter((module) => module.unresolvedBindings).length,
      exportCount: serviceProgramList.reduce((sum, serviceProgram) => sum + (serviceProgram.exports || []).length, 0),
    },
    modules: moduleList.sort((a, b) => a.name.localeCompare(b.name)),
    servicePrograms: serviceProgramList.sort((a, b) => a.name.localeCompare(b.name)),
    bindingDirectories: bindingDirectoryList,
  };
}

function buildSqlEntities(sqlStatements) {
  return sqlStatements.map((statement, index) => ({
    ...statement,
    id: createEntityId('SQL', String(index + 1).padStart(4, '0')),
  }));
}

function buildProgramEntities(rootProgram, sourceFiles, programCalls, procedures, prototypes) {
  const sourcePrograms = new Set((sourceFiles || []).map((entry) => normalizeName(path.basename(entry.path, path.extname(entry.path)))));
  const ownerPrograms = new Set([
    ...(procedures || []).map((entry) => entry.ownerProgram),
    ...(prototypes || []).map((entry) => entry.ownerProgram),
  ]);
  const calledPrograms = new Set((programCalls || []).map((entry) => entry.name));
  const programNames = uniqueSortedStrings([rootProgram, ...sourcePrograms, ...ownerPrograms, ...calledPrograms]);

  return programNames.map((programName) => ({
    id: createEntityId('PROGRAM', programName),
    name: programName,
    role: programName === normalizeName(rootProgram)
      ? 'ROOT'
      : sourcePrograms.has(programName) || ownerPrograms.has(programName) ? 'SCANNED' : 'CALLED',
  }));
}

function buildProcedureReferenceEntities(procedureCalls) {
  const map = new Map();
  let sequence = 1;

  for (const call of procedureCalls || []) {
    if (call.resolution === 'INTERNAL' || call.resolution === 'EXTERNAL') {
      continue;
    }

    const evidence = call.evidence && call.evidence[0] ? call.evidence[0] : {};
    const key = [
      call.ownerProgram,
      call.ownerName,
      call.name,
      call.resolution,
      evidence.file || '',
      evidence.line || evidence.startLine || sequence,
    ].join('|');

    if (!map.has(key)) {
      map.set(key, {
        id: createEntityId('PROCEDURE_REF', `${call.ownerProgram}:${call.ownerName}:${String(sequence).padStart(4, '0')}`),
        name: call.name,
        resolution: call.resolution,
        targetKind: call.targetKind,
        ownerProgram: call.ownerProgram,
        ownerName: call.ownerName,
        evidenceCount: call.evidenceCount || (call.evidence || []).length,
        evidence: call.evidence || [],
      });
      sequence += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function findProcedureEntity(procedures, ownerProgram, name, expectedKind = null) {
  return (procedures || []).find((entry) => entry.ownerProgram === ownerProgram
    && entry.name === normalizeName(name)
    && (!expectedKind || entry.kind === normalizeName(expectedKind)));
}

function findPrototypeEntity(prototypes, ownerProgram, name) {
  return (prototypes || []).find((entry) => entry.ownerProgram === ownerProgram && entry.name === normalizeName(name))
    || (prototypes || []).find((entry) => entry.name === normalizeName(name));
}

function resolveCallSourceEntityId(call, procedures) {
  if (call.ownerKind === 'PROGRAM') {
    return createEntityId('PROGRAM', call.ownerProgram);
  }
  const local = findProcedureEntity(procedures, call.ownerProgram, call.ownerName, call.ownerKind);
  return local ? local.id : createEntityId('PROGRAM', call.ownerProgram);
}

function resolveCallTargetEntityId(call, procedures, prototypes, procedureReferences) {
  if (call.resolution === 'INTERNAL') {
    const local = findProcedureEntity(procedures, call.targetProgram || call.ownerProgram, call.name, call.targetKind);
    return local ? local.id : null;
  }
  if (call.resolution === 'EXTERNAL') {
    const prototype = findPrototypeEntity(prototypes, call.targetProgram || call.ownerProgram, call.name);
    return prototype ? prototype.id : null;
  }
  const reference = (procedureReferences || []).find((entry) => {
    const evidence = entry.evidence && entry.evidence[0] ? entry.evidence[0] : {};
    const callEvidence = call.evidence && call.evidence[0] ? call.evidence[0] : {};
    return entry.ownerProgram === call.ownerProgram
      && entry.ownerName === call.ownerName
      && entry.name === call.name
      && entry.resolution === call.resolution
      && String(evidence.file || '') === String(callEvidence.file || '')
      && Number(evidence.line || evidence.startLine || 0) === Number(callEvidence.line || callEvidence.startLine || 0);
  });
  return reference ? reference.id : null;
}

function findPrototypeForModule(moduleEntity, symbolName, prototypes) {
  const normalizedSymbol = normalizeName(symbolName);
  return (prototypes || []).find((entry) => entry.ownerProgram === moduleEntity.ownerProgram
    && entry.sourceFile === moduleEntity.sourceFile
    && entry.name === normalizedSymbol)
    || (prototypes || []).find((entry) => entry.ownerProgram === moduleEntity.ownerProgram && entry.name === normalizedSymbol)
    || (prototypes || []).find((entry) => entry.name === normalizedSymbol);
}

function findExportedProcedure(symbolName, procedures) {
  const normalizedSymbol = normalizeName(symbolName);
  return (procedures || []).find((entry) => entry.name === normalizedSymbol && entry.exported);
}

function buildRelations(
  rootProgram,
  sourceFiles,
  tables,
  programCalls,
  copyMembers,
  sqlStatements,
  procedures,
  prototypes,
  procedureReferences,
  procedureCalls,
  nativeFiles,
  nativeFileAccesses,
  nativeFileUsage,
  modules,
  servicePrograms,
  bindingDirectories,
) {
  const relations = [];
  const rootProgramId = createEntityId('PROGRAM', rootProgram);

  for (const sourceFile of sourceFiles || []) {
    relations.push({
      id: createRelationId('HAS_SOURCE', rootProgramId, sourceFile.id),
      type: 'HAS_SOURCE',
      from: rootProgramId,
      to: sourceFile.id,
      evidence: [],
    });
  }

  for (const table of tables || []) {
    relations.push({
      id: createRelationId('USES_TABLE', rootProgramId, createEntityId('TABLE', table.name)),
      type: 'USES_TABLE',
      from: rootProgramId,
      to: createEntityId('TABLE', table.name),
      evidence: table.evidence || [],
    });
  }

  for (const nativeFile of nativeFiles || []) {
    const usageEntry = nativeFileUsage && Array.isArray(nativeFileUsage.files)
      ? nativeFileUsage.files.find((entry) => entry.name === nativeFile.name)
      : null;
    relations.push({
      id: createRelationId('USES_NATIVE_FILE', rootProgramId, nativeFile.id),
      type: 'USES_NATIVE_FILE',
      from: rootProgramId,
      to: nativeFile.id,
      evidence: nativeFile.evidence || [],
      attributes: {
        fileKind: nativeFile.kind || 'FILE',
        keyed: Boolean(nativeFile.keyed),
        declaredAccess: nativeFile.declaredAccess || [],
        mutating: Boolean(usageEntry && usageEntry.access && usageEntry.access.mutating),
        interactive: Boolean(usageEntry && usageEntry.access && usageEntry.access.interactive),
      },
    });
  }

  for (const call of programCalls || []) {
    relations.push({
      id: createRelationId('CALLS_PROGRAM', rootProgramId, createEntityId('PROGRAM', call.name)),
      type: 'CALLS_PROGRAM',
      from: rootProgramId,
      to: createEntityId('PROGRAM', call.name),
      evidence: call.evidence || [],
      attributes: {
        callKind: call.kind || 'PROGRAM',
      },
    });
  }

  for (const copyMember of copyMembers || []) {
    relations.push({
      id: createRelationId('INCLUDES_COPY', rootProgramId, createEntityId('COPY_MEMBER', copyMember.name)),
      type: 'INCLUDES_COPY',
      from: rootProgramId,
      to: createEntityId('COPY_MEMBER', copyMember.name),
      evidence: copyMember.evidence || [],
    });
  }

  for (const procedure of procedures || []) {
    relations.push({
      id: createRelationId('OWNS_PROCEDURE', createEntityId('PROGRAM', procedure.ownerProgram), procedure.id),
      type: 'OWNS_PROCEDURE',
      from: createEntityId('PROGRAM', procedure.ownerProgram),
      to: procedure.id,
      evidence: procedure.evidence || [],
      attributes: {
        procedureKind: procedure.kind,
      },
    });
  }

  for (const prototype of prototypes || []) {
    relations.push({
      id: createRelationId('DECLARES_PROTOTYPE', createEntityId('PROGRAM', prototype.ownerProgram), prototype.id),
      type: 'DECLARES_PROTOTYPE',
      from: createEntityId('PROGRAM', prototype.ownerProgram),
      to: prototype.id,
      evidence: prototype.evidence || [],
      attributes: {
        imported: Boolean(prototype.imported),
        externalName: prototype.externalName,
      },
    });
  }

  for (const moduleEntity of modules || []) {
    relations.push({
      id: createRelationId('HAS_MODULE', createEntityId('PROGRAM', moduleEntity.ownerProgram), moduleEntity.id),
      type: 'HAS_MODULE',
      from: createEntityId('PROGRAM', moduleEntity.ownerProgram),
      to: moduleEntity.id,
      evidence: moduleEntity.evidence || [],
      attributes: {
        moduleKind: moduleEntity.kind || 'PROGRAM_MODULE',
        sourceFile: moduleEntity.sourceFile || '',
      },
    });

    for (const bindingDirectory of moduleEntity.bindingDirectories || []) {
      relations.push({
        id: createRelationId('USES_BINDING_DIRECTORY', moduleEntity.id, createEntityId('BINDING_DIRECTORY', bindingDirectory)),
        type: 'USES_BINDING_DIRECTORY',
        from: moduleEntity.id,
        to: createEntityId('BINDING_DIRECTORY', bindingDirectory),
        evidence: moduleEntity.evidence || [],
      });
    }

    for (const serviceProgramName of moduleEntity.servicePrograms || []) {
      relations.push({
        id: createRelationId('BINDS_SERVICE_PROGRAM', moduleEntity.id, createEntityId('SERVICE_PROGRAM', serviceProgramName)),
        type: 'BINDS_SERVICE_PROGRAM',
        from: moduleEntity.id,
        to: createEntityId('SERVICE_PROGRAM', serviceProgramName),
        evidence: moduleEntity.evidence || [],
      });
    }

    for (const importedProcedure of moduleEntity.importedProcedures || []) {
      const prototype = findPrototypeForModule(moduleEntity, importedProcedure, prototypes);
      if (!prototype) continue;
      relations.push({
        id: createRelationId('IMPORTS_PROCEDURE', moduleEntity.id, prototype.id),
        type: 'IMPORTS_PROCEDURE',
        from: moduleEntity.id,
        to: prototype.id,
        evidence: prototype.evidence || moduleEntity.evidence || [],
        attributes: {
          importedName: importedProcedure,
        },
      });
    }
  }

  for (const serviceProgram of servicePrograms || []) {
    for (const exportedSymbol of serviceProgram.exports || []) {
      const procedure = findExportedProcedure(exportedSymbol.symbol, procedures);
      if (!procedure) continue;
      relations.push({
        id: createRelationId('EXPORTS_PROCEDURE', serviceProgram.id, procedure.id),
        type: 'EXPORTS_PROCEDURE',
        from: serviceProgram.id,
        to: procedure.id,
        evidence: serviceProgram.evidence || [],
        attributes: {
          symbol: exportedSymbol.symbol,
          signatureLevel: exportedSymbol.signatureLevel || 'CURRENT',
        },
      });
    }
  }

  sqlStatements.forEach((statement) => {
    const statementId = statement.id;
    relations.push({
      id: createRelationId('EXECUTES_SQL', rootProgramId, statementId),
      type: 'EXECUTES_SQL',
      from: rootProgramId,
      to: statementId,
      evidence: statement.evidence || [],
      attributes: {
        sqlType: statement.type,
        intent: statement.intent || 'OTHER',
        readsData: Boolean(statement.readsData),
        writesData: Boolean(statement.writesData),
        dynamic: Boolean(statement.dynamic),
        unresolved: Boolean(statement.unresolved),
        hostVariables: statement.hostVariables || [],
        cursorNames: (statement.cursors || []).map((cursor) => cursor.name),
        uncertainty: statement.uncertainty || [],
      },
    });

    for (const tableName of statement.tables || []) {
      relations.push({
        id: createRelationId('SQL_REFERENCES_TABLE', statementId, createEntityId('TABLE', tableName)),
        type: 'SQL_REFERENCES_TABLE',
        from: statementId,
        to: createEntityId('TABLE', tableName),
        evidence: statement.evidence || [],
      });
    }
  });

  for (const call of procedureCalls || []) {
    const from = resolveCallSourceEntityId(call, procedures);
    const to = resolveCallTargetEntityId(call, procedures, prototypes, procedureReferences);
    if (!from || !to) {
      continue;
    }
    const firstEvidence = call.evidence && call.evidence[0] ? call.evidence[0] : {};
    const callSiteMarker = Number(firstEvidence.line || firstEvidence.startLine || 0);
    relations.push({
      id: `${createRelationId('CALLS_PROCEDURE', from, to)}:${callSiteMarker}`,
      type: 'CALLS_PROCEDURE',
      from,
      to,
      evidence: call.evidence || [],
      attributes: {
        resolution: call.resolution,
        targetKind: call.targetKind,
        targetName: call.name,
      },
    });
  }

  for (const access of nativeFileAccesses || []) {
    const from = resolveCallSourceEntityId(access, procedures);
    const to = createEntityId('NATIVE_FILE', access.fileName);
    if (!from || !to) {
      continue;
    }
    const firstEvidence = access.evidence && access.evidence[0] ? access.evidence[0] : {};
    const accessSiteMarker = Number(firstEvidence.line || firstEvidence.startLine || 0);
    relations.push({
      id: `${createRelationId('ACCESSES_NATIVE_FILE', from, to)}:${accessSiteMarker}:${access.opcode}`,
      type: 'ACCESSES_NATIVE_FILE',
      from,
      to,
      evidence: access.evidence || [],
      attributes: {
        opcode: access.opcode,
        accessKind: access.accessKind,
        recordFormat: access.recordFormat,
        keyed: Boolean(access.keyed),
        interactive: Boolean(access.interactive),
        mutating: Boolean(access.mutating),
        fileKind: access.fileKind || 'FILE',
      },
    });
  }

  return relations.sort((a, b) => a.id.localeCompare(b.id));
}

function buildSummary(rootProgram, sourceFiles, dependencies, sqlStatements, sqlAnalysis, procedures, prototypes, procedureCalls, nativeFileUsage, bindingAnalysis) {
  const summary = {
    sourceFileCount: sourceFiles.length,
    tableCount: (dependencies.tables || []).length,
    programCallCount: (dependencies.programCalls || []).length,
    copyMemberCount: (dependencies.copyMembers || []).length,
    sqlStatementCount: sqlStatements.length,
    readSqlStatementCount: Number(sqlAnalysis && sqlAnalysis.summary && sqlAnalysis.summary.readStatementCount) || 0,
    writeSqlStatementCount: Number(sqlAnalysis && sqlAnalysis.summary && sqlAnalysis.summary.writeStatementCount) || 0,
    dynamicSqlStatementCount: Number(sqlAnalysis && sqlAnalysis.summary && sqlAnalysis.summary.dynamicStatementCount) || 0,
    unresolvedSqlStatementCount: Number(sqlAnalysis && sqlAnalysis.summary && sqlAnalysis.summary.unresolvedStatementCount) || 0,
    procedureCount: (procedures || []).length,
    prototypeCount: (prototypes || []).length,
    procedureCallCount: (procedureCalls || []).length,
    internalProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'INTERNAL').length,
    externalProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'EXTERNAL').length,
    dynamicProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'DYNAMIC').length,
    unresolvedProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'UNRESOLVED').length,
    nativeFileCount: Number(nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.fileCount) || 0,
    mutatingNativeFileCount: Number(nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.mutatingFileCount) || 0,
    interactiveNativeFileCount: Number(nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.interactiveFileCount) || 0,
    recordFormatCount: Number(nativeFileUsage && nativeFileUsage.summary && nativeFileUsage.summary.recordFormatCount) || 0,
    moduleCount: Number(bindingAnalysis && bindingAnalysis.summary && bindingAnalysis.summary.moduleCount) || 0,
    serviceProgramCount: Number(bindingAnalysis && bindingAnalysis.summary && bindingAnalysis.summary.serviceProgramCount) || 0,
    bindingDirectoryCount: Number(bindingAnalysis && bindingAnalysis.summary && bindingAnalysis.summary.bindingDirectoryCount) || 0,
    unresolvedBindingCount: Number(bindingAnalysis && bindingAnalysis.summary && bindingAnalysis.summary.unresolvedModuleCount) || 0,
  };
  summary.text = `Program ${normalizeName(rootProgram)} references ${summary.tableCount} tables, calls ${summary.programCallCount} programs, includes ${summary.copyMemberCount} copy members, contains ${summary.sqlStatementCount} SQL statements (${summary.readSqlStatementCount} read, ${summary.writeSqlStatementCount} write, ${summary.dynamicSqlStatementCount} dynamic), exposes ${summary.procedureCount} procedures with ${summary.procedureCallCount} procedure call sites, uses ${summary.nativeFileCount} native files (${summary.mutatingNativeFileCount} mutating, ${summary.interactiveNativeFileCount} interactive), and models ${summary.moduleCount} modules, ${summary.serviceProgramCount} service programs, and ${summary.bindingDirectoryCount} binding directories (${summary.unresolvedBindingCount} unresolved bindings).`;
  return summary;
}

function defaultGraphSummary() {
  return {
    nodeCount: 0,
    edgeCount: 0,
    tableCount: 0,
    programCallCount: 0,
    copyMemberCount: 0,
    files: {
      json: 'dependency-graph.json',
      mermaid: 'dependency-graph.mmd',
      markdown: 'dependency-graph.md',
    },
  };
}

function defaultCrossProgramSummary() {
  return {
    programCount: 0,
    tableCount: 0,
    copyMemberCount: 0,
    edgeCount: 0,
    ambiguousPrograms: [],
    unresolvedPrograms: [],
    files: {
      json: 'program-call-tree.json',
      mermaid: 'program-call-tree.mmd',
      markdown: 'program-call-tree.md',
    },
  };
}

function buildCanonicalAnalysisModel({
  program,
  sourceRoot,
  sourceFiles,
  dependencies,
  notes,
  importManifest,
  generatedAt,
}) {
  const normalizedProgram = normalizeName(program);
  const normalizedSourceRoot = path.resolve(process.cwd(), sourceRoot || '.');
  const normalizedSourceFiles = normalizeSourceFiles(sourceFiles || [], normalizedSourceRoot, importManifest);

  const tables = dedupeByName(dependencies && dependencies.tables, normalizedSourceRoot, 'TABLE').map((table) => ({
    ...table,
    kind: table.kind || 'TABLE',
    id: createEntityId('TABLE', table.name),
  }));
  const programCalls = normalizeProgramCalls(dependencies && dependencies.calls, normalizedSourceRoot);
  const copyMembers = dedupeByName(dependencies && dependencies.copyMembers, normalizedSourceRoot).map((copyMember) => ({
    ...copyMember,
    kind: 'COPY_MEMBER',
    id: createEntityId('COPY_MEMBER', copyMember.name),
  }));
  const sqlStatements = buildSqlEntities(sortSqlStatements(dependencies && dependencies.sqlStatements, normalizedSourceRoot));
  const procedures = normalizeProcedures(dependencies && dependencies.procedures, normalizedSourceRoot);
  const prototypes = normalizePrototypes(dependencies && dependencies.prototypes, normalizedSourceRoot);
  const procedureCalls = normalizeProcedureCalls(dependencies && dependencies.procedureCalls, normalizedSourceRoot);
  const nativeFiles = normalizeNativeFiles(dependencies && dependencies.nativeFiles, normalizedSourceRoot);
  const nativeFileAccesses = normalizeNativeFileAccesses(dependencies && dependencies.nativeFileAccesses, normalizedSourceRoot);
  const modules = normalizeModules(dependencies && dependencies.modules, normalizedSourceRoot);
  const bindingDirectories = normalizeBindingDirectories(dependencies && dependencies.bindingDirectories, normalizedSourceRoot);
  const servicePrograms = normalizeServicePrograms(dependencies && dependencies.servicePrograms, normalizedSourceRoot);
  const nativeFileUsage = summarizeNativeFileUsage(nativeFiles, nativeFileAccesses);
  const sqlAnalysis = summarizeSqlStatements(sqlStatements);
  const bindingAnalysis = summarizeBindingAnalysis(modules, servicePrograms, bindingDirectories, procedures);
  const mergedTables = mergeSqlTablesIntoDependencies(tables, sqlAnalysis.tableNames)
    .map((table) => ({
      ...table,
      id: createEntityId('TABLE', table.name),
    }));
  const procedureReferences = buildProcedureReferenceEntities(procedureCalls);
  const importManifestSummary = summarizeImportManifest(importManifest);

  const dependencyBlock = {
    tables: mergedTables,
    programCalls,
    copyMembers,
    bindingAnalysis,
  };
  const sqlBlock = {
    summary: sqlAnalysis.summary,
    statements: sqlStatements,
    tableNames: sqlAnalysis.tableNames,
    hostVariables: sqlAnalysis.hostVariables,
    cursors: sqlAnalysis.cursors,
  };

  const model = {
    schemaVersion: CANONICAL_ANALYSIS_SCHEMA_VERSION,
    kind: 'canonical-analysis',
    generatedAt: generatedAt || new Date().toISOString(),
    rootProgram: normalizedProgram,
    sourceRoot: normalizedSourceRoot,
    provenance: {
      importManifest: importManifestSummary ? {
        file: importManifestSummary.manifestFile,
        schemaVersion: importManifestSummary.schemaVersion,
        fetchedAt: importManifestSummary.fetchedAt,
        transportRequested: importManifestSummary.transportRequested,
        transportUsed: importManifestSummary.transportUsed,
        streamFileCcsid: importManifestSummary.streamFileCcsid,
        encodingPolicy: importManifestSummary.encodingPolicy,
        normalizationPolicy: importManifestSummary.normalizationPolicy,
        fileCount: importManifestSummary.fileCount,
        exportedFileCount: importManifestSummary.exportedFileCount,
        failedFileCount: importManifestSummary.failedFileCount,
        invalidFileCount: importManifestSummary.invalidFileCount,
        traceableFileCount: importManifestSummary.traceableFileCount,
      } : null,
    },
    sourceFiles: normalizedSourceFiles,
    entities: {
      programs: buildProgramEntities(normalizedProgram, normalizedSourceFiles, programCalls, procedures, prototypes),
      tables: mergedTables,
      nativeFiles,
      modules,
      servicePrograms,
      bindingDirectories,
      copyMembers,
      sqlStatements,
      procedures,
      prototypes,
      procedureReferences,
    },
    relations: buildRelations(
      normalizedProgram,
      normalizedSourceFiles,
      mergedTables,
      programCalls,
      copyMembers,
      sqlStatements,
      procedures,
      prototypes,
      procedureReferences,
      procedureCalls,
      nativeFiles,
      nativeFileAccesses,
      nativeFileUsage,
      modules,
      servicePrograms,
      bindingDirectories,
    ),
    enrichments: {
      summary: buildSummary(normalizedProgram, normalizedSourceFiles, dependencyBlock, sqlStatements, sqlAnalysis, procedures, prototypes, procedureCalls, nativeFileUsage, bindingAnalysis),
      aiContext: {
        programPurposeHint: '',
        primaryTables: dependencyBlock.tables.slice(0, 10).map((entry) => entry.name),
        primaryCalls: dependencyBlock.programCalls.slice(0, 10).map((entry) => entry.name),
        riskHints: buildRiskHints(dependencyBlock, sqlBlock, procedureCalls, nativeFileUsage),
      },
      bindingAnalysis,
      nativeFileUsage,
      graph: defaultGraphSummary(),
      crossProgramGraph: defaultCrossProgramSummary(),
      sourceCatalog: null,
      db2Metadata: null,
      testData: null,
    },
    notes: uniqueSortedStrings((notes || []).map((note) => String(note))),
  };

  assertCanonicalAnalysisModel(model);
  return model;
}

function mergeObject(baseValue, patchValue) {
  const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
  const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
  return {
    ...base,
    ...patch,
  };
}

function enrichCanonicalAnalysisModel(model, updates = {}) {
  assertCanonicalAnalysisModel(model);
  const next = {
    ...model,
    enrichments: {
      ...model.enrichments,
      ...(updates.summary ? { summary: mergeObject(model.enrichments.summary, updates.summary) } : {}),
      ...(updates.aiContext ? { aiContext: mergeObject(model.enrichments.aiContext, updates.aiContext) } : {}),
      ...(updates.bindingAnalysis ? { bindingAnalysis: mergeObject(model.enrichments.bindingAnalysis, updates.bindingAnalysis) } : {}),
      ...(updates.nativeFileUsage ? { nativeFileUsage: mergeObject(model.enrichments.nativeFileUsage, updates.nativeFileUsage) } : {}),
      ...(updates.graph ? { graph: mergeObject(model.enrichments.graph, updates.graph) } : {}),
      ...(updates.crossProgramGraph ? { crossProgramGraph: mergeObject(model.enrichments.crossProgramGraph, updates.crossProgramGraph) } : {}),
      ...(updates.sourceCatalog !== undefined ? { sourceCatalog: updates.sourceCatalog } : {}),
      ...(updates.db2Metadata !== undefined ? { db2Metadata: updates.db2Metadata } : {}),
      ...(updates.testData !== undefined ? { testData: updates.testData } : {}),
    },
    notes: updates.notes
      ? uniqueSortedStrings([...(model.notes || []), ...updates.notes.map((note) => String(note))])
      : model.notes,
  };

  assertCanonicalAnalysisModel(next);
  return next;
}

function validateCanonicalAnalysisModel(model) {
  const errors = [];
  if (!model || typeof model !== 'object') {
    errors.push('Canonical analysis model must be an object.');
    return {
      valid: false,
      errors,
    };
  }

  if (Number(model.schemaVersion) !== CANONICAL_ANALYSIS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CANONICAL_ANALYSIS_SCHEMA_VERSION}.`);
  }
  if (String(model.kind || '') !== 'canonical-analysis') {
    errors.push('kind must be "canonical-analysis".');
  }
  if (!normalizeName(model.rootProgram)) {
    errors.push('rootProgram must be a non-empty program name.');
  }
  if (!path.isAbsolute(String(model.sourceRoot || ''))) {
    errors.push('sourceRoot must be an absolute path.');
  }
  if (!Array.isArray(model.sourceFiles)) {
    errors.push('sourceFiles must be an array.');
  }
  if (!model.entities || typeof model.entities !== 'object') {
    errors.push('entities must be an object.');
  }
  if (!Array.isArray(model.relations)) {
    errors.push('relations must be an array.');
  }
  if (!model.enrichments || typeof model.enrichments !== 'object') {
    errors.push('enrichments must be an object.');
  }
  if (!Array.isArray(model.notes)) {
    errors.push('notes must be an array.');
  }

  const entityCollections = model.entities && typeof model.entities === 'object'
    ? Object.values(model.entities).filter(Array.isArray)
    : [];
  const entityIds = new Set();
  for (const collection of entityCollections) {
    for (const entity of collection) {
      if (!entity || typeof entity !== 'object') {
        errors.push('Each entity must be an object.');
        continue;
      }
      const id = String(entity.id || '');
      if (!id) {
        errors.push('Each entity must have an id.');
        continue;
      }
      if (entityIds.has(id)) {
        errors.push(`Duplicate entity id detected: ${id}`);
      }
      entityIds.add(id);
    }
  }

  const rootProgramId = createEntityId('PROGRAM', model.rootProgram);
  if (!entityIds.has(rootProgramId)) {
    errors.push(`Root program entity is missing: ${rootProgramId}`);
  }

  if (Array.isArray(model.sourceFiles)) {
    for (const sourceFile of model.sourceFiles) {
      if (!sourceFile || typeof sourceFile !== 'object') {
        errors.push('Each source file entry must be an object.');
        continue;
      }
      if (!String(sourceFile.id || '').startsWith('FILE:')) {
        errors.push('Each source file id must start with FILE:.');
      }
      if (!String(sourceFile.path || '').trim()) {
        errors.push('Each source file must have a path.');
      }
    }
  }

  if (Array.isArray(model.relations)) {
    for (const relation of model.relations) {
      if (!relation || typeof relation !== 'object') {
        errors.push('Each relation must be an object.');
        continue;
      }
      if (!String(relation.id || '').trim()) {
        errors.push('Each relation must have an id.');
      }
      if (!String(relation.type || '').trim()) {
        errors.push('Each relation must have a type.');
      }
      if (!entityIds.has(String(relation.from || ''))) {
        errors.push(`Relation source does not reference a known entity: ${relation.from}`);
      }
      if (!entityIds.has(String(relation.to || '')) && !String(relation.to || '').startsWith('FILE:')) {
        errors.push(`Relation target does not reference a known entity: ${relation.to}`);
      }
      for (const evidence of relation.evidence || []) {
        if (evidence.file && String(evidence.file).includes('\\')) {
          errors.push(`Evidence file paths must use forward slashes: ${evidence.file}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function assertCanonicalAnalysisModel(model) {
  const validation = validateCanonicalAnalysisModel(model);
  if (!validation.valid) {
    throw new Error(`Invalid canonical analysis model: ${validation.errors.join(' ')}`);
  }
  return model;
}

module.exports = {
  CANONICAL_ANALYSIS_SCHEMA_VERSION,
  assertCanonicalAnalysisModel,
  buildCanonicalAnalysisModel,
  defaultCrossProgramSummary,
  defaultBindingAnalysis,
  defaultGraphSummary,
  defaultNativeFileUsage,
  defaultSqlAnalysis,
  enrichCanonicalAnalysisModel,
  summarizeSqlStatements,
  validateCanonicalAnalysisModel,
};
