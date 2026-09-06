'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  ANALYZE_RUN_MANIFEST_FILE,
  readAnalyzeRunManifest,
} = require('../analyze/analyzeRunManifest');

function resumeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeWorkspacePath(cwd, value) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const requested = String(value || '').trim();
  if (!requested) return null;
  const target = path.resolve(workspaceRoot, requested);
  if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw resumeError(
      'PATH_OUTSIDE_WORKSPACE',
      'Resume output must stay inside the current workspace.'
    );
  }
  return target;
}

function displayPath(cwd, target) {
  return path.relative(path.resolve(cwd), target).split(path.sep).join('/') || '.';
}

function commandArgument(value, placeholder) {
  const text = String(value || '').trim();
  if (!text) return `<${placeholder}>`;
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function buildResumeHints({ cwd = process.cwd(), out = null, program = null } = {}) {
  const workspaceRoot = path.resolve(String(cwd || process.cwd()));
  const outputRoot = safeWorkspacePath(workspaceRoot, out);
  if (!outputRoot) {
    return {
      available: false,
      reason: 'No output root supplied; resume discovery is intentionally bounded.',
      manifestPath: null,
      status: null,
      commands: [],
    };
  }

  const programName = String(program || '').trim();
  const candidates = [];
  if (path.basename(outputRoot) === ANALYZE_RUN_MANIFEST_FILE) candidates.push(outputRoot);
  if (programName) candidates.push(path.join(outputRoot, programName, ANALYZE_RUN_MANIFEST_FILE));
  candidates.push(path.join(outputRoot, ANALYZE_RUN_MANIFEST_FILE));
  const manifestPath = candidates.find(
    candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!manifestPath) {
    return {
      available: false,
      reason: 'No analyze run manifest found under the supplied output root.',
      manifestPath: null,
      status: null,
      commands: [],
    };
  }

  let manifest;
  try {
    const manifestDir = path.dirname(manifestPath);
    manifest = readAnalyzeRunManifest(manifestDir);
  } catch {
    return {
      available: false,
      reason: 'The existing analyze run manifest could not be read safely.',
      manifestPath: displayPath(workspaceRoot, manifestPath),
      status: 'invalid',
      commands: [],
    };
  }
  if (!manifest) {
    return {
      available: false,
      reason: 'The existing analyze run manifest is empty or unavailable.',
      manifestPath: displayPath(workspaceRoot, manifestPath),
      status: 'unavailable',
      commands: [],
    };
  }

  const resolvedProgram = programName || manifest.inputs?.program || manifest.program || '';
  const relativeManifest = displayPath(workspaceRoot, manifestPath);
  const programOutput = displayPath(workspaceRoot, path.dirname(manifestPath));
  const relativeOutputRoot = displayPath(workspaceRoot, outputRoot);
  const status = String(manifest.run?.status || manifest.status || 'unknown');
  const completed = ['completed', 'succeeded', 'success'].includes(status.toLowerCase());
  const commands = completed
    ? [
        `node cli/zeus.js investigate --program ${commandArgument(resolvedProgram, 'program')} --out ${commandArgument(relativeOutputRoot, 'output-root')}`,
        `node cli/zeus.js qa --input ${commandArgument(programOutput, 'analysis-output')} --format markdown`,
      ]
    : [
        `node cli/zeus.js analyze --source <source-root> --program ${commandArgument(resolvedProgram, 'program')} --out ${commandArgument(relativeOutputRoot, 'output-root')} --json`,
      ];
  return {
    available: true,
    reason: 'An existing analyze run manifest was found; inspect it before re-running work.',
    manifestPath: relativeManifest,
    status,
    runId: manifest.run?.runId || manifest.run?.id || null,
    commands,
  };
}

module.exports = { buildResumeHints, safeWorkspacePath };
