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
const { spawnSync } = require('child_process');

function resolveJavaPaths({ cwd = process.cwd() } = {}) {
  const sourceDir = path.resolve(cwd, 'java');
  return {
    sourceDir,
    binDir: path.join(sourceDir, 'bin'),
    libDir: path.join(sourceDir, 'lib'),
  };
}

function listJavaSourceFiles(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.java'))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function listClasspathJarEntries(paths) {
  const jarEntries = [];

  for (const dirPath of [paths.binDir, paths.libDir]) {
    if (!fs.existsSync(dirPath)) {
      continue;
    }

    const jars = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((a, b) => a.localeCompare(b));
    jarEntries.push(...jars);
  }

  return jarEntries;
}

function resolveJavaClasspathEntries({ cwd = process.cwd() } = {}) {
  const paths = resolveJavaPaths({ cwd });
  const entries = [paths.binDir, ...listClasspathJarEntries(paths)];
  return Array.from(new Set(entries));
}

function resolveJavaClasspath(options) {
  return resolveJavaClasspathEntries(options).join(path.delimiter);
}

function getClassFilePath(binDir, sourceFilePath) {
  const className = path.basename(sourceFilePath, '.java');
  return path.join(binDir, `${className}.class`);
}

function shouldCompileJavaSources({ sourceFiles, binDir }) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    return false;
  }

  return sourceFiles.some((sourceFilePath) => {
    const classFilePath = getClassFilePath(binDir, sourceFilePath);
    if (!fs.existsSync(classFilePath)) {
      return true;
    }
    return fs.statSync(sourceFilePath).mtimeMs > fs.statSync(classFilePath).mtimeMs;
  });
}

function runProcess(command, args, errorLabel) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`${errorLabel}: ${result.error.message}`);
  }

  return result;
}

function ensureJavaSourcesCompiled({ cwd = process.cwd(), verbose = false } = {}) {
  const paths = resolveJavaPaths({ cwd });
  const sourceFiles = listJavaSourceFiles(paths.sourceDir);

  if (sourceFiles.length === 0) {
    throw new Error(`No Java sources found in ${paths.sourceDir}`);
  }

  fs.mkdirSync(paths.binDir, { recursive: true });

  if (!shouldCompileJavaSources({ sourceFiles, binDir: paths.binDir })) {
    return {
      compiled: false,
      sourceFiles,
      classpath: resolveJavaClasspath({ cwd }),
      ...paths,
    };
  }

  const compileArgs = ['-cp', resolveJavaClasspath({ cwd }), '-d', paths.binDir, ...sourceFiles];
  const compileResult = runProcess('javac', compileArgs, 'Failed to run javac');
  if (compileResult.status !== 0) {
    const stderr = (compileResult.stderr || '').trim();
    throw new Error(`Java compile failed: ${stderr || 'unknown error'}`);
  }

  if (verbose) {
    console.log(`[verbose] Compiled ${sourceFiles.length} Java helper source files`);
  }

  return {
    compiled: true,
    sourceFiles,
    classpath: resolveJavaClasspath({ cwd }),
    ...paths,
  };
}

function runJavaClass(className, args, { cwd = process.cwd() } = {}) {
  const classpath = resolveJavaClasspath({ cwd });
  return runProcess('java', ['-cp', classpath, className, ...args], `Failed to run Java helper ${className}`);
}

module.exports = {
  resolveJavaPaths,
  resolveJavaClasspathEntries,
  resolveJavaClasspath,
  listClasspathJarEntries,
  listJavaSourceFiles,
  shouldCompileJavaSources,
  ensureJavaSourcesCompiled,
  runJavaClass,
};
