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
    path.isAbsolute(relative)
  ) {
    throw new Error('Fetch output must stay inside the current workspace.');
  }
  return { resolved, relative: relative.split(path.sep).join('/') };
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
  const localSubDir = path.join(output.resolved, plan.scope.sourceFile);
  fs.mkdirSync(localSubDir, { recursive: true });

  for (const member of plan.scope.members) {
    const targetPath = path.join(localSubDir, `${member}${extension}`);
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
      fetched.push({
        member,
        path: path.relative(cwd, targetPath).split(path.sep).join('/'),
        linesWritten: Number(result.linesWritten || 0),
        usedFallback: Boolean(result.usedFallback),
      });
    } catch (error) {
      failures.push({ member, message: maskRuntimeMessage(error && error.message) });
    }
  }

  return {
    operation: 'read-only-member-fetch',
    planId: plan.planId,
    remoteMutation: false,
    localArtifactWrite: true,
    fetched,
    failures,
    status: failures.length ? (fetched.length ? 'warning' : 'failed') : 'completed',
  };
}

module.exports = {
  DEFAULT_SOURCE_FILE,
  DEFAULT_STREAM_FILE_CCSID,
  buildFetchMemberPlan,
  executeReadOnlyMemberFetch,
  normalizeMembers,
  resolveExtension,
  summarizeEndpoint,
};
