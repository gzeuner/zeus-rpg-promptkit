/*
Copyright 2026 gzeuner - tiny-tool.de

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

// Secure secret passing to the Java helpers. The password is provided to the JVM
// via this environment variable; SECRET_ENV_SENTINEL is placed in the CLI argument
// vector where the password would otherwise appear, so it never reaches the OS
// process list. Kept in sync with java/ZeusSecrets.java.
const SECRET_ENV_VAR = 'ZEUS_JV_PASSWORD';
const SECRET_ENV_SENTINEL = '@ZEUS_SECRET_ENV@';

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

  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.java'))
    .map(entry => path.join(sourceDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function listClasspathJarEntries(paths) {
  const jarEntries = [];

  for (const dirPath of [paths.binDir, paths.libDir]) {
    if (!fs.existsSync(dirPath)) {
      continue;
    }

    const jars = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
      .map(entry => path.join(dirPath, entry.name))
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

  return sourceFiles.some(sourceFilePath => {
    const classFilePath = getClassFilePath(binDir, sourceFilePath);
    if (!fs.existsSync(classFilePath)) {
      return true;
    }
    return fs.statSync(sourceFilePath).mtimeMs > fs.statSync(classFilePath).mtimeMs;
  });
}

function runProcess(command, args, errorLabel, env, timeoutMs) {
  const spawnOpts = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Java helpers (e.g. source-wide search) can emit large JSON payloads;
    // the default 1 MB buffer overflows with ENOBUFS on big result sets.
    maxBuffer: 256 * 1024 * 1024,
    ...(env ? { env } : {}),
  };
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    spawnOpts.timeout = timeoutMs;
  }
  const result = spawnSync(command, args, spawnOpts);

  if (result.error) {
    if (
      result.error.code === 'ETIMEDOUT' ||
      (result.signal && String(result.signal).toUpperCase().includes('SIG'))
    ) {
      throw new Error(`${errorLabel}: timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${errorLabel}: ${result.error.message}`);
  }

  return result;
}

function ensureJavaSourcesCompiled({ cwd = process.cwd(), verbose = false, runtime = {} } = {}) {
  if (runtime && (runtime.skipJavaCompile || runtime.runJavaHelper)) {
    // In mocked test runtimes, skip real compile (jt400.jar not present in clean CI; tests simulate via runJavaHelper)
    return {
      compiled: false,
      sourceFiles: [],
      classpath: '',
      binDir: '',
      sourceDir: '',
    };
  }

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

const HEARTBEAT_CLASSES = new Set([
  'Db2DiagnosticQueryRunner',
  'Db2WriteQueryRunner',
  'Db2MetadataExporter',
  'Db2TestDataExtractor',
]);

function runJavaClass(
  className,
  args,
  { cwd = process.cwd(), heartbeat = false, password, timeout } = {}
) {
  const classpath = resolveJavaClasspath({ cwd });
  const showHeartbeat = heartbeat || HEARTBEAT_CLASSES.has(className);
  if (showHeartbeat) {
    process.stderr.write(`[zeus] ${className}: Verbindung aufbauen...\n`);
  }
  const t0 = Date.now();
  // Security: when a password is supplied, it is passed to the Java child via the
  // ZEUS_JV_PASSWORD environment variable (NOT as a CLI argument), so it never
  // appears in the OS process list. The caller places SECRET_ENV_SENTINEL in the
  // argument vector where the password would otherwise go; ZeusSecrets.resolve()
  // swaps it back inside the JVM.
  const childEnv =
    password !== undefined && password !== null
      ? { ...process.env, [SECRET_ENV_VAR]: String(password) }
      : undefined;
  const result = runProcess(
    'java',
    ['-cp', classpath, className, ...args],
    `Failed to run Java helper ${className}`,
    childEnv,
    timeout
  );
  if (showHeartbeat) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stderr.write(`[zeus] ${className}: fertig (${elapsed}s)\n`);
  }
  return result;
}

module.exports = {
  SECRET_ENV_SENTINEL,
  SECRET_ENV_VAR,
  resolveJavaPaths,
  resolveJavaClasspathEntries,
  resolveJavaClasspath,
  listClasspathJarEntries,
  listJavaSourceFiles,
  shouldCompileJavaSources,
  ensureJavaSourcesCompiled,
  runJavaClass,
};
