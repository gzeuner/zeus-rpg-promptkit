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
const { ensureJavaSourcesCompiled, runJavaClass } = require('../java/javaRuntime');

function ensureJavaHelperCompiled() {
  return ensureJavaSourcesCompiled();
}

function parseJsonResult(stdout, fallback) {
  const content = (stdout || '').trim();
  if (!content) {
    return fallback;
  }

  try {
    return JSON.parse(content);
  } catch (_) {
    return fallback;
  }
}

function runJavaHelper(className, args) {
  return runJavaClass(className, args);
}

function runClCommand({ host, user, password, command, verbose }) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] CL command: ${command}`);
  }

  const result = runJavaHelper('IbmiCommandRunner', [host, user, password, command]);
  const parsed = parseJsonResult(result.stdout, {
    ok: result.status === 0,
    command,
    messages: [(result.stderr || '').trim()].filter(Boolean),
    timestamp: new Date().toISOString(),
  });

  return {
    ...parsed,
    exitCode: result.status,
    stderr: (result.stderr || '').trim(),
  };
}

function listMembers({ host, user, password, sourceLib, sourceFile, verbose }) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] Listing members in ${sourceLib}/${sourceFile}`);
  }

  const result = runJavaHelper('IbmiMemberLister', [host, user, password, sourceLib, sourceFile]);
  const parsed = parseJsonResult(result.stdout, {
    ok: false,
    members: [],
    messages: [(result.stderr || '').trim()].filter(Boolean),
    timestamp: new Date().toISOString(),
  });

  return {
    ok: parsed.ok === true && result.status === 0,
    members: Array.isArray(parsed.members) ? parsed.members : [],
    messages: parsed.messages || [],
    exitCode: result.status,
    stderr: (result.stderr || '').trim(),
  };
}

function exportSourceMemberViaJdbc({
  host,
  user,
  password,
  sourceLib,
  sourceFile,
  member,
  targetPath,
  streamFileCcsid,
  verbose,
}) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] JDBC source export fallback for ${sourceLib}/${sourceFile}(${member}) -> ${targetPath}`);
  }

  const result = runJavaHelper('IbmiSourceMemberExporter', [
    host,
    user,
    password,
    sourceLib,
    sourceFile,
    member,
    targetPath,
    String(streamFileCcsid),
  ]);

  const parsed = parseJsonResult(result.stdout, {
    ok: false,
    messages: [(result.stderr || '').trim()].filter(Boolean),
    timestamp: new Date().toISOString(),
  });

  return {
    ok: parsed.ok === true && result.status === 0,
    linesWritten: Number(parsed.linesWritten || 0),
    usedFallback: parsed.usedFallback === true,
    messages: parsed.messages || [],
    exitCode: result.status,
    stderr: (result.stderr || '').trim(),
  };
}

module.exports = {
  ensureJavaHelperCompiled,
  runJavaHelper,
  runClCommand,
  listMembers,
  exportSourceMemberViaJdbc,
};
