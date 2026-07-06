const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const IMPORT_SPECIFIER_PATTERNS = [
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function listJavaScriptFiles(rootDir) {
  const collected = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
        collected.push(fullPath);
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }

  return collected;
}

function readInternalRuntimeConfigModuleNames(repoRoot) {
  const configDir = path.join(repoRoot, 'src', 'config');
  if (!fs.existsSync(configDir)) {
    return [];
  }

  return fs.readdirSync(configDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^runtimeConfig.+\.js$/i.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase() !== 'runtimeconfig.js')
    .map((name) => name.slice(0, -3))
    .sort((a, b) => a.localeCompare(b));
}

function collectImportSpecifiers(sourceText) {
  const imports = [];

  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(sourceText);
    while (match) {
      const specifier = String(match[1] || '').trim();
      const uptoMatch = sourceText.slice(0, match.index);
      const line = uptoMatch.split('\n').length;
      imports.push({ line, specifier });
      match = pattern.exec(sourceText);
    }
  }

  return imports;
}

function collectForbiddenRuntimeConfigImports(relativePath, sourceText, internalModuleNames) {
  const violations = [];
  const internalModuleNameSet = new Set(internalModuleNames.map((name) => name.toLowerCase()));
  if (internalModuleNameSet.size === 0) {
    return violations;
  }

  for (const imported of collectImportSpecifiers(sourceText)) {
    const moduleName = path.basename(imported.specifier).replace(/\.js$/i, '');
    if (!internalModuleNameSet.has(moduleName.toLowerCase())) {
      continue;
    }
    violations.push({
      relativePath,
      line: imported.line,
      specifier: imported.specifier,
    });
  }

  return violations;
}

test('runtime-config facade exports remain stable', () => {
  const runtimeConfigFacade = require('../src/config/runtimeConfig');
  const exportedKeys = Object.keys(runtimeConfigFacade).sort();

  assert.deepEqual(exportedKeys, [
    'ALLOWED_FETCH_TRANSPORTS',
    'ALLOWED_WORKFLOW_STEPS',
    'ALLOWED_WORK_COPY_EXTENSIONS',
    'DEFAULT_ANALYSIS_LIMITS',
    'DEFAULT_EXTENSIONS',
    'DEFAULT_TOKEN_BUDGET',
    'DEFAULT_WORKFLOW_ANALYZE_MODES',
    'DEFAULT_WORKFLOW_STEPS',
    'DEFAULT_WORK_COPY',
    'describeProfilesLocation',
    'getProfilesMetadata',
    'loadProfiles',
    'normalizeTokenBudgetKey',
    'readTokenBudgetConfig',
    'readWorkCopyConfig',
    'readWorkflowConfig',
    'resolveAnalyzeConfig',
    'resolveAnalyzeDbConfig',
    'resolveBundleConfig',
    'resolveFetchConfig',
    'resolveProfile',
    'resolveProfileResources',
    'resolveProfilesConfigPaths',
    'resolveWorkflowPresetConfig',
    'validateProfiles',
  ]);
});

test('runtime-config boundary: no direct imports of internal runtime-config modules outside src/config', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const rootsToScan = ['src', 'cli', 'tests'];
  const violations = [];
  const internalModuleNames = readInternalRuntimeConfigModuleNames(repoRoot);
  assert.ok(
    internalModuleNames.length > 0,
    'Expected at least one internal runtime-config module under src/config for boundary protection.',
  );

  for (const root of rootsToScan) {
    const absoluteRoot = path.join(repoRoot, root);
    const files = listJavaScriptFiles(absoluteRoot);
    for (const filePath of files) {
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
      if (relativePath.startsWith('src/config/')) {
        continue;
      }

      const sourceText = fs.readFileSync(filePath, 'utf8');
      violations.push(...collectForbiddenRuntimeConfigImports(relativePath, sourceText, internalModuleNames));
    }
  }

  const formattedViolations = violations
    .map((entry) => `${entry.relativePath}:${entry.line} imports "${entry.specifier}"`)
    .join('\n');
  assert.equal(
    violations.length,
    0,
    `Found forbidden direct imports of internal runtime-config modules:\n${formattedViolations}`,
  );
});

test('runtime-config layering: internal runtime-config modules must not import runtimeConfig facade', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const configDir = path.join(repoRoot, 'src', 'config');
  const violations = [];
  const files = listJavaScriptFiles(configDir)
    .filter((filePath) => /^runtimeConfig.+\.js$/i.test(path.basename(filePath)))
    .filter((filePath) => path.basename(filePath).toLowerCase() !== 'runtimeconfig.js');

  for (const filePath of files) {
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const importedSpecifiers = collectImportSpecifiers(sourceText);
    for (const imported of importedSpecifiers) {
      const moduleName = path.basename(imported.specifier).replace(/\.js$/i, '').toLowerCase();
      if (moduleName !== 'runtimeconfig') {
        continue;
      }
      violations.push({
        relativePath,
        line: imported.line,
        specifier: imported.specifier,
      });
    }
  }

  const formattedViolations = violations
    .map((entry) => `${entry.relativePath}:${entry.line} imports "${entry.specifier}"`)
    .join('\n');
  assert.equal(
    violations.length,
    0,
    `Found layering violations: internal runtime-config modules must not import runtimeConfig facade:\n${formattedViolations}`,
  );
});
