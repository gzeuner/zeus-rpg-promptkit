import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..');
const rulesPath = path.join(__dirname, 'safety-rules.json');

if (!fs.existsSync(rulesPath)) {
  throw new Error(`Missing safety rules: ${rulesPath}`);
}

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const scanRoot = path.resolve(rootDir, String(rules.scanRoot || 'examples/demo-rpg-mini-system'));
const includeExtensions = new Set(
  (rules.includeExtensions || []).map(entry => String(entry).toLowerCase())
);
function compilePattern(entry, fallbackName) {
  const name = String(entry.name || fallbackName);
  const raw = String(entry.regex || '');
  const configuredFlags = String(entry.flags || '');
  const hasInlineCaseInsensitive = raw.startsWith('(?i)');
  const source = hasInlineCaseInsensitive ? raw.slice(4) : raw;
  const flags = `g${configuredFlags}${hasInlineCaseInsensitive ? 'i' : ''}`;
  const normalizedFlags = Array.from(new Set(flags.split(''))).join('');
  return {
    name,
    regex: new RegExp(source, normalizedFlags),
  };
}

const denyPatterns = (rules.denyPatterns || []).map(entry =>
  compilePattern(entry, 'unnamed-pattern')
);
const allowPatterns = (rules.allowPatterns || []).map(entry =>
  compilePattern(entry, 'unnamed-allow')
);

function listFiles(dirPath) {
  const collected = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...listFiles(fullPath));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (includeExtensions.size === 0 || includeExtensions.has(ext)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function isAllowedByPlaceholder(text) {
  for (const allow of allowPatterns) {
    allow.regex.lastIndex = 0;
    if (allow.regex.test(text)) {
      return true;
    }
  }
  return false;
}

if (!fs.existsSync(scanRoot)) {
  throw new Error(`Scan root does not exist: ${scanRoot}`);
}

const violations = [];
for (const filePath of listFiles(scanRoot)) {
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, lineIndex) => {
    for (const deny of denyPatterns) {
      deny.regex.lastIndex = 0;
      const matched = deny.regex.exec(line);
      if (!matched) continue;
      if (isAllowedByPlaceholder(line)) continue;
      violations.push({
        file: relativePath,
        line: lineIndex + 1,
        rule: deny.name,
        snippet: line.trim(),
      });
    }
  });
}

if (violations.length > 0) {
  console.error('Safety check failed. Violations found:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.rule}] ${violation.snippet}`);
  }
  process.exit(1);
}

console.log(`Safety check passed. Scanned ${listFiles(scanRoot).length} file(s).`);
