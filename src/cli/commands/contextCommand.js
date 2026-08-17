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
'use strict';

const {
  RESOURCE_KINDS,
  buildWorkingContextView,
  clearWorkingContext,
  setWorkingContext,
} = require('../../context/workingContext');
const { createJsonOutput } = require('../helpers/jsonOutput');

function value(args, ...keys) {
  for (const key of keys) {
    if (args && args[key] !== undefined && args[key] !== true && args[key] !== '') {
      return args[key];
    }
  }
  return undefined;
}

function buildPatch(args) {
  const patch = {};
  const activeKind = value(args, 'active', 'active-kind', 'kind');
  if (activeKind !== undefined) {
    const normalized = String(activeKind).trim();
    if (!RESOURCE_KINDS.includes(normalized)) {
      throw new Error(`Invalid --active value. Use: ${RESOURCE_KINDS.join(', ')}`);
    }
    patch.activeKind = normalized;
  }

  const profile = value(args, 'profile');
  if (profile !== undefined) patch.profile = String(profile).trim();

  const sourceCode = {};
  const sourceFields = [
    ['system', ['system', 'source-system']],
    ['profile', ['source-profile']],
    ['library', ['source-library', 'source-lib', 'lib']],
    ['sourceFile', ['source-file', 'file']],
    ['member', ['member', 'program']],
    ['localRoot', ['source-root', 'local-root', 'out']],
    ['path', ['path', 'source-path', 'local-path']],
    ['ifsPath', ['ifs-path', 'ifs-dir']],
  ];
  for (const [field, keys] of sourceFields) {
    const entry = value(args, ...keys);
    if (entry !== undefined) sourceCode[field] = String(entry).trim();
  }
  if (Object.keys(sourceCode).length > 0) patch.resources = { sourceCode };

  const genericSystem = value(args, 'system');
  const selectedKind = patch.activeKind || 'sourceCode';
  if (genericSystem !== undefined && selectedKind !== 'sourceCode') {
    patch.resources = {
      ...(patch.resources || {}),
      [selectedKind]: {
        ...((patch.resources && patch.resources[selectedKind]) || {}),
        system: String(genericSystem).trim(),
      },
    };
  }

  for (const kind of ['objects', 'metadata', 'data']) {
    const resource = {};
    const prefix = kind === 'metadata' ? 'metadata' : kind === 'data' ? 'data' : 'object';
    const system = value(args, `${prefix}-system`);
    const profileValue = value(args, `${prefix}-profile`);
    const library = value(args, `${prefix}-library`);
    const schema = value(args, `${prefix}-schema`);
    const table = value(args, `${prefix}-table`);
    const objectType = value(args, 'object-type');
    const objectName = value(args, 'object-name');
    if (system !== undefined) resource.system = String(system).trim();
    if (profileValue !== undefined) resource.profile = String(profileValue).trim();
    if (library !== undefined) resource.library = String(library).trim();
    if (schema !== undefined) resource.schema = String(schema).trim();
    if (table !== undefined) resource.table = String(table).trim();
    if (objectType !== undefined && kind === 'objects')
      resource.objectType = String(objectType).trim();
    if (objectName !== undefined && kind === 'objects')
      resource.objectName = String(objectName).trim();
    if (Object.keys(resource).length > 0) {
      patch.resources = { ...(patch.resources || {}), [kind]: resource };
    }
  }
  return patch;
}

function renderContext(view) {
  const active = view.active || {};
  console.log('Working context (workspace-local, no credentials):');
  console.log(`  Active resource: ${view.activeKind}`);
  console.log(`  Default profile: ${view.profile || '(none)'}`);
  console.log(
    `  Active selection: ${active.system || '(system unset)'} / ${active.library || active.schema || '(library/schema unset)'} / ${active.sourceFile || active.table || '(file/table unset)'} / ${active.member || '(member unset)'}`
  );
  for (const kind of RESOURCE_KINDS) {
    const resource = view.resources[kind] || {};
    const parts = Object.entries(resource)
      .filter(([, item]) => item !== null && item !== '')
      .map(([key, item]) => `${key}=${item}`);
    console.log(`  ${kind}: ${parts.length > 0 ? parts.join(', ') : '(unset)'}`);
  }
  console.log('  Precedence: explicit command arguments > working context > profile defaults.');
  console.log(`  State file: ${view.storagePath || view.control.storage}`);
}

async function runContext(args = {}) {
  const subcommand = Array.isArray(args._) && args._[0] ? String(args._[0]).toLowerCase() : 'show';
  const cwd = process.cwd();
  let view;

  try {
    if (subcommand === 'show' || subcommand === 'get') {
      view = buildWorkingContextView({ cwd, includeStoragePath: true });
    } else if (subcommand === 'set' || subcommand === 'update') {
      view = buildWorkingContextView({ cwd, includeStoragePath: true });
      const result = setWorkingContext({ cwd, patch: buildPatch(args), actor: 'cli' });
      view = {
        ...buildWorkingContextView({ cwd, includeStoragePath: true }),
        storagePath: result.storagePath,
      };
    } else if (subcommand === 'clear' || subcommand === 'reset') {
      const result = clearWorkingContext({ cwd, actor: 'cli' });
      view = {
        ...buildWorkingContextView({ cwd, includeStoragePath: true }),
        storagePath: result.storagePath,
      };
    } else {
      throw new Error('Unknown context action. Use show, set, or clear.');
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(view);
    return view;
  }
  renderContext(view);
  return view;
}

module.exports = { runContext, buildPatch, renderContext };
