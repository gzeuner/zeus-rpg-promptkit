const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function listJavaScriptFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJavaScriptFiles(full));
    } else if (entry.isFile() && (full.endsWith('.js') || full.endsWith('.mjs'))) {
      results.push(full);
    }
  }
  return results;
}

function collectCoreAdapterImports(relativePath, sourceText) {
  const violations = [];
  // Forbid imports of adapter *layers* (commands, mcp server/tools, viewer, vscode), not shared helpers
  const forbidden = [
    /from ['"]\.\.\/(cli\/commands|mcp(?!\/tools)|viewer|vscode)/,
    /require\(['"]\.\.\/(cli\/commands|mcp(?!\/tools)|viewer|vscode)/,
    /from ['"]\.\.\/\.\.\/(cli\/commands|mcp(?!\/tools)|viewer|vscode)/,
    /require\(['"]\.\.\/\.\.\/(cli\/commands|mcp(?!\/tools)|viewer|vscode)/,
  ];

  const lines = sourceText.split('\n');
  lines.forEach((line, idx) => {
    for (const re of forbidden) {
      if (re.test(line)) {
        violations.push(`${relativePath}:${idx + 1}: ${line.trim()}`);
      }
    }
  });
  return violations;
}

test('architecture boundary: src/core must not import CLI/MCP/viewer/vscode adapters', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const coreDir = path.join(repoRoot, 'src', 'core');
  const files = listJavaScriptFiles(coreDir);
  const violations = [];

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    const sourceText = fs.readFileSync(filePath, 'utf8');
    violations.push(...collectCoreAdapterImports(relativePath, sourceText));
  }

  assert.deepStrictEqual(
    violations,
    [],
    'src/core must not directly import adapter layers (cli, mcp, viewer, vscode). Violations:\n' +
      violations.join('\n')
  );
});
