'use strict';

const { normalizeRelativePath } = require('./pathSafety');
const { FILE_ACTIONS } = require('./constants');

/**
 * Deterministically extract only explicitly declared proposedFiles.
 * Markdown fences, free-text paths, and undeclared side channels are ignored.
 */
function extractDeclaredFiles(candidate) {
  const files = Array.isArray(candidate && candidate.proposedFiles) ? candidate.proposedFiles : [];
  const extracted = [];
  for (const file of files) {
    if (!file || typeof file !== 'object') continue;
    const path = normalizeRelativePath(file.path);
    if (!path) continue;
    const action = FILE_ACTIONS.includes(String(file.action || 'modify'))
      ? String(file.action || 'modify')
      : 'modify';
    extracted.push({
      path,
      action,
      language: file.language == null ? null : String(file.language),
      content: action === 'delete' ? null : file.content == null ? null : String(file.content),
      rationale: file.rationale == null ? null : String(file.rationale),
    });
  }
  extracted.sort((a, b) => a.path.localeCompare(b.path) || a.action.localeCompare(b.action));
  return extracted;
}

module.exports = {
  extractDeclaredFiles,
};
