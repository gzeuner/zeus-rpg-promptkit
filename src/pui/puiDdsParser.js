/**
 * PUI DDS Parser — Liest IBM i DDS Display File Member (*.MBR / *.dds)
 * und extrahiert die Struktur: DDS-Zeilen, HTML-Blöcke, Felder, Record Formats.
 *
 * Das Profound UI Format besteht aus:
 *  - Normalen DDS-Zeilen (Spalten 1-80, col 6 = 'A')
 *  - HTML('...') Keyword-Blöcken, die über mehrere Zeilen mit '-'-Continuation verteilt sind
 *  - Im HTML-Block: entweder PUI-Steuerstring (QPUI...) oder JSON-Objektdefinition
 *
 * Zeilenformat:
 *   Pos 1-5:  Sequenz/Leerzeichen
 *   Pos 6:    'A' (oder '*' für Kommentar)
 *   Pos 7-80: DDS-Inhalt
 *
 * HTML-Continuation:
 *   Letzte Zeile endet NICHT mit "'" sondern mit "-" an Position 80 (Spalte 80 des Inhalts)
 *   Der Inhalt zwischen HTML(' und ') wird auf 63 Zeichen pro Zeile aufgeteilt.
 */

'use strict';

// Zeilenanfang für HTML-Keyword-Zeilen (genau wie PUI Designer schreibt)
const DDS_PREFIX_FIRST   = '     A                                  1  2HTML(\'';
const DDS_PREFIX_CONT    = '     A                                      ';
const DDS_LINE_MAX_COL   = 80; // IBM i Quelldatei: 80 Zeichen je Zeile (ohne Zeilenende)

// Nutzbare Zeichenbreite für den HTML-Inhalt:
//   Erste Zeile: nach dem HTML(', vor dem abschließenden ' oder dem Continuation-'-'
//   Col 80 = Position 80 (1-basiert), also 80 - len(prefix) - 1 (für Cont-Zeichen)
const CONTENT_WIDTH_FIRST = DDS_LINE_MAX_COL - DDS_PREFIX_FIRST.length; // 80 - 48 = 32? → s.u.
// Tatsächliche Messung aus der Datei:
//   DDS_PREFIX_FIRST.length = 48, verbleibend bis col 80 = 32 Zeichen + Continuation-'-'
//   Aber PUI schreibt 63 Zeichen Inhalt pro Zeile → Prefix muss kürzer sein.
// → Messen der tatsächlichen Prefix-Länge:
//   '     A                                  1  2HTML(\'' = 48 Zeichen
//   Inhalt erste Zeile: '{"screen":{"record format nam-' = 30 Zeichen + '-' = Position 79
//   Also: 48 + 30 + 1(Cont) = 79 → passt (80 Zeichen = Position 1-80 ohne LF)
// CONTENT_FIRST = 30 Zeichen (dann '-' als Continuation)
// CONTENT_CONT  = ?
//   '     A                                      ' = 45 Zeichen
//   45 + 34 + 1 = 80 → CONTENT_CONT = 34 Zeichen

// Gemessene Werte aus echter PUI-Datei:
const HTML_CONTENT_PER_FIRST_LINE = DDS_LINE_MAX_COL - DDS_PREFIX_FIRST.length - 1; // 80 - 48 - 1 = 31
const HTML_CONTENT_PER_CONT_LINE  = DDS_LINE_MAX_COL - DDS_PREFIX_CONT.length  - 1; // 80 - 45 - 1 = 34

/**
 * Liest eine DDS-Datei und gibt ein geparste Struktur zurück.
 * @param {string} content - Dateiinhalt als String
 * @returns {ParsedDds}
 */
function parseDds(content) {
  const rawLines = content.split('\n');
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    // Ohne trailing newline-Zeichen
    const line = raw.replace(/\r$/, '');
    lines.push(line);
  }

  // Zusammenhängende HTML-Blöcke aufbauen
  // Ein HTML-Block beginnt wenn eine Zeile HTML(' enthält und endet wenn kein '-' am Zeilenende steht
  const segments = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colA = line.length >= 6 ? line[5] : ' ';
    const isComment = colA === '*';

    if (isComment) {
      segments.push({ kind: 'comment', raw: line, lineIndex: i });
      i++;
      continue;
    }

    // Prüfe ob diese Zeile ein HTML(... enthält
    const htmlStartIdx = line.indexOf("HTML('");
    if (htmlStartIdx >= 0) {
      // Sammle alle Continuation-Lines
      const blockLines = [line];
      let j = i;

      // Prüfe Continuation: Zeile endet mit '-' an der letzten nutzbaren Position
      while (isHtmlContinuation(blockLines[blockLines.length - 1])) {
        j++;
        if (j >= lines.length) break;
        blockLines.push(lines[j]);
      }

      // Extrahiere den vollständigen HTML-Inhalt
      const fullContent = extractHtmlContent(blockLines);
      segments.push({
        kind: 'html',
        rawLines: blockLines,
        lineIndex: i,
        lineCount: blockLines.length,
        content: fullContent,
      });

      i = j + 1;
      continue;
    }

    // Normaler DDS-Eintrag (Feld-Definition, Record-Format, Keywords etc.)
    segments.push({ kind: 'dds', raw: line, lineIndex: i });
    i++;
  }

  return { segments, rawLines: lines };
}

/**
 * Prüft ob eine HTML-Zeile eine Continuation hat (endet mit '-' vor dem LF).
 * Laut IBM-Spec: Spalte 80 (0-basiert: Index 79) = '-' bedeutet Fortsetzung.
 * In der Praxis: Zeile endet auf "-'" wenn Ende, oder auf "-" wenn Continuation.
 */
function isHtmlContinuation(line) {
  // Zeile ohne trailing whitespace/CR prüfen
  const stripped = line.replace(/\s+$/, '');
  // Continuation wenn letzte Zeichen '-' ist (aber nicht ")'")
  return stripped.endsWith('-') && !stripped.endsWith("')");
}

/**
 * Extrahiert den rohen Inhalt aus einem HTML(...)Block über mehrere Zeilen.
 * Entfernt den DDS-Prefix und die Continuation-Zeichen.
 */
function extractHtmlContent(blockLines) {
  let combined = '';

  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    let content;

    if (i === 0) {
      // Erste Zeile: nach HTML(' extrahieren
      const startIdx = line.indexOf("HTML('");
      if (startIdx < 0) return '';
      content = line.slice(startIdx + 6); // nach HTML('
    } else {
      // Continuation-Zeile: nach dem Prefix-Bereich extrahieren
      // Prefix ist immer '     A                                      '
      const prefixLen = DDS_PREFIX_CONT.length;
      content = line.slice(prefixLen);
    }

    // Letztes Zeichen: '-' (Continuation) oder ')' (Abschluss) entfernen
    if (content.endsWith("')")) {
      content = content.slice(0, -2); // Abschluss ') entfernen
    } else if (content.endsWith('-')) {
      content = content.slice(0, -1); // Continuation '-' entfernen
    }

    combined += content;
  }

  return combined;
}

/**
 * Serialisiert den geparsten DDS zurück in den Dateitext.
 * Dabei werden HTML-Blöcke korrekt auf 80-Zeichen-Zeilen aufgeteilt — exakt
 * wie der PUI Designer es tut, damit er die Datei weiter bearbeiten kann.
 */
function serializeDds(parsed) {
  const outputLines = [];

  for (const segment of parsed.segments) {
    if (segment.kind === 'comment' || segment.kind === 'dds') {
      outputLines.push(segment.raw);
    } else if (segment.kind === 'html') {
      const rebuilt = buildHtmlLines(segment.content);
      for (const l of rebuilt) {
        outputLines.push(l);
      }
    }
  }

  return outputLines.join('\n');
}

/**
 * Baut HTML(...)  DDS-Zeilen aus dem rohen Inhalt-String auf.
 * Exakt das Format, das der PUI Designer erzeugt:
 *   Erste Zeile:  '     A                                  1  2HTML(\'<CONTENT>-'
 *   Folgezeilen:  '     A                                      <CONTENT>-'
 *   Letzte Zeile endet mit: '<CONTENT>\')'
 */
function buildHtmlLines(content) {
  if (!content) {
    return [`${DDS_PREFIX_FIRST}')`];
  }

  const lines = [];
  let pos = 0;
  let isFirst = true;

  while (pos < content.length) {
    const chunkSize = isFirst ? HTML_CONTENT_PER_FIRST_LINE : HTML_CONTENT_PER_CONT_LINE;
    const remaining = content.length - pos;
    const isLast = remaining <= chunkSize;
    const chunk = content.slice(pos, pos + (isLast ? remaining : chunkSize));

    if (isFirst) {
      if (isLast) {
        lines.push(`${DDS_PREFIX_FIRST}${chunk}')`);
      } else {
        lines.push(`${DDS_PREFIX_FIRST}${chunk}-`);
      }
      isFirst = false;
    } else {
      if (isLast) {
        lines.push(`${DDS_PREFIX_CONT}${chunk}')`);
      } else {
        lines.push(`${DDS_PREFIX_CONT}${chunk}-`);
      }
    }

    pos += chunkSize;
    if (isLast) break;
  }

  return lines;
}

/**
 * Hilfsfunktion: Findet einen HTML-Segment der ein JSON-Objekt enthält
 * (beginnt mit '{').
 * Da PUI den JSON auf mehrere HTML()-Blöcke à max 2500 Zeichen aufteilt,
 * gibt dies NUR das erste JSON-Segment zurück.
 * Für den vollständigen JSON → findJsonSegmentGroup() verwenden.
 */
function findJsonSegment(parsed) {
  return parsed.segments.find(
    (s) => s.kind === 'html' && s.content.trimStart().startsWith('{'),
  );
}

/**
 * Findet alle zusammenhängenden HTML-Segmente die gemeinsam ein JSON-Objekt bilden.
 * PUI teilt den JSON auf mehrere HTML()-Blöcke (je max 2500 Zeichen) auf.
 * Zusammenhängend = aufeinanderfolgende HTML-Segmente, das erste beginnt mit '{',
 * das letzte endet mit '}'.
 *
 * @returns {{ segments: Segment[], startIdx: number, endIdx: number } | null}
 */
function findJsonSegmentGroup(parsed) {
  let startIdx = -1;

  for (let i = 0; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    if (seg.kind === 'html' && seg.content.trimStart().startsWith('{')) {
      startIdx = i;
      break;
    }
  }

  if (startIdx < 0) return null;

  // Inkrementell JSON aufbauen und sobald parsebar beenden.
  // Das ist robuster als Prefix-Heuristiken (z.B. Chunk beginnt mit "Q...").
  let combined = '';
  for (let i = startIdx; i < parsed.segments.length; i++) {
    const seg = parsed.segments[i];
    if (seg.kind !== 'html') break;
    combined += seg.content;
    try {
      JSON.parse(combined);
      return {
        segments: parsed.segments.slice(startIdx, i + 1),
        startIdx,
        endIdx: i,
      };
    } catch {
      // Noch nicht komplett, weiter sammeln.
    }
  }

  // Fallback: zusammenhängende HTML-Segmente ab Start zurückgeben.
  let endIdx = startIdx;
  for (let i = startIdx + 1; i < parsed.segments.length; i++) {
    if (parsed.segments[i].kind !== 'html') break;
    endIdx = i;
  }
  return {
    segments: parsed.segments.slice(startIdx, endIdx + 1),
    startIdx,
    endIdx,
  };
}

/**
 * Parst den vollständigen JSON-Inhalt über alle zusammenhängenden HTML-Segmente.
 * @returns {object|null}
 */
function parseJsonFromGroup(group) {
  if (!group) return null;
  const fullContent = group.segments.map((s) => s.content).join('');
  try {
    return JSON.parse(fullContent);
  } catch {
    // Recovery path for legacy dumps containing invalid C0 control chars
    // (for example 0x1A) inside string literals.
    const sanitized = fullContent.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    try {
      return JSON.parse(sanitized);
    } catch {
      return null;
    }
  }
}

/**
 * Schreibt ein JavaScript-Objekt als JSON zurück in die Segment-Gruppe.
 * Teilt den JSON-String auf Segmente à max 2500 Zeichen auf (IBM i-Limit).
 */
function serializeJsonToGroup(parsed, group, obj) {
  const JSON_MAX_PER_BLOCK = 2500;
  const fullJson = JSON.stringify(obj);

  // Baue neue Segmente
  const newSegments = [];
  let pos = 0;
  while (pos < fullJson.length) {
    const chunk = fullJson.slice(pos, pos + JSON_MAX_PER_BLOCK);
    newSegments.push({
      kind: 'html',
      content: chunk,
      rawLines: [], // wird beim Serialisieren neu gebaut
      lineIndex: -1,
      lineCount: 0,
    });
    pos += JSON_MAX_PER_BLOCK;
  }

  // Ersetze alte Segmente durch neue
  parsed.segments.splice(group.startIdx, group.segments.length, ...newSegments);
}

/**
 * Parst den JSON-Inhalt eines HTML-Segments (Single-Segment, Legacy).
 * @returns {object|null}
 */
function parseJsonSegment(segment) {
  if (!segment || segment.kind !== 'html') return null;
  try {
    return JSON.parse(segment.content);
  } catch {
    return null;
  }
}

/**
 * Schreibt ein JavaScript-Objekt als JSON zurück in den content eines Segments (Legacy).
 */
function serializeJsonToSegment(segment, obj) {
  // PUI Designer schreibt kompaktes JSON (kein Pretty-Print, keine Leerzeichen nach : oder ,)
  segment.content = JSON.stringify(obj);
}

module.exports = {
  parseDds,
  serializeDds,
  buildHtmlLines,
  extractHtmlContent,
  findJsonSegment,
  findJsonSegmentGroup,
  parseJsonFromGroup,
  serializeJsonToGroup,
  parseJsonSegment,
  serializeJsonToSegment,
  HTML_CONTENT_PER_FIRST_LINE,
  HTML_CONTENT_PER_CONT_LINE,
  DDS_PREFIX_FIRST,
  DDS_PREFIX_CONT,
};
