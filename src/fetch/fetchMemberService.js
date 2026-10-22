/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exportSourceMemberViaJdbc } = require('./jt400CommandRunner');
const { validateSourceFile } = require('../source/sourceIntegrity');
const {
  IMPORT_MANIFEST_FILE,
  buildImportManifest,
  writeImportManifest,
} = require('./importManifest');

const DEFAULT_SOURCE_FILE = 'QRPGLESRC';
const DEFAULT_STREAM_FILE_CCSID = 1208;
const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_#$@]*$/;
const MAX_MEMBERS = 50;

function normalizeIdentifier(value, label) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (!normalized || !IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`Invalid ${label}: ${value || '(empty)'}`);
  }
  return normalized;
}

function normalizeMembers(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const members = values
    .map(entry => String(entry || '').trim())
    .filter(Boolean)
    .map(entry => normalizeIdentifier(entry, 'member'));
  if (!members.length) {
    throw new Error('At least one source member is required.');
  }
  if (members.length > MAX_MEMBERS) {
    throw new Error(`At most ${MAX_MEMBERS} source members may be fetched in one GUI action.`);
  }
  return [...new Set(members)];
}

function normalizeRelativeOutput(cwd, outputRoot) {
  const raw = String(outputRoot || '').trim();
  if (!raw) {
    throw new Error('Fetch output must be a non-empty workspace path.');
  }
  const resolved = path.resolve(cwd, raw);
  const relative = path.relative(cwd, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !staysInWorkspace(cwd, resolved)
  ) {
    throw new Error('Fetch output must stay inside the current workspace.');
  }
  return { resolved, relative: relative.split(path.sep).join('/') };
}

function staysInWorkspace(cwd, targetPath) {
  const root = fs.realpathSync(cwd);
  let existing = path.resolve(targetPath);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  const resolved = fs.realpathSync(existing);
  const relative = path.relative(root, resolved);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function summarizeEndpoint(host) {
  const value = String(host || '').trim();
  if (!value) return '(configured endpoint unavailable)';
  if (/^jdbc:/i.test(value)) {
    const withoutCredentials = value.replace(/\/\/[^/@;]+:[^/@;]+@/g, '//');
    return (
      withoutCredentials.replace(/^jdbc:[^:]+:\/\//i, '').split(/[;/]/)[0] || '(redacted endpoint)'
    );
  }
  return value.replace(/\/\/[^/@;]+:[^/@;]+@/g, '//').split(/[;/]/)[0];
}

function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function buildSourceFingerprint(validation) {
  if (!validation || !validation.exists || !validation.sha256) {
    return null;
  }
  return {
    algorithm: 'sha256',
    sha256: validation.sha256,
    sizeBytes: validation.sizeBytes,
  };
}

function resolveWorkspaceFile(cwd, relativePath) {
  const root = path.resolve(cwd);
  const absolutePath = path.resolve(root, String(relativePath || ''));
  const relative = path.relative(root, absolutePath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !staysInWorkspace(cwd, absolutePath)
  ) {
    return null;
  }
  return {
    absolutePath,
    relativePath: relative.split(path.sep).join('/'),
  };
}

function checkFetchedSourceFreshness({ cwd = process.cwd(), fetched = [] } = {}) {
  const checkedAt = new Date().toISOString();
  const files = (Array.isArray(fetched) ? fetched : []).map(entry => {
    const relativePath = String(entry && entry.path ? entry.path : '')
      .trim()
      .replace(/\\/g, '/');
    const expectedSha256 =
      entry && entry.sourceFingerprint && entry.sourceFingerprint.sha256
        ? String(entry.sourceFingerprint.sha256)
        : entry && entry.sha256
          ? String(entry.sha256)
          : null;
    const workspaceFile = resolveWorkspaceFile(cwd, relativePath);
    if (!workspaceFile) {
      return {
        member: entry && entry.member ? entry.member : null,
        path: relativePath,
        status: 'unknown',
        reason: 'path-outside-workspace',
        expectedSha256,
        currentSha256: null,
        sizeBytes: 0,
      };
    }

    const validation = validateSourceFile(workspaceFile.absolutePath, {
      rootDir: cwd,
      normalizeText: false,
    });
    let status = 'unknown';
    let reason = 'source-fingerprint-missing';
    if (!validation.exists) {
      status = 'missing';
      reason = 'source-file-missing';
    } else if (expectedSha256 && expectedSha256 === validation.sha256) {
      status = 'fresh';
      reason = 'source-fingerprint-matches';
    } else if (expectedSha256) {
      status = 'changed';
      reason = 'source-file-changed';
    }

    return {
      member: entry && entry.member ? entry.member : null,
      path: workspaceFile.relativePath,
      status,
      reason,
      expectedSha256,
      currentSha256: validation.sha256,
      sizeBytes: validation.sizeBytes,
    };
  });

  let status = 'unknown';
  let reason = 'no-fetched-files';
  if (files.some(file => file.status === 'changed')) {
    status = 'changed';
    reason = 'source-file-changed';
  } else if (files.some(file => file.status === 'missing')) {
    status = 'missing';
    reason = 'source-file-missing';
  } else if (files.length > 0 && files.every(file => file.status === 'fresh')) {
    status = 'fresh';
    reason = 'source-fingerprint-matches';
  } else if (files.length > 0) {
    reason = 'source-fingerprint-unavailable';
  }

  return {
    algorithm: 'sha256',
    status,
    reason,
    checkedAt,
    files,
  };
}

function resolveExtension(sourceFile) {
  const upper = String(sourceFile || '').toUpperCase();
  if (upper === 'QRPGLESRC' || upper === 'QRPGFREE') return '.rpgle';
  if (upper === 'QCLLESRC' || upper === 'QCLSRC') return '.clle';
  if (upper === 'QDDSSRC') return '.dds';
  if (upper === 'QSQLSRC' || upper === 'SQLSRC' || /SQL|TBL|TABLE|DDL/.test(upper)) return '.sql';
  if (upper.includes('DDS')) return '.dds';
  if (upper.includes('CL')) return '.clle';
  return '.rpgle';
}

function buildFetchMemberPlan({
  cwd = process.cwd(),
  profile,
  host,
  transport = 'jt400',
  sourceLib,
  sourceFile = DEFAULT_SOURCE_FILE,
  members,
  outputRoot,
  workingContextFingerprint = null,
}) {
  const normalizedProfile = String(profile || '').trim();
  const normalizedSourceLib = normalizeIdentifier(sourceLib, 'source library');
  const normalizedSourceFile = normalizeIdentifier(sourceFile, 'source file');
  const normalizedMembers = normalizeMembers(members);
  const output = normalizeRelativeOutput(cwd, outputRoot);
  const extension = resolveExtension(normalizedSourceFile);
  const safePlan = {
    schemaVersion: 1,
    kind: 'zeus-read-only-fetch-plan',
    remoteMutation: false,
    localArtifactWrite: true,
    profile: normalizedProfile || null,
    endpoint: {
      transport: String(transport || 'jt400')
        .trim()
        .toLowerCase(),
      target: summarizeEndpoint(host),
      credentialsIncluded: false,
    },
    scope: {
      sourceLibrary: normalizedSourceLib,
      sourceFile: normalizedSourceFile,
      members: normalizedMembers,
    },
    output: {
      root: output.relative,
      files: normalizedMembers.map(
        member => `${output.relative}/${normalizedSourceFile}/${member}${extension}`
      ),
    },
    workingContextFingerprint: workingContextFingerprint || null,
  };
  return {
    ...safePlan,
    planId: stableFingerprint(safePlan),
  };
}

function maskRuntimeMessage(value) {
  return String(value || '')
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s;]+/gi, '$1=[redacted]')
    .replace(/\/\/[^/@\s]+:[^/@\s]+@/g, '//[redacted]@');
}

function executeReadOnlyMemberFetch({
  cwd = process.cwd(),
  plan,
  host,
  user,
  password,
  confirmPlanId,
  manifestSubdirectory = null,
  exporter = exportSourceMemberViaJdbc,
}) {
  if (!plan || plan.kind !== 'zeus-read-only-fetch-plan') {
    throw new Error('A valid read-only fetch plan is required.');
  }
  if (String(confirmPlanId || '') !== plan.planId) {
    const error = new Error(
      'Fetch plan changed or was not explicitly confirmed. Create and review a new plan.'
    );
    error.code = 'FETCH_PLAN_CONFIRMATION_REQUIRED';
    throw error;
  }
  if (!user || !password || !host) {
    const error = new Error(
      'Fetch endpoint credentials are not available for the selected profile.'
    );
    error.code = 'FETCH_ENDPOINT_NOT_READY';
    throw error;
  }

  const output = normalizeRelativeOutput(cwd, plan.output.root);
  const extension = resolveExtension(plan.scope.sourceFile);
  const fetched = [];
  const failures = [];
  const exportRecords = [];
  const localSubDir = path.join(output.resolved, plan.scope.sourceFile);
  const manifestDestination = manifestSubdirectory
    ? path.join(output.resolved, normalizeIdentifier(manifestSubdirectory, 'manifest subdirectory'))
    : null;
  if (manifestDestination) {
    normalizeRelativeOutput(cwd, path.relative(cwd, manifestDestination));
    const manifestPath = path.join(manifestDestination, IMPORT_MANIFEST_FILE);
    if (
      fs.existsSync(manifestPath) ||
      plan.scope.members.some(member =>
        fs.existsSync(path.join(localSubDir, `${member}${resolveExtension(plan.scope.sourceFile)}`))
      )
    ) {
      const error = new Error(
        'Fetch source or manifest already exists; choose a new output directory.'
      );
      error.code = 'FETCH_OUTPUT_EXISTS';
      throw error;
    }
  }
  fs.mkdirSync(localSubDir, { recursive: true });

  for (const member of plan.scope.members) {
    const targetPath = path.join(localSubDir, `${member}${extension}`);
    const record = {
      sourceLib: plan.scope.sourceLibrary,
      sourceFile: plan.scope.sourceFile,
      member,
      localPath: targetPath,
      system: summarizeEndpoint(host),
      fetchedAt: new Date().toISOString(),
      ok: false,
    };
    try {
      const result = exporter({
        host,
        user,
        password,
        sourceLib: plan.scope.sourceLibrary,
        sourceFile: plan.scope.sourceFile,
        member,
        targetPath,
        streamFileCcsid: DEFAULT_STREAM_FILE_CCSID,
        writeMode: 'local',
        verbose: false,
      });
      const stat = fs.statSync(targetPath);
      if (!result || !result.ok || !stat.isFile() || stat.size === 0) {
        throw new Error('The endpoint returned no non-empty local source artifact.');
      }
      const validation = validateSourceFile(targetPath, {
        rootDir: cwd,
        normalizeText: false,
      });
      const sourceFingerprint = buildSourceFingerprint(validation);
      fetched.push({
        member,
        path: path.relative(cwd, targetPath).split(path.sep).join('/'),
        linesWritten: Number(result.linesWritten || 0),
        usedFallback: Boolean(result.usedFallback),
        sha256: sourceFingerprint ? sourceFingerprint.sha256 : null,
        sizeBytes: sourceFingerprint ? sourceFingerprint.sizeBytes : stat.size,
        sourceFingerprint,
      });
      record.ok = true;
      record.fallbackUsed = Boolean(result.usedFallback);
      record.transportUsed = plan.endpoint.transport;
    } catch (error) {
      const message = maskRuntimeMessage(error && error.message);
      record.messages = [message];
      failures.push({ member, message });
    }
    exportRecords.push(record);
  }

  let manifest = null;
  let manifestPath = null;
  if (manifestDestination) {
    manifest = buildImportManifest({
      options: {
        host: summarizeEndpoint(host),
        sourceLib: plan.scope.sourceLibrary,
        files: [plan.scope.sourceFile],
        members: plan.scope.members,
        replace: false,
        transport: plan.endpoint.transport,
        streamFileCcsid: DEFAULT_STREAM_FILE_CCSID,
      },
      summary: {
        transportUsed: plan.endpoint.transport,
        encodingPolicy: 'UTF-8',
        exportedTotal: exportRecords.length,
        exportedSuccess: fetched.length,
        downloadedCount: fetched.length,
      },
      exportRecords,
      localDestination: manifestDestination,
    });
    manifest.tool.command = 'fetch-member';
    manifest.status = failures.length ? (fetched.length ? 'partial' : 'failed') : 'completed';
    manifestPath = writeImportManifest(manifestDestination, manifest, { exclusive: true });
  }

  return {
    operation: 'read-only-member-fetch',
    planId: plan.planId,
    remoteMutation: false,
    localArtifactWrite: true,
    fetched,
    failures,
    ...(manifest
      ? {
          manifestPath: path.relative(cwd, manifestPath).split(path.sep).join('/'),
          manifest: {
            ...manifest,
            localDestination: path.relative(cwd, manifestDestination).split(path.sep).join('/'),
          },
        }
      : {}),
    sourceFingerprints: fetched.map(entry => ({
      member: entry.member,
      path: entry.path,
      ...entry.sourceFingerprint,
    })),
    freshness: checkFetchedSourceFreshness({ cwd, fetched }),
    status: failures.length ? (fetched.length ? 'warning' : 'failed') : 'completed',
  };
}

module.exports = {
  DEFAULT_SOURCE_FILE,
  DEFAULT_STREAM_FILE_CCSID,
  buildFetchMemberPlan,
  checkFetchedSourceFreshness,
  executeReadOnlyMemberFetch,
  normalizeMembers,
  resolveExtension,
  summarizeEndpoint,
};
