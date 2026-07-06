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
 * PUI Projection — read-only, LOCAL-ONLY analysis view of a ProfoundUI Display
 * File member. It reassembles the column-72 continuation lines (via
 * puiDdsParser), decodes the per-record-format JSON and projects a reviewable
 * structure: grids -> columns -> field bindings + tooltips, plus standalone
 * bound widgets.
 *
 * Privacy boundary: the decoded PUI JSON is customer content. This projection is
 * a local review aid only. It may be exposed through the opt-in `zeus.pui-inspect`
 * MCP tool (requires explicit --allow-tools), but it must never be part of the
 * default MCP-safe surface, a project-neutral catalog, or a shareable bundle.
 */

'use strict';

const { parseDds, parseJsonFromGroup } = require('./puiDdsParser');

const PUI_PROJECTION_KIND = 'zeus-pui-projection';
const PUI_PROJECTION_VERSION = 1;

function toStringValue(value) {
  return typeof value === 'string' ? value : '';
}

function nonEmptyString(value) {
  const str = toStringValue(value).trim();
  return str.length > 0 ? str : null;
}

function normalizeFieldName(value) {
  return toStringValue(value).trim().toUpperCase();
}

function splitCsv(value) {
  const str = toStringValue(value);
  if (!str) {
    return [];
  }
  return str.split(',').map((entry) => entry.trim());
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Finds every JSON segment group in the parsed DDS. ProfoundUI stores one JSON
 * blob per record format, each split across HTML('...') continuation blocks.
 * puiDdsParser exposes only the first group, so we walk the segments and greedily
 * accumulate consecutive HTML segments until a valid JSON object is formed.
 */
function collectJsonGroups(parsed) {
  const groups = [];
  const segments = (parsed && parsed.segments) || [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];
    if (seg.kind !== 'html' || !toStringValue(seg.content).trimStart().startsWith('{')) {
      i += 1;
      continue;
    }

    let combined = '';
    let endIdx = i;
    let parsedOk = false;
    for (let j = i; j < segments.length; j += 1) {
      if (segments[j].kind !== 'html') {
        break;
      }
      combined += toStringValue(segments[j].content);
      endIdx = j;
      try {
        JSON.parse(combined);
        parsedOk = true;
        break;
      } catch (_) {
        // keep collecting
      }
    }

    // Whether or not JSON.parse succeeded, treat the collected span as one group
    // so downstream recovery (control-char sanitization) still gets a chance.
    groups.push({
      segments: segments.slice(i, endIdx + 1),
      startIdx: i,
      endIdx,
      parsedOk,
    });
    i = endIdx + 1;
  }

  return groups;
}

function groupLineRange(group) {
  const first = group.segments[0];
  const last = group.segments[group.segments.length - 1];
  const startLine = (first && Number.isInteger(first.lineIndex) ? first.lineIndex : 0) + 1;
  const lastIndex = last && Number.isInteger(last.lineIndex) ? last.lineIndex : 0;
  const lastCount = last && Number.isInteger(last.lineCount) && last.lineCount > 0 ? last.lineCount : 1;
  const endLine = lastIndex + lastCount;
  return { startLine, endLine };
}

function findItemsArray(json) {
  if (Array.isArray(json && json.items)) {
    return json.items;
  }
  if (isPlainObject(json)) {
    for (const value of Object.values(json)) {
      if (Array.isArray(value) && value.every(isPlainObject)) {
        return value;
      }
      if (isPlainObject(value) && Array.isArray(value.items)) {
        return value.items;
      }
    }
  }
  return [];
}

function resolveRecordFormatName(json, items) {
  const direct = nonEmptyString(json && json['record format name']);
  if (direct) {
    return normalizeFieldName(direct);
  }
  for (const item of items) {
    const name = nonEmptyString(item && item['record format name']);
    if (name) {
      return normalizeFieldName(name);
    }
  }
  return '';
}

function isGrid(item) {
  return isPlainObject(item) && toStringValue(item['field type']).trim().toLowerCase() === 'grid';
}

function isColumnItem(item) {
  return isPlainObject(item)
    && nonEmptyString(item.grid) !== null
    && nonEmptyString(item.column) !== null;
}

function boundFieldOf(item) {
  // Convention A (synthetic/simple): a top-level "field name" key.
  const direct = nonEmptyString(item && item['field name']);
  if (direct) {
    return direct;
  }
  // Convention B (real ProfoundUI): the "value" property is an object that
  // carries the bound DDS field in "fieldName" (alongside dataLength/dataType/
  // designValue). A string "value" is a static literal, not a binding.
  if (isPlainObject(item && item.value)) {
    const fieldName = nonEmptyString(item.value.fieldName);
    if (fieldName) {
      return fieldName;
    }
  }
  // Convention C (real ProfoundUI): input widgets (image / checkbox / radio)
  // bind their DDS field through the "response" property, an object carrying
  // "fieldName" (alongside customTrue/customFalse/dataType/indFormat). These are
  // genuinely bound columns even though they have no display "value" binding.
  if (isPlainObject(item && item.response)) {
    const fieldName = nonEmptyString(item.response.fieldName);
    if (fieldName) {
      return fieldName;
    }
  }
  return null;
}

function tooltipOf(item) {
  return nonEmptyString(item && item.tooltip);
}

function fieldTypeOf(item) {
  return nonEmptyString(item && item['field type']);
}

function staticValueOf(item) {
  // A bound-field descriptor object is not a static literal.
  if (isPlainObject(item && item.value)) {
    return null;
  }
  return nonEmptyString(item && item.value);
}

function gridIdOf(grid) {
  return nonEmptyString(grid && grid.id)
    || nonEmptyString(grid && grid['record format name'])
    || '';
}

function makeEvidence(file, range, text) {
  return {
    file: file || '',
    startLine: range.startLine,
    endLine: range.endLine,
    text,
  };
}

function projectGrid(grid, items, file, range) {
  const gridId = gridIdOf(grid);
  const numberOfColumns = Number.parseInt(toStringValue(grid['number of columns']) || '0', 10) || 0;
  const headings = splitCsv(grid['column headings']);
  const widths = splitCsv(grid['column widths']);

  const columns = [];
  for (let n = 1; n <= numberOfColumns; n += 1) {
    const columnItems = items.filter((item) => isColumnItem(item)
      && nonEmptyString(item.grid) === gridId
      && (Number.parseInt(toStringValue(item.column) || '0', 10) === n));

    let boundField = null;
    let boundFieldType = null;
    let tooltip = null;
    let staticValue = null;
    const itemIds = [];

    for (const item of columnItems) {
      const id = nonEmptyString(item.id);
      if (id) {
        itemIds.push(id);
      }
      if (boundField === null) {
        const candidate = boundFieldOf(item);
        if (candidate) {
          boundField = normalizeFieldName(candidate);
          boundFieldType = fieldTypeOf(item);
        }
      }
      if (tooltip === null) {
        tooltip = tooltipOf(item);
      }
      if (staticValue === null) {
        staticValue = staticValueOf(item);
      }
    }

    columns.push({
      column: n,
      heading: headings.length >= n ? (nonEmptyString(headings[n - 1]) || '') : null,
      width: widths.length >= n ? (nonEmptyString(widths[n - 1]) || '') : null,
      boundField,
      boundFieldType,
      tooltip,
      staticValue,
      itemIds: itemIds.sort((a, b) => a.localeCompare(b)),
    });
  }

  return {
    id: gridId,
    numberOfColumns,
    headingCount: headings.length,
    columns,
    evidence: [makeEvidence(file, range, `grid ${gridId} (${numberOfColumns} columns)`)],
  };
}

function projectWidget(item, file, range) {
  const id = nonEmptyString(item.id) || '';
  const boundField = boundFieldOf(item);
  return {
    id,
    fieldType: fieldTypeOf(item),
    boundField: boundField ? normalizeFieldName(boundField) : null,
    staticValue: staticValueOf(item),
    tooltip: tooltipOf(item),
    evidence: [makeEvidence(file, range, `widget ${id || '(anonymous)'}`)],
  };
}

function buildSignals(recordFormatName, grid) {
  const signals = [];

  if (grid.headingCount > 0 && grid.headingCount !== grid.numberOfColumns) {
    signals.push({
      type: 'HEADING_COLUMN_MISMATCH',
      recordFormat: recordFormatName,
      grid: grid.id,
      detail: `grid "${grid.id}" declares ${grid.numberOfColumns} column(s) but ${grid.headingCount} heading(s)`,
    });
  }

  for (const column of grid.columns) {
    if (column.boundField === null && column.staticValue === null) {
      signals.push({
        type: 'UNBOUND_COLUMN',
        recordFormat: recordFormatName,
        grid: grid.id,
        column: column.column,
        detail: `grid "${grid.id}" column ${column.column}`
          + (column.heading ? ` ("${column.heading}")` : '')
          + ' has no field binding or static value',
      });
    }
  }

  return signals;
}

function projectRecordFormat(group, file) {
  const range = groupLineRange(group);
  const json = parseJsonFromGroup(group);
  if (!json) {
    return {
      recordFormat: '',
      decoded: false,
      startLine: range.startLine,
      endLine: range.endLine,
      grids: [],
      widgets: [],
      signals: [{
        type: 'JSON_DECODE_FAILED',
        recordFormat: '',
        detail: `PUI JSON block at lines ${range.startLine}-${range.endLine} could not be decoded`,
      }],
    };
  }

  const items = findItemsArray(json).filter(isPlainObject);
  const recordFormat = resolveRecordFormatName(json, items);

  const grids = items
    .filter(isGrid)
    .map((grid) => projectGrid(grid, items, file, range))
    .sort((a, b) => a.id.localeCompare(b.id));

  const widgets = items
    .filter((item) => !isGrid(item) && !isColumnItem(item))
    .filter((item) => boundFieldOf(item) !== null || tooltipOf(item) !== null)
    .map((item) => projectWidget(item, file, range))
    .sort((a, b) => a.id.localeCompare(b.id));

  const signals = [];
  for (const grid of grids) {
    signals.push(...buildSignals(recordFormat, grid));
  }

  return {
    recordFormat,
    decoded: true,
    startLine: range.startLine,
    endLine: range.endLine,
    grids,
    widgets,
    signals,
  };
}

function sortSignals(signals) {
  return signals.slice().sort((a, b) => {
    const keyA = `${a.recordFormat}|${a.type}|${a.grid || ''}|${a.column || 0}`;
    const keyB = `${b.recordFormat}|${b.type}|${b.grid || ''}|${b.column || 0}`;
    return keyA.localeCompare(keyB);
  });
}

/**
 * Builds a reviewable projection of a ProfoundUI Display File member.
 * @param {string} content - raw DDS member content
 * @param {{ file?: string }} [options]
 */
function buildPuiProjection(content, options = {}) {
  const file = toStringValue(options.file);
  const parsed = parseDds(String(content || ''));
  const groups = collectJsonGroups(parsed);

  const recordFormats = groups
    .map((group) => projectRecordFormat(group, file))
    .sort((a, b) => {
      if (a.recordFormat === b.recordFormat) {
        return a.startLine - b.startLine;
      }
      return a.recordFormat.localeCompare(b.recordFormat);
    });

  const signals = sortSignals(
    recordFormats.reduce((acc, rf) => acc.concat(rf.signals), []),
  );

  return {
    kind: PUI_PROJECTION_KIND,
    schemaVersion: PUI_PROJECTION_VERSION,
    file,
    recordFormatCount: recordFormats.length,
    recordFormats,
    signals,
  };
}

/**
 * Traces where a given field name is bound in the projection. Answers
 * "is this field actually rendered, and where?".
 * @param {object} projection - result of buildPuiProjection
 * @param {string} fieldName
 * @returns {Array<object>} deterministic list of binding locations
 */
function traceFieldBinding(projection, fieldName) {
  const target = normalizeFieldName(fieldName);
  const hits = [];
  if (!target || !projection || !Array.isArray(projection.recordFormats)) {
    return hits;
  }

  for (const rf of projection.recordFormats) {
    for (const grid of rf.grids || []) {
      for (const column of grid.columns || []) {
        if (column.boundField === target) {
          hits.push({
            recordFormat: rf.recordFormat,
            location: 'grid-column',
            grid: grid.id,
            column: column.column,
            heading: column.heading || null,
            tooltip: column.tooltip || null,
            fieldType: column.boundFieldType || null,
            startLine: rf.startLine,
            endLine: rf.endLine,
          });
        }
      }
    }
    for (const widget of rf.widgets || []) {
      if (widget.boundField === target) {
        hits.push({
          recordFormat: rf.recordFormat,
          location: 'widget',
          widget: widget.id,
          tooltip: widget.tooltip || null,
          fieldType: widget.fieldType || null,
          startLine: rf.startLine,
          endLine: rf.endLine,
        });
      }
    }
  }

  return hits.sort((a, b) => {
    const keyA = `${a.recordFormat}|${a.location}|${a.grid || a.widget || ''}|${a.column || 0}`;
    const keyB = `${b.recordFormat}|${b.location}|${b.grid || b.widget || ''}|${b.column || 0}`;
    return keyA.localeCompare(keyB);
  });
}

module.exports = {
  buildPuiProjection,
  traceFieldBinding,
  collectJsonGroups,
  PUI_PROJECTION_KIND,
  PUI_PROJECTION_VERSION,
};
