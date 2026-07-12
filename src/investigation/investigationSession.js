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

const fs = require('fs');
const path = require('path');

const { createSchemaRegistry } = require('../core/contracts');
const { INITIAL_SCHEMAS, CONTRACT_IDS } = require('../core/contracts/schemas');

const SESSION_DIR = '.investigations';
const SESSION_FILE = 'session.json';
const INVESTIGATION_SESSION_CONTRACT = `${CONTRACT_IDS.INVESTIGATION_SESSION}@1`;
const INVESTIGATION_SESSION_VERSION = 1;

const schemaRegistry = createSchemaRegistry();
try {
  Object.entries(INITIAL_SCHEMAS).forEach(([id, def]) => {
    schemaRegistry.register({ id, version: def.version, schema: def.schema });
  });
} catch (e) {
  // ignore duplicate registration
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getSessionRoot(outputProgramDir) {
  return path.join(outputProgramDir, SESSION_DIR);
}

function buildSessionId() {
  const now = new Date();
  return `inv-${now.toISOString().replace(/[:.]/g, '').slice(0, 15)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultSession(id, outputProgramDir, goal) {
  const focus = {
    programs: [],
    tables: [],
    searchScopes: [],
  };
  return {
    schemaVersion: INVESTIGATION_SESSION_VERSION,
    contract: INVESTIGATION_SESSION_CONTRACT,
    id,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    baseAnalysisDir: outputProgramDir,
    goal: goal || '',
    // Legacy focus kept for CLI/API compat
    focus,
    // Conceptual sections per package 04
    scope: { ...focus, sourceRuns: focus.searchScopes || [] },
    evidence: [], // factual references (artifact ids, search results, etc.)
    searches: [], // performed searches/queries
    findings: [], // observations
    uncertainties: [], // unresolved items
    impact: [], // impact/risk observations
    recommendations: [], // tests/checks
    decisions: [], // human decisions/notes
    artifacts: [], // generated artifact references
    history: [], // append-only chronology
    metadata: {},
  };
}

function normalizeLegacySession(raw, outputProgramDir) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const normalized = { ...raw };

  // Add version/contract if missing (legacy pre-contract sessions)
  if (!normalized.schemaVersion) {
    normalized.schemaVersion = INVESTIGATION_SESSION_VERSION;
    normalized.contract = INVESTIGATION_SESSION_CONTRACT;
  }

  // Map old focus to scope for compatibility
  if (raw.focus && !normalized.scope) {
    normalized.scope = {
      programs: raw.focus.programs || [],
      tables: raw.focus.tables || [],
      sourceRuns: raw.focus.searchScopes || [],
    };
  }
  if (!normalized.scope) {
    normalized.scope = { programs: [], tables: [], sourceRuns: [] };
  }

  // Move history if present
  if (!Array.isArray(normalized.history)) normalized.history = [];

  // Ensure new sections exist
  [
    'evidence',
    'searches',
    'findings',
    'uncertainties',
    'impact',
    'recommendations',
    'decisions',
    'artifacts',
  ].forEach(sec => {
    if (!Array.isArray(normalized[sec])) normalized[sec] = [];
  });

  if (!normalized.metadata) normalized.metadata = {};

  // Preserve old goal/focus for CLI compat where accessed directly
  normalized.goal = raw.goal || normalized.goal || '';
  normalized.focus = raw.focus || normalized.scope; // alias for backward

  normalized.lastActiveAt = new Date().toISOString();

  return normalized;
}

/**
 * Creates or loads an investigation session.
 * Sessions are scoped to a specific program analysis output directory.
 */
function createOrLoadSession({ outputProgramDir, sessionId = null, goal = '' }) {
  if (!outputProgramDir) {
    throw new Error('outputProgramDir is required for investigation sessions');
  }

  const investigationsRoot = getSessionRoot(outputProgramDir);
  ensureDir(investigationsRoot);

  let activeSessionId = sessionId;

  if (!activeSessionId) {
    // Try to find the most recent session, or create a new one
    const entries = fs
      .readdirSync(investigationsRoot)
      .filter(name => fs.statSync(path.join(investigationsRoot, name)).isDirectory())
      .sort()
      .reverse();

    activeSessionId = entries.length > 0 ? entries[0] : buildSessionId();
  }

  const sessionDir = path.join(investigationsRoot, activeSessionId);
  ensureDir(sessionDir);

  const sessionPath = path.join(sessionDir, SESSION_FILE);

  let session;
  if (fs.existsSync(sessionPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      session = normalizeLegacySession(raw, outputProgramDir);
    } catch (_) {
      session = null;
    }
  }

  if (!session) {
    session = createDefaultSession(activeSessionId, outputProgramDir, goal);
  } else {
    session.lastActiveAt = new Date().toISOString();
  }

  // Validate against contract (package 04)
  const validation = schemaRegistry.validate(
    CONTRACT_IDS.INVESTIGATION_SESSION,
    INVESTIGATION_SESSION_VERSION,
    session
  );
  if (!validation.ok) {
    // Attach for diagnostics but do not block load for legacy compat
    session._validation = { ok: false, errors: validation.errors };
  }

  // Atomic write
  writeSessionAtomic(sessionPath, session);

  return {
    session,
    sessionDir,
    sessionPath,
  };
}

function writeSessionAtomic(sessionPath, session) {
  const tmp = sessionPath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8');
  fs.renameSync(tmp, sessionPath);
}

function recordInvestigationEvent(sessionContext, event) {
  const { session, sessionPath } = sessionContext;
  if (!Array.isArray(session.history)) session.history = [];

  session.history.push({
    at: new Date().toISOString(),
    ...event,
  });

  writeSessionAtomic(sessionPath, session);
  return session;
}

function updateFocus(sessionContext, focusUpdate) {
  const { session, sessionPath } = sessionContext;
  if (!session.scope) session.scope = { programs: [], tables: [], sourceRuns: [] };
  if (!session.focus) session.focus = session.scope;

  session.focus = { ...session.focus, ...focusUpdate };
  session.scope = { ...session.scope, ...focusUpdate };
  session.lastActiveAt = new Date().toISOString();

  writeSessionAtomic(sessionPath, session);
  return session;
}

function listSessions(outputProgramDir) {
  const root = getSessionRoot(outputProgramDir);
  if (!fs.existsSync(root)) return [];

  return fs
    .readdirSync(root)
    .filter(name => {
      const p = path.join(root, name, SESSION_FILE);
      return fs.existsSync(p);
    })
    .map(name => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(root, name, SESSION_FILE), 'utf8'));
        return {
          id: data.id,
          createdAt: data.createdAt,
          lastActiveAt: data.lastActiveAt,
          goal: data.goal || '',
          schemaVersion: data.schemaVersion || 0,
        };
      } catch {
        return { id: name, createdAt: null };
      }
    })
    .sort((a, b) => (b.lastActiveAt || '').localeCompare(a.lastActiveAt || ''));
}

/**
 * Apply a focus update to the session (e.g. narrow to certain programs/tables).
 */
function applyFocus(sessionContext, focusPatch) {
  const { session, sessionPath } = sessionContext;
  if (!session.scope) session.scope = { programs: [], tables: [], sourceRuns: [] };
  if (!session.focus) session.focus = session.scope;

  const current = session.focus;
  const next = {
    programs: Array.from(new Set([...(current.programs || []), ...(focusPatch.programs || [])])),
    tables: Array.from(new Set([...(current.tables || []), ...(focusPatch.tables || [])])),
    searchScopes: Array.from(
      new Set([...(current.searchScopes || []), ...(focusPatch.searchScopes || [])])
    ),
  };

  session.focus = next;
  session.scope = next;
  session.lastActiveAt = new Date().toISOString();

  writeSessionAtomic(sessionPath, session);

  recordInvestigationEvent(sessionContext, {
    type: 'focus-applied',
    focus: next,
  });

  return session;
}

/**
 * Record a search action within the session.
 */
function recordSearch(sessionContext, searchResult) {
  recordInvestigationEvent(sessionContext, {
    type: 'search',
    terms: searchResult.terms || [],
    matchCount: searchResult.summary ? searchResult.summary.matchCount : 0,
    resultSummary: searchResult.summary,
  });
  return sessionContext.session;
}

/**
 * Get the current focused context summary.
 */
function getFocusedContext(session) {
  if (!session) {
    return { programs: [], tables: [], searchScopes: [] };
  }
  const f = session.focus || session.scope || {};
  return {
    programs: f.programs || [],
    tables: f.tables || [],
    searchScopes: f.searchScopes || f.sourceRuns || [],
  };
}

module.exports = {
  createOrLoadSession,
  recordInvestigationEvent,
  updateFocus,
  applyFocus,
  recordSearch,
  getFocusedContext,
  listSessions,
  getSessionRoot,
};
