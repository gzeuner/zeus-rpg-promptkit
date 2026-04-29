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

function truncateCell(value, maxLen = 40) {
  const rendered = value === null || value === undefined ? '' : String(value);
  if (!Number.isFinite(Number(maxLen)) || Number(maxLen) <= 0) {
    return rendered;
  }
  const limit = Math.max(1, Number(maxLen));
  if (rendered.length <= limit) {
    return rendered;
  }
  if (limit === 1) {
    return '…';
  }
  return `${rendered.slice(0, limit - 1)}…`;
}

function renderCell(value, options = {}) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return truncateCell(JSON.stringify(value), options.maxCellWidth);
  }
  return truncateCell(String(value), options.maxCellWidth);
}

function buildSeparator(widths) {
  return `+-${widths.map((width) => repeat('-', width)).join('-+-')}-+`;
}

function buildRow(values, widths, options) {
  return `| ${values.map((value, index) => renderCell(value, options).padEnd(widths[index], ' ')).join(' | ')} |`;
}

function renderAsciiTable(columns, rows, options = {}) {
  const headers = Array.isArray(columns) ? columns.map((column) => String(column || '')) : [];
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const widths = headers.map((header, columnIndex) => Math.max(
    header.length,
    ...normalizedRows.map((row) => renderCell(Array.isArray(row) ? row[columnIndex] : '', options).length),
  ));

  if (widths.length === 0) {
    return '';
  }

  const separator = buildSeparator(widths);
  const lines = [
    separator,
    buildRow(headers, widths, options),
    separator,
  ];

  for (const row of normalizedRows) {
    lines.push(buildRow(Array.isArray(row) ? row : [], widths, options));
  }

  lines.push(separator);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderAsciiTable,
  truncateCell,
};
