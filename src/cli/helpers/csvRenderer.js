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
function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function renderCsv(columns, rows) {
  const header = (columns || []).map((column) => String(column || '')).join(';');
  const lines = (rows || []).map((row) => (columns || [])
    .map((column, index) => {
      if (Array.isArray(row)) {
        return escapeCsvValue(row[index]);
      }
      return escapeCsvValue(row && typeof row === 'object' ? row[column] : '');
    })
    .join(';'));
  return `${[header, ...lines].join('\n')}\n`;
}

module.exports = {
  renderCsv,
};
