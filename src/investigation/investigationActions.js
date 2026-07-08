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

const {
  createOrLoadSession,
  applyFocus,
  recordSearch,
  getFocusedContext,
} = require('./investigationSession');

const { runFullTextSearch } = require('./fullTextSearch');

/**
 * Load base artifacts from an analysis dir.
 */
function loadBaseArtifacts(analysisDir) {
  const canonicalPath = path.join(analysisDir, 'canonical-analysis.json');
  let canonical = null;
  if (fs.existsSync(canonicalPath)) {
    try { canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8')); } catch (_) {}
  }

  const contextPath = path.join(analysisDir, 'context.json');
  let context = null;
  if (fs.existsSync(contextPath)) {
    try { context = JSON.parse(fs.readFileSync(contextPath, 'utf8')); } catch (_) {}
  }

  const searchPath = path.join(analysisDir, 'search-results.json');
  let searchResults = null;
  if (fs.existsSync(searchPath)) {
    try { searchResults = JSON.parse(fs.readFileSync(searchPath, 'utf8')); } catch (_) {}
  }

  return { canonical, context, searchResults };
}

/**
 * Focus the investigation on specific areas.
 */
function focus({ analysisDir, sessionId = null, goal = '', focus: focusPatch = {} }) {
  const { session, sessionDir, sessionPath } = createOrLoadSession({ outputProgramDir: analysisDir, sessionId, goal });

  const updated = applyFocus({ session, sessionPath }, focusPatch);

  return {
    session: updated,
    sessionDir,
    message: `Focus updated. Current focus: programs=${updated.focus.programs.length}, tables=${updated.focus.tables.length}`,
  };
}

/**
 * Perform a scoped full-text search within the current focus.
 */
function search({ analysisDir, sessionId = null, terms = [], goal = '' }) {
  const { session, sessionDir, sessionPath } = createOrLoadSession({ outputProgramDir: analysisDir, sessionId, goal });

  const focus = getFocusedContext(session);
  const base = loadBaseArtifacts(analysisDir);

  const effectiveTerms = Array.isArray(terms) && terms.length > 0 ? terms : (focus.searchScopes || []);

  if (effectiveTerms.length === 0) {
    return {
      session,
      results: null,
      message: 'No search terms provided and no searchScopes in focus.',
    };
  }

  // If we have source text in context or normalized, use it. Fallback to searchResults if present.
  let sourceTextByRelativePath = {};
  if (base.context && base.context.sourceFiles) {
    // Simplified: in real use we'd have the normalizedSourceTextByRelativePath
    // For now, we can re-use or simulate from existing search if available.
  }

  let results;
  if (base.searchResults && base.searchResults.kind === 'full-text-search-results') {
    // Better: filter existing search results by the effective terms if possible
    const existingMatches = (base.searchResults.matches || []).filter(m =>
      effectiveTerms.some(t => (m.term || '').toLowerCase().includes(t.toLowerCase()) || (m.line || '').toLowerCase().includes(t.toLowerCase()))
    );
    results = {
      ...base.searchResults,
      terms: effectiveTerms,
      matches: existingMatches.slice(0, 100),
      summary: {
        ... (base.searchResults.summary || {}),
        matchCount: existingMatches.length,
        filtered: true
      }
    };
  } else {
    results = runFullTextSearch(sourceTextByRelativePath, {}, {
      terms: effectiveTerms,
      maxResults: 100,
    });
  }

  recordSearch({ session, sessionPath }, results);

  return {
    session,
    sessionDir,
    results,
    focus,
    message: `Search completed for terms: ${effectiveTerms.join(', ')}`,
  };
}

/**
 * Generate a focused prompt based on current session state + artifacts.
 */
function generateFocusedPrompt({ analysisDir, sessionId = null, goal = '' }) {
  const { session } = createOrLoadSession({ outputProgramDir: analysisDir, sessionId, goal });
  const focus = getFocusedContext(session);
  const base = loadBaseArtifacts(analysisDir);

  const promptParts = [
    `Investigation Goal: ${session.goal || goal || 'Explore focused areas of the program.'}`,
    `Focused Programs: ${focus.programs.join(', ') || 'all'}`,
    `Focused Tables: ${focus.tables.join(', ') || 'all'}`,
  ];

  if (base.context && base.context.summary) {
    promptParts.push(`Base Summary: ${base.context.summary.text || ''}`);
  }

  const prompt = promptParts.join('\n\n');

  return {
    session,
    prompt,
    focus,
  };
}

module.exports = {
  focus,
  search,
  generateFocusedPrompt,
  loadBaseArtifacts,
};
