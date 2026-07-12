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
 * puiEditService — pure orchestration for ProfoundUI Display File editing.
 *
 * This module contains the action logic shared by the `pui-edit` CLI command
 * and the `zeus.pui-edit` MCP tool. It performs no console output and never
 * calls process.exit; every action returns a structured result:
 *
 *   {
 *     ok: boolean,            // false signals a non-fatal failure (e.g. roundtrip mismatch)
 *     action: string,
 *     file: string|null,      // absolute path of the edited member (null for validate-json)
 *     messages: string[],     // human-readable stdout lines
 *     warnings: string[],     // human-readable stderr lines
 *     writes: string[],       // absolute paths of files written (incl. backups)
 *     data: object,           // action-specific structured payload
 *   }
 *
 * Argument errors throw an Error with `.code = 'PUI_EDIT_INVALID'`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  parseDds,
  serializeDds,
  findJsonSegmentGroup,
  parseJsonFromGroup,
  serializeJsonToGroup,
} = require('./puiDdsParser');
const { applyChangeSetToJson, cloneJson, normalizeChangeSet } = require('./puiEditEngine');
const { buildPuiDddlPayloadV1, parsePuiDddlPayload } = require('./puiDddl');

const READ_ONLY_ACTIONS = Object.freeze(['roundtrip-check', 'dump-json', 'validate-json', 'plan']);
const WRITE_ACTIONS = Object.freeze(['export-json', 'import-json', 'apply', 'grid-add-column']);
const ALL_ACTIONS = Object.freeze([...READ_ONLY_ACTIONS, ...WRITE_ACTIONS]);

function invalid(message) {
  const error = new Error(message);
  error.code = 'PUI_EDIT_INVALID';
  return error;
}

function resolvePath(cwd, rawValue) {
  return path.resolve(cwd || process.cwd(), String(rawValue));
}

function createResult(action, file) {
  return {
    ok: true,
    action,
    file: file || null,
    messages: [],
    warnings: [],
    writes: [],
    data: {},
  };
}

/**
 * Executes a pui-edit action and returns a structured result.
 * @param {object} args  CLI/MCP-style argument object.
 * @param {object} [options]
 * @param {string} [options.cwd] Base directory for resolving relative paths.
 * @param {boolean} [options.allowWrites] When false, mutating actions are rejected.
 */
function executePuiEdit(args = {}, options = {}) {
  const cwd = options.cwd || process.cwd();
  const allowWrites = options.allowWrites !== false;

  const action = args.action || args.a;
  if (!action) {
    throw invalid(
      '--action is required (roundtrip-check | dump-json | validate-json | export-json | import-json | plan | apply | grid-add-column)'
    );
  }
  if (!ALL_ACTIONS.includes(action)) {
    throw invalid(`Unknown action: ${action}. Allowed: ${ALL_ACTIONS.join(', ')}`);
  }
  if (!allowWrites && WRITE_ACTIONS.includes(action)) {
    const error = new Error(
      `Action "${action}" is a write operation and is not permitted in this context.`
    );
    error.code = 'PUI_EDIT_WRITE_BLOCKED';
    throw error;
  }

  // validate-json operates purely on the --in payload, no DDS member needed.
  if (action === 'validate-json') {
    return actionValidateJson(args, cwd);
  }

  const file = args.file || args.f;
  if (!file) {
    throw invalid('--file is required');
  }
  const filePath = resolvePath(cwd, file);
  if (!fs.existsSync(filePath)) {
    throw invalid(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDds(content);

  switch (action) {
    case 'roundtrip-check':
      return actionRoundtripCheck(parsed, content, filePath);
    case 'dump-json':
      return actionDumpJson(parsed, filePath);
    case 'export-json':
      return actionExportJson(parsed, args, filePath, cwd);
    case 'import-json':
      return actionImportJson(parsed, args, filePath, cwd);
    case 'plan':
      return actionChangeSetPreview(parsed, args, filePath, cwd);
    case 'apply':
      return actionChangeSetApply(parsed, args, filePath, cwd);
    case 'grid-add-column':
      return actionGridAddColumn(parsed, args, filePath);
    default:
      // Unreachable: action membership validated above.
      throw invalid(`Unknown action: ${action}`);
  }
}

// ─── Action: Roundtrip-Check ────────────────────────────────────────────────

function actionRoundtripCheck(parsed, original, filePath) {
  const result = createResult('roundtrip-check', filePath);
  const serialized = serializeDds(parsed);
  const normalizedOriginal = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const htmlBlocks = parsed.segments.filter(s => s.kind === 'html').length;

  if (serialized === normalizedOriginal) {
    result.messages.push('OK Roundtrip — output is identical to input');
    result.messages.push(`  Segments: ${parsed.segments.length}`);
    result.messages.push(`  HTML blocks: ${htmlBlocks}`);
    result.data = {
      roundtrip: true,
      segmentCount: parsed.segments.length,
      htmlBlockCount: htmlBlocks,
    };
    return result;
  }

  const origLines = normalizedOriginal.split('\n');
  const outLines = serialized.split('\n');
  let firstDiff = -1;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if (origLines[i] !== outLines[i]) {
      firstDiff = i;
      break;
    }
  }

  result.ok = false;
  result.warnings.push('FAIL Roundtrip — output differs');
  if (firstDiff >= 0) {
    result.warnings.push(`  First differing line: ${firstDiff + 1}`);
    result.warnings.push(`  Original: |${origLines[firstDiff]}|`);
    result.warnings.push(`  Output:   |${outLines[firstDiff]}|`);
  }
  result.data = {
    roundtrip: false,
    segmentCount: parsed.segments.length,
    htmlBlockCount: htmlBlocks,
    firstDiffLine: firstDiff >= 0 ? firstDiff + 1 : null,
  };
  return result;
}

// ─── Action: dump JSON ──────────────────────────────────────────────────────

function actionDumpJson(parsed, filePath) {
  const result = createResult('dump-json', filePath);
  const { obj } = readJsonFromParsed(parsed);
  result.data = { json: obj };
  result.messages.push(JSON.stringify(obj, null, 2));
  return result;
}

function actionValidateJson(args, cwd) {
  const result = createResult('validate-json', null);
  const inPath = args.in || args.input || args['json-file'];
  if (!inPath) {
    throw invalid('--in is required for --action validate-json');
  }

  const resolvedInput = resolvePath(cwd, inPath);
  if (!fs.existsSync(resolvedInput)) {
    throw invalid(`Input file not found: ${resolvedInput}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  const parsedDddl = parsePuiDddlPayload(payload, {
    strict: true,
    allowMigration: true,
  });

  if (parsedDddl.recognized) {
    if (!parsedDddl.validation.valid) {
      throw invalid(`Invalid DDDL format: ${parsedDddl.validation.errors.join('; ')}`);
    }
    result.messages.push(`Valid DDDL (${parsedDddl.payload.kind} v${parsedDddl.payload.version})`);
    const migrations = parsedDddl.migrations.length > 0 ? parsedDddl.migrations : [];
    if (migrations.length > 0) {
      result.messages.push(`Applied migrations: ${migrations.join(', ')}`);
    } else {
      result.messages.push('Applied migrations: none');
    }
    result.data = {
      valid: true,
      kind: parsedDddl.payload.kind,
      version: parsedDddl.payload.version,
      migrations,
      inputPath: resolvedInput,
    };
    return result;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalid('JSON file must be either a valid DDDL object or a PUI root object.');
  }

  result.messages.push('Valid plain PUI JSON object');
  result.data = { valid: true, kind: 'pui-json', inputPath: resolvedInput };
  return result;
}

function actionExportJson(parsed, args, filePath, cwd) {
  const result = createResult('export-json', filePath);
  const outPath = args.out || args.output;
  if (!outPath) {
    throw invalid('--out is required for --action export-json');
  }
  const { group, obj, compactSource } = readJsonFromParsed(parsed);
  const format = String(args.format || 'pretty')
    .trim()
    .toLowerCase();
  const resolvedOutput = resolvePath(cwd, outPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

  let payload;
  if (format === 'pretty') {
    payload = JSON.stringify(obj, null, 2);
  } else if (format === 'compact') {
    payload = JSON.stringify(obj);
  } else if (format === 'dddl') {
    payload = JSON.stringify(
      buildDddlPayload({
        filePath,
        group,
        obj,
        compactSource,
      }),
      null,
      2
    );
  } else {
    throw invalid('--format must be pretty, compact or dddl');
  }

  fs.writeFileSync(resolvedOutput, `${payload}\n`, 'utf8');
  result.writes.push(resolvedOutput);
  result.messages.push(`Export written: ${resolvedOutput}`);
  result.messages.push(`Format: ${format}`);
  result.data = { format, outputPath: resolvedOutput };
  return result;
}

function actionImportJson(parsed, args, filePath, cwd) {
  const result = createResult('import-json', filePath);
  const inPath = args.in || args.input || args['json-file'];
  if (!inPath) {
    throw invalid('--in is required for --action import-json');
  }
  const confirm = parseBoolean(args.confirm || args.yes || args.write, false);
  if (!confirm) {
    throw invalid('--action import-json requires --confirm.');
  }

  const resolvedInput = resolvePath(cwd, inPath);
  if (!fs.existsSync(resolvedInput)) {
    throw invalid(`Input file not found: ${resolvedInput}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  const importedJson = unwrapImportedPuiJson(payload);
  if (!importedJson || typeof importedJson !== 'object' || Array.isArray(importedJson)) {
    throw invalid('Import JSON must be an object (PUI root object).');
  }

  const group = findJsonSegmentGroup(parsed);
  if (!group) {
    throw invalid('No JSON segment found in the file');
  }
  serializeJsonToGroup(parsed, group, importedJson);
  const output = serializeDds(parsed);
  writeDisplayWithBackup(filePath, output, result);
  result.messages.push(`PUI JSON imported from: ${resolvedInput}`);
  result.data = { inputPath: resolvedInput };
  return result;
}

function buildDddlPayload({ filePath, group, obj, compactSource }) {
  return buildPuiDddlPayloadV1({
    filePath,
    group,
    puiJson: obj,
    compactSource,
  });
}

function unwrapImportedPuiJson(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const parsedDddl = parsePuiDddlPayload(payload, {
    strict: true,
    allowMigration: true,
  });
  if (parsedDddl.recognized) {
    if (!parsedDddl.validation.valid) {
      throw invalid(`Invalid DDDL format: ${parsedDddl.validation.errors.join('; ')}`);
    }
    return parsedDddl.payload.puiJson;
  }
  return payload;
}

function readJsonFromParsed(parsed) {
  const group = findJsonSegmentGroup(parsed);
  if (!group) {
    throw invalid('No JSON segment found');
  }
  const compactSource = group.segments.map(s => s.content).join('');
  const obj = parseJsonFromGroup(group);
  if (!obj) {
    throw invalid(`JSON parsing failed. Segment preview: ${compactSource.slice(0, 200)}`);
  }
  return { group, obj, compactSource };
}

function writeDisplayWithBackup(filePath, output, result) {
  const backupPath = filePath + '.bak';
  fs.copyFileSync(filePath, backupPath);
  result.writes.push(backupPath);
  result.messages.push(`Backup created: ${backupPath}`);
  fs.writeFileSync(filePath, output, 'utf8');
  result.writes.push(filePath);
  result.messages.push(`File updated: ${filePath}`);
}

// ─── Action: Change-Set preview / apply ─────────────────────────────────────

function actionChangeSetPreview(parsed, args, filePath, cwd) {
  const result = createResult('plan', filePath);
  const changeSet = resolveChangeSet(args, cwd);
  const preview = buildChangeSetPreview(parsed, changeSet);
  fillChangeSetMessages(result, preview, filePath, false);
  return result;
}

function actionChangeSetApply(parsed, args, filePath, cwd) {
  const result = createResult('apply', filePath);
  const confirm = parseBoolean(args.confirm || args.yes || args.write, false);
  if (!confirm) {
    throw invalid('--action apply requires --confirm. Use --action plan for a preview.');
  }

  const changeSet = resolveChangeSet(args, cwd);
  const preview = buildChangeSetPreview(parsed, changeSet);
  fillChangeSetMessages(result, preview, filePath, true);

  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) {
    throw invalid('No JSON segment found in the file');
  }

  serializeJsonToGroup(parsed, jsonGroup, preview.after);
  const output = serializeDds(parsed);
  writeDisplayWithBackup(filePath, output, result);
  return result;
}

function buildChangeSetPreview(parsed, changeSet) {
  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) {
    throw invalid('No JSON segment found in the file');
  }

  const { obj: json } = readJsonFromParsed(parsed);

  const workingCopy = cloneJson(json);
  const applied = applyChangeSetToJson(workingCopy, changeSet);
  return {
    after: workingCopy,
    applied,
    description: changeSet.description || '',
    operationCount: applied.operationCount,
  };
}

function fillChangeSetMessages(result, preview, filePath, applied) {
  if (preview.description) {
    result.messages.push(`Change set: ${preview.description}`);
  }
  result.messages.push(`File: ${filePath}`);
  result.messages.push(`Operations: ${preview.operationCount}`);
  for (const line of preview.applied.summaryLines) {
    result.messages.push(`  ${line}`);
  }
  if (!applied) {
    result.messages.push(
      'Preview created. Use --confirm with --action apply to write the changes.'
    );
  }
  result.data = {
    description: preview.description,
    operationCount: preview.operationCount,
    summaryLines: Array.isArray(preview.applied.summaryLines)
      ? preview.applied.summaryLines.slice()
      : [],
    applied,
  };
}

function resolveChangeSet(args, cwd) {
  const changeSetPath = args['changes-file'] || args['change-file'] || args['change-spec'];
  if (!changeSetPath) {
    throw invalid('--changes-file is required for --action plan and --action apply');
  }

  const resolvedPath = resolvePath(cwd, changeSetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw invalid(`Change-set file not found: ${resolvedPath}`);
  }

  const changeSet = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  return normalizeChangeSet(changeSet);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
}

// ─── Action: insert grid column ─────────────────────────────────────────────

function actionGridAddColumn(parsed, args, filePath) {
  const result = createResult('grid-add-column', filePath);
  const gridId = args['grid-id'];
  const colPos = parseInt(args['col-position'], 10);
  const colHeading = args['col-heading'];
  const colWidth = parseInt(args['col-width'], 10);
  const fieldId = args['field-id'];
  const fieldName = args['field-name'];
  const fieldType = args['field-type'] || 'output field';
  const fieldDataType = args['field-data-type'] || 'char';
  const fieldLength = parseInt(args['field-length'] || '10', 10);
  const fieldWidth = args['field-width'] || '100px';
  const sflFields = args['sfl-field']
    ? Array.isArray(args['sfl-field'])
      ? args['sfl-field']
      : [args['sfl-field']]
    : [];
  const sflRecord = args['sfl-record'] ? String(args['sfl-record']).trim() : '';
  const autoAdjust = !args['no-auto-adjust'];
  const confirm = parseBoolean(args.confirm || args.yes || args.write, false);

  if (!gridId || isNaN(colPos) || !colHeading || isNaN(colWidth) || !fieldId || !fieldName) {
    throw invalid(
      'grid-add-column requires: --grid-id, --col-position, --col-heading, --col-width, --field-id, --field-name and --confirm to write'
    );
  }

  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) throw invalid('No JSON segment found in the file');

  const { obj: json } = readJsonFromParsed(parsed);

  const grid = (json.items || []).find(item => item.id === gridId);
  if (!grid) {
    throw invalid(
      `Grid element "${gridId}" not found. Available IDs: ${(json.items || []).map(i => i.id).join(', ')}`
    );
  }

  const oldCount = parseInt(grid['number of columns'] || '0', 10);
  grid['number of columns'] = String(oldCount + 1);

  const widths = (grid['column widths'] || '').split(',');
  widths.splice(colPos, 0, String(colWidth));
  grid['column widths'] = widths.join(',');

  const headings = (grid['column headings'] || '').split(',');
  headings.splice(colPos, 0, colHeading);
  grid['column headings'] = headings.join(',');

  for (const item of json.items || []) {
    if (item.grid === gridId && item.column !== undefined) {
      const colNum = parseInt(item.column, 10);
      if (!isNaN(colNum) && colNum >= colPos) {
        item.column = String(colNum + 1);
      }
    }
  }

  let autoAdjustLog = [];
  if (autoAdjust) {
    autoAdjustLog = autoAdjustLayout(json, gridId, colWidth);
    for (const line of autoAdjustLog) result.messages.push(`  Auto-Adjust: ${line}`);
  }

  const newFieldDef = buildFieldDefinition(
    fieldId,
    fieldName,
    fieldType,
    fieldDataType,
    fieldLength,
    fieldWidth,
    gridId,
    colPos
  );
  const lastGridItemIdx = (() => {
    let last = -1;
    for (let i = 0; i < json.items.length; i++) {
      if (json.items[i].grid === gridId) last = i;
    }
    return last;
  })();
  if (lastGridItemIdx >= 0) {
    json.items.splice(lastGridItemIdx + 1, 0, newFieldDef);
  } else {
    json.items.push(newFieldDef);
  }

  serializeJsonToGroup(parsed, jsonGroup, json);

  let sflInserted = 0;
  if (sflFields.length > 0) {
    sflInserted = insertSflFields(parsed, sflFields, sflRecord, result);
  }

  const output = serializeDds(parsed);

  result.data = {
    gridId,
    colPosition: colPos,
    columnHeading: colHeading,
    oldColumnCount: oldCount,
    newColumnCount: oldCount + 1,
    autoAdjusted: autoAdjust,
    autoAdjustLog,
    sflFieldsInserted: sflInserted,
    written: confirm,
  };

  if (!confirm) {
    result.messages.push('Preview created. Use --confirm to write the file.');
    return result;
  }

  writeDisplayWithBackup(filePath, output, result);
  result.messages.push(
    `Column "${colHeading}" inserted at position ${colPos} (${oldCount} -> ${oldCount + 1} columns)`
  );
  if (sflFields.length > 0) {
    result.messages.push(`${sflFields.length} SFL field(s) inserted`);
  }
  return result;
}

/**
 * Auto-adjusts layout elements after a grid column expansion:
 *   - Grid width  = sum of all column widths + 1px
 *   - Panel width += colWidth
 *   - Action buttons (bottom row, right of center) -> left += colWidth
 * Returns log lines describing the applied changes.
 */
function autoAdjustLayout(json, gridId, colWidth) {
  const log = [];
  const items = json.items || [];

  const grid = items.find(i => i.id === gridId);
  if (!grid) return log;

  const colWidths = (grid['column widths'] || '').split(',').map(w => parseInt(w, 10));
  const newGridWidth = colWidths.reduce((a, b) => a + b, 0) + 1;
  const oldGridWidth = parsePx(grid.width);
  grid.width = `${newGridWidth}px`;
  log.push(`Grid "${gridId}" width: ${oldGridWidth}px -> ${newGridWidth}px`);

  const panel = items.find(i => i['field type'] === 'css panel');
  if (!panel) return log;

  const oldPanelWidth = parsePx(panel.width);
  const newPanelWidth = oldPanelWidth + colWidth;
  panel.width = `${newPanelWidth}px`;
  log.push(`Panel "${panel.id}" width: ${oldPanelWidth}px -> ${newPanelWidth}px`);

  const panelHeight = parsePx(panel.height);
  const buttonRowThreshold = panelHeight - 80;
  const rightThreshold = oldPanelWidth * 0.35;

  for (const item of items) {
    const itemTop = parsePx(item.top);
    const itemLeft = parsePx(item.left);
    if (itemTop >= buttonRowThreshold && itemLeft > rightThreshold) {
      const newLeft = itemLeft + colWidth;
      item.left = `${newLeft}px`;
      log.push(`Button "${item.id}" left: ${itemLeft}px -> ${newLeft}px`);
    }
  }

  return log;
}

/** Parses a CSS pixel value like "910px" -> 910. Returns 0 when not parseable. */
function parsePx(val) {
  if (!val) return 0;
  return parseInt(String(val).replace('px', ''), 10) || 0;
}

/** Builds a PUI field definition for a new output field in the grid. */
function buildFieldDefinition(
  id,
  fieldName,
  fieldType,
  dataType,
  dataLength,
  width,
  gridId,
  column
) {
  const isNumeric = dataType === 'zoned' || dataType === 'Number';
  const def = {
    id,
    'field type': fieldType,
    'css class': fieldType === 'textbox' ? 'outputField' : 'output-field',
    value: {
      fieldName,
      dataLength: String(dataLength),
      trimLeading: 'false',
      trimTrailing: 'true',
      blankFill: 'false',
      rjZeroFill: 'false',
      dataType,
      formatting: isNumeric ? 'Number' : 'Text',
      textTransform: 'none',
      designValue: `[${fieldName}]`,
    },
    'font family': 'Arial',
    'font size': '12px',
    'font variant': 'normal',
    'font weight': 'normal',
    'text align': 'left',
    left: '5px',
    top: '5px',
    width,
    grid: gridId,
    column: String(column),
  };

  if (isNumeric) {
    def.value = {
      fieldName,
      dataLength: String(dataLength),
      decPos: '0',
      numSep: 'false',
      zeroBalance: 'false',
      numBlankFill: 'false',
      zeroFill: 'false',
      noExtraSpaces: 'false',
      curSym: '',
      dataType,
      formatting: 'Number',
      negNum: '-999.00',
      units: '',
      designValue: `[${fieldName}]`,
    };
  }

  return def;
}

/**
 * Inserts DDS field lines into an SFL record.
 * Finds the matching DDS segment and inserts before the next record format.
 * Returns the number of inserted lines.
 */
function insertSflFields(parsed, sflFieldLines, preferredRecordName = '', result = null) {
  const targetRecord = preferredRecordName ? preferredRecordName.toUpperCase() : '';

  let sflEndIdx = -1;
  let insideSfl = false;

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    if (seg.kind !== 'dds') continue;

    const raw = seg.raw || '';
    if (raw.match(/^\s+A\s+R\s+/)) {
      if (insideSfl) {
        sflEndIdx = i;
        break;
      }
      const upperRaw = raw.toUpperCase();
      if (
        (targetRecord && upperRaw.includes(targetRecord)) ||
        (!targetRecord && upperRaw.includes('SFL'))
      ) {
        insideSfl = true;
      }
    }
  }

  if (sflEndIdx < 0) {
    const label = targetRecord || 'SFL*';
    if (result) {
      result.warnings.push(`${label} record not found; SFL fields were not inserted`);
    }
    return 0;
  }

  const newSegments = sflFieldLines.map(fieldLine => {
    const normalized = fieldLine.startsWith('     A')
      ? fieldLine
      : `     A            ${fieldLine}`;
    return { kind: 'dds', raw: normalized, lineIndex: -1 };
  });

  parsed.segments.splice(sflEndIdx, 0, ...newSegments);
  return newSegments.length;
}

module.exports = {
  executePuiEdit,
  READ_ONLY_ACTIONS,
  WRITE_ACTIONS,
  ALL_ACTIONS,
};
