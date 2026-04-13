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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { version: toolVersion } = require('../../package.json');

const ANALYSIS_ARTIFACT_CACHE_FILE = 'analysis-cache.json';

function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeDbFingerprint(dbConfig) {
  const db = dbConfig && typeof dbConfig === 'object' ? dbConfig : {};
  return {
    host: String(db.host || '').trim(),
    url: String(db.url || '').trim(),
    defaultSchema: String(db.defaultSchema || db.defaultLibrary || db.schema || db.library || '').trim().toUpperCase(),
    user: String(db.user || '').trim().toUpperCase(),
  };
}

function readAnalysisArtifactCache(outputProgramDir) {
  const cachePath = path.join(outputProgramDir, ANALYSIS_ARTIFACT_CACHE_FILE);
  if (!fs.existsSync(cachePath)) {
    return {
      schemaVersion: 1,
      kind: 'analysis-artifact-cache',
      toolVersion,
      artifacts: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid analysis artifact cache');
    }
    return {
      schemaVersion: 1,
      kind: 'analysis-artifact-cache',
      toolVersion: String(parsed.toolVersion || toolVersion),
      artifacts: parsed.artifacts && typeof parsed.artifacts === 'object' ? parsed.artifacts : {},
    };
  } catch (_) {
    return {
      schemaVersion: 1,
      kind: 'analysis-artifact-cache',
      toolVersion,
      artifacts: {},
    };
  }
}

function writeAnalysisArtifactCache(outputProgramDir, cache) {
  const cachePath = path.join(outputProgramDir, ANALYSIS_ARTIFACT_CACHE_FILE);
  const payload = {
    schemaVersion: 1,
    kind: 'analysis-artifact-cache',
    toolVersion,
    artifacts: cache && cache.artifacts ? cache.artifacts : {},
  };
  fs.writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return cachePath;
}

function buildDb2MetadataCacheKey({ program, dependencies, dbConfig }) {
  return hashValue({
    toolVersion,
    kind: 'db2Metadata',
    program: String(program || '').trim().toUpperCase(),
    requestedTables: ((dependencies && dependencies.tables) || [])
      .map((entry) => String(entry && entry.name ? entry.name : entry || '').trim().toUpperCase())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    db: normalizeDbFingerprint(dbConfig),
  });
}

function buildTestDataCacheKey({ program, metadataPayload, dbConfig, testDataConfig }) {
  return hashValue({
    toolVersion,
    kind: 'testData',
    program: String(program || '').trim().toUpperCase(),
    tables: ((metadataPayload && metadataPayload.tables) || [])
      .map((entry) => ({
        schema: String(entry.schema || '').trim().toUpperCase(),
        table: String(entry.table || '').trim().toUpperCase(),
        systemSchema: String(entry.systemSchema || '').trim().toUpperCase(),
        systemName: String(entry.systemName || '').trim().toUpperCase(),
      }))
      .sort((a, b) => {
        if (a.table !== b.table) return a.table.localeCompare(b.table);
        return a.schema.localeCompare(b.schema);
      }),
    rowLimit: Number(testDataConfig && testDataConfig.limit) || 0,
    maskColumns: Array.isArray(testDataConfig && testDataConfig.maskColumns)
      ? testDataConfig.maskColumns.map((entry) => String(entry || '').trim().toUpperCase()).sort((a, b) => a.localeCompare(b))
      : [],
    allowTables: Array.isArray(testDataConfig && testDataConfig.allowTables)
      ? testDataConfig.allowTables.map((entry) => String(entry || '').trim().toUpperCase()).sort((a, b) => a.localeCompare(b))
      : [],
    denyTables: Array.isArray(testDataConfig && testDataConfig.denyTables)
      ? testDataConfig.denyTables.map((entry) => String(entry || '').trim().toUpperCase()).sort((a, b) => a.localeCompare(b))
      : [],
    maskRules: Array.isArray(testDataConfig && testDataConfig.maskRules)
      ? testDataConfig.maskRules.map((entry) => ({
        schema: String(entry && entry.schema || '').trim().toUpperCase(),
        table: String(entry && entry.table || '').trim().toUpperCase(),
        columns: Array.isArray(entry && entry.columns)
          ? entry.columns.map((column) => String(column || '').trim().toUpperCase()).sort((a, b) => a.localeCompare(b))
          : [],
        value: String(entry && entry.value || '').trim(),
      })).sort((a, b) => {
        if (a.table !== b.table) return a.table.localeCompare(b.table);
        if (a.schema !== b.schema) return a.schema.localeCompare(b.schema);
        return a.value.localeCompare(b.value);
      })
      : [],
    db: normalizeDbFingerprint(dbConfig),
  });
}

function readCachedArtifact(outputProgramDir, cache, artifactKind, cacheKey) {
  const record = cache && cache.artifacts && cache.artifacts[artifactKind];
  if (!record || record.cacheKey !== cacheKey) {
    return null;
  }

  const payloadPath = path.join(outputProgramDir, record.payloadFile);
  if (!fs.existsSync(payloadPath)) {
    return null;
  }
  if (record.markdownFile && !fs.existsSync(path.join(outputProgramDir, record.markdownFile))) {
    return null;
  }

  try {
    return {
      summary: record.summary,
      payload: JSON.parse(fs.readFileSync(payloadPath, 'utf8')),
      payloadFile: record.payloadFile,
      markdownFile: record.markdownFile || null,
    };
  } catch (_) {
    return null;
  }
}

function storeCachedArtifact(cache, artifactKind, cacheKey, summary, payloadFile, markdownFile) {
  const next = cache && typeof cache === 'object'
    ? cache
    : {
      schemaVersion: 1,
      kind: 'analysis-artifact-cache',
      toolVersion,
      artifacts: {},
    };
  next.artifacts = next.artifacts && typeof next.artifacts === 'object' ? next.artifacts : {};
  next.artifacts[artifactKind] = {
    cacheKey,
    storedAt: new Date().toISOString(),
    payloadFile,
    markdownFile,
    summary,
  };
  return next;
}

module.exports = {
  ANALYSIS_ARTIFACT_CACHE_FILE,
  buildDb2MetadataCacheKey,
  buildTestDataCacheKey,
  readAnalysisArtifactCache,
  readCachedArtifact,
  storeCachedArtifact,
  writeAnalysisArtifactCache,
};
