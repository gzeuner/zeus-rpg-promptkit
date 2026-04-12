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

const AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION = 1;

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortStrings(values) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function toRelativeEvidenceKey(evidence) {
  return [
    String(evidence.file || ''),
    Number(evidence.startLine || evidence.line || 0),
    Number(evidence.endLine || evidence.line || 0),
    String(evidence.text || evidence.rawText || '').trim(),
  ].join('|');
}

function loadSnippet(sourceRoot, evidence, maxSnippetLines = 6, sourceTextByRelativePath = null) {
  if (!evidence || !evidence.file) return '';
  const relativePath = String(evidence.file || '').replace(/\\/g, '/');
  let content = null;
  if (sourceTextByRelativePath instanceof Map && sourceTextByRelativePath.has(relativePath)) {
    content = sourceTextByRelativePath.get(relativePath);
  } else {
    const resolved = path.resolve(sourceRoot || process.cwd(), relativePath);
    if (!fs.existsSync(resolved)) return '';
    content = fs.readFileSync(resolved, 'utf8');
  }
  const lines = content.split(/\r?\n/);
  const startLine = Math.max(1, Number(evidence.startLine || evidence.line || 1));
  const evidenceEndLine = Math.max(startLine, Number(evidence.endLine || evidence.line || startLine));
  const endLine = Math.min(evidenceEndLine, startLine + maxSnippetLines - 1);
  return lines.slice(startLine - 1, endLine).join('\n').trim();
}

function createEvidenceIndex(sourceRoot, canonicalAnalysis, sourceTextByRelativePath = null) {
  const evidenceMap = new Map();
  let sequence = 1;

  function collectEvidence(evidenceList, category, label) {
    for (const evidence of asArray(evidenceList)) {
      const file = String(evidence.file || '').trim();
      if (!file) continue;
      const key = toRelativeEvidenceKey(evidence);
      if (evidenceMap.has(key)) continue;
      evidenceMap.set(key, {
        id: `EV${String(sequence).padStart(4, '0')}`,
        category,
        label: String(label || category || 'Evidence').trim(),
        file,
        startLine: Number(evidence.startLine || evidence.line || 0) || undefined,
        endLine: Number(evidence.endLine || evidence.line || evidence.startLine || 0) || undefined,
        rawText: String(evidence.text || '').trim(),
        snippet: loadSnippet(sourceRoot, evidence, 6, sourceTextByRelativePath),
      });
      sequence += 1;
    }
  }

  const entities = (canonicalAnalysis && canonicalAnalysis.entities) || {};
  const relations = (canonicalAnalysis && canonicalAnalysis.relations) || [];

  for (const table of asArray(entities.tables)) {
    collectEvidence(table.evidence, 'TABLE', table.name);
  }
  for (const sql of asArray(entities.sqlStatements)) {
    collectEvidence(sql.evidence, 'SQL', sql.type || 'SQL');
  }
  for (const nativeFile of asArray(entities.nativeFiles)) {
    collectEvidence(nativeFile.evidence, 'NATIVE_FILE', nativeFile.name);
  }
  for (const moduleEntity of asArray(entities.modules)) {
    collectEvidence(moduleEntity.evidence, 'MODULE', moduleEntity.name);
  }
  for (const serviceProgram of asArray(entities.servicePrograms)) {
    collectEvidence(serviceProgram.evidence, 'SERVICE_PROGRAM', serviceProgram.name);
  }
  for (const relation of relations) {
    collectEvidence(relation.evidence, relation.type, relation.type);
  }

  return Array.from(evidenceMap.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function evidenceRefsFor(evidenceIndex, evidenceList) {
  const indexByKey = new Map(evidenceIndex.map((entry) => [toRelativeEvidenceKey(entry), entry.id]));
  return sortStrings(asArray(evidenceList).map((evidence) => indexByKey.get(toRelativeEvidenceKey(evidence))).filter(Boolean));
}

function collectUncertaintyMarkers(canonicalAnalysis, context) {
  const markers = new Set();
  const sqlStatements = (((canonicalAnalysis || {}).entities || {}).sqlStatements) || [];
  const bindingAnalysis = (context && context.bindingAnalysis) || {};
  const procedureAnalysis = (context && context.procedureAnalysis) || {};

  for (const statement of sqlStatements) {
    for (const marker of statement.uncertainty || []) {
      markers.add(String(marker));
    }
  }

  if ((procedureAnalysis.summary && procedureAnalysis.summary.dynamicCallCount) > 0) {
    markers.add('DYNAMIC_PROCEDURE_CALL');
  }
  if ((procedureAnalysis.summary && procedureAnalysis.summary.unresolvedCallCount) > 0) {
    markers.add('UNRESOLVED_PROCEDURE_CALL');
  }
  if ((bindingAnalysis.summary && bindingAnalysis.summary.unresolvedModuleCount) > 0) {
    markers.add('UNRESOLVED_BINDING');
  }

  return Array.from(markers).sort((a, b) => a.localeCompare(b));
}

function projectSqlStatements(canonicalAnalysis, evidenceIndex) {
  return asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements)
    .map((statement) => ({
      id: statement.id,
      type: statement.type,
      intent: statement.intent || 'OTHER',
      text: statement.text,
      tables: asArray(statement.tables),
      hostVariables: asArray(statement.hostVariables),
      dynamic: Boolean(statement.dynamic),
      unresolved: Boolean(statement.unresolved),
      uncertainty: asArray(statement.uncertainty),
      evidenceRefs: evidenceRefsFor(evidenceIndex, statement.evidence),
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.text.localeCompare(b.text);
    });
}

function projectTableDependencies(context, canonicalAnalysis, evidenceIndex) {
  const tableEntities = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.tables)
    .map((entry) => [entry.name, entry]));
  return asArray(context && context.dependencies && context.dependencies.tables)
    .map((entry) => {
      const entity = tableEntities.get(entry.name);
      return {
        name: entry.name,
        kind: entry.kind || 'TABLE',
        evidenceRefs: evidenceRefsFor(evidenceIndex, entity && entity.evidence),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectProgramCalls(context) {
  return asArray(context && context.dependencies && context.dependencies.programCalls)
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'PROGRAM',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectCopyMembers(context) {
  return asArray(context && context.dependencies && context.dependencies.copyMembers)
    .map((entry) => ({
      name: entry.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectProgramCallRelations(canonicalAnalysis, evidenceIndex) {
  return asArray(canonicalAnalysis && canonicalAnalysis.relations)
    .filter((relation) => relation.type === 'CALLS_PROGRAM')
    .map((relation) => ({
      name: String(relation.to || '').replace(/^PROGRAM:/, ''),
      kind: relation.attributes && relation.attributes.callKind ? relation.attributes.callKind : 'PROGRAM',
      evidenceRefs: evidenceRefsFor(evidenceIndex, relation.evidence),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectProcedureCalls(canonicalAnalysis, evidenceIndex) {
  return asArray(canonicalAnalysis && canonicalAnalysis.relations)
    .filter((relation) => relation.type === 'CALLS_PROCEDURE')
    .map((relation) => ({
      target: relation.attributes && relation.attributes.targetName ? relation.attributes.targetName : String(relation.to || ''),
      resolution: relation.attributes && relation.attributes.resolution ? relation.attributes.resolution : 'UNKNOWN',
      targetKind: relation.attributes && relation.attributes.targetKind ? relation.attributes.targetKind : 'UNKNOWN',
      evidenceRefs: evidenceRefsFor(evidenceIndex, relation.evidence),
    }))
    .sort((a, b) => {
      if (a.resolution !== b.resolution) return a.resolution.localeCompare(b.resolution);
      return a.target.localeCompare(b.target);
    });
}

function projectCopyMemberRelations(canonicalAnalysis, evidenceIndex) {
  return asArray(canonicalAnalysis && canonicalAnalysis.relations)
    .filter((relation) => relation.type === 'INCLUDES_COPY')
    .map((relation) => ({
      name: String(relation.to || '').replace(/^COPY_MEMBER:/, ''),
      evidenceRefs: evidenceRefsFor(evidenceIndex, relation.evidence),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectNativeFiles(context, canonicalAnalysis, evidenceIndex) {
  const nativeFileEntities = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.nativeFiles)
    .map((entry) => [entry.name, entry]));
  return asArray(context && context.nativeFileUsage && context.nativeFileUsage.files)
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'FILE',
      keyed: Boolean(entry.keyed),
      mutating: Boolean(entry.access && entry.access.mutating),
      interactive: Boolean(entry.access && entry.access.interactive),
      recordFormats: asArray(entry.recordFormats).map((item) => item.name),
      evidenceRefs: evidenceRefsFor(evidenceIndex, nativeFileEntities.get(entry.name) && nativeFileEntities.get(entry.name).evidence),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function projectBinding(context, canonicalAnalysis, evidenceIndex) {
  const bindingAnalysis = (context && context.bindingAnalysis) || {};
  const moduleEntities = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.modules)
    .map((entry) => [entry.name, entry]));
  const serviceProgramEntities = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.servicePrograms)
    .map((entry) => [entry.name, entry]));
  const bindingDirectoryEntities = new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.bindingDirectories)
    .map((entry) => [entry.name, entry]));
  return {
    modules: asArray(bindingAnalysis.modules).map((entry) => ({
      name: entry.name,
      kind: entry.kind || 'MODULE',
      bindingDirectories: asArray(entry.bindingDirectories),
      servicePrograms: asArray(entry.servicePrograms),
      importedProcedures: asArray(entry.importedProcedures),
      unresolvedBindings: Boolean(entry.unresolvedBindings),
      evidenceRefs: evidenceRefsFor(evidenceIndex, moduleEntities.get(entry.name) && moduleEntities.get(entry.name).evidence),
    })),
    servicePrograms: asArray(bindingAnalysis.servicePrograms).map((entry) => ({
      name: entry.name,
      sourceKind: entry.sourceKind || 'HINT',
      exports: asArray(entry.exports).map((item) => ({
        symbol: item.symbol,
        resolved: Boolean(item.resolved),
      })),
      evidenceRefs: evidenceRefsFor(evidenceIndex, serviceProgramEntities.get(entry.name) && serviceProgramEntities.get(entry.name).evidence),
    })),
    bindingDirectories: asArray(bindingAnalysis.bindingDirectories).map((entry) => ({
      name: entry.name,
      evidenceRefs: evidenceRefsFor(evidenceIndex, bindingDirectoryEntities.get(entry.name) && bindingDirectoryEntities.get(entry.name).evidence),
    })),
  };
}

function projectDb2Tables(context, evidenceIndex) {
  return asArray(context && context.db2Metadata && context.db2Metadata.tables)
    .map((entry) => ({
      requestedName: entry.requestedName,
      schema: entry.schema,
      table: entry.table,
      matchStatus: entry.matchStatus || 'resolved',
      columnCount: Number(entry.columnCount) || 0,
      foreignKeyCount: Number(entry.foreignKeyCount) || 0,
      sourceEvidenceCount: Number(entry.sourceEvidenceCount) || 0,
      sqlReferenceCount: Number(entry.sqlReferenceCount) || 0,
      nativeFileCount: Number(entry.nativeFileCount) || 0,
      evidenceRefs: evidenceRefsFor(evidenceIndex, entry.sourceEvidence),
    }))
    .sort((a, b) => {
      if (a.table !== b.table) return a.table.localeCompare(b.table);
      return a.schema.localeCompare(b.schema);
    });
}

function projectWorkflowDb2Tables(projectionTables, workflow) {
  const workflowTableNames = new Set(asArray(workflow && workflow.tables).map((entry) => normalizeName(entry && entry.name)));
  const selected = asArray(projectionTables).filter((entry) => {
    const requested = normalizeName(entry.requestedName || entry.table);
    const exact = normalizeName(entry.table);
    return workflowTableNames.has(requested) || workflowTableNames.has(exact);
  });
  return selected.length > 0 ? selected : asArray(projectionTables).slice(0, 5);
}

function projectWorkflowTestData(context, workflowDb2Tables) {
  const testData = context && context.testData ? context.testData : { status: 'skipped' };
  const workflowTableNames = new Set(asArray(workflowDb2Tables).map((entry) => normalizeName(entry.table)));
  const tables = asArray(testData.tables)
    .filter((entry) => workflowTableNames.size === 0 || workflowTableNames.has(normalizeName(entry.table)))
    .slice(0, 5);

  return {
    ...testData,
    tables,
  };
}

function cloneEntityList(items, mapper) {
  return asArray(items).map((entry) => (mapper ? mapper(entry) : { ...entry }));
}

function buildWorkflow(name, context, projection, payload = {}) {
  return {
    name,
    summary: context && context.summary ? context.summary.text : '',
    tables: cloneEntityList(payload.tables && payload.tables.length > 0 ? payload.tables : projection.entities.tables),
    programCalls: cloneEntityList(payload.programCalls && payload.programCalls.length > 0 ? payload.programCalls : projection.entities.programCalls),
    copyMembers: cloneEntityList(payload.copyMembers && payload.copyMembers.length > 0 ? payload.copyMembers : projection.entities.copyMembers),
    sqlStatements: cloneEntityList(payload.sqlStatements),
    nativeFiles: cloneEntityList(payload.nativeFiles && payload.nativeFiles.length > 0 ? payload.nativeFiles : projection.entities.nativeFiles),
    db2Tables: cloneEntityList(payload.db2Tables && payload.db2Tables.length > 0 ? payload.db2Tables : projection.entities.db2Tables),
    riskMarkers: projection.riskMarkers,
    uncertaintyMarkers: projection.uncertaintyMarkers,
    tokenBudget: Number(payload.tokenBudget) || null,
    estimatedTokens: Number(payload.estimatedTokens) || null,
    evidencePacks: payload.evidencePacks && typeof payload.evidencePacks === 'object'
      ? {
        sql: cloneEntityList(payload.evidencePacks.sql),
        calls: cloneEntityList(payload.evidencePacks.calls),
        fileUsage: cloneEntityList(payload.evidencePacks.fileUsage),
        conditionals: cloneEntityList(payload.evidencePacks.conditionals),
        errorPaths: cloneEntityList(payload.evidencePacks.errorPaths),
      }
      : {
        sql: [],
        calls: [],
        fileUsage: [],
        conditionals: [],
        errorPaths: [],
      },
    evidenceHighlights: cloneEntityList(payload.evidenceHighlights),
    rankedEvidence: cloneEntityList(payload.rankedEvidence && payload.rankedEvidence.length > 0 ? payload.rankedEvidence : payload.evidenceHighlights),
    dependencyGraphSummary: {
      nodeCount: Number(context && context.graph && context.graph.nodeCount) || 0,
      edgeCount: Number(context && context.graph && context.graph.edgeCount) || 0,
    },
    testData: payload.testData || (context && context.testData ? context.testData : { status: 'skipped' }),
  };
}

function buildEvidenceHighlights(evidenceIndex, projection) {
  const selected = [];
  const seen = new Set();

  const priorityRefs = [
    ...projection.entities.sqlStatements.filter((entry) => entry.dynamic || entry.unresolved).flatMap((entry) => entry.evidenceRefs),
    ...projection.entities.nativeFiles.filter((entry) => entry.mutating || entry.interactive).flatMap((entry) => entry.evidenceRefs),
    ...projection.entities.binding.modules.filter((entry) => entry.unresolvedBindings).flatMap((entry) => {
      const moduleEntity = asArray(projection.entities.modules || []).find((item) => item.name === entry.name);
      return moduleEntity ? moduleEntity.evidenceRefs || [] : [];
    }),
  ];

  for (const ref of priorityRefs) {
    if (seen.has(ref)) continue;
    const evidence = evidenceIndex.find((entry) => entry.id === ref);
    if (!evidence) continue;
    seen.add(ref);
    selected.push({
      ref,
      file: evidence.file,
      startLine: evidence.startLine || null,
      endLine: evidence.endLine || null,
      snippet: evidence.snippet || '',
      label: evidence.label || evidence.category,
    });
    if (selected.length >= 8) break;
  }

  return selected;
}

function projectSqlSelection(optimizedContext, fallbackStatements) {
  if (optimizedContext && optimizedContext.workflows && optimizedContext.workflows.documentation) {
    return cloneEntityList(optimizedContext.workflows.documentation.sqlStatements).map((entry) => ({
      id: entry.id,
      type: entry.type,
      intent: entry.intent || 'OTHER',
      tables: asArray(entry.tables),
      dynamic: Boolean(entry.dynamic),
      unresolved: Boolean(entry.unresolved),
      text: entry.text || entry.snippet || '',
      evidenceRefs: asArray(entry.evidenceRefs),
      hostVariables: asArray(entry.hostVariables),
      uncertainty: asArray(entry.uncertainty),
    }));
  }

  if (asArray(optimizedContext && optimizedContext.sqlStatements).length > 0) {
    return asArray(optimizedContext.sqlStatements).map((entry) => ({
      type: entry.type,
      intent: entry.intent || 'OTHER',
      tables: asArray(entry.tables),
      dynamic: Boolean(entry.dynamic),
      unresolved: Boolean(entry.unresolved),
      text: entry.snippet || entry.text || '',
    }));
  }

  return fallbackStatements.slice(0, 10).map((entry) => ({
    type: entry.type,
    intent: entry.intent,
    tables: entry.tables,
    dynamic: entry.dynamic,
    unresolved: entry.unresolved,
    text: entry.text,
    evidenceRefs: entry.evidenceRefs,
    hostVariables: entry.hostVariables,
    uncertainty: entry.uncertainty,
  }));
}

function buildWorkflowPayload(workflowName, optimizedContext, fallbackSqlStatements, fallbackEvidenceHighlights) {
  const workflowKey = workflowName === 'error-analysis' ? 'errorAnalysis' : 'documentation';
  const optimizedWorkflow = optimizedContext && optimizedContext.workflows
    ? optimizedContext.workflows[workflowKey]
    : null;

  if (optimizedWorkflow) {
    return {
      ...optimizedWorkflow,
      sqlStatements: cloneEntityList(optimizedWorkflow.sqlStatements),
      evidenceHighlights: cloneEntityList(optimizedWorkflow.evidenceHighlights),
      rankedEvidence: cloneEntityList(optimizedWorkflow.rankedEvidence),
      tables: cloneEntityList(optimizedWorkflow.tables),
      programCalls: cloneEntityList(optimizedWorkflow.programCalls),
      copyMembers: cloneEntityList(optimizedWorkflow.copyMembers),
      nativeFiles: cloneEntityList(optimizedWorkflow.nativeFiles),
      evidencePacks: optimizedWorkflow.evidencePacks || {},
    };
  }

  return {
    sqlStatements: fallbackSqlStatements,
    evidenceHighlights: fallbackEvidenceHighlights,
    rankedEvidence: fallbackEvidenceHighlights,
    tables: [],
    programCalls: [],
    copyMembers: [],
    nativeFiles: [],
    evidencePacks: {
      sql: cloneEntityList(fallbackEvidenceHighlights.filter((entry) => entry.label && /SQL/i.test(entry.label))),
      calls: [],
      fileUsage: cloneEntityList(fallbackEvidenceHighlights.filter((entry) => entry.label && /FILE/i.test(entry.label))),
      conditionals: [],
      errorPaths: [],
    },
  };
}

function buildAiKnowledgeProjection({ canonicalAnalysis, context, optimizedContext = null, sourceTextByRelativePath = null }) {
  if (!canonicalAnalysis || canonicalAnalysis.kind !== 'canonical-analysis') {
    throw new Error('AI knowledge projection requires canonical analysis input.');
  }

  const evidenceIndex = createEvidenceIndex(canonicalAnalysis.sourceRoot, canonicalAnalysis, sourceTextByRelativePath);
  const sqlStatements = projectSqlStatements(canonicalAnalysis, evidenceIndex);
  const selectedSqlStatements = projectSqlSelection(optimizedContext, sqlStatements);

  const projection = {
    schemaVersion: AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION,
    kind: 'ai-knowledge-projection',
    generatedAt: canonicalAnalysis.generatedAt,
    program: canonicalAnalysis.rootProgram,
    sourceRoot: canonicalAnalysis.sourceRoot,
    provenance: {
      canonicalSchemaVersion: canonicalAnalysis.schemaVersion,
      canonicalKind: canonicalAnalysis.kind,
      sourceArtifacts: sortStrings([
        'canonical-analysis.json',
        'context.json',
        ...(optimizedContext ? ['optimized-context.json'] : []),
      ]),
    },
    summary: context && context.summary ? context.summary : {},
    riskMarkers: sortStrings((((canonicalAnalysis.enrichments || {}).aiContext || {}).riskHints) || []),
    uncertaintyMarkers: [],
    evidenceIndex,
    entities: {
      tables: projectTableDependencies(context, canonicalAnalysis, evidenceIndex),
      programCalls: projectProgramCallRelations(canonicalAnalysis, evidenceIndex),
      procedureCalls: projectProcedureCalls(canonicalAnalysis, evidenceIndex),
      copyMembers: projectCopyMemberRelations(canonicalAnalysis, evidenceIndex),
      sqlStatements,
      nativeFiles: projectNativeFiles(context, canonicalAnalysis, evidenceIndex),
      db2Tables: projectDb2Tables(context, evidenceIndex),
      binding: projectBinding(context, canonicalAnalysis, evidenceIndex),
      modules: asArray(canonicalAnalysis.entities && canonicalAnalysis.entities.modules).map((entry) => ({
        name: entry.name,
        evidenceRefs: evidenceRefsFor(evidenceIndex, entry.evidence),
      })),
    },
    workflows: {},
  };

  projection.uncertaintyMarkers = collectUncertaintyMarkers(canonicalAnalysis, context);
  const evidenceHighlights = buildEvidenceHighlights(evidenceIndex, projection);
  const documentationPayload = buildWorkflowPayload('documentation', optimizedContext, selectedSqlStatements, evidenceHighlights);
  documentationPayload.db2Tables = projectWorkflowDb2Tables(projection.entities.db2Tables, documentationPayload);
  documentationPayload.testData = projectWorkflowTestData(context, documentationPayload.db2Tables);
  projection.workflows.documentation = buildWorkflow(
    'documentation',
    context,
    projection,
    documentationPayload,
  );
  const errorAnalysisPayload = buildWorkflowPayload('error-analysis', optimizedContext, selectedSqlStatements, evidenceHighlights);
  errorAnalysisPayload.db2Tables = projectWorkflowDb2Tables(projection.entities.db2Tables, errorAnalysisPayload);
  errorAnalysisPayload.testData = projectWorkflowTestData(context, errorAnalysisPayload.db2Tables);
  projection.workflows.errorAnalysis = buildWorkflow(
    'error-analysis',
    context,
    projection,
    errorAnalysisPayload,
  );

  return projection;
}

module.exports = {
  AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION,
  buildAiKnowledgeProjection,
};
