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
function repeat(char, count) {
  return String(char || ' ').repeat(Math.max(0, Number(count) || 0));
}

function renderCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildSeparator(widths) {
  return `+-${widths.map((width) => repeat('-', width)).join('-+-')}-+`;
}

function buildRow(values, widths) {
  return `| ${values.map((value, index) => renderCell(value).padEnd(widths[index], ' ')).join(' | ')} |`;
}

function renderAsciiTable(columns, rows) {
  const headers = Array.isArray(columns) ? columns.map((column) => String(column || '')) : [];
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const widths = headers.map((header, columnIndex) => Math.max(
    header.length,
    ...normalizedRows.map((row) => renderCell(Array.isArray(row) ? row[columnIndex] : '').length),
  ));

  if (widths.length === 0) {
    return '';
  }

  const separator = buildSeparator(widths);
  const lines = [
    separator,
    buildRow(headers, widths),
    separator,
  ];

  for (const row of normalizedRows) {
    lines.push(buildRow(Array.isArray(row) ? row : [], widths));
  }

  lines.push(separator);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderAsciiTable,
};
