'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { queryProcesses } = require('../projectIntelligence/process/retrieval');
const { validatePlainData } = require('../providers/contracts');

function parseInput(text, kind) {
  const value = JSON.parse(text);
  const errors = validatePlainData(value, {
    maxDepth: 24,
    maxKeys: 100000,
    maxItems: 10000,
    maxStringBytes: 8192,
    maxTotalBytes: 2 * 1024 * 1024,
  });
  if (errors.length > 0 || value.schemaVersion !== 1 || value.kind !== kind) {
    throw new Error('Invalid local catalog');
  }
  return value;
}

try {
  const catalog = parseInput(workerData.catalog, 'process-candidate-catalog');
  const glossaryCatalog = workerData.glossary
    ? parseInput(workerData.glossary, 'process-glossary-catalog')
    : null;
  const result = queryProcesses(catalog, workerData.question, { limit: 5, glossaryCatalog });
  if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error('Result too large');
  parentPort.postMessage({ ok: true, result });
} catch {
  parentPort.postMessage({ ok: false });
}
