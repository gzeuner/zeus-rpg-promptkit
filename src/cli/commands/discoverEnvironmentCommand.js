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

const fs = require('fs');
const path = require('path');
const { renderAsciiTable } = require('../helpers/asciiTable');
const { resolveAnalyzeConfig, resolveAnalyzeDbConfig } = require('../../config/runtimeConfig');
const { isDbConfigured } = require('../../db2/db2Config');
const { printDbRuntimeConflictWarnings } = require('../helpers/runtimeConfigWarnings');
const {
  discoverEnvironment,
  suggestResourcesConfig,
} = require('../../config/environmentDiscoveryService');
const { createJsonOutput } = require('../helpers/jsonOutput');

function parseCsvArg(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap(entry => String(entry).split(','))
    .map(entry => entry.trim())
    .filter(Boolean);
}

function flagEnabled(value) {
  if (value === undefined || value === null) return false;
  if (value === true) return true;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

async function runDiscoverEnvironment(args) {
  if (!args.profile || !String(args.profile).trim()) {
    console.error('Missing required option: --profile <name>');
    process.exit(2);
  }

  let config;
  try {
    config = resolveAnalyzeConfig(args, { cwd: process.cwd(), env: process.env });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const role =
    String(args.role || 'metadata')
      .trim()
      .toLowerCase() === 'data'
      ? 'testData'
      : 'metadata';
  const dbConfig = resolveAnalyzeDbConfig(config, role);
  printDbRuntimeConflictWarnings(dbConfig);
  if (!isDbConfigured(dbConfig)) {
    console.error('DB2 connection configuration is incomplete for the selected profile.');
    console.error(
      'Discovery is read-only and requires DB2 catalog (QSYS2) access. Load the environment first.'
    );
    process.exit(2);
  }

  const scope = {
    libraries: parseCsvArg(args.libraries),
    schemas: parseCsvArg(args.schemas),
    includeMembers: flagEnabled(args['include-members']),
  };
  const options = {
    includeMembers: flagEnabled(args['include-members']),
    includeTables: !flagEnabled(args['no-tables']),
  };

  let report;
  try {
    report = await discoverEnvironment({ dbConfig, scope, options });
  } catch (error) {
    console.error(`Environment discovery failed: ${error.message}`);
    process.exit(2);
  }

  const system = args.system ? String(args.system).trim() : '';
  const skeleton = suggestResourcesConfig(report, { system });
  const output = {
    profile: String(args.profile).trim(),
    report,
    suggestedResources: skeleton,
  };

  const json = createJsonOutput(args);
  if (json.isJsonMode) {
    json.print(output);
  } else {
    console.log(`Environment discovery (read-only) for profile: ${output.profile}`);
    console.log(`Target: ${report.target.host || '(unknown host)'}`);
    console.log('');
    console.log(
      `Schemas/libraries (${report.schemas.length}): ${report.schemas.join(', ') || '(none)'}`
    );
    console.log('');
    if (report.sourceFiles.length > 0) {
      console.log('Source files:');
      console.log(
        renderAsciiTable(
          ['Library', 'Source file', 'Text'],
          report.sourceFiles.map(entry => [entry.schema, entry.name, entry.text || ''])
        )
      );
    }
    if (report.tables.length > 0) {
      console.log(`Application tables (${report.tables.length}, showing up to 25):`);
      console.log(
        renderAsciiTable(
          ['Schema', 'Table', 'Type'],
          report.tables.slice(0, 25).map(entry => [entry.schema, entry.name, entry.type || ''])
        )
      );
    }
    if (report.members.length > 0) {
      console.log(`Source members (${report.members.length}, showing up to 25):`);
      console.log(
        renderAsciiTable(
          ['Library', 'Source file', 'Member'],
          report.members.slice(0, 25).map(entry => [entry.schema, entry.sourceFile, entry.name])
        )
      );
    }
    for (const note of report.notes) {
      console.log(`Note: ${note}`);
    }
    console.log('');
    console.log('Suggested "resources" block (paste into the profile and refine):');
    console.log(JSON.stringify({ resources: skeleton }, null, 2));
  }

  if (args.out) {
    const outPath = path.resolve(process.cwd(), String(args.out).trim());
    try {
      const written = json.writeFile(outPath, output);
      if (written) {
        console.log(`Saved discovery report + suggested resources to: ${written}`);
      }
    } catch (error) {
      console.error(`Failed to write output file: ${error.message}`);
      process.exit(2);
    }
  }
}

module.exports = { runDiscoverEnvironment };
