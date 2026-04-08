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

function loadSnippet(sourceRoot, evidence, maxSnippetLines = 6) {
  if (!evidence || !evidence.file) return '';
  const resolved = path.resolve(sourceRoot || process.cwd(), evidence.file);
  if (!fs.existsSync(resolved)) return '';

  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split(/\r?\n/);
  const startLine = Math.max(1, Number(evidence.startLine || evidence.line || 1));
  const evidenceEndLine = Math.max(startLine, Number(evidence.endLine || evidence.line || startLine));
  const endLine = Math.min(evidenceEndLine, startLine + maxSnippetLines - 1);
  return lines.slice(startLine - 1, endLine).join('\n').trim();
}

function createEvidenceIndex(sourceRoot, canonicalAnalysis) {
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
        snippet: loadSnippet(sourceRoot, evidence),
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

function stringifySqlStatement(statement) {
  const flags = [];
  if (statement.intent && statement.intent !== 'OTHER') flags.push(statement.intent);
  if (statement.dynamic) flags.push('DYNAMIC');
  if (statement.unresolved) flags.push('UNRESOLVED');
  const tables = asArray(statement.tables).length > 0 ? ` tables: ${statement.tables.join(', ')}` : '';
  return `[${statement.type}${flags.length ? `/${flags.join('/')}` : ''}] ${statement.text}${tables}`;
}

function buildWorkflow(name, context, projection, selectedSqlStatements, evidenceHighlights) {
  return {
    name,
    summary: context && context.summary ? context.summary.text : '',
    tables: projection.entities.tables,
    programCalls: projection.entities.programCalls,
    copyMembers: projection.entities.copyMembers,
    sqlStatements: selectedSqlStatements,
    riskMarkers: projection.riskMarkers,
    uncertaintyMarkers: projection.uncertaintyMarkers,
    evidenceHighlights,
    dependencyGraphSummary: {
      nodeCount: Number(context && context.graph && context.graph.nodeCount) || 0,
      edgeCount: Number(context && context.graph && context.graph.edgeCount) || 0,
    },
    testData: context && context.testData ? context.testData : { status: 'skipped' },
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

function buildAiKnowledgeProjection({ canonicalAnalysis, context, optimizedContext = null }) {
  if (!canonicalAnalysis || canonicalAnalysis.kind !== 'canonical-analysis') {
    throw new Error('AI knowledge projection requires canonical analysis input.');
  }

  const evidenceIndex = createEvidenceIndex(canonicalAnalysis.sourceRoot, canonicalAnalysis);
  const sqlStatements = projectSqlStatements(canonicalAnalysis, evidenceIndex);
  const selectedSqlStatements = asArray(optimizedContext && optimizedContext.sqlStatements).length > 0
    ? asArray(optimizedContext.sqlStatements).map((entry) => ({
      type: entry.type,
      intent: entry.intent || 'OTHER',
      tables: asArray(entry.tables),
      dynamic: Boolean(entry.dynamic),
      unresolved: Boolean(entry.unresolved),
      text: entry.snippet || '',
    }))
    : sqlStatements.slice(0, 10).map((entry) => ({
      type: entry.type,
      intent: entry.intent,
      tables: entry.tables,
      dynamic: entry.dynamic,
      unresolved: entry.unresolved,
      text: entry.text,
    }));

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
      programCalls: projectProgramCalls(context),
      copyMembers: projectCopyMembers(context),
      sqlStatements,
      nativeFiles: projectNativeFiles(context, canonicalAnalysis, evidenceIndex),
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
  projection.workflows.documentation = buildWorkflow('documentation', context, projection, selectedSqlStatements, evidenceHighlights);
  projection.workflows.errorAnalysis = buildWorkflow('error-analysis', context, projection, selectedSqlStatements, evidenceHighlights);

  return projection;
}

module.exports = {
  AI_KNOWLEDGE_PROJECTION_SCHEMA_VERSION,
  buildAiKnowledgeProjection,
};
