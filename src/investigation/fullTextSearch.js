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

const FULL_TEXT_SEARCH_SCHEMA_VERSION = 1;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function normalizeTerms(value) {
  return Array.from(new Set(asArray(value)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeIgnorePatterns(value) {
  return Array.from(new Set(asArray(value)
    .map((entry) => normalizePath(entry).toLowerCase())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function shouldIgnore(relativePath, ignorePatterns) {
  const normalized = normalizePath(relativePath).toLowerCase();
  return ignorePatterns.some((pattern) => normalized.includes(pattern));
}

function buildSearchResult(term, relativePath, metadata, line, context) {
  const sourceInfo = metadata || {};
  return {
    term,
    sourcePath: normalizePath(relativePath),
    sourceCategory: sourceInfo.provenance && sourceInfo.provenance.origin === 'imported' ? 'IMPORTED' : 'LOCAL',
    sourceType: sourceInfo.sourceType || '',
    line: Number(line) || 1,
    context: String(context || '').trim(),
  };
}

function searchLinesForTerm(term, relativePath, metadata, content) {
  const lowerTerm = String(term || '').toLowerCase();
  const lines = String(content || '').split('\n');
  const matches = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.toLowerCase().includes(lowerTerm)) {
      continue;
    }
    matches.push(buildSearchResult(term, relativePath, metadata, index + 1, line));
  }

  return matches;
}

function summarizeMatches(matches) {
  const byCategory = {};
  for (const match of matches) {
    byCategory[match.sourceCategory] = Number(byCategory[match.sourceCategory] || 0) + 1;
  }
  return Object.keys(byCategory)
    .sort((a, b) => a.localeCompare(b))
    .reduce((result, key) => {
      result[key] = byCategory[key];
      return result;
    }, {});
}

function runFullTextSearch(sourceTextByRelativePath, sourceFileMetadata, options = {}) {
  const terms = normalizeTerms(options.terms);
  const ignorePatterns = normalizeIgnorePatterns(options.ignorePatterns);
  const maxResults = Number.isInteger(options.maxResults) && options.maxResults > 0
    ? options.maxResults
    : 200;

  if (terms.length === 0) {
    return {
      schemaVersion: FULL_TEXT_SEARCH_SCHEMA_VERSION,
      kind: 'full-text-search-results',
      enabled: false,
      terms: [],
      ignorePatterns,
      summary: {
        termCount: 0,
        scannedFileCount: 0,
        ignoredFileCount: 0,
        matchCount: 0,
        truncated: false,
        categoryCounts: {},
      },
      matches: [],
      notes: [],
    };
  }

  const entries = sourceTextByRelativePath instanceof Map
    ? Array.from(sourceTextByRelativePath.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  const metadataByPath = sourceFileMetadata instanceof Map ? sourceFileMetadata : new Map();
  const matches = [];
  let ignoredFileCount = 0;
  let truncated = false;

  for (const [relativePath, content] of entries) {
    if (shouldIgnore(relativePath, ignorePatterns)) {
      ignoredFileCount += 1;
      continue;
    }
    const metadata = metadataByPath.get(relativePath) || null;
    for (const term of terms) {
      matches.push(...searchLinesForTerm(term, relativePath, metadata, content));
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  const sortedMatches = matches
    .slice(0, maxResults)
    .sort((a, b) => {
      if (a.term !== b.term) return a.term.localeCompare(b.term);
      if (a.sourceCategory !== b.sourceCategory) return a.sourceCategory.localeCompare(b.sourceCategory);
      if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
      return a.line - b.line;
    });

  return {
    schemaVersion: FULL_TEXT_SEARCH_SCHEMA_VERSION,
    kind: 'full-text-search-results',
    enabled: true,
    terms,
    ignorePatterns,
    summary: {
      termCount: terms.length,
      scannedFileCount: entries.length - ignoredFileCount,
      ignoredFileCount,
      matchCount: sortedMatches.length,
      truncated,
      categoryCounts: summarizeMatches(sortedMatches),
    },
    matches: sortedMatches,
    notes: truncated ? [`Search results were truncated at ${maxResults} matches.`] : [],
  };
}

function renderFullTextSearchMarkdown(results) {
  const lines = [
    '# Full-Text Search Results',
    '',
  ];

  if (!results || !results.enabled) {
    lines.push('No search terms were configured for this run.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Terms: ${results.terms.join(', ')}`);
  lines.push(`Matches: ${results.summary.matchCount}`);
  lines.push(`Scanned Files: ${results.summary.scannedFileCount}`);
  lines.push(`Ignored Files: ${results.summary.ignoredFileCount}`);
  lines.push(`Truncated: ${results.summary.truncated ? 'yes' : 'no'}`);
  lines.push('');

  if (results.ignorePatterns.length > 0) {
    lines.push('## Ignore Rules');
    for (const pattern of results.ignorePatterns) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  }

  if (results.matches.length === 0) {
    lines.push('No matches were found.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  let currentTerm = null;
  for (const match of results.matches) {
    if (match.term !== currentTerm) {
      currentTerm = match.term;
      lines.push(`## Term: ${currentTerm}`);
    }
    lines.push(`- [${match.sourceCategory}] ${match.sourcePath}:${match.line} ${match.context}`);
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  FULL_TEXT_SEARCH_SCHEMA_VERSION,
  renderFullTextSearchMarkdown,
  runFullTextSearch,
};
