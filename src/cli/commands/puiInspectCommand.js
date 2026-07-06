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

/**
 * pui-inspect — LOCAL, read-only review of a ProfoundUI Display File member.
 *
 * Usage:
 *   node cli/zeus.js pui-inspect --file <path> [--json] [--trace <fieldName>]  (global --json normalization supported)
 *
 * Reassembles the column-72 continuation lines, decodes the per-record-format
 * PUI JSON and prints a reviewable projection: grids -> columns -> field
 * bindings + tooltips, standalone bound widgets, and consistency signals.
 *
 * This command reads a LOCAL workspace file only. It never connects to IBM i and
 * never writes. The decoded PUI JSON is customer content and stays local.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildPuiProjection, traceFieldBinding } = require('../../pui/puiProjection');
const { createJsonOutput } = require('../helpers/jsonOutput');

function printProjectionSummary(projection) {
  console.log(`PUI Display File: ${projection.file}`);
  console.log(`Record formats: ${projection.recordFormatCount}`);

  for (const rf of projection.recordFormats) {
    console.log('');
    const rfLabel = rf.recordFormat || '(unnamed)';
    console.log(`Record format ${rfLabel}  [lines ${rf.startLine}-${rf.endLine}]`);
    if (!rf.decoded) {
      console.log('  JSON konnte nicht dekodiert werden.');
      continue;
    }

    if (rf.grids.length === 0) {
      console.log('  (keine Grids)');
    }
    for (const grid of rf.grids) {
      console.log(`  Grid ${grid.id}  (${grid.numberOfColumns} Spalten)`);
      for (const column of grid.columns) {
        const heading = column.heading != null ? column.heading : '';
        const binding = column.boundField || (column.staticValue ? `="${column.staticValue}"` : '(ungebunden)');
        const tooltip = column.tooltip ? `  Tooltip: "${column.tooltip}"` : '';
        console.log(`    Sp ${String(column.column).padStart(2, ' ')} | ${heading.padEnd(20, ' ')} | ${binding}${tooltip}`);
      }
    }

    if (rf.widgets.length > 0) {
      console.log('  Gebundene Widgets:');
      for (const widget of rf.widgets) {
        const binding = widget.boundField || (widget.staticValue ? `="${widget.staticValue}"` : '(ungebunden)');
        const tooltip = widget.tooltip ? `  Tooltip: "${widget.tooltip}"` : '';
        console.log(`    ${(widget.id || '(anonym)').padEnd(24, ' ')} | ${binding}${tooltip}`);
      }
    }
  }

  if (projection.signals.length > 0) {
    console.log('');
    console.log(`Konsistenz-Signale (${projection.signals.length}):`);
    for (const signal of projection.signals) {
      console.log(`  [${signal.type}] ${signal.detail}`);
    }
  } else {
    console.log('');
    console.log('Keine Konsistenz-Signale.');
  }
}

async function run(args) {
  const fileArg = args.file || args.source || args.f;
  if (!fileArg || typeof fileArg !== 'string') {
    console.error('Missing required option: --file <path> (lokaler DDS/PUI-Member)');
    process.exit(2);
  }

  const resolved = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    console.error(`Datei nicht gefunden: ${resolved}`);
    process.exit(2);
  }

  let content;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    console.error(`Datei konnte nicht gelesen werden: ${err.message}`);
    process.exit(2);
  }

  const projection = buildPuiProjection(content, { file: path.relative(process.cwd(), resolved) || fileArg });

  if (args.trace) {
    const hits = traceFieldBinding(projection, String(args.trace));
    if (args.json) {
      const json = createJsonOutput(args);
      json.print({ field: String(args.trace).toUpperCase(), hits });
    } else if (hits.length === 0) {
      console.log(`Feld "${String(args.trace).toUpperCase()}" ist in keiner Grid-Spalte oder Widget-Bindung gefunden.`);
    } else {
      console.log(`Feld "${String(args.trace).toUpperCase()}" gebunden an:`);
      for (const hit of hits) {
        if (hit.location === 'grid-column') {
          const tooltip = hit.tooltip ? `  Tooltip: "${hit.tooltip}"` : '';
          console.log(`  ${hit.recordFormat} / Grid ${hit.grid} / Spalte ${hit.column}${hit.heading ? ` ("${hit.heading}")` : ''}${tooltip}`);
        } else {
          console.log(`  ${hit.recordFormat} / Widget ${hit.widget}`);
        }
      }
    }
    return projection;
  }

  if (args.json) {
    const json = createJsonOutput(args);
    json.print(projection);
    return projection;
  }

  printProjectionSummary(projection);
  return projection;
}

module.exports = { run };
