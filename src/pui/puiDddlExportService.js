'use strict';

const fs = require('fs');
const path = require('path');

const { parseDds, findJsonSegmentGroup, parseJsonFromGroup } = require('./puiDdsParser');
const { buildPuiDddlPayloadV1, parsePuiDddlPayload } = require('./puiDddl');

function listFilesRecursive(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function candidateHasPuiMarkers(content) {
  return content.includes("HTML('") && content.includes('{"screen"');
}

function exportPuiDddlBatch(options = {}) {
  const sourceRoot = options.sourceRoot ? path.resolve(String(options.sourceRoot)) : null;
  if (!sourceRoot) {
    throw new Error('sourceRoot is required');
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`sourceRoot does not exist: ${sourceRoot}`);
  }

  const outRoot = options.outRoot
    ? path.resolve(String(options.outRoot))
    : path.resolve('./output/pui-dddl/by-source');
  const reportPath = options.reportPath
    ? path.resolve(String(options.reportPath))
    : path.resolve('./output/pui-dddl/export-report.json');

  const allFiles = listFilesRecursive(sourceRoot);
  const candidates = [];
  for (const filePath of allFiles) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_error) {
      continue;
    }
    if (candidateHasPuiMarkers(content)) {
      candidates.push({ filePath, content });
    }
  }

  let exported = 0;
  let parseFailed = 0;
  let validationFailed = 0;
  const errors = [];
  const exportedFiles = [];

  for (const candidate of candidates) {
    const { filePath, content } = candidate;
    const relative = path.relative(sourceRoot, filePath);

    try {
      const parsed = parseDds(content);
      const group = findJsonSegmentGroup(parsed);
      if (!group) {
        parseFailed += 1;
        errors.push({ file: relative, phase: 'find-json-group', message: 'no JSON group found' });
        continue;
      }

      const json = parseJsonFromGroup(group);
      if (!json) {
        parseFailed += 1;
        errors.push({ file: relative, phase: 'parse-json', message: 'JSON parse failed' });
        continue;
      }

      const compactSource = group.segments.map((segment) => segment.content).join('');
      const dddl = buildPuiDddlPayloadV1({
        filePath,
        group,
        puiJson: json,
        compactSource,
      });

      const validation = parsePuiDddlPayload(dddl, {
        strict: true,
        allowMigration: false,
      });
      if (!validation.recognized || !validation.validation.valid) {
        validationFailed += 1;
        errors.push({
          file: relative,
          phase: 'validate-generated',
          message: (validation.validation.errors || []).join('; '),
        });
        continue;
      }

      const outPath = path.join(outRoot, `${relative}.dddl.json`);
      writeJson(outPath, dddl);
      exported += 1;
      exportedFiles.push(path.relative(path.dirname(reportPath), outPath));
    } catch (error) {
      parseFailed += 1;
      errors.push({
        file: relative,
        phase: 'exception',
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    outRoot,
    stats: {
      scannedFiles: allFiles.length,
      candidates: candidates.length,
      exported,
      parseFailed,
      validationFailed,
    },
    exportedFiles,
    errors,
  };

  writeJson(reportPath, report);
  return report;
}

module.exports = {
  exportPuiDddlBatch,
};
