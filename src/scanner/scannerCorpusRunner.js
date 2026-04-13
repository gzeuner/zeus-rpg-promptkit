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
const fs = require('fs');
const path = require('path');
const { scanSourceFiles } = require('./rpgScanner');

function normalizeStrings(values) {
  return Array.from(new Set((values || [])
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function readScannerCorpus(corpusPath) {
  const absolutePath = path.resolve(corpusPath);
  const corpus = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  return {
    corpus,
    corpusPath: absolutePath,
    corpusDir: path.dirname(absolutePath),
  };
}

function collectActualDetections(scanSummary) {
  const sourceFiles = Array.isArray(scanSummary.sourceFiles) ? scanSummary.sourceFiles : [];
  return {
    sourceTypes: normalizeStrings(sourceFiles.map((entry) => entry.sourceType)),
    tables: normalizeStrings((scanSummary.tables || []).map((entry) => entry.name || entry)),
    calls: normalizeStrings((scanSummary.calls || []).map((entry) => entry.name || entry)),
    copyMembers: normalizeStrings((scanSummary.copyMembers || []).map((entry) => entry.name || entry)),
    sqlTables: normalizeStrings((scanSummary.sqlStatements || []).flatMap((entry) => entry.tables || [])),
    procedures: normalizeStrings((scanSummary.procedures || []).map((entry) => entry.name || entry)),
    prototypes: normalizeStrings((scanSummary.prototypes || []).map((entry) => entry.name || entry)),
    modules: normalizeStrings((scanSummary.modules || []).map((entry) => entry.name || entry)),
    servicePrograms: normalizeStrings((scanSummary.servicePrograms || []).map((entry) => entry.name || entry)),
    bindingDirectories: normalizeStrings((scanSummary.bindingDirectories || []).map((entry) => entry.name || entry)),
  };
}

function compareDetections(expected, actual) {
  const keys = Object.keys(expected || {});
  const mismatches = [];

  for (const key of keys) {
    const expectedValues = normalizeStrings(expected[key]);
    const actualValues = normalizeStrings(actual[key]);
    if (JSON.stringify(expectedValues) !== JSON.stringify(actualValues)) {
      mismatches.push({
        key,
        expected: expectedValues,
        actual: actualValues,
      });
    }
  }

  return mismatches;
}

function runScannerCorpus(corpusPath) {
  const { corpus, corpusDir } = readScannerCorpus(corpusPath);
  const cases = Array.isArray(corpus.cases) ? corpus.cases : [];
  const results = [];

  for (const corpusCase of cases) {
    const filePaths = (corpusCase.files || [])
      .map((relativePath) => path.join(corpusDir, relativePath));
    const scanSummary = scanSourceFiles(filePaths);
    const actual = collectActualDetections(scanSummary);
    const mismatches = compareDetections(corpusCase.expected || {}, actual);
    results.push({
      id: corpusCase.id,
      title: corpusCase.title || corpusCase.id,
      files: corpusCase.files || [],
      mismatches,
      passed: mismatches.length === 0,
      actual,
    });
  }

  return {
    schemaVersion: Number(corpus.schemaVersion) || 1,
    kind: 'scanner-corpus-run',
    name: corpus.name || path.basename(corpusPath),
    summary: {
      caseCount: results.length,
      passedCaseCount: results.filter((entry) => entry.passed).length,
      failedCaseCount: results.filter((entry) => !entry.passed).length,
    },
    results,
  };
}

module.exports = {
  collectActualDetections,
  readScannerCorpus,
  runScannerCorpus,
};
