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
const { OBJECT_NAME_PATTERN } = require('./bridgeConfig');

function normalizeTargetType(value) {
  const normalized = String(value || 'source-member')
    .trim()
    .toLowerCase();
  if (normalized !== 'source-member' && normalized !== 'ifs-streamfile') {
    throw new Error(`Invalid bridge target type: ${value}`);
  }
  return normalized;
}

function normalizeObjectName(value, label) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (!normalized) {
    throw new Error(`Missing bridge target field: ${label}`);
  }
  if (!OBJECT_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid bridge target ${label}: ${value}`);
  }
  return normalized;
}

function normalizeIfsPath(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Missing bridge target field: ${label}`);
  }
  if (!normalized.startsWith('/')) {
    throw new Error(`Invalid bridge target ${label}: expected absolute IFS path.`);
  }
  if (normalized.includes('..')) {
    throw new Error(`Invalid bridge target ${label}: parent traversal is not allowed.`);
  }
  if (normalized.includes('\0')) {
    throw new Error(`Invalid bridge target ${label}: contains NUL byte.`);
  }
  return normalized;
}

function targetIsAllowlisted(target, allowlist) {
  const allowed = allowlist || {};
  if (target.targetType === 'ifs-streamfile') {
    return (allowed.ifsPaths || []).some(entry => target.ifsPath.startsWith(entry));
  }
  const libraries = allowed.libraries || [];
  const sourceFiles = allowed.sourceFiles || [];
  return libraries.includes(target.library) && sourceFiles.includes(target.sourceFile);
}

function validateBridgeTarget(target, allowlist) {
  const targetType = normalizeTargetType(target && target.targetType);
  if (targetType === 'ifs-streamfile') {
    const normalizedTarget = {
      targetType,
      ifsPath: normalizeIfsPath(target && target.ifsPath, 'ifsPath'),
    };
    return {
      target: normalizedTarget,
      allowlisted: targetIsAllowlisted(normalizedTarget, allowlist),
    };
  }

  const normalizedTarget = {
    targetType,
    library: normalizeObjectName(target && target.library, 'library'),
    sourceFile: normalizeObjectName(target && target.sourceFile, 'sourceFile'),
    member: normalizeObjectName(target && target.member, 'member'),
    memberType:
      target && target.memberType ? normalizeObjectName(target.memberType, 'memberType') : '',
  };
  return {
    target: normalizedTarget,
    allowlisted: targetIsAllowlisted(normalizedTarget, allowlist),
  };
}

module.exports = {
  normalizeTargetType,
  normalizeIfsPath,
  normalizeObjectName,
  targetIsAllowlisted,
  validateBridgeTarget,
};
