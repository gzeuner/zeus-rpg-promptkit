/*
Copyright 2026 Zeus PromptKit Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeLibraryList(value) {
  if (value === undefined || value === null || value === false) {
    return '';
  }

  const entries = Array.isArray(value)
    ? value
    : String(value)
      .split(/[\s,]+/)
      .filter(Boolean);

  return entries
    .map((entry) => normalizeIdentifier(entry))
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .join(',');
}

function resolveDefaultSchema(dbConfig) {
  return normalizeIdentifier(
    (dbConfig && (dbConfig.defaultSchema || dbConfig.defaultLibrary || dbConfig.schema || dbConfig.library)) || '',
  );
}

function buildJdbcUrl(dbConfig, defaultSchema) {
  const normalizedDefaultSchema = normalizeIdentifier(defaultSchema);
  const normalizedLibraryList = normalizeLibraryList(dbConfig && dbConfig.libraryList);
  const requestedLibraries = normalizedLibraryList || normalizedDefaultSchema;

  if (dbConfig && dbConfig.url) {
    const baseUrl = String(dbConfig.url).trim();
    if (!baseUrl) {
      return '';
    }
    if (!requestedLibraries) {
      return baseUrl;
    }
    if (/(?:^|;)(libraries|library)\s*=/i.test(baseUrl)) {
      return baseUrl.replace(/(?:^|;)(libraries|library)\s*=[^;]*/i, `;libraries=${requestedLibraries}`);
    }
    return `${baseUrl};libraries=${requestedLibraries}`;
  }

  const host = dbConfig && dbConfig.host ? String(dbConfig.host).trim() : '';
  if (!host) {
    return '';
  }

  const parts = [`jdbc:as400://${host}`, 'naming=system'];
  if (requestedLibraries) {
    parts.push(`libraries=${requestedLibraries}`);
  }
  return parts.join(';');
}

function isDbConfigured(dbConfig) {
  if (!dbConfig || typeof dbConfig !== 'object') {
    return false;
  }

  const hasUrl = Boolean(String(dbConfig.url || '').trim());
  const hasHost = Boolean(String(dbConfig.host || '').trim());
  const hasUser = Boolean(String(dbConfig.user || '').trim());
  const hasPassword = dbConfig.password !== undefined && dbConfig.password !== null;
  return (hasUrl || hasHost) && hasUser && hasPassword;
}

module.exports = {
  normalizeIdentifier,
  normalizeLibraryList,
  resolveDefaultSchema,
  buildJdbcUrl,
  isDbConfigured,
};
