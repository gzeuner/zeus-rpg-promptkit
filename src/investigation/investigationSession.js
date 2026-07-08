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

const SESSION_DIR = '.investigations';
const SESSION_FILE = 'session.json';

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
    const entries = fs.readdirSync(investigationsRoot)
      .filter((name) => fs.statSync(path.join(investigationsRoot, name)).isDirectory())
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
      session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch (_) {
      session = null;
    }
  }

  if (!session) {
    session = {
      id: activeSessionId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      baseAnalysisDir: outputProgramDir,
      goal: goal || '',
      focus: {
        programs: [],
        tables: [],
        searchScopes: [],
      },
      history: [],
      metadata: {},
    };
  } else {
    session.lastActiveAt = new Date().toISOString();
  }

  // Persist
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');

  return {
    session,
    sessionDir,
    sessionPath,
  };
}

function recordInvestigationEvent(sessionContext, event) {
  const { session, sessionPath } = sessionContext;
  if (!session.history) session.history = [];

  session.history.push({
    at: new Date().toISOString(),
    ...event,
  });

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  return session;
}

function updateFocus(sessionContext, focusUpdate) {
  const { session, sessionPath } = sessionContext;
  session.focus = {
    ...session.focus,
    ...focusUpdate,
  };
  session.lastActiveAt = new Date().toISOString();

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  return session;
}

function listSessions(outputProgramDir) {
  const root = getSessionRoot(outputProgramDir);
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root)
    .filter((name) => {
      const p = path.join(root, name, SESSION_FILE);
      return fs.existsSync(p);
    })
    .map((name) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(root, name, SESSION_FILE), 'utf8'));
        return {
          id: data.id,
          createdAt: data.createdAt,
          lastActiveAt: data.lastActiveAt,
          goal: data.goal || '',
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
  const { session } = sessionContext;
  if (!session.focus) session.focus = { programs: [], tables: [], searchScopes: [] };

  const current = session.focus;
  const next = {
    programs: Array.from(new Set([...(current.programs || []), ...(focusPatch.programs || [])])),
    tables: Array.from(new Set([...(current.tables || []), ...(focusPatch.tables || [])])),
    searchScopes: Array.from(new Set([...(current.searchScopes || []), ...(focusPatch.searchScopes || [])])),
  };

  session.focus = next;
  session.lastActiveAt = new Date().toISOString();

  fs.writeFileSync(sessionContext.sessionPath, JSON.stringify(session, null, 2), 'utf8');

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
  if (!session || !session.focus) {
    return { programs: [], tables: [], searchScopes: [] };
  }
  return { ...session.focus };
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
