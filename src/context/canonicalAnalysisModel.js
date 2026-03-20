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

function sortSqlStatements(statements, sourceRoot) {
  const normalized = (statements || []).map((statement) => {
    const evidence = normalizeEvidenceList(statement.evidence || [], sourceRoot);
    return {
      type: normalizeName(statement.type || 'OTHER') || 'OTHER',
      text: String(statement.text || '').trim(),
      tables: uniqueSortedStrings((statement.tables || []).map((name) => normalizeName(name)).filter(Boolean)),
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

function buildRiskHints(dependencies, sql, procedureCalls) {
  const hints = [];
  if ((sql.statements || []).length > 0) {
    hints.push('Embedded SQL detected');
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
  return hints;
}

function createManifestIndex(importManifest) {
  const map = new Map();
  if (!importManifest || !Array.isArray(importManifest.files)) {
    return map;
  }

  for (const entry of importManifest.files) {
    const localPath = String(entry && entry.localPath ? entry.localPath : '').trim().replace(/\\/g, '/');
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

      return {
        id: `FILE:${relPath}`,
        path: relPath || absolutePath,
        sizeBytes: Number(entry && entry.sizeBytes ? entry.sizeBytes : 0),
        lines: Number(entry && entry.lines ? entry.lines : 0),
        provenance: {
          origin: manifestEntry ? 'imported' : 'local',
          import: manifestEntry ? {
            sourceLib: normalizeName(manifestEntry.sourceLib),
            sourceFile: normalizeName(manifestEntry.sourceFile),
            member: normalizeName(manifestEntry.member),
            remotePath: manifestEntry.remotePath || '',
            sha256: manifestEntry.sha256 || null,
            transportUsed: importManifest && importManifest.transportUsed ? String(importManifest.transportUsed) : null,
            fetchedAt: importManifest && importManifest.fetchedAt ? importManifest.fetchedAt : null,
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

function buildRelations(rootProgram, sourceFiles, tables, programCalls, copyMembers, sqlStatements, procedures, prototypes, procedureReferences, procedureCalls) {
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

  return relations.sort((a, b) => a.id.localeCompare(b.id));
}

function buildSummary(rootProgram, sourceFiles, dependencies, sqlStatements, procedures, prototypes, procedureCalls) {
  const summary = {
    sourceFileCount: sourceFiles.length,
    tableCount: (dependencies.tables || []).length,
    programCallCount: (dependencies.programCalls || []).length,
    copyMemberCount: (dependencies.copyMembers || []).length,
    sqlStatementCount: sqlStatements.length,
    procedureCount: (procedures || []).length,
    prototypeCount: (prototypes || []).length,
    procedureCallCount: (procedureCalls || []).length,
    internalProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'INTERNAL').length,
    externalProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'EXTERNAL').length,
    dynamicProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'DYNAMIC').length,
    unresolvedProcedureCallCount: (procedureCalls || []).filter((entry) => entry.resolution === 'UNRESOLVED').length,
  };
  summary.text = `Program ${normalizeName(rootProgram)} references ${summary.tableCount} tables, calls ${summary.programCallCount} programs, includes ${summary.copyMemberCount} copy members, contains ${summary.sqlStatementCount} SQL statements, and exposes ${summary.procedureCount} procedures with ${summary.procedureCallCount} procedure call sites.`;
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
  const sqlTableNames = uniqueSortedStrings(sqlStatements.flatMap((statement) => statement.tables || []).map((name) => normalizeName(name)));
  const mergedTables = mergeSqlTablesIntoDependencies(tables, sqlTableNames)
    .map((table) => ({
      ...table,
      id: createEntityId('TABLE', table.name),
    }));
  const procedureReferences = buildProcedureReferenceEntities(procedureCalls);

  const dependencyBlock = {
    tables: mergedTables,
    programCalls,
    copyMembers,
  };
  const sqlBlock = {
    statements: sqlStatements,
    tableNames: sqlTableNames,
  };

  const model = {
    schemaVersion: CANONICAL_ANALYSIS_SCHEMA_VERSION,
    kind: 'canonical-analysis',
    generatedAt: generatedAt || new Date().toISOString(),
    rootProgram: normalizedProgram,
    sourceRoot: normalizedSourceRoot,
    provenance: {
      importManifest: importManifest ? {
        file: 'zeus-import-manifest.json',
        schemaVersion: Number(importManifest.schemaVersion) || null,
        fetchedAt: importManifest.fetchedAt || null,
        transportUsed: importManifest.transportUsed || null,
        fileCount: importManifest.summary && Number.isFinite(Number(importManifest.summary.fileCount))
          ? Number(importManifest.summary.fileCount)
          : Array.isArray(importManifest.files) ? importManifest.files.length : 0,
      } : null,
    },
    sourceFiles: normalizedSourceFiles,
    entities: {
      programs: buildProgramEntities(normalizedProgram, normalizedSourceFiles, programCalls, procedures, prototypes),
      tables: mergedTables,
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
    ),
    enrichments: {
      summary: buildSummary(normalizedProgram, normalizedSourceFiles, dependencyBlock, sqlStatements, procedures, prototypes, procedureCalls),
      aiContext: {
        programPurposeHint: '',
        primaryTables: dependencyBlock.tables.slice(0, 10).map((entry) => entry.name),
        primaryCalls: dependencyBlock.programCalls.slice(0, 10).map((entry) => entry.name),
        riskHints: buildRiskHints(dependencyBlock, sqlBlock, procedureCalls),
      },
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
  defaultGraphSummary,
  enrichCanonicalAnalysisModel,
  validateCanonicalAnalysisModel,
};
