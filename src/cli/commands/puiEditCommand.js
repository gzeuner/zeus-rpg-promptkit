/**
 * pui-edit — CLI-Tool zum programmatischen Bearbeiten von ProfoundUI Display File Members.
 *
 * Usage:
 *   node cli/zeus.js pui-edit --file <path> --action <action> [--options...]
 *
 * Aktionen:
 *   grid-add-column    Fügt eine neue Spalte in ein Grid ein
 *   dump-json          Gibt den geparsten JSON-Inhalt des Hauptformats aus
 *   validate-json      Validiert eine JSON/DDDL-Datei (ohne DDS-Schreibzugriff)
 *   export-json        Exportiert PUI-JSON als pretty|compact|dddl Datei
 *   import-json        Importiert PUI-JSON (pretty/compact/dddl) zurück in DDS
 *   roundtrip-check    Parst + serialisiert und prüft ob die Ausgabe identisch ist
 *   plan               Validiert ein deklaratives Change-Set ohne zu schreiben
 *   apply              Wendet ein deklaratives Change-Set nach --confirm an
 *
 * Optionen für grid-add-column:
 *   --grid-id          ID des Grid-Elements (z.B. "gridMain")
 *   --col-position     0-basierte Spaltenposition wo eingefügt werden soll
 *   --col-heading      Spaltenüberschrift
 *   --col-width        Spaltenbreite in Pixel (Zahl)
 *   --field-id         ID des neuen PUI-Feldelements (z.B. "GRID_FIELD_NEW")
 *   --field-name       DDS-Feldname (z.B. "FIELD_NEW")
 *   --field-type       PUI-Feldtyp (z.B. "output field", "textbox")
 *   --field-data-type  PUI-Datentyp (z.B. "char", "zoned")
 *   --field-length     Datenlänge
 *   --field-width      Anzeigebreite in px (z.B. "100px")
 *   --sfl-field        DDS-Feldzeile(n), die in ein SFL-Record eingefügt werden sollen
 *   --sfl-record       Optional: expliziter Record-Name für --sfl-field
 *                      Format: "FELDNAME  10A  H" — kann mehrfach angegeben werden
 *   --no-auto-adjust   Layout-Auto-Anpassung überspringen (Grid-/Panel-Breite + Buttons)
 *
 * Auto-Adjust (Standard: aktiv):
 *   Nach grid-add-column werden automatisch angepasst:
 *   - Grid width     = Summe aller Spaltenbreiten + 1px
 *   - Panel width   += neue Spaltenbreite
 *   - Aktions-Buttons in der untersten Zeile (rechts von Mitte) → left += neue Spaltenbreite
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
} = require('../../pui/puiDdsParser');
const {
  applyChangeSetToJson,
  cloneJson,
  normalizeChangeSet,
} = require('../../pui/puiEditEngine');
const {
  buildPuiDddlPayloadV1,
  parsePuiDddlPayload,
} = require('../../pui/puiDddl');

async function run(args) {
  try {
    const action = args.action || args.a;
    if (!action) {
      throw new Error('--action ist erforderlich (roundtrip-check | dump-json | validate-json | export-json | import-json | plan | apply | grid-add-column)');
    }

    if (action === 'validate-json') {
      return actionValidateJson(args);
    }

    const file = args.file || args.f;
    if (!file) {
      throw new Error('--file ist erforderlich');
    }

    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Datei nicht gefunden: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseDds(content);

    switch (action) {
      case 'roundtrip-check':
        return actionRoundtripCheck(parsed, content, filePath);
      case 'dump-json':
        return actionDumpJson(parsed);
      case 'export-json':
        return actionExportJson(parsed, args, filePath);
      case 'import-json':
        return actionImportJson(parsed, args, filePath);
      case 'plan':
        return actionChangeSetPreview(parsed, args, filePath);
      case 'apply':
        return actionChangeSetApply(parsed, args, filePath);
      case 'grid-add-column':
        return actionGridAddColumn(parsed, args, filePath);
      default:
        throw new Error(`Unbekannte Aktion: ${action}. Erlaubt: roundtrip-check, dump-json, validate-json, export-json, import-json, plan, apply, grid-add-column`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

// ─── Aktion: Roundtrip-Check ────────────────────────────────────────────────

function actionRoundtripCheck(parsed, original, filePath) {
  const serialized = serializeDds(parsed);

  if (serialized === original.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
    console.log('✓ Roundtrip OK — Output ist identisch mit Input');
    console.log(`  Segmente: ${parsed.segments.length}`);
    console.log(`  HTML-Blöcke: ${parsed.segments.filter((s) => s.kind === 'html').length}`);
    return;
  }

  // Finde erste abweichende Zeile
  const origLines = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const outLines  = serialized.split('\n');
  let firstDiff = -1;
  for (let i = 0; i < Math.max(origLines.length, outLines.length); i++) {
    if (origLines[i] !== outLines[i]) {
      firstDiff = i;
      break;
    }
  }

  console.error('✗ Roundtrip FEHLER — Output weicht ab');
  if (firstDiff >= 0) {
    console.error(`  Erste abweichende Zeile: ${firstDiff + 1}`);
    console.error(`  Original: |${origLines[firstDiff]}|`);
    console.error(`  Output:   |${outLines[firstDiff]}|`);
  }
  process.exitCode = 1;
}

// ─── Aktion: JSON dumpen ─────────────────────────────────────────────────────

function actionDumpJson(parsed) {
  const { obj } = readJsonFromParsed(parsed);
  console.log(JSON.stringify(obj, null, 2));
}

function actionValidateJson(args) {
  const inPath = args.in || args.input || args['json-file'];
  if (!inPath) {
    throw new Error('--in ist erforderlich fuer --action validate-json');
  }

  const resolvedInput = path.resolve(String(inPath));
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input-Datei nicht gefunden: ${resolvedInput}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  const parsedDddl = parsePuiDddlPayload(payload, {
    strict: true,
    allowMigration: true,
  });

  if (parsedDddl.recognized) {
    if (!parsedDddl.validation.valid) {
      throw new Error(`Ungueltiges DDDL-Format: ${parsedDddl.validation.errors.join('; ')}`);
    }
    console.log(`Valid DDDL (${parsedDddl.payload.kind} v${parsedDddl.payload.version})`);
    if (parsedDddl.migrations.length > 0) {
      console.log(`Applied migrations: ${parsedDddl.migrations.join(', ')}`);
    } else {
      console.log('Applied migrations: none');
    }
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('JSON-Datei muss entweder ein gueltiges DDDL-Objekt oder ein PUI root object sein.');
  }

  console.log('Valid plain PUI JSON object');
}

function actionExportJson(parsed, args, filePath) {
  const outPath = args.out || args.output;
  if (!outPath) {
    throw new Error('--out ist erforderlich fuer --action export-json');
  }
  const { group, obj, compactSource } = readJsonFromParsed(parsed);
  const format = String(args.format || 'pretty').trim().toLowerCase();
  const resolvedOutput = path.resolve(String(outPath));
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

  let payload;
  if (format === 'pretty') {
    payload = JSON.stringify(obj, null, 2);
  } else if (format === 'compact') {
    payload = JSON.stringify(obj);
  } else if (format === 'dddl') {
    payload = JSON.stringify(buildDddlPayload({
      filePath,
      group,
      obj,
      compactSource,
    }), null, 2);
  } else {
    throw new Error('--format muss pretty, compact oder dddl sein');
  }

  fs.writeFileSync(resolvedOutput, `${payload}\n`, 'utf8');
  console.log(`Export geschrieben: ${resolvedOutput}`);
  console.log(`Format: ${format}`);
}

function actionImportJson(parsed, args, filePath) {
  const inPath = args.in || args.input || args['json-file'];
  if (!inPath) {
    throw new Error('--in ist erforderlich fuer --action import-json');
  }
  const confirm = parseBoolean(args.confirm || args.yes || args.write, false);
  if (!confirm) {
    throw new Error('Fuer --action import-json ist --confirm erforderlich.');
  }

  const resolvedInput = path.resolve(String(inPath));
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input-Datei nicht gefunden: ${resolvedInput}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
  const importedJson = unwrapImportedPuiJson(payload);
  if (!importedJson || typeof importedJson !== 'object' || Array.isArray(importedJson)) {
    throw new Error('Import-JSON muss ein Objekt sein (PUI root object).');
  }

  const group = findJsonSegmentGroup(parsed);
  if (!group) {
    throw new Error('Kein JSON-Segment in der Datei gefunden');
  }
  serializeJsonToGroup(parsed, group, importedJson);
  const output = serializeDds(parsed);
  writeDisplayWithBackup(filePath, output);
  console.log(`PUI-JSON importiert aus: ${resolvedInput}`);
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
      throw new Error(`Ungueltiges DDDL-Format: ${parsedDddl.validation.errors.join('; ')}`);
    }
    return parsedDddl.payload.puiJson;
  }
  return payload;
}

function readJsonFromParsed(parsed) {
  const group = findJsonSegmentGroup(parsed);
  if (!group) {
    throw new Error('Kein JSON-Segment gefunden');
  }
  const compactSource = group.segments.map((s) => s.content).join('');
  const obj = parseJsonFromGroup(group);
  if (!obj) {
    throw new Error(`JSON-Parsing fehlgeschlagen. Segment-Vorschau: ${compactSource.slice(0, 200)}`);
  }
  return { group, obj, compactSource };
}

function writeDisplayWithBackup(filePath, output) {
  const backupPath = filePath + '.bak';
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup erstellt: ${backupPath}`);
  fs.writeFileSync(filePath, output, 'utf8');
  console.log(`Datei aktualisiert: ${filePath}`);
}

// ─── Aktion: Change-Set Vorschau / Anwendung ────────────────────────────────

function actionChangeSetPreview(parsed, args, filePath) {
  const changeSet = resolveChangeSet(args);
  const preview = buildChangeSetPreview(parsed, changeSet);
  printChangeSetPreview(preview, filePath, false);
}

function actionChangeSetApply(parsed, args, filePath) {
  const confirm = parseBoolean(args.confirm || args.yes || args.write, false);
  if (!confirm) {
    throw new Error('Für --action apply ist --confirm erforderlich. Verwende --action plan für eine Vorschau.');
  }

  const changeSet = resolveChangeSet(args);
  const preview = buildChangeSetPreview(parsed, changeSet);
  printChangeSetPreview(preview, filePath, true);

  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) {
    throw new Error('Kein JSON-Segment in der Datei gefunden');
  }

  serializeJsonToGroup(parsed, jsonGroup, preview.after);
  const output = serializeDds(parsed);
  writeDisplayWithBackup(filePath, output);
}

function buildChangeSetPreview(parsed, changeSet) {
  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) {
    throw new Error('Kein JSON-Segment in der Datei gefunden');
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

function printChangeSetPreview(preview, filePath, applied) {
  if (preview.description) {
    console.log(`Change-Set: ${preview.description}`);
  }
  console.log(`Datei: ${filePath}`);
  console.log(`Operationen: ${preview.operationCount}`);
  for (const line of preview.applied.summaryLines) {
    console.log(`  ${line}`);
  }
  if (!applied) {
    console.log('Vorschau erstellt. Nutze --confirm mit --action apply, um die Änderungen zu schreiben.');
  }
}

function resolveChangeSet(args) {
  const changeSetPath = args['changes-file'] || args['change-file'] || args['change-spec'];
  if (!changeSetPath) {
    throw new Error('--changes-file ist erforderlich für --action plan und --action apply');
  }

  const resolvedPath = path.resolve(changeSetPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Change-Set-Datei nicht gefunden: ${resolvedPath}`);
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

// ─── Aktion: Grid-Spalte einfügen ────────────────────────────────────────────

function actionGridAddColumn(parsed, args, filePath) {
  // Parameter einlesen
  const gridId      = args['grid-id'];
  const colPos      = parseInt(args['col-position'], 10);
  const colHeading  = args['col-heading'];
  const colWidth    = parseInt(args['col-width'], 10);
  const fieldId     = args['field-id'];
  const fieldName   = args['field-name'];
  const fieldType   = args['field-type']  || 'output field';
  const fieldDataType = args['field-data-type'] || 'char';
  const fieldLength = parseInt(args['field-length'] || '10', 10);
  const fieldWidth  = args['field-width'] || '100px';
  const sflFields   = args['sfl-field']
    ? (Array.isArray(args['sfl-field']) ? args['sfl-field'] : [args['sfl-field']])
    : [];
  const sflRecord = args['sfl-record'] ? String(args['sfl-record']).trim() : '';
  const autoAdjust  = !args['no-auto-adjust'];
  const confirm     = parseBoolean(args.confirm || args.yes || args.write, false);

  if (!gridId || isNaN(colPos) || !colHeading || isNaN(colWidth) || !fieldId || !fieldName) {
    throw new Error(
      'Für grid-add-column benötigt: --grid-id, --col-position, --col-heading, --col-width, --field-id, --field-name und --confirm zum Schreiben',
    );
  }

  // JSON-Segment finden und parsen
  const jsonGroup = findJsonSegmentGroup(parsed);
  if (!jsonGroup) throw new Error('Kein JSON-Segment in der Datei gefunden');

  const { obj: json } = readJsonFromParsed(parsed);

  // Grid-Element finden
  const grid = (json.items || []).find((item) => item.id === gridId);
  if (!grid) {
    throw new Error(`Grid-Element "${gridId}" nicht gefunden. Verfügbare IDs: ${(json.items || []).map((i) => i.id).join(', ')}`);
  }

  // 1) Anzahl Spalten erhöhen
  const oldCount = parseInt(grid['number of columns'] || '0', 10);
  grid['number of columns'] = String(oldCount + 1);

  // 2) Column Widths: an Position colPos einfügen
  const widths = (grid['column widths'] || '').split(',');
  widths.splice(colPos, 0, String(colWidth));
  grid['column widths'] = widths.join(',');

  // 3) Column Headings: an Position colPos einfügen
  const headings = (grid['column headings'] || '').split(',');
  headings.splice(colPos, 0, colHeading);
  grid['column headings'] = headings.join(',');

  // 4) Alle bestehenden Felder die column >= colPos haben → +1
  for (const item of json.items || []) {
    if (item.grid === gridId && item.column !== undefined) {
      const colNum = parseInt(item.column, 10);
      if (!isNaN(colNum) && colNum >= colPos) {
        item.column = String(colNum + 1);
      }
    }
  }

  // 5a) Auto-Adjust: Grid-/Panel-Breite + Aktions-Buttons anpassen
  if (autoAdjust) {
    const adjustLog = autoAdjustLayout(json, gridId, colWidth);
    for (const line of adjustLog) console.log(`  Auto-Adjust: ${line}`);
  }

  // 5) Neues Feld-Element einfügen (nach dem letzten Element des Grids)
  const newFieldDef = buildFieldDefinition(fieldId, fieldName, fieldType, fieldDataType, fieldLength, fieldWidth, gridId, colPos);
  // Einfügen nach dem letzten Grid-Feld mit dieser gridId
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

  // JSON zurückschreiben
  serializeJsonToGroup(parsed, jsonGroup, json);

  // DDS-Felder in einen SFL-Record einfügen (wenn angegeben)
  if (sflFields.length > 0) {
    insertSflFields(parsed, sflFields, sflRecord);
  }

  // Ausgabe
  const output = serializeDds(parsed);

  if (!confirm) {
    console.log('Vorschau erstellt. Nutze --confirm, um die Datei zu schreiben.');
    return;
  }

  // Backup der Originaldatei + neue Datei schreiben
  writeDisplayWithBackup(filePath, output);
  console.log(`Spalte "${colHeading}" an Position ${colPos} eingefügt (${oldCount} → ${oldCount + 1} Spalten)`);

  if (sflFields.length > 0) {
    console.log(`${sflFields.length} SFL-Feld(er) eingefügt`);
  }
}

/**
 * Passt nach einer Grid-Spalten-Erweiterung automatisch die Layout-Elemente an:
 *   - Grid width     = Summe aller Spaltenbreiten + 1px
 *   - Panel width   += colWidth
 *   - Aktions-Buttons (unterste Zeile, rechts von Mitte) → left += colWidth
 *
 * Heuristik für "Aktions-Button":
 *   top  >= panel_height - 80px  (untere Zeile des Panels)
 *   left >  old_panel_width * 0.35  (rechts von Mitte)
 *
 * @param {object} json      - Geparste JSON-Struktur (wird in-place verändert)
 * @param {string} gridId    - ID des Grid-Elements
 * @param {number} colWidth  - Breite der neuen Spalte (px)
 * @returns {string[]} Log-Zeilen der vorgenommenen Änderungen
 */
function autoAdjustLayout(json, gridId, colWidth) {
  const log   = [];
  const items = json.items || [];

  // 1) Grid: width = Summe aller Spaltenbreiten + 1px (Rand)
  const grid = items.find((i) => i.id === gridId);
  if (!grid) return log;

  const colWidths    = (grid['column widths'] || '').split(',').map((w) => parseInt(w, 10));
  const newGridWidth = colWidths.reduce((a, b) => a + b, 0) + 1;
  const oldGridWidth = parsePx(grid.width);
  grid.width = `${newGridWidth}px`;
  log.push(`Grid "${gridId}" width: ${oldGridWidth}px → ${newGridWidth}px`);

  // 2) Container-Panel: erstes Item mit field type "css panel"
  const panel = items.find((i) => i['field type'] === 'css panel');
  if (!panel) return log;

  const oldPanelWidth  = parsePx(panel.width);
  const newPanelWidth  = oldPanelWidth + colWidth;
  panel.width = `${newPanelWidth}px`;
  log.push(`Panel "${panel.id}" width: ${oldPanelWidth}px → ${newPanelWidth}px`);

  // 3) Aktions-Buttons in der untersten Zeile nach rechts verschieben
  const panelHeight        = parsePx(panel.height);
  const buttonRowThreshold = panelHeight - 80;     // z.B. 705 - 80 = 625
  const rightThreshold     = oldPanelWidth * 0.35; // z.B. 910 * 0.35 = 318

  for (const item of items) {
    const itemTop  = parsePx(item.top);
    const itemLeft = parsePx(item.left);
    if (itemTop >= buttonRowThreshold && itemLeft > rightThreshold) {
      const newLeft = itemLeft + colWidth;
      item.left = `${newLeft}px`;
      log.push(`Button "${item.id}" left: ${itemLeft}px → ${newLeft}px`);
    }
  }

  return log;
}

/** Parst einen CSS-Pixel-Wert wie "910px" → 910. Gibt 0 zurück wenn nicht parsebar. */
function parsePx(val) {
  if (!val) return 0;
  return parseInt(String(val).replace('px', ''), 10) || 0;
}

/**
 * Baut eine PUI-Felddefinition für ein neues Output-Feld im Grid auf.
 */
function buildFieldDefinition(id, fieldName, fieldType, dataType, dataLength, width, gridId, column) {
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

  // Bei numerischen Feldern: andere Value-Struktur
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
 * Fügt DDS-Feldzeilen in einen SFL-Record ein.
 * Sucht das passende DDS-Segment und fügt vor dem nächsten Record-Format ein.
 */
function insertSflFields(parsed, sflFieldLines, preferredRecordName = '') {
  const targetRecord = preferredRecordName ? preferredRecordName.toUpperCase() : '';

  // Finde das SFL-Record (R <name>) oder das erste Record mit "SFL"
  let sflEndIdx = -1;
  let insideSfl = false;

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    if (seg.kind !== 'dds') continue;

    const raw = seg.raw || '';
    // Record-Format Start
    if (raw.match(/^\s+A\s+R\s+/)) {
      if (insideSfl) {
        // Nächstes Record-Format gefunden → Einfügestelle ist hier
        sflEndIdx = i;
        break;
      }
      const upperRaw = raw.toUpperCase();
      if ((targetRecord && upperRaw.includes(targetRecord)) || (!targetRecord && upperRaw.includes('SFL'))) {
        insideSfl = true;
      }
    }
  }

  if (sflEndIdx < 0) {
    const label = targetRecord || 'SFL*';
    console.warn(`${label} record not found; SFL fields were not inserted`);
    return;
  }

  // Neue Segmente für die SFL-Felder bauen
  const newSegments = sflFieldLines.map((fieldLine) => {
    // Normiere auf korrektes DDS-Format: 5 Leerzeichen + 'A' + Rest
    const normalized = fieldLine.startsWith('     A') ? fieldLine : `     A            ${fieldLine}`;
    return { kind: 'dds', raw: normalized, lineIndex: -1 };
  });

  // Vor sflEndIdx einfügen
  parsed.segments.splice(sflEndIdx, 0, ...newSegments);
}

module.exports = { run };
