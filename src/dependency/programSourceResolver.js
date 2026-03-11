const path = require('path');

function normalizeProgramName(value) {
  return String(value || '').trim().toUpperCase();
}

function toMemberName(filePath) {
  const baseName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  return normalizeProgramName(baseName);
}

function toSortedUniquePaths(paths) {
  return Array.from(new Set((paths || []).filter(Boolean).map((entry) => String(entry))))
    .sort((a, b) => a.localeCompare(b));
}

function buildSourceIndex(sourceFiles) {
  const index = new Map();
  for (const filePath of toSortedUniquePaths(sourceFiles)) {
    const memberName = toMemberName(filePath);
    if (!memberName) continue;
    if (!index.has(memberName)) {
      index.set(memberName, []);
    }
    index.get(memberName).push(filePath);
  }

  for (const [programName, entries] of index.entries()) {
    entries.sort((a, b) => a.localeCompare(b));
    index.set(programName, entries);
  }

  return index;
}

function resolveProgram(programName, sourceIndex) {
  const normalized = normalizeProgramName(programName);
  if (!normalized) return null;

  const matches = (sourceIndex && sourceIndex.get(normalized)) || [];
  if (matches.length === 0) {
    return null;
  }

  const selectedPath = matches[0];
  const warning = matches.length > 1
    ? `Multiple local sources found for program ${normalized}. Selected ${selectedPath}.`
    : null;

  return {
    name: normalized,
    path: selectedPath,
    warning,
    alternatives: matches.slice(1),
  };
}

module.exports = {
  normalizeProgramName,
  buildSourceIndex,
  resolveProgram,
};
