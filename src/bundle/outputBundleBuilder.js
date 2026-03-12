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
const AdmZip = require('adm-zip');

const MANIFEST_FILE = 'bundle-manifest.json';
const ZIP_MANIFEST_FILE = 'manifest.json';
const README_FILE = 'README.txt';

function normalizeProgramName(program) {
  return String(program || '').trim();
}

function resolveIncludeTypes(options) {
  const includeJson = Boolean(options.includeJson);
  const includeMd = Boolean(options.includeMd);
  const includeHtml = Boolean(options.includeHtml);

  if (!includeJson && !includeMd && !includeHtml) {
    return new Set(['.json', '.md', '.html']);
  }

  const selected = new Set();
  if (includeJson) selected.add('.json');
  if (includeMd) selected.add('.md');
  if (includeHtml) selected.add('.html');
  return selected;
}

function shouldIncludeFile(fileName, includeTypes) {
  const ext = path.extname(fileName).toLowerCase();
  if (!includeTypes.has(ext)) {
    return false;
  }
  if (fileName === MANIFEST_FILE) {
    return false;
  }
  return true;
}

function collectBundleFiles(programOutputDir, includeTypes) {
  return fs.readdirSync(programOutputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => shouldIncludeFile(fileName, includeTypes))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: fileName,
      path: path.join(programOutputDir, fileName),
      ext: path.extname(fileName).toLowerCase(),
    }));
}

function buildSummary(files) {
  const summary = {
    jsonFiles: 0,
    markdownFiles: 0,
    htmlFiles: 0,
    totalFiles: files.length,
  };

  for (const file of files) {
    if (file.ext === '.json') summary.jsonFiles += 1;
    if (file.ext === '.md') summary.markdownFiles += 1;
    if (file.ext === '.html') summary.htmlFiles += 1;
  }

  return summary;
}

function buildManifest(program, files) {
  return {
    program: normalizeProgramName(program).toUpperCase(),
    generatedAt: new Date().toISOString(),
    files: files.map((file) => file.name),
    summary: buildSummary(files),
  };
}

function buildReadmeText(program, manifest) {
  return [
    `Program: ${normalizeProgramName(program).toUpperCase()}`,
    'Created by: zeus-rpg-promptkit',
    'Contents: reports, prompts, graphs, metadata',
    `Files: ${manifest.summary.totalFiles}`,
  ].join('\n');
}

function addZipEntry(zip, entryName, content) {
  zip.addFile(entryName, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
  const entry = zip.getEntry(entryName);
  if (entry) {
    entry.header.time = new Date(0);
  }
}

function buildOutputBundle({
  program,
  sourceOutputRoot = 'output',
  bundleOutputRoot = 'bundles',
  includeJson = false,
  includeMd = false,
  includeHtml = false,
}) {
  const resolvedProgram = normalizeProgramName(program);
  if (!resolvedProgram) {
    throw new Error('Bundle creation requires --program <name>');
  }

  const resolvedSourceRoot = path.resolve(process.cwd(), sourceOutputRoot);
  const resolvedBundleRoot = path.resolve(process.cwd(), bundleOutputRoot);
  const programOutputDir = path.join(resolvedSourceRoot, resolvedProgram);

  if (!fs.existsSync(programOutputDir)) {
    throw new Error(`Program output directory not found: ${programOutputDir}. Run analyze first.`);
  }

  const includeTypes = resolveIncludeTypes({ includeJson, includeMd, includeHtml });
  const files = collectBundleFiles(programOutputDir, includeTypes);
  const manifest = buildManifest(resolvedProgram, files);
  const zip = new AdmZip();

  for (const file of files) {
    addZipEntry(zip, file.name, fs.readFileSync(file.path));
  }

  addZipEntry(zip, ZIP_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  addZipEntry(zip, README_FILE, `${buildReadmeText(resolvedProgram, manifest)}\n`);

  fs.mkdirSync(resolvedBundleRoot, { recursive: true });
  fs.writeFileSync(path.join(programOutputDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const zipPath = path.join(resolvedBundleRoot, `${resolvedProgram}-analysis-bundle.zip`);
  zip.writeZip(zipPath);

  return {
    program: manifest.program,
    sourceOutputRoot: resolvedSourceRoot,
    programOutputDir,
    bundleOutputRoot: resolvedBundleRoot,
    zipPath,
    manifest,
  };
}

module.exports = {
  buildOutputBundle,
};
