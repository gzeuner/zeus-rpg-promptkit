/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

'use strict';

const { normalizeName, uniqueSortedStrings } = require('../context/canonicalAnalysisModel');

function makeNodeId(type, ...parts) {
  const normalized = parts
    .map(p => normalizeName(p))
    .filter(Boolean)
    .join(':');
  return `${String(type || 'NODE').toUpperCase()}:${normalized || 'UNKNOWN'}`;
}

function makeEdgeId(type, fromId, toId) {
  return `${String(type || 'EDGE').toUpperCase()}:${normalizeName(fromId)}->${normalizeName(toId)}`;
}

function normalizeLocation(ev) {
  if (!ev || typeof ev !== 'object') return null;
  return {
    file: ev.file || ev.path || null,
    startLine: Number(ev.startLine || ev.line || 0) || null,
    endLine: Number(ev.endLine || ev.line || 0) || null,
  };
}

function collectLocations(evidence) {
  const locs = [];
  for (const e of evidence || []) {
    const loc = normalizeLocation(e);
    if (loc && (loc.file || loc.startLine)) locs.push(loc);
  }
  // deterministic sort
  return locs.sort((a, b) => {
    const fa = String(a.file || '');
    const fb = String(b.file || '');
    if (fa !== fb) return fa.localeCompare(fb);
    return (a.startLine || 0) - (b.startLine || 0);
  });
}

function normalizeEvidence(evidence) {
  // keep minimal stable evidence refs
  return (evidence || [])
    .map(e => {
      if (!e) return null;
      return {
        file: e.file || e.path || null,
        line: Number(e.line || e.startLine || 0) || null,
      };
    })
    .filter(Boolean);
}

function buildEvidenceGraph(canonicalAnalysis, options = {}) {
  if (!canonicalAnalysis || typeof canonicalAnalysis !== 'object') {
    throw new Error('canonicalAnalysis is required');
  }

  const nodes = [];
  const edges = [];
  const nodeMap = new Map(); // id -> node
  const edgeSet = new Set(); // for dedupe

  const program = normalizeName(canonicalAnalysis.rootProgram || canonicalAnalysis.program);
  const sourceRoot = canonicalAnalysis.sourceRoot || '';

  function addNode(raw) {
    if (!raw || !raw.name) return;
    const type = String(raw.type || 'UNRESOLVED_SYMBOL').toUpperCase();
    const id = makeNodeId(type, raw.program || program, raw.name, raw.kind);
    if (nodeMap.has(id)) {
      // merge evidence/provenance
      const existing = nodeMap.get(id);
      const newEv = normalizeEvidence(raw.evidence || []);
      const merged = [...(existing.evidence || [])];
      for (const e of newEv) {
        const m = JSON.stringify(e);
        if (!merged.some(x => JSON.stringify(x) === m)) merged.push(e);
      }
      existing.evidence = merged;
      if (raw.confidence) existing.confidence = raw.confidence;
      return existing;
    }
    const node = {
      id,
      type,
      name: normalizeName(raw.name),
      kind: raw.kind ? normalizeName(raw.kind) : undefined,
      program: program,
      confidence: raw.confidence || 'MEDIUM',
      resolver: raw.resolver || 'canonical-analysis',
      locations: collectLocations(raw.evidence),
      evidence: normalizeEvidence(raw.evidence || []),
      uncertainty: uniqueSortedStrings(raw.uncertainty || []),
    };
    nodeMap.set(id, node);
    nodes.push(node);
    return node;
  }

  function addEdge(type, from, to, meta = {}) {
    if (!from || !to) return;
    const fromId = from.id || from;
    const toId = to.id || to;
    const eid = makeEdgeId(type, fromId, toId);
    if (edgeSet.has(eid)) return;
    edgeSet.add(eid);
    edges.push({
      id: eid,
      type: String(type).toUpperCase(),
      from: fromId,
      to: toId,
      confidence: meta.confidence || 'MEDIUM',
      resolver: meta.resolver || 'canonical-analysis',
      locations: meta.locations || [],
      evidence: normalizeEvidence(meta.evidence || []),
      uncertainty: uniqueSortedStrings(meta.uncertainty || []),
    });
  }

  // Programs from entities + relations
  for (const p of (canonicalAnalysis.entities && canonicalAnalysis.entities.programs) || []) {
    addNode({
      type: 'PROGRAM',
      name: p.name,
      evidence: p.evidence,
      confidence: p.confidence,
      uncertainty: p.uncertainty,
    });
  }

  // Relations (CALLS_PROGRAM etc map to typed edges)
  for (const rel of canonicalAnalysis.relations || []) {
    if (!rel || !rel.from || !rel.to) continue;
    const from = addNode({ type: 'PROGRAM', name: rel.from });
    let toType = 'PROGRAM';
    let etype = 'PROGRAM_CALL';
    if (rel.type === 'CALLS_PROGRAM' || rel.type === 'PROGRAM_CALL') {
      etype = 'PROGRAM_CALL';
    } else if (rel.type && rel.type.includes('PROCEDURE')) {
      etype = 'BOUND_PROCEDURE_CALL';
      toType = 'PROCEDURE';
    } else if (rel.type === 'SUBROUTINE') {
      etype = 'SUBROUTINE_CALL';
      toType = 'SUBROUTINE';
    }
    const target = addNode({ type: toType, name: rel.to, evidence: rel.evidence });
    addEdge(etype, from, target, {
      evidence: rel.evidence,
      confidence: rel.confidence || 'MEDIUM',
    });
  }

  // Procedures / subroutines from sql or other
  // Procedures often in canonical as part of programs or separate
  const procedures = (canonicalAnalysis.entities && canonicalAnalysis.entities.procedures) || [];
  for (const proc of procedures) {
    const progName = proc.program || program;
    const n = addNode({
      type: 'PROCEDURE',
      name: proc.name,
      program: progName,
      evidence: proc.evidence,
      kind: proc.kind,
    });
    if (proc.parentProgram) {
      const parent = addNode({ type: 'PROGRAM', name: proc.parentProgram });
      addEdge('BOUND_PROCEDURE_CALL', parent, n, { evidence: proc.evidence });
    }
  }

  // Subroutines
  const subroutines = (canonicalAnalysis.entities && canonicalAnalysis.entities.subroutines) || [];
  for (const sub of subroutines) {
    const n = addNode({ type: 'SUBROUTINE', name: sub.name, evidence: sub.evidence });
    if (sub.program) {
      const p = addNode({ type: 'PROGRAM', name: sub.program });
      addEdge('SUBROUTINE_CALL', p, n, { evidence: sub.evidence });
    }
  }

  // Source members, copybooks, includes from sourceFiles or imports
  for (const sf of canonicalAnalysis.sourceFiles || []) {
    if (!sf || !sf.path) continue;
    const isCopy = /copy|include|\.cpy/i.test(sf.path || '');
    const ntype = isCopy ? 'COPYBOOK' : 'SOURCE_MEMBER';
    addNode({
      type: ntype,
      name: sf.path,
      evidence: sf.evidence || [{ file: sf.path }],
    });
  }

  // Files / tables / fields from relations or sql
  const tables = (canonicalAnalysis.entities && canonicalAnalysis.entities.tables) || [];
  for (const t of tables) {
    const n = addNode({ type: 'TABLE', name: t.name, kind: t.kind, evidence: t.evidence });
    // references
  }

  const fields = (canonicalAnalysis.entities && canonicalAnalysis.entities.fields) || [];
  for (const f of fields) {
    addNode({ type: 'FIELD', name: f.name, evidence: f.evidence });
  }

  // SQL statements -> table/field refs
  for (const stmt of canonicalAnalysis.sqlStatements || []) {
    const prog = stmt.program || program;
    const pnode = addNode({ type: 'PROGRAM', name: prog });
    for (const tbl of stmt.tables || []) {
      const tnode = addNode({ type: 'TABLE', name: tbl });
      const intent = (stmt.intent || '').toUpperCase();
      const etype = intent.includes('WRITE') ? 'FILE_WRITE' : 'TABLE_REFERENCE';
      addEdge(etype, pnode, tnode, {
        evidence: stmt.evidence,
        confidence: stmt.confidence,
        locations: collectLocations(stmt.evidence),
      });
    }
    for (const hv of stmt.hostVariables || []) {
      // treat as field ref sometimes
    }
  }

  // From relations in canonical if present (cross program etc)
  for (const rel of canonicalAnalysis.relations || []) {
    if (rel && rel.type === 'CALL' && rel.from && rel.to) {
      const from = addNode({ type: 'PROGRAM', name: rel.from });
      const to = addNode({ type: 'PROGRAM', name: rel.to });
      addEdge('PROGRAM_CALL', from, to, { evidence: rel.evidence });
    }
    if (rel && (rel.type === 'FILE_READ' || rel.type === 'FILE_WRITE')) {
      const f = addNode({ type: 'PROGRAM', name: rel.from || program });
      const t = addNode({ type: 'FILE', name: rel.to || rel.file });
      addEdge(rel.type, f, t, { evidence: rel.evidence });
    }
  }

  // Unresolved / dynamic
  for (const u of canonicalAnalysis.unresolvedPrograms || []) {
    const n = addNode({ type: 'UNRESOLVED_SYMBOL', name: u, confidence: 'LOW' });
    const p = addNode({ type: 'PROGRAM', name: program });
    addEdge('DYNAMIC_UNRESOLVED_CALL', p, n, { confidence: 'LOW' });
  }

  // Tables, native files, copy members from entities (for references)
  for (const t of (canonicalAnalysis.entities && canonicalAnalysis.entities.tables) || []) {
    addNode({ type: 'TABLE', name: t.name, kind: t.kind, evidence: t.evidence });
  }
  for (const f of (canonicalAnalysis.entities && canonicalAnalysis.entities.nativeFiles) || []) {
    addNode({ type: 'FILE', name: f.name || f.file, evidence: f.evidence });
  }
  for (const c of (canonicalAnalysis.entities && canonicalAnalysis.entities.copyMembers) || []) {
    addNode({ type: 'COPYBOOK', name: c.name || c.member, evidence: c.evidence });
  }

  // SQL table refs as TABLE_REFERENCE
  for (const stmt of canonicalAnalysis.sqlStatements || []) {
    const p = addNode({ type: 'PROGRAM', name: stmt.program || program });
    for (const tbl of stmt.tables || []) {
      const t = addNode({ type: 'TABLE', name: tbl });
      const et =
        stmt.writesData || /insert|update|delete|merge/i.test(stmt.text || '')
          ? 'FILE_WRITE'
          : 'TABLE_REFERENCE';
      addEdge(et, p, t, { evidence: stmt.evidence, confidence: stmt.confidence });
    }
  }

  // Sort for determinism
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  const graph = {
    schemaVersion: 1,
    kind: 'evidence-graph',
    program,
    generatedAt: new Date(0).toISOString(), // deterministic placeholder; caller may override with repro
    generator: 'evidence-graph-builder@v1',
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      unresolvedCount: nodes.filter(n => n.type === 'UNRESOLVED_SYMBOL').length,
    },
  };

  return graph;
}

module.exports = {
  buildEvidenceGraph,
  makeNodeId,
  makeEdgeId,
};
