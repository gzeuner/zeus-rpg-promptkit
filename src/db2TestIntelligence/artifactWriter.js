'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ARTIFACT_FILES,
  MANIFEST_KIND,
  NON_CLAIMS,
  REASON_CODES,
  LIMITS,
  RESULT_CONTRACT_REF,
} = require('./constants');
const { prettyCanonical, sha256Text, utf8ByteLength } = require('./util');
const {
  sanitizeRunId,
  assertArtifactRootOutsideWorkspace,
  assertPathInsideRoot,
  resolveReal,
  isInsideOrEqual,
} = require('./paths');
const { exportMarkdown, exportFramework } = require('./exporters');
const { validateVectorSet } = require('./validate');

const WRITE_FAILED = Object.freeze({
  code: REASON_CODES.ARTIFACT_WRITE_FAILED,
  message: 'Artifact write failed; details redacted.',
});

function writeFileCreateOnly(filePath, content) {
  const fd = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Staging directory suffix only — not used for vector identity or artifact content. */
let stageSeq = 0;
function stagingSuffix() {
  stageSeq += 1;
  return crypto.createHash('sha256').update(`stage-${stageSeq}`).digest('hex').slice(0, 16);
}

/**
 * Write the full artifact set under trusted artifactRoot / sanitized runId.
 * Prefer staging directory, write content files, write manifest last, then
 * atomic rename into final run directory. Create-only; no overwrite.
 * Mid-write failure leaves no reader-valid final artifact.
 */
function writeArtifacts({ workspaceRoot, artifactRoot, runId, vectorSet, frameworks = [] }) {
  try {
    const validation = validateVectorSet(vectorSet);
    if (!validation.ok) {
      return { written: false, files: [], error: { ...WRITE_FAILED } };
    }

    const absArtifact = assertArtifactRootOutsideWorkspace(artifactRoot, workspaceRoot);
    fs.mkdirSync(absArtifact, { recursive: true });
    const realArtifact = resolveReal(absArtifact);
    if (workspaceRoot) {
      const realSource = resolveReal(workspaceRoot);
      if (isInsideOrEqual(realSource, realArtifact)) {
        return { written: false, files: [], error: { ...WRITE_FAILED } };
      }
    }

    const safeRunId = sanitizeRunId(runId);
    const finalDir = path.join(realArtifact, safeRunId);

    // Create-only final directory — collision fails closed
    if (fs.existsSync(finalDir)) {
      return {
        written: false,
        files: [],
        error: {
          code: REASON_CODES.ARTIFACT_COLLISION,
          message: 'Artifact run directory already exists; create-only policy.',
        },
      };
    }

    // Stage under the artifact root (same volume) so rename is atomic on Windows/Linux.
    // Hidden staging name cannot collide with sanitized run ids (no leading '.' after sanitize).
    const stageName = `.staging-${stagingSuffix()}`;
    const stageDir = path.join(realArtifact, stageName);
    if (fs.existsSync(stageDir) || fs.existsSync(finalDir)) {
      return {
        written: false,
        files: [],
        error: {
          code: REASON_CODES.ARTIFACT_COLLISION,
          message: 'Artifact run directory already exists; create-only policy.',
        },
      };
    }
    fs.mkdirSync(stageDir, { recursive: false });
    assertPathInsideRoot(stageDir, realArtifact, workspaceRoot);

    // ownsFinal is true only after this invocation successfully renames into finalDir.
    // Never delete a finalDir we do not own (concurrent/pre-existing collision).
    let ownsFinal = false;

    try {
      const artifactEntries = [];
      let aggregateBytes = 0;

      function addContent(relName, text) {
        const bytes = utf8ByteLength(text);
        if (bytes > LIMITS.maxCanonicalJsonBytes && relName.endsWith('.json')) {
          throw Object.assign(new Error('oversize'), { code: REASON_CODES.BOUNDS_EXCEEDED });
        }
        if (bytes > LIMITS.maxMarkdownBytes && relName.endsWith('.md')) {
          throw Object.assign(new Error('oversize'), { code: REASON_CODES.BOUNDS_EXCEEDED });
        }
        if (
          bytes > LIMITS.maxFrameworkOutputBytes &&
          !relName.endsWith('.json') &&
          !relName.endsWith('.md')
        ) {
          throw Object.assign(new Error('oversize'), { code: REASON_CODES.BOUNDS_EXCEEDED });
        }
        aggregateBytes += bytes;
        if (aggregateBytes > LIMITS.maxAggregateArtifactBytes) {
          throw Object.assign(new Error('aggregate-oversize'), {
            code: REASON_CODES.BOUNDS_EXCEEDED,
          });
        }
        const abs = path.join(stageDir, relName);
        writeFileCreateOnly(abs, text);
        artifactEntries.push({
          path: relName,
          sha256: sha256Text(text),
          sizeBytes: bytes,
        });
      }

      // Canonical JSON is sole source of truth
      const canonicalText = prettyCanonical(vectorSet, 2);
      if (utf8ByteLength(canonicalText) > LIMITS.maxCanonicalJsonBytes) {
        throw Object.assign(new Error('canonical-oversize'), {
          code: REASON_CODES.BOUNDS_EXCEEDED,
        });
      }
      addContent(ARTIFACT_FILES.CANONICAL, canonicalText);

      const md = exportMarkdown(vectorSet);
      if (!md.ok) {
        throw Object.assign(new Error('md-fail'), {
          code: md.reasonCode || REASON_CODES.ARTIFACT_WRITE_FAILED,
        });
      }
      addContent(ARTIFACT_FILES.MARKDOWN, md.text);

      const fwList = Array.isArray(frameworks) ? frameworks.slice().sort() : [];
      for (const fw of fwList) {
        const exported = exportFramework(vectorSet, fw);
        if (!exported.ok) {
          throw Object.assign(new Error('fw-fail'), {
            code: exported.reasonCode || REASON_CODES.ARTIFACT_WRITE_FAILED,
          });
        }
        if (fw === 'junit-xml') {
          addContent(ARTIFACT_FILES.JUNIT, exported.text);
        } else if (fw === 'robot-framework') {
          addContent(ARTIFACT_FILES.ROBOT, exported.text);
        }
      }

      // Manifest last (not self-listed)
      const manifest = {
        schemaVersion: 1,
        kind: MANIFEST_KIND,
        runId: safeRunId,
        contractRef: RESULT_CONTRACT_REF,
        nonClaims: { ...NON_CLAIMS },
        notes: [
          'Canonical JSON is the sole source of truth.',
          'Markdown and framework files are deterministic projections.',
          'Existing artifacts are readable without entitlement.',
          'manifest.json is present beside the listed artifacts and is not self-hashed.',
        ],
        artifacts: artifactEntries,
      };
      const manifestText = prettyCanonical(manifest, 2);
      writeFileCreateOnly(path.join(stageDir, ARTIFACT_FILES.MANIFEST), manifestText);

      // Atomic rename into final create-only run directory (same volume).
      assertPathInsideRoot(finalDir, realArtifact, workspaceRoot);
      if (fs.existsSync(finalDir)) {
        throw Object.assign(new Error('collision'), { code: REASON_CODES.ARTIFACT_COLLISION });
      }
      fs.renameSync(stageDir, finalDir);
      ownsFinal = true;

      // Post-rename containment / symlink escape check
      assertPathInsideRoot(finalDir, realArtifact, workspaceRoot);
      for (const entry of artifactEntries) {
        const filePath = path.join(finalDir, entry.path);
        assertPathInsideRoot(filePath, realArtifact, workspaceRoot);
      }
      assertPathInsideRoot(
        path.join(finalDir, ARTIFACT_FILES.MANIFEST),
        realArtifact,
        workspaceRoot
      );

      const written = artifactEntries.map(e => path.join(finalDir, e.path));
      written.push(path.join(finalDir, ARTIFACT_FILES.MANIFEST));

      return {
        written: true,
        root: realArtifact,
        directory: finalDir,
        runId: safeRunId,
        files: written,
        manifest,
      };
    } catch (err) {
      // Staging cleanup only when this invocation still owns the staging directory
      // (rename has not succeeded). Never delete an unowned finalDir.
      if (!ownsFinal) {
        try {
          if (fs.existsSync(stageDir)) {
            fs.rmSync(stageDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      } else {
        // Post-rename failure: only remove the final directory we just created
        // if it is not yet reader-valid (manifest missing).
        try {
          const man = path.join(finalDir, ARTIFACT_FILES.MANIFEST);
          if (fs.existsSync(finalDir) && !fs.existsSync(man)) {
            fs.rmSync(finalDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
      if (err && err.code === REASON_CODES.BOUNDS_EXCEEDED) {
        return {
          written: false,
          files: [],
          error: {
            code: REASON_CODES.BOUNDS_EXCEEDED,
            message: 'Artifact size bound exceeded.',
          },
        };
      }
      if (err && err.code === REASON_CODES.ARTIFACT_COLLISION) {
        return {
          written: false,
          files: [],
          error: {
            code: REASON_CODES.ARTIFACT_COLLISION,
            message: 'Artifact run directory already exists; create-only policy.',
          },
        };
      }
      return { written: false, files: [], error: { ...WRITE_FAILED } };
    }
  } catch {
    return { written: false, files: [], error: { ...WRITE_FAILED } };
  }
}

module.exports = {
  writeArtifacts,
  WRITE_FAILED,
};
