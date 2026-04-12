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
const path = require('path');

const SOURCE_TYPE_BY_EXTENSION = Object.freeze({
  '.rpg': 'RPG',
  '.rpgle': 'RPGLE',
  '.sqlrpgle': 'SQLRPGLE',
  '.rpgile': 'RPGILE',
  '.clp': 'CLP',
  '.clle': 'CLLE',
  '.dds': 'DDS',
  '.dspf': 'DSPF',
  '.prtf': 'PRTF',
  '.pf': 'PF',
  '.lf': 'LF',
  '.bnd': 'BND',
  '.binder': 'BINDER',
  '.bndsrc': 'BNDSRC',
});

function normalizeSourceType(value) {
  return String(value || '').trim().toUpperCase();
}

function classifySourceFile(filePath, explicitSourceType = '') {
  const normalizedExplicit = normalizeSourceType(explicitSourceType);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SOURCE_TYPE_BY_EXTENSION[ext] || 'UNKNOWN';
}

function sourceTypeFamily(sourceType) {
  const normalized = normalizeSourceType(sourceType);
  if (['RPG', 'RPGLE', 'SQLRPGLE', 'RPGILE', 'BND', 'BINDER', 'BNDSRC'].includes(normalized)) {
    return 'RPG';
  }
  if (['CLP', 'CLLE'].includes(normalized)) {
    return 'CL';
  }
  if (['DDS', 'DSPF', 'PRTF', 'PF', 'LF'].includes(normalized)) {
    return 'DDS';
  }
  return 'UNKNOWN';
}

function summarizeSourceTypes(entries) {
  const byType = {};
  const byFamily = {};

  for (const entry of entries || []) {
    const sourceType = normalizeSourceType(entry && entry.sourceType);
    const family = sourceTypeFamily(sourceType);
    if (!sourceType) {
      continue;
    }
    byType[sourceType] = (byType[sourceType] || 0) + 1;
    byFamily[family] = (byFamily[family] || 0) + 1;
  }

  return {
    byType: Object.fromEntries(Object.entries(byType).sort((a, b) => a[0].localeCompare(b[0]))),
    byFamily: Object.fromEntries(Object.entries(byFamily).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

module.exports = {
  classifySourceFile,
  normalizeSourceType,
  sourceTypeFamily,
  summarizeSourceTypes,
};
