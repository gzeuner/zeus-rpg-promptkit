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
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_FILE_PATTERN = /^Q[A-Z0-9]+SRC$/i;
const SOURCE_ROOT_MARKERS = new Set([
  'QRPGLESRC',
  'QSQLRPGLESRC',
  'QCLLESRC',
  'QCLSRC',
  'QDDSSRC',
  'QTBLSRC',
  'rpg_sources',
  'source',
]);

function pathParts(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function isWindowsPath(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(String(value || ''));
}

function pathApiFor(...values) {
  return values.some(isWindowsPath) ? path.win32 : path;
}

function resolvePathLike(root, candidate = '') {
  const api = pathApiFor(root, candidate);
  return api.resolve(String(root || ''), String(candidate || ''));
}

function joinPathLike(root, ...parts) {
  const api = pathApiFor(root);
  return api.join(String(root || ''), ...parts);
}

function extensionOfPath(value) {
  return pathApiFor(value).extname(String(value || ''));
}

function basename(value) {
  const parts = pathParts(value);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

function withoutExtension(value) {
  return basename(value)
    .replace(/\.[^.]+$/, '')
    .trim()
    .toUpperCase();
}

function resolveCurrentTarget({
  scheme = 'file',
  path: uriPath = '',
  fsPath = '',
  fileName = '',
} = {}) {
  const sourceIdentity = fsPath || fileName || uriPath;
  const parts = pathParts(uriPath || fsPath || fileName);
  const sourceFileIndex = parts.findIndex(part => SOURCE_FILE_PATTERN.test(part));
  const sourceFile = sourceFileIndex >= 0 ? parts[sourceFileIndex].toUpperCase() : null;
  const member = withoutExtension(sourceIdentity) || null;

  return {
    scheme: String(scheme || 'file'),
    system: null,
    library: null,
    sourceFile,
    member,
    program: member,
    memberPath: sourceIdentity ? String(sourceIdentity) : null,
    sourceFileIndex,
  };
}

function computeLocalSourceRoot(target, workspaceFolders = [], fileExists = fs.existsSync) {
  const workspaceRoot =
    workspaceFolders[0] && workspaceFolders[0].uri && workspaceFolders[0].uri.fsPath
      ? workspaceFolders[0].uri.fsPath
      : process.cwd();
  const currentPath = target && target.memberPath ? target.memberPath : '';
  if (!currentPath) {
    return workspaceRoot;
  }

  let candidate = path.dirname(currentPath);
  for (let depth = 0; depth < 7; depth += 1) {
    const name = path.basename(candidate);
    if (SOURCE_ROOT_MARKERS.has(name) || SOURCE_ROOT_MARKERS.has(name.toUpperCase())) {
      return path.dirname(candidate);
    }

    const parent = path.dirname(candidate);
    if (!parent || parent === candidate) {
      break;
    }
    for (const marker of SOURCE_ROOT_MARKERS) {
      if (fileExists(path.join(parent, marker))) {
        return parent;
      }
    }
    candidate = parent;
  }

  return fileExists(path.dirname(currentPath)) ? path.dirname(currentPath) : workspaceRoot;
}

function isPathWithin(root, candidate) {
  const api = pathApiFor(root, candidate);
  const resolvedRoot = resolvePathLike(root);
  const resolvedCandidate = resolvePathLike(root, candidate);
  const relative = api.relative(resolvedRoot, resolvedCandidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${api.sep}`) && relative !== '..' && !api.isAbsolute(relative))
  );
}

function buildAnalyzeOptions({ target, sourceRoot, outputRoot, denseLevel = 'full' } = {}) {
  if (!target || !target.program) {
    throw new Error('An analysis target with a program/member is required.');
  }
  if (!sourceRoot) {
    throw new Error('A source root is required.');
  }

  return {
    source: sourceRoot,
    sourceRoot,
    out: outputRoot,
    program: target.program,
    member: target.member || undefined,
    dense: denseLevel,
    mode: 'documentation',
    optimizeContext: true,
  };
}

function buildCliInvocation({
  workspaceRoot,
  cliPath = '',
  target,
  sourceRoot,
  outputRoot,
  profile = 'default',
  denseLevel = 'full',
  fileExists = fs.existsSync,
} = {}) {
  if (!workspaceRoot || !target || !target.program || !sourceRoot || !outputRoot) {
    throw new Error('Workspace, target, source root, and output root are required.');
  }

  const args = [
    'analyze',
    '--profile',
    profile,
    '--source',
    sourceRoot,
    '--program',
    target.program,
    '--out',
    outputRoot,
    '--mode',
    'documentation',
    '--dense',
    denseLevel,
    '--optimize-context',
    '--json',
  ];
  if (target.member && target.member !== target.program) {
    args.push('--member', target.member);
  }

  const configured = String(cliPath || '').trim();
  if (configured) {
    const hasPath =
      configured.includes('/') || configured.includes('\\') || path.isAbsolute(configured);
    if (hasPath) {
      const resolved = resolvePathLike(workspaceRoot, configured);
      if (!isPathWithin(workspaceRoot, resolved)) {
        throw new Error('The configured Zeus CLI path must remain inside the workspace.');
      }
      return extensionOfPath(resolved).toLowerCase() === '.js'
        ? { command: process.execPath, args: [resolved, ...args] }
        : { command: resolved, args };
    }
    return { command: configured, args };
  }

  const workspaceCli = joinPathLike(workspaceRoot, 'cli', 'zeus.js');
  if (fileExists(workspaceCli)) {
    return { command: process.execPath, args: [workspaceCli, ...args] };
  }
  return { command: process.platform === 'win32' ? 'zeus.cmd' : 'zeus', args };
}

function formatTarget(target = {}) {
  return [
    `System: ${target.system || 'unknown'}`,
    `Library/schema: ${target.library || 'unknown'}`,
    `Source file: ${target.sourceFile || 'unknown'}`,
    `Member/program: ${target.member || target.program || 'unknown'}`,
  ].join('\n');
}

module.exports = {
  SOURCE_FILE_PATTERN,
  buildAnalyzeOptions,
  buildCliInvocation,
  computeLocalSourceRoot,
  formatTarget,
  isPathWithin,
  pathParts,
  resolveCurrentTarget,
};
