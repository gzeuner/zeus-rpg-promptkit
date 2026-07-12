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

const { renderAsciiTable } = require('../helpers/asciiTable');
const { resolveProfileResources } = require('../../config/runtimeConfig');
const { RESOURCE_KINDS } = require('../../config/resourceModel');
const { createJsonOutput } = require('../helpers/jsonOutput');

const KIND_TITLES = Object.freeze({
  sourceCode: 'Source code',
  objects: 'Objects',
  metadata: 'DB metadata',
  data: 'DB data',
});

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '(none)';
  }
  return values.join(', ');
}

function buildResourceRows(model) {
  const rows = [];
  for (const kind of RESOURCE_KINDS) {
    const resource = model.resources[kind] || {};
    const scopeParts = [];
    if (Array.isArray(resource.libraries) && resource.libraries.length > 0) {
      scopeParts.push(`libraries=${resource.libraries.join(',')}`);
    }
    if (Array.isArray(resource.sourceFiles) && resource.sourceFiles.length > 0) {
      scopeParts.push(`sourceFiles=${resource.sourceFiles.join(',')}`);
    }
    if (Array.isArray(resource.members) && resource.members.length > 0) {
      scopeParts.push(`members=${resource.members.join(',')}`);
    }
    if (Array.isArray(resource.ifsPaths) && resource.ifsPaths.length > 0) {
      scopeParts.push(`ifsPaths=${resource.ifsPaths.join(',')}`);
    }
    if (Array.isArray(resource.objectTypes) && resource.objectTypes.length > 0) {
      scopeParts.push(`objectTypes=${resource.objectTypes.join(',')}`);
    }
    if (Array.isArray(resource.schemas) && resource.schemas.length > 0) {
      scopeParts.push(`schemas=${resource.schemas.join(',')}`);
    }
    rows.push([
      KIND_TITLES[kind] || kind,
      resource.system || '(default)',
      resource.target && resource.target.host ? resource.target.host : '(unconfigured)',
      scopeParts.length > 0 ? scopeParts.join('; ') : '(none)',
    ]);
  }
  return rows;
}

async function runResources(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  let result;
  try {
    result = resolveProfileResources(args, { cwd: process.cwd(), env: process.env });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const { model } = result;

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(result);
    return;
  }

  console.log(`Profile: ${result.profile}`);
  console.log(`Configuration: ${result.configSource}`);
  console.log(`Multi-system: ${model.multiSystem ? 'yes' : 'no'}`);
  if (Array.isArray(model.systems) && model.systems.length > 0) {
    console.log(
      `Systems: ${model.systems.map(s => `${s.key}${s.host ? ` (${s.host})` : ''}`).join(', ')}`
    );
  }
  if (!model.hasExplicitResources) {
    console.log(
      'Note: no explicit "resources" block — model derived from fetch/db/dbRoles (backward compatible).'
    );
  }
  console.log('');
  console.log(renderAsciiTable(['Resource', 'System', 'Host', 'Scope'], buildResourceRows(model)));
}

module.exports = { runResources, buildResourceRows };
