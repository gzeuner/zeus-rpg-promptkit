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

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const STORE_SCHEMA_VERSION = 1;

function normalizeString(value, fallback = '') {
  const normalized = String(value === undefined || value === null ? '' : value).trim();
  return normalized || fallback;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function normalizeFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeTemplateStorePath(templateStorePath, cwd = process.cwd()) {
  const provided = normalizeString(templateStorePath);
  if (!provided) {
    return path.resolve(cwd, 'config', 'local-only', 'prompt-workbench', 'templates.json');
  }
  return path.resolve(cwd, provided);
}

function ensureStoreDirectory(templateStorePath) {
  const directory = path.dirname(path.resolve(templateStorePath));
  fs.mkdirSync(directory, { recursive: true });
}

function buildEmptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    templates: [],
  };
}

function readTemplateStore(templateStorePath) {
  const resolvedPath = path.resolve(templateStorePath);
  if (!fs.existsSync(resolvedPath)) {
    return buildEmptyStore();
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid prompt template store payload: ${resolvedPath}`);
  }

  if (!Array.isArray(parsed.templates)) {
    throw new Error(`Invalid prompt template store templates array: ${resolvedPath}`);
  }

  return {
    schemaVersion: Number(parsed.schemaVersion) || STORE_SCHEMA_VERSION,
    templates: parsed.templates,
  };
}

function writeTemplateStore(templateStorePath, store) {
  ensureStoreDirectory(templateStorePath);
  const payload = {
    schemaVersion: STORE_SCHEMA_VERSION,
    templates: Array.isArray(store.templates) ? store.templates : [],
  };
  fs.writeFileSync(path.resolve(templateStorePath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function sanitizeTemplateName(name) {
  const normalized = normalizeString(name);
  if (!normalized) {
    throw new Error('Prompt template name is required.');
  }
  if (normalized.length > 120) {
    throw new Error('Prompt template name exceeds 120 characters.');
  }
  return normalized;
}

function sanitizeTemplatePayload(input = {}) {
  const name = sanitizeTemplateName(input.name);
  const description = normalizeString(input.description);
  const useCaseId = normalizeString(input.useCaseId);
  if (!useCaseId) {
    throw new Error('Prompt template useCaseId is required.');
  }

  const moduleIds = normalizeArray(input.moduleIds);
  if (moduleIds.length === 0) {
    throw new Error('Prompt template requires at least one moduleId.');
  }

  return {
    name,
    description,
    useCaseId,
    moduleIds,
    fields: normalizeFields(input.fields),
    additionalRequirements: normalizeString(input.additionalRequirements),
    tags: normalizeArray(input.tags),
  };
}

function createTemplateId(name) {
  const base = normalizeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'prompt-template';
  const suffix = randomUUID().split('-')[0];
  return `${base}-${suffix}`;
}

function summarizeTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    useCaseId: template.useCaseId,
    moduleIds: [...template.moduleIds],
    tags: [...(template.tags || [])],
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function listTemplates(templateStorePath) {
  const store = readTemplateStore(templateStorePath);
  return store.templates
    .map((entry) => summarizeTemplate(entry))
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return left.name.localeCompare(right.name);
    });
}

function readTemplate(templateStorePath, templateId) {
  const normalizedId = normalizeString(templateId);
  if (!normalizedId) {
    throw new Error('Template id is required.');
  }
  const store = readTemplateStore(templateStorePath);
  const entry = store.templates.find((template) => template.id === normalizedId);
  if (!entry) {
    throw new Error(`Prompt template not found: ${normalizedId}`);
  }
  return {
    ...entry,
    moduleIds: [...(entry.moduleIds || [])],
    fields: normalizeFields(entry.fields),
    tags: normalizeArray(entry.tags),
  };
}

function createTemplate(templateStorePath, input = {}) {
  const store = readTemplateStore(templateStorePath);
  const payload = sanitizeTemplatePayload(input);
  const now = new Date().toISOString();
  const entry = {
    id: createTemplateId(payload.name),
    ...payload,
    createdAt: now,
    updatedAt: now,
  };
  store.templates.push(entry);
  writeTemplateStore(templateStorePath, store);
  return readTemplate(templateStorePath, entry.id);
}

function updateTemplate(templateStorePath, templateId, input = {}) {
  const normalizedId = normalizeString(templateId);
  if (!normalizedId) {
    throw new Error('Template id is required.');
  }

  const store = readTemplateStore(templateStorePath);
  const index = store.templates.findIndex((entry) => entry.id === normalizedId);
  if (index < 0) {
    throw new Error(`Prompt template not found: ${normalizedId}`);
  }

  const payload = sanitizeTemplatePayload(input);
  const current = store.templates[index];
  store.templates[index] = {
    ...current,
    ...payload,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  writeTemplateStore(templateStorePath, store);
  return readTemplate(templateStorePath, normalizedId);
}

function deleteTemplate(templateStorePath, templateId) {
  const normalizedId = normalizeString(templateId);
  if (!normalizedId) {
    throw new Error('Template id is required.');
  }

  const store = readTemplateStore(templateStorePath);
  const index = store.templates.findIndex((entry) => entry.id === normalizedId);
  if (index < 0) {
    throw new Error(`Prompt template not found: ${normalizedId}`);
  }

  const [removed] = store.templates.splice(index, 1);
  writeTemplateStore(templateStorePath, store);
  return summarizeTemplate(removed);
}

module.exports = {
  STORE_SCHEMA_VERSION,
  createTemplate,
  deleteTemplate,
  listTemplates,
  normalizeTemplateStorePath,
  readTemplate,
  readTemplateStore,
  summarizeTemplate,
  updateTemplate,
  writeTemplateStore,
};
