'use strict';

const crypto = require('node:crypto');
const { buildEvidenceGraph } = require('../../analyze/evidenceGraphBuilder');
const CONTRACT_IDS = require('../contractIds');
const {
  DERIVATION_CLASSES,
  PROCESS_STATUSES,
  REASON_CODES,
  DIAGNOSTIC_SEVERITIES,
} = require('../constants');

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function sortById(items) {
  return [...items].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
}

function confidence(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['high', 'medium', 'low', 'unknown'].includes(normalized) ? normalized : 'unknown';
}

function normalizeLocation(location) {
  if (!location || typeof location !== 'object') return null;
  const file = String(location.file || location.path || '')
    .trim()
    .replace(/\\/g, '/');
  const line = Number(location.line || location.startLine || 0) || 0;
  const endLine = Number(location.endLine || line) || line;
  if (!file && !line) return null;
  return { file: file || null, line: line || null, endLine: endLine || null };
}

function createEvidenceReference({ locations = [], fallbackId, evidenceCatalog }) {
  const normalizedLocations = locations
    .map(normalizeLocation)
    .filter(Boolean)
    .sort((a, b) => {
      if (String(a.file || '') !== String(b.file || '')) {
        return String(a.file || '').localeCompare(String(b.file || ''));
      }
      return Number(a.line || 0) - Number(b.line || 0);
    });
  if (normalizedLocations.length === 0) {
    const id = `derived-reference:${sha256({ fallbackId }).slice(0, 16)}`;
    evidenceCatalog.set(id, { id, kind: 'derived-reference', source: fallbackId });
    return { id, kind: 'derived-reference' };
  }
  return normalizedLocations.map(location => {
    const id = `source-location:${sha256(location).slice(0, 16)}`;
    evidenceCatalog.set(id, { id, kind: 'source-location', location });
    return { id, kind: 'source-location', contractId: CONTRACT_IDS.SOURCE_SPAN };
  });
}

function evidenceReferences(items, fallbackId, evidenceCatalog) {
  const locations = (items || []).flatMap(item => [
    ...((item && item.locations) || []),
    ...((item && item.evidence) || []),
  ]);
  const references = createEvidenceReference({ locations, fallbackId, evidenceCatalog });
  return Array.isArray(references) ? references : [references];
}

function nodeIndex(graph) {
  return new Map((graph.nodes || []).map(node => [node.id, node]));
}

function programNodes(graph) {
  return (graph.nodes || []).filter(node => String(node.type).toUpperCase() === 'PROGRAM');
}

function programComponents(graph) {
  const programs = sortById(programNodes(graph));
  const programIds = new Set(programs.map(node => node.id));
  const adjacency = new Map(programs.map(node => [node.id, new Set()]));
  for (const edge of graph.edges || []) {
    if (String(edge.type).toUpperCase() !== 'PROGRAM_CALL') continue;
    if (!programIds.has(edge.from) || !programIds.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
  }

  const components = [];
  const seen = new Set();
  for (const program of programs) {
    if (seen.has(program.id)) continue;
    const queue = [program.id];
    const ids = [];
    seen.add(program.id);
    while (queue.length > 0) {
      const current = queue.shift();
      ids.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(ids.sort((a, b) => a.localeCompare(b)));
  }
  return components;
}

function chooseEntryPoint(component, graph, options) {
  const requested = normalizeName(options.entryPoint || graph.program);
  const byName = (graph.nodes || []).find(
    node => component.includes(node.id) && normalizeName(node.name) === requested
  );
  if (byName) return byName;

  const incoming = new Set(
    (graph.edges || [])
      .filter(edge => edge.type === 'PROGRAM_CALL' && component.includes(edge.to))
      .map(edge => edge.to)
  );
  return (
    (graph.nodes || [])
      .filter(node => component.includes(node.id) && !incoming.has(node.id))
      .sort((a, b) => a.id.localeCompare(b.id))[0] ||
    (graph.nodes || []).find(node => component.includes(node.id))
  );
}

function edgeStepKind(type) {
  if (type === 'DYNAMIC_UNRESOLVED_CALL') return 'exception';
  if (type === 'FILE_READ' || type === 'TABLE_REFERENCE') return 'data';
  if (type === 'FILE_WRITE') return 'data';
  if (type === 'PROGRAM_CALL' || type === 'BOUND_PROCEDURE_CALL') return 'interface';
  return 'action';
}

function relationshipType(type) {
  if (type === 'PROGRAM_CALL' || type === 'BOUND_PROCEDURE_CALL') return 'CALLS';
  if (type === 'FILE_READ' || type === 'TABLE_REFERENCE') return 'READS';
  if (type === 'FILE_WRITE') return 'WRITES';
  if (type === 'DYNAMIC_UNRESOLVED_CALL') return 'HAS_EXCEPTION';
  return 'USES_INTERFACE';
}

function makeProvenance(projectId, snapshotId, sourceHash) {
  return {
    projectId,
    snapshotId,
    sourceHash,
    analyzerId: 'zeus.process-discovery',
    analyzerVersion: '1.0.0',
    derivationClass: DERIVATION_CLASSES.INFERRED,
  };
}

function makeDiagnostic(projectId, snapshotId, diagnosticId, reasonCode, relatedIds) {
  return {
    schemaVersion: 1,
    kind: 'project-knowledge-diagnostic',
    contractId: CONTRACT_IDS.DIAGNOSTIC,
    projectId,
    snapshotId,
    diagnosticId,
    severity: DIAGNOSTIC_SEVERITIES.WARNING,
    reasonCode,
    message:
      reasonCode === REASON_CODES.EVIDENCE_MISSING
        ? 'A process element has no direct source location; review the derived reference.'
        : 'A technical dependency could not be resolved; the process remains incomplete.',
    relatedIds: unique(relatedIds),
  };
}

function discoverProcessCandidates(input, options = {}) {
  if (!input || typeof input !== 'object')
    throw new Error('canonical analysis or evidence graph is required');
  const graph = input.kind === 'evidence-graph' ? input : buildEvidenceGraph(input);
  const projectId = String(options.projectId || input.projectId || 'project-unknown');
  const snapshotId = String(options.snapshotId || input.snapshotId || 'snapshot-unknown');
  const sourceHash = /^[a-f0-9]{64}$/.test(String(options.sourceHash || input.sourceHash || ''))
    ? String(options.sourceHash || input.sourceHash)
    : sha256(input);
  const index = nodeIndex(graph);
  const evidenceCatalog = new Map();
  const components = programComponents(graph);
  if (components.length === 0 && graph.program) {
    const root = (graph.nodes || []).find(
      node => normalizeName(node.name) === normalizeName(graph.program)
    );
    if (root) components.push([root.id]);
  }

  const candidates = components.map((component, componentIndex) => {
    const entry = chooseEntryPoint(component, graph, options);
    const componentNodes = component.map(id => index.get(id)).filter(Boolean);
    const componentEdges = (graph.edges || [])
      .filter(edge => component.includes(edge.from) || component.includes(edge.to))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const processSeed = {
      projectId,
      snapshotId,
      component: component.slice().sort(),
      entry: entry && entry.id,
    };
    const processId = `process:${sha256(processSeed).slice(0, 16)}`;
    const processVersionId = `${processId}:v1`;
    const provenance = makeProvenance(projectId, snapshotId, sourceHash);
    const processEvidence = evidenceReferences(componentNodes, processId, evidenceCatalog);
    const steps = [];
    const claims = [];
    const relationships = [];
    const unknowns = [];
    const diagnostics = [];
    const stepForRef = new Map();

    function addStep({ stepKind, title, description, technicalRefs, evidenceItems, fallbackId }) {
      const stepId = `${processVersionId}:step:${steps.length + 1}`;
      const refs = evidenceReferences(evidenceItems, fallbackId || stepId, evidenceCatalog);
      const step = {
        schemaVersion: 1,
        kind: 'project-knowledge-process-step',
        contractId: CONTRACT_IDS.PROCESS_STEP,
        projectId,
        snapshotId,
        processId,
        processVersionId,
        stepId,
        sequence: steps.length + 1,
        stepKind,
        title,
        description,
        status: PROCESS_STATUSES.CANDIDATE,
        derivationClass: DERIVATION_CLASSES.INFERRED,
        confidence: confidence((evidenceItems || [])[0] && (evidenceItems || [])[0].confidence),
        evidenceReferences: refs,
        technicalRefs: unique(technicalRefs || []).sort(),
      };
      steps.push(step);
      for (const ref of step.technicalRefs) stepForRef.set(ref, stepId);
      return step;
    }

    if (entry) {
      addStep({
        stepKind: 'trigger',
        title: `Entry point ${normalizeName(entry.name)}`,
        description:
          'Technical entry point detected from the evidence graph; business trigger is not established.',
        technicalRefs: [entry.id],
        evidenceItems: [entry],
        fallbackId: entry.id,
      });
    }
    for (const node of componentNodes.sort((a, b) => a.id.localeCompare(b.id))) {
      if (entry && node.id === entry.id) continue;
      addStep({
        stepKind: 'action',
        title: `Technical participant ${normalizeName(node.name)}`,
        description:
          'Technical participation detected; business responsibility is not established.',
        technicalRefs: [node.id],
        evidenceItems: [node],
        fallbackId: node.id,
      });
    }
    for (const edge of componentEdges) {
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (!from || !to) continue;
      const type = String(edge.type || '').toUpperCase();
      const step = addStep({
        stepKind: edgeStepKind(type),
        title: `${type.replace(/_/g, ' ')}: ${normalizeName(from.name)} -> ${normalizeName(to.name)}`,
        description:
          type === 'DYNAMIC_UNRESOLVED_CALL'
            ? 'Unresolved technical dependency; no business behavior is inferred.'
            : 'Technical relationship detected from the evidence graph.',
        technicalRefs: [from.id, to.id],
        evidenceItems: [edge],
        fallbackId: edge.id,
      });
      const processRelationId = `${processVersionId}:relationship:${relationships.length + 1}`;
      relationships.push({
        schemaVersion: 1,
        kind: 'project-knowledge-process-relationship',
        contractId: CONTRACT_IDS.PROCESS_RELATIONSHIP,
        projectId,
        snapshotId,
        processId,
        processVersionId,
        relationshipId: processRelationId,
        relationshipType: relationshipType(type),
        fromId: stepForRef.get(from.id) || step.stepId,
        toId: stepForRef.get(to.id) || step.stepId,
        status: PROCESS_STATUSES.CANDIDATE,
        derivationClass: DERIVATION_CLASSES.INFERRED,
        confidence: confidence(edge.confidence),
        provenance,
        evidenceReferences: evidenceReferences([edge], edge.id, evidenceCatalog),
      });
      if (type === 'DYNAMIC_UNRESOLVED_CALL' || to.type === 'UNRESOLVED_SYMBOL') {
        unknowns.push(`Unresolved dependency ${normalizeName(to.name)}`);
        diagnostics.push(
          makeDiagnostic(
            projectId,
            snapshotId,
            `${processId}:unresolved:${diagnostics.length + 1}`,
            REASON_CODES.CAPABILITY_UNAVAILABLE,
            [edge.id, to.id]
          )
        );
      }
    }
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1];
      const current = steps[i];
      relationships.push({
        schemaVersion: 1,
        kind: 'project-knowledge-process-relationship',
        contractId: CONTRACT_IDS.PROCESS_RELATIONSHIP,
        projectId,
        snapshotId,
        processId,
        processVersionId,
        relationshipId: `${processVersionId}:relationship:${relationships.length + 1}`,
        relationshipType: 'PRECEDES',
        fromId: previous.stepId,
        toId: current.stepId,
        status: PROCESS_STATUSES.CANDIDATE,
        derivationClass: DERIVATION_CLASSES.INFERRED,
        confidence: 'medium',
        provenance,
        evidenceReferences: previous.evidenceReferences,
      });
    }
    for (const step of steps) {
      claims.push({
        schemaVersion: 1,
        kind: 'project-knowledge-process-claim',
        contractId: CONTRACT_IDS.PROCESS_CLAIM,
        projectId,
        snapshotId,
        processId,
        processVersionId,
        claimId: `${step.stepId}:claim`,
        claimType: 'technical-observation',
        text: `${step.title} is supported as a technical observation by the referenced evidence.`,
        status: PROCESS_STATUSES.CANDIDATE,
        derivationClass: DERIVATION_CLASSES.INFERRED,
        confidence: step.confidence,
        provenance,
        evidenceReferences: step.evidenceReferences,
        supportingRefs: step.technicalRefs,
      });
    }
    if (processEvidence.some(ref => ref.kind === 'derived-reference')) {
      unknowns.push('At least one process element has no direct source location.');
      diagnostics.push(
        makeDiagnostic(
          projectId,
          snapshotId,
          `${processId}:evidence-missing`,
          REASON_CODES.EVIDENCE_MISSING,
          [processId]
        )
      );
    }
    const claimIds = claims.map(claim => claim.claimId);
    const relationshipIds = relationships.map(relationship => relationship.relationshipId);
    const interfaces = componentEdges
      .filter(edge =>
        ['PROGRAM_CALL', 'BOUND_PROCEDURE_CALL'].includes(String(edge.type).toUpperCase())
      )
      .map(edge => ({
        id: edge.id,
        kind: 'technical-interface',
        name: String(edge.type).toUpperCase(),
        evidenceReferences: evidenceReferences([edge], edge.id, evidenceCatalog),
      }));
    const dataObjects = componentEdges
      .filter(edge =>
        ['FILE_READ', 'FILE_WRITE', 'TABLE_REFERENCE'].includes(String(edge.type).toUpperCase())
      )
      .map(edge => ({
        id: edge.to,
        kind: 'technical-data-object',
        name: normalizeName(index.get(edge.to)?.name),
        evidenceReferences: evidenceReferences([edge], edge.id, evidenceCatalog),
      }));
    const exceptions = componentEdges
      .filter(edge => String(edge.type).toUpperCase() === 'DYNAMIC_UNRESOLVED_CALL')
      .map(edge => ({
        id: edge.to,
        kind: 'unresolved-dependency',
        name: normalizeName(index.get(edge.to)?.name),
        evidenceReferences: evidenceReferences([edge], edge.id, evidenceCatalog),
      }));
    const version = {
      schemaVersion: 1,
      kind: 'project-knowledge-process-version',
      contractId: CONTRACT_IDS.PROCESS_VERSION,
      projectId,
      snapshotId,
      processId,
      processVersionId,
      title: `Technical flow ${normalizeName(entry && entry.name) || String(componentIndex + 1)}`,
      status: PROCESS_STATUSES.CANDIDATE,
      confidence: unknowns.length > 0 ? 'low' : 'medium',
      provenance,
      evidenceReferences: processEvidence,
      stepIds: steps.map(step => step.stepId),
      claimIds,
      relationshipIds,
      systems: [
        {
          id: `${processId}:system`,
          kind: 'technical-system',
          name: 'Detected application',
          evidenceReferences: processEvidence,
        },
      ],
      interfaces,
      dataObjects,
      exceptions,
      decisions: [],
      actors: [],
      uncertainty: ['Business goal, roles, and rules require explicit domain review.'],
      openQuestions: ['Which business outcome does this technical flow support?'],
    };
    const process = {
      schemaVersion: 1,
      kind: 'project-knowledge-business-process',
      contractId: CONTRACT_IDS.BUSINESS_PROCESS,
      projectId,
      snapshotId,
      processId,
      processVersionId,
      name: version.title,
      status: PROCESS_STATUSES.CANDIDATE,
      confidence: version.confidence,
      provenance,
      evidenceReferences: processEvidence,
      entryPoints: entry
        ? [
            {
              id: entry.id,
              kind: 'program',
              name: entry.name,
              evidenceReferences: evidenceReferences([entry], entry.id, evidenceCatalog),
            },
          ]
        : [],
      claimIds,
      relationshipIds,
      unknowns: unique(unknowns).sort(),
    };
    return { process, version, steps, claims, relationships, diagnostics };
  });

  const flat = candidates.flatMap(candidate => [
    candidate.process,
    candidate.version,
    ...candidate.steps,
    ...candidate.claims,
    ...candidate.relationships,
  ]);
  return {
    schemaVersion: 1,
    kind: 'process-candidate-catalog',
    projectId,
    snapshotId,
    sourceHash,
    analyzerId: 'zeus.process-discovery',
    analyzerVersion: '1.0.0',
    candidates,
    processes: candidates.map(candidate => candidate.process),
    versions: candidates.map(candidate => candidate.version),
    steps: candidates.flatMap(candidate => candidate.steps),
    claims: candidates.flatMap(candidate => candidate.claims),
    relationships: candidates.flatMap(candidate => candidate.relationships),
    diagnostics: candidates.flatMap(candidate => candidate.diagnostics),
    evidenceCatalog: Array.from(evidenceCatalog.values()).sort((a, b) => a.id.localeCompare(b.id)),
    summary: {
      candidateCount: candidates.length,
      processCount: flat.filter(item => item.contractId === CONTRACT_IDS.BUSINESS_PROCESS).length,
      unresolvedCount: candidates.reduce(
        (total, candidate) => total + candidate.diagnostics.length,
        0
      ),
    },
  };
}

module.exports = {
  discoverProcessCandidates,
  stableValue,
  sha256,
};
