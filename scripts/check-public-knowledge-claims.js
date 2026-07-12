#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const ALLOWLISTED_DOCS = new Set([
  normalizePath('docs/knowledgebase/project-neutral-knowledgebase-architecture.md'),
  normalizePath('docs/knowledgebase/README.md'),
  normalizePath('docs/safety/local-workspace-policy.md'),
]);

const DOC_BLOCKED_TERMS = [
  '.zeus/knowledge',
  'puiDddlKnowledgeBase',
  'aiKnowledgePatternLibrary',
  'knowledgeBaseService',
  'puiPatternRegistry',
  'puiPatternImport',
  'build-pui-knowledgebase',
  'build-pui-catalog',
  'promote-pui-dddl-kb',
  'DDDL knowledgebase',
  'template knowledgebase',
  'reusable DDDL templates',
  'persistent PUI pattern catalog',
  'local pattern registry',
];

const RUNTIME_BLOCKED_TERMS = [
  'zeus.knowledge',
  '.zeus/knowledge',
  'DDDL knowledgebase',
  'template knowledgebase',
  'persistent PUI pattern catalog',
  'local pattern registry',
  'buildKnowledgebase',
  'promoteKnowledge',
  'trainFromSources',
  'rawEvidenceExport',
  'local-ai-classifier',
  'train-from-projects',
  'train from sources',
  'fine-tune on project sources',
  'fine tune on project sources',
];

const ZEUS_KNOWLEDGE_PATTERN = /\bzeus\.knowledge\b/i;
const ZEUS_KNOWLEDGE_NEGATIVE_CONTEXT =
  /\b(not part|is not part|not available|disabled|removed|reset|no longer|nicht teil|ist nicht teil|nicht verfuegbar|nicht verfügbar|deaktiviert|entfernt|zurueckgesetzt|zurückgesetzt|nicht mehr)\b/i;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function listMarkdownFiles(dirPath, bucket = []) {
  if (!fs.existsSync(dirPath)) {
    return bucket;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listMarkdownFiles(fullPath, bucket);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      bucket.push(fullPath);
    }
  }
  return bucket;
}

function isPublicDoc(relativePath) {
  const normalized = normalizePath(relativePath);
  if (normalized === 'README.md') {
    return true;
  }
  if (!normalized.startsWith('docs/')) {
    return false;
  }
  if (normalized.startsWith('docs/internal/')) {
    return false;
  }
  return true;
}

function shouldSkipFile(relativePath) {
  const normalized = normalizePath(relativePath);
  return ALLOWLISTED_DOCS.has(normalized);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDocIssues(lines, filePath) {
  const issues = [];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    DOC_BLOCKED_TERMS.forEach(term => {
      const termRegex = new RegExp(escapeRegex(term), 'i');
      if (!termRegex.test(line)) {
        return;
      }
      issues.push({
        filePath,
        lineNumber,
        term,
        line,
        message: `legacy knowledge-path claim detected: "${term}"`,
      });
    });

    if (ZEUS_KNOWLEDGE_PATTERN.test(line) && !ZEUS_KNOWLEDGE_NEGATIVE_CONTEXT.test(line)) {
      issues.push({
        filePath,
        lineNumber,
        term: 'zeus.knowledge',
        line,
        message: 'zeus.knowledge appears without explicit removed/disabled context',
      });
    }
  });
  return issues;
}

function findRuntimeIssues(lines, filePath) {
  const issues = [];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    RUNTIME_BLOCKED_TERMS.forEach(term => {
      const termRegex = new RegExp(escapeRegex(term), 'i');
      if (!termRegex.test(line)) {
        return;
      }
      issues.push({
        filePath,
        lineNumber,
        term,
        message: `runtime/public surface references blocked term: "${term}"`,
      });
    });
  });
  return issues;
}

function collectDocTargets() {
  const files = [];
  const readmePath = path.resolve(ROOT, 'README.md');
  if (fs.existsSync(readmePath)) {
    files.push(readmePath);
  }

  const docsRoot = path.resolve(ROOT, 'docs');
  files.push(...listMarkdownFiles(docsRoot));

  const unique = new Set(files.map(entry => path.resolve(entry)));
  return [...unique];
}

function listFilesRecursive(rootDir, bucket = []) {
  if (!fs.existsSync(rootDir)) {
    return bucket;
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(fullPath, bucket);
      continue;
    }
    if (entry.isFile()) {
      bucket.push(fullPath);
    }
  }
  return bucket;
}

function collectRuntimeTargets() {
  const roots = [
    path.resolve(ROOT, 'src', 'mcp'),
    path.resolve(ROOT, 'src', 'api'),
    path.resolve(ROOT, 'cli'),
  ];
  const files = [];
  roots.forEach(rootDir => listFilesRecursive(rootDir, files));
  const unique = new Set(files.map(entry => path.resolve(entry)));
  return [...unique];
}

function main() {
  const docTargets = collectDocTargets();
  const runtimeTargets = collectRuntimeTargets();
  const issues = [];

  docTargets.forEach(absolutePath => {
    const relativePath = normalizePath(path.relative(ROOT, absolutePath));
    if (!isPublicDoc(relativePath)) {
      return;
    }
    if (shouldSkipFile(relativePath)) {
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    issues.push(...findDocIssues(lines, relativePath));
  });

  runtimeTargets.forEach(absolutePath => {
    const relativePath = normalizePath(path.relative(ROOT, absolutePath));
    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/);
    issues.push(...findRuntimeIssues(lines, relativePath));
  });

  if (issues.length > 0) {
    console.error('Public knowledge-claims guard failed.');
    console.error('The following files contain blocked legacy/internal knowledge exposure terms:');
    issues.forEach(issue => {
      console.error(`- ${issue.filePath}:${issue.lineNumber} [${issue.term}] ${issue.message}`);
    });
    process.exit(1);
  }

  console.log('Public knowledge-claims guard passed.');
}

main();
