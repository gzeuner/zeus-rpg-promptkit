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
const CONNECTION_TARGET_METADATA_KEY = Symbol('zeus.connectionTargetMetadata');

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeTargetName(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeTargetNameList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .flatMap(entry => (Array.isArray(entry) ? entry : [entry]))
        .map(entry => normalizeTargetName(entry))
        .filter(Boolean)
    )
  );
}

function extractAuthorityName(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  const jdbcMatch = text.match(/^jdbc:as400:\/\/([^;]+)/i);
  if (jdbcMatch && jdbcMatch[1]) {
    const authority = jdbcMatch[1].includes('@')
      ? jdbcMatch[1].slice(jdbcMatch[1].lastIndexOf('@') + 1)
      : jdbcMatch[1];
    return normalizeTargetName(authority.split(/[/:?#]/)[0]);
  }
  return normalizeTargetName(text.split(/[/:?#]/)[0]);
}

function cloneConnectionTargetMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  return {
    kind: 'connection-target',
    source: normalizeText(metadata.source) || 'system-ref',
    systemKey: normalizeText(metadata.systemKey),
    systemName: normalizeText(metadata.systemName),
    displayName: normalizeText(metadata.displayName),
    aliases: normalizeTargetNameList(metadata.aliases || []),
    configuredNames: normalizeTargetNameList(metadata.configuredNames || []),
  };
}

function attachConnectionTargetMetadata(target, metadata) {
  if (!target || typeof target !== 'object' || !metadata || typeof metadata !== 'object') {
    return target;
  }
  Object.defineProperty(target, CONNECTION_TARGET_METADATA_KEY, {
    value: cloneConnectionTargetMetadata(metadata),
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return target;
}

function getConnectionTargetMetadata(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }
  return cloneConnectionTargetMetadata(target[CONNECTION_TARGET_METADATA_KEY] || null);
}

function buildConnectionTargetMetadata({
  systemKey = '',
  systemDefinition = {},
  resolvedConfig = {},
  source = 'system-ref',
} = {}) {
  const systemName = normalizeText(systemDefinition.systemName || systemDefinition.name);
  const displayName =
    normalizeText(systemDefinition.displayName) || systemName || normalizeText(systemKey);
  const aliases = normalizeTargetNameList(systemDefinition.aliases || []);
  const configuredNames = normalizeTargetNameList([
    systemKey,
    systemName,
    aliases,
    extractAuthorityName(systemDefinition.host),
    extractAuthorityName(systemDefinition.url),
    extractAuthorityName(resolvedConfig && resolvedConfig.host),
    extractAuthorityName(resolvedConfig && resolvedConfig.url),
  ]);

  return {
    kind: 'connection-target',
    source: normalizeText(source) || 'system-ref',
    systemKey: normalizeText(systemKey),
    systemName,
    displayName,
    aliases,
    configuredNames,
  };
}

function listConnectionTargetNames(targetOrMetadata) {
  const metadata =
    getConnectionTargetMetadata(targetOrMetadata) ||
    cloneConnectionTargetMetadata(targetOrMetadata);
  if (!metadata) {
    const host = extractAuthorityName(targetOrMetadata && targetOrMetadata.host);
    const url = extractAuthorityName(targetOrMetadata && targetOrMetadata.url);
    return normalizeTargetNameList([host, url]);
  }
  return normalizeTargetNameList([
    metadata.systemKey,
    metadata.systemName,
    metadata.aliases,
    metadata.configuredNames,
    extractAuthorityName(targetOrMetadata && targetOrMetadata.host),
    extractAuthorityName(targetOrMetadata && targetOrMetadata.url),
  ]);
}

function matchesConnectionTargetName(targetOrMetadata, reportedName) {
  const normalizedReported = normalizeTargetName(reportedName);
  if (!normalizedReported) {
    return false;
  }
  return listConnectionTargetNames(targetOrMetadata).includes(normalizedReported);
}

function describeConnectionTarget(targetOrMetadata) {
  const metadata =
    getConnectionTargetMetadata(targetOrMetadata) ||
    cloneConnectionTargetMetadata(targetOrMetadata);
  const fallbackHost =
    extractAuthorityName(targetOrMetadata && targetOrMetadata.host) ||
    extractAuthorityName(targetOrMetadata && targetOrMetadata.url);
  if (!metadata) {
    return fallbackHost || '(target unknown)';
  }

  const parts = [];
  const title =
    metadata.displayName ||
    metadata.systemName ||
    metadata.systemKey ||
    fallbackHost ||
    '(target unknown)';
  if (metadata.systemKey) {
    parts.push(`key=${metadata.systemKey}`);
  }
  if (metadata.systemName) {
    parts.push(`name=${metadata.systemName}`);
  }
  if (metadata.aliases.length > 0) {
    parts.push(`aliases=${metadata.aliases.join(',')}`);
  }
  if (fallbackHost) {
    parts.push(`host=${fallbackHost}`);
  }
  return parts.length > 0 ? `${title} [${parts.join('; ')}]` : title;
}

module.exports = {
  attachConnectionTargetMetadata,
  buildConnectionTargetMetadata,
  cloneConnectionTargetMetadata,
  describeConnectionTarget,
  extractAuthorityName,
  getConnectionTargetMetadata,
  listConnectionTargetNames,
  matchesConnectionTargetName,
  normalizeTargetName,
  normalizeTargetNameList,
};
