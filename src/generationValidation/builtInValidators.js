'use strict';

const path = require('path');
const {
  DIAGNOSTIC_IDS,
  SEVERITY,
  ALLOWED_FILE_EXTENSIONS,
  DEFAULT_LIMITS,
  FILE_ACTIONS,
} = require('./constants');
const { validateWorkspacePath, caseFoldKey, normalizeRelativePath } = require('./pathSafety');
const { CONTRACT_IDS, generationCandidateSchema } = require('./contracts');

function byteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function secretLike(text) {
  const s = String(text || '');
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s) ||
    /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}/i.test(s)
  );
}

function createBuiltInValidators(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const allowedExtensions = options.allowedExtensions || ALLOWED_FILE_EXTENSIONS;

  return [
    {
      id: 'schema',
      version: 1,
      order: 10,
      title: 'Schema validator',
      description: 'Validates generation-candidate/v1 structure',
      validate(ctx) {
        const errors = generationCandidateSchema(ctx.candidate);
        if (!errors.length) return [];
        return errors.map(err => ({
          id: DIAGNOSTIC_IDS.SCHEMA_INVALID,
          severity: SEVERITY.BLOCKING,
          path: err.path || null,
          message: err.message,
        }));
      },
    },
    {
      id: 'contract-version',
      version: 1,
      order: 20,
      title: 'Contract version validator',
      description: 'Ensures supported generation-candidate contract version',
      validate(ctx) {
        const c = ctx.candidate || {};
        if (Number(c.schemaVersion) !== 1) {
          return [
            {
              id: DIAGNOSTIC_IDS.CONTRACT_VERSION_UNSUPPORTED,
              severity: SEVERITY.BLOCKING,
              path: '/schemaVersion',
              message: `Unsupported generation-candidate version: ${c.schemaVersion}`,
            },
          ];
        }
        if (
          c.contractId != null &&
          c.contractId !== CONTRACT_IDS.GENERATION_CANDIDATE &&
          c.contractId !== `${CONTRACT_IDS.GENERATION_CANDIDATE}@1`
        ) {
          return [
            {
              id: DIAGNOSTIC_IDS.CONTRACT_VERSION_UNSUPPORTED,
              severity: SEVERITY.BLOCKING,
              path: '/contractId',
              message: 'Unsupported generation-candidate contract id',
            },
          ];
        }
        return [];
      },
    },
    {
      id: 'workspace-path',
      version: 1,
      order: 30,
      title: 'Workspace path validator',
      description: 'Rejects absolute, traversal, UNC, drive, and control-character paths',
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          const result = validateWorkspacePath(file && file.path, {
            workspaceRoot: ctx.workspaceRoot,
            allowedRelativeRoots: ctx.allowedRelativeRoots,
          });
          if (!result.ok) {
            const id =
              result.code === 'outside-workspace'
                ? DIAGNOSTIC_IDS.PATH_OUTSIDE_WORKSPACE
                : result.code === 'outside-scope'
                  ? DIAGNOSTIC_IDS.PATH_OUTSIDE_SCOPE
                  : DIAGNOSTIC_IDS.PATH_UNSAFE;
            out.push({
              id,
              severity: SEVERITY.BLOCKING,
              path: file && file.path ? String(file.path) : null,
              message: result.message,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'file-type',
      version: 1,
      order: 40,
      title: 'Allowed file type validator',
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          const ext = path.posix.extname(normalizeRelativePath(file && file.path)).toLowerCase();
          if (!allowedExtensions.includes(ext)) {
            out.push({
              id: DIAGNOSTIC_IDS.FILE_TYPE_DENIED,
              severity: SEVERITY.BLOCKING,
              path: file && file.path ? String(file.path) : null,
              message: `File extension is not allowed: ${ext || '(none)'}`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'size-limits',
      version: 1,
      order: 50,
      title: 'Content and file size limits',
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        if (files.length > limits.maxFiles) {
          out.push({
            id: DIAGNOSTIC_IDS.TOO_MANY_FILES,
            severity: SEVERITY.BLOCKING,
            path: '/proposedFiles',
            message: `Too many proposed files (max ${limits.maxFiles})`,
          });
        }
        let total = 0;
        for (const file of files) {
          const size = byteLength(file && file.content);
          total += size;
          if (size > limits.maxContentBytes) {
            out.push({
              id: DIAGNOSTIC_IDS.CONTENT_TOO_LARGE,
              severity: SEVERITY.BLOCKING,
              path: file && file.path ? String(file.path) : null,
              message: `File content exceeds ${limits.maxContentBytes} bytes`,
            });
          }
        }
        if (total > limits.maxTotalContentBytes) {
          out.push({
            id: DIAGNOSTIC_IDS.TOTAL_CONTENT_TOO_LARGE,
            severity: SEVERITY.BLOCKING,
            path: '/proposedFiles',
            message: `Total content exceeds ${limits.maxTotalContentBytes} bytes`,
          });
        }
        return out;
      },
    },
    {
      id: 'duplicate-target',
      version: 1,
      order: 60,
      title: 'Duplicate target validator',
      validate(ctx) {
        const out = [];
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        const seen = new Map();
        for (const file of files) {
          const key = caseFoldKey(file && file.path);
          if (!key) continue;
          if (seen.has(key)) {
            out.push({
              id: DIAGNOSTIC_IDS.DUPLICATE_TARGET,
              severity: SEVERITY.BLOCKING,
              path: file.path,
              message: `Duplicate target path (case-insensitive): ${file.path}`,
            });
          } else {
            seen.set(key, file.path);
          }
        }
        return out;
      },
    },
    {
      id: 'scope',
      version: 1,
      order: 70,
      title: 'Declared scope validator',
      validate(ctx) {
        const out = [];
        const declared = Array.isArray(ctx.declaredScopePaths)
          ? ctx.declaredScopePaths.map(normalizeRelativePath)
          : null;
        if (!declared || declared.length === 0) return out;
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          const p = normalizeRelativePath(file && file.path);
          const allowed = declared.some(root => p === root || p.startsWith(`${root}/`));
          if (!allowed) {
            out.push({
              id: DIAGNOSTIC_IDS.SCOPE_EXPANSION,
              severity: SEVERITY.BLOCKING,
              path: p,
              message: 'Proposed file expands beyond the declared validation scope',
            });
          }
        }
        // Undeclared expansion markers (e.g. free-text additionalFiles) are ignored as changes.
        if (Array.isArray(ctx.candidate && ctx.candidate.additionalFiles)) {
          out.push({
            id: DIAGNOSTIC_IDS.UNDECLARED_FILE,
            severity: SEVERITY.BLOCKING,
            path: '/additionalFiles',
            message: 'Undeclared additionalFiles are not accepted as proposed changes',
          });
        }
        return out;
      },
    },
    {
      id: 'evidence-reference',
      version: 1,
      order: 80,
      title: 'Evidence reference validator',
      validate(ctx) {
        const out = [];
        const refs = Array.isArray(ctx.candidate && ctx.candidate.evidenceReferences)
          ? ctx.candidate.evidenceReferences
          : [];
        const store =
          ctx.evidenceStore && typeof ctx.evidenceStore === 'object' ? ctx.evidenceStore : {};
        if (refs.length === 0) {
          out.push({
            id: DIAGNOSTIC_IDS.EVIDENCE_MISSING,
            severity: SEVERITY.BLOCKING,
            path: '/evidenceReferences',
            message: 'At least one evidence reference is required',
          });
          return out;
        }
        for (const ref of refs) {
          const id = ref && ref.id;
          const entry = store[id];
          if (!entry) {
            out.push({
              id: DIAGNOSTIC_IDS.EVIDENCE_UNKNOWN,
              severity: SEVERITY.BLOCKING,
              path: `/evidenceReferences/${id || ''}`,
              message: `Unknown evidence reference: ${id || '(missing id)'}`,
            });
            continue;
          }
          if (ref.kind && entry.kind && String(ref.kind) !== String(entry.kind)) {
            out.push({
              id: DIAGNOSTIC_IDS.EVIDENCE_TYPE_MISMATCH,
              severity: SEVERITY.BLOCKING,
              path: `/evidenceReferences/${id}`,
              message: `Evidence kind mismatch for ${id}`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'policy',
      version: 1,
      order: 90,
      title: 'Safety and policy validator',
      validate(ctx) {
        const out = [];
        if (ctx.policy && ctx.policy.deny === true) {
          out.push({
            id: DIAGNOSTIC_IDS.POLICY_DENIED,
            severity: SEVERITY.BLOCKING,
            path: null,
            message: String(ctx.policy.reason || 'Candidate denied by local safety policy'),
          });
        }
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          if (secretLike(file && file.content)) {
            out.push({
              id: DIAGNOSTIC_IDS.SECRET_LIKE_CONTENT,
              severity: SEVERITY.BLOCKING,
              path: file && file.path ? String(file.path) : null,
              message: 'Proposed content appears to contain secret-like material',
            });
          }
          const action = file && file.action ? String(file.action) : 'modify';
          if (!FILE_ACTIONS.includes(action)) {
            out.push({
              id: DIAGNOSTIC_IDS.POLICY_DENIED,
              severity: SEVERITY.BLOCKING,
              path: file && file.path ? String(file.path) : null,
              message: `Unsupported file action: ${action}`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'static-parse',
      version: 1,
      order: 100,
      title: 'Optional local static parse check',
      description:
        'Reuses existing source-type classification; does not invent a second RPG parser or claim compile readiness',
      validate(ctx) {
        const out = [];
        let classifySourceFile;
        let sourceTypeFamily;
        try {
          ({ classifySourceFile, sourceTypeFamily } = require('../source/sourceType'));
        } catch {
          return [
            {
              id: DIAGNOSTIC_IDS.STATIC_PARSE_UNSUPPORTED,
              severity: SEVERITY.WARNING,
              path: null,
              message: 'Source type classifier unavailable; static parse skipped',
            },
          ];
        }
        const files = Array.isArray(ctx.candidate && ctx.candidate.proposedFiles)
          ? ctx.candidate.proposedFiles
          : [];
        for (const file of files) {
          if (!file || file.action === 'delete') continue;
          const sourceType = classifySourceFile(file.path || '');
          const family = sourceTypeFamily(sourceType);
          if (!family || family === 'UNKNOWN') {
            // Not every allowed extension is an RPG/CL/DDS source unit.
            continue;
          }
          // Capability honesty: classification only — not semantic or compile validity.
          if (['RPG', 'CL', 'DDS'].includes(family)) {
            if (typeof file.content === 'string' && file.content.includes('\u0000')) {
              out.push({
                id: DIAGNOSTIC_IDS.STATIC_PARSE_FAILED,
                severity: SEVERITY.BLOCKING,
                path: file.path,
                message: 'Source content contains NUL bytes and cannot be parsed safely',
              });
            }
          }
        }
        return out;
      },
    },
  ];
}

module.exports = {
  createBuiltInValidators,
};
