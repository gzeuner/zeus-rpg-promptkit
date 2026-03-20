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

function buildRiskHints(dependencies, sql) {
  const hints = [];
  if ((sql.statements || []).length > 0) {
    hints.push('Embedded SQL detected');
  }
  if ((dependencies.programCalls || []).some((call) => call.kind === 'DYNAMIC' || call.name === '<DYNAMIC>')) {
    hints.push('Dynamic call detected');
  }
  if ((dependencies.programCalls || []).length > 0) {
    hints.push('External program calls detected');
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

function createEntityId(type, name) {
  return `${String(type || '').trim().toUpperCase()}:${String(name || '').trim()}`;
}

function createRelationId(type, from, to) {
  return `${String(type || '').trim().toUpperCase()}:${String(from || '')}->${String(to || '')}`;
}

function buildProgramEntities(rootProgram, programCalls) {
  const entities = [{
    id: createEntityId('PROGRAM', rootProgram),
    name: normalizeName(rootProgram),
    role: 'ROOT',
  }];

  for (const call of programCalls || []) {
    if (normalizeName(call.name) === normalizeName(rootProgram)) continue;
    entities.push({
      id: createEntityId('PROGRAM', call.name),
      name: normalizeName(call.name),
      role: 'CALLED',
      kind: call.kind || 'PROGRAM',
      evidenceCount: Number(call.evidenceCount) || 0,
    });
  }

  return entities.sort((a, b) => a.name.localeCompare(b.name));
}

function buildRelations(rootProgram, sourceFiles, tables, programCalls, copyMembers, sqlStatements) {
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

  sqlStatements.forEach((statement, index) => {
    const statementId = statement.id || createEntityId('SQL', String(index + 1).padStart(4, '0'));
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

  return relations.sort((a, b) => a.id.localeCompare(b.id));
}

function buildSummary(rootProgram, sourceFiles, dependencies, sqlStatements) {
  const summary = {
    sourceFileCount: sourceFiles.length,
    tableCount: (dependencies.tables || []).length,
    programCallCount: (dependencies.programCalls || []).length,
    copyMemberCount: (dependencies.copyMembers || []).length,
    sqlStatementCount: sqlStatements.length,
  };
  summary.text = `Program ${normalizeName(rootProgram)} references ${summary.tableCount} tables, calls ${summary.programCallCount} programs, includes ${summary.copyMemberCount} copy members, and contains ${summary.sqlStatementCount} SQL statements.`;
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
  const programCalls = dedupeByName(dependencies && dependencies.calls, normalizedSourceRoot, 'PROGRAM').map((call) => ({
    ...call,
    kind: call.kind || 'PROGRAM',
    id: createEntityId('PROGRAM', call.name),
  }));
  const copyMembers = dedupeByName(dependencies && dependencies.copyMembers, normalizedSourceRoot).map((copyMember) => ({
    ...copyMember,
    kind: 'COPY_MEMBER',
    id: createEntityId('COPY_MEMBER', copyMember.name),
  }));
  const sqlStatements = sortSqlStatements(dependencies && dependencies.sqlStatements, normalizedSourceRoot)
    .map((statement, index) => ({
      ...statement,
      id: createEntityId('SQL', String(index + 1).padStart(4, '0')),
    }));
  const sqlTableNames = uniqueSortedStrings(sqlStatements.flatMap((statement) => statement.tables || []).map((name) => normalizeName(name)));
  const mergedTables = mergeSqlTablesIntoDependencies(tables, sqlTableNames)
    .map((table) => ({
      ...table,
      id: createEntityId('TABLE', table.name),
    }));

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
      programs: buildProgramEntities(normalizedProgram, programCalls),
      tables: mergedTables,
      copyMembers,
      sqlStatements,
    },
    relations: buildRelations(normalizedProgram, normalizedSourceFiles, mergedTables, programCalls, copyMembers, sqlStatements),
    enrichments: {
      summary: buildSummary(normalizedProgram, normalizedSourceFiles, dependencyBlock, sqlStatements),
      aiContext: {
        programPurposeHint: '',
        primaryTables: dependencyBlock.tables.slice(0, 10).map((entry) => entry.name),
        primaryCalls: dependencyBlock.programCalls.slice(0, 10).map((entry) => entry.name),
        riskHints: buildRiskHints(dependencyBlock, sqlBlock),
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
