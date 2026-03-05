const fs = require('fs');
const path = require('path');

function normalizeExtensions(extensions) {
  return extensions.map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
}

function collectSourceFiles(sourceRoot, extensions) {
  const normalized = normalizeExtensions(extensions || []);
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (normalized.length === 0 || normalized.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(sourceRoot);
  return files.sort();
}

module.exports = {
  collectSourceFiles,
};