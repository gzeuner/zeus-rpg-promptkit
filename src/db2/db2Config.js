/*
Copyright 2026 Guido Zeuner

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

function resolveDefaultSchema(dbConfig) {
  return normalizeIdentifier(
    (dbConfig && (dbConfig.defaultSchema || dbConfig.defaultLibrary || dbConfig.schema || dbConfig.library)) || '',
  );
}

function buildJdbcUrl(dbConfig, defaultSchema) {
  if (dbConfig && dbConfig.url) {
    return String(dbConfig.url).trim();
  }

  const host = dbConfig && dbConfig.host ? String(dbConfig.host).trim() : '';
  if (!host) {
    return '';
  }

  const parts = [`jdbc:as400://${host}`, 'naming=system'];
  if (defaultSchema) {
    parts.push(`libraries=${defaultSchema}`);
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
  resolveDefaultSchema,
  buildJdbcUrl,
  isDbConfigured,
};
