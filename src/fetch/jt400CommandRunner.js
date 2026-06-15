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
const { ensureJavaSourcesCompiled, runJavaClass } = require('../java/javaRuntime');
const { ensureFetchConnectionGuard } = require('../security/connectionGuards');

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

function executeClCommandRaw({ host, user, password, command, verbose, runtime = {} }) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] CL command: ${command}`);
  }

  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const result = runJavaHelperFn('IbmiCommandRunner', [host, user, password, command]);
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

function runClCommand({ host, user, password, command, verbose, runtime = {} }) {
  if (!runtime.skipConnectionGuard) {
    ensureFetchConnectionGuard({
      fetchConfig: { host, user, password },
      scopeLabel: runtime.scopeLabel || 'IBM i command connection',
      probe: (probeOptions) => {
        const result = executeClCommandRaw({
          ...probeOptions,
          runtime: {
            ...runtime,
            skipConnectionGuard: true,
          },
        });
        if (!result.ok) {
          throw new Error(result.messages.join('; ') || result.stderr || 'IBM i command probe failed.');
        }
        return result;
      },
    });
  }

  return executeClCommandRaw({ host, user, password, command, verbose, runtime });
}

function executeListMembersRaw({ host, user, password, sourceLib, sourceFile, verbose, runtime = {} }) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] Listing members in ${sourceLib}/${sourceFile}`);
  }

  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const result = runJavaHelperFn('IbmiMemberLister', [host, user, password, sourceLib, sourceFile]);
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

function listMembers({ host, user, password, sourceLib, sourceFile, verbose, runtime = {} }) {
  if (!runtime.skipConnectionGuard) {
    ensureFetchConnectionGuard({
      fetchConfig: { host, user, password },
      scopeLabel: runtime.scopeLabel || 'IBM i fetch connection',
      probe: (probeOptions) => {
        const result = executeClCommandRaw({
          ...probeOptions,
          runtime: {
            ...runtime,
            skipConnectionGuard: true,
          },
        });
        if (!result.ok) {
          throw new Error(result.messages.join('; ') || result.stderr || 'IBM i fetch probe failed.');
        }
        return result;
      },
    });
  }

  return executeListMembersRaw({ host, user, password, sourceLib, sourceFile, verbose, runtime });
}

function executeExportSourceMemberViaJdbcRaw({
  host,
  user,
  password,
  sourceLib,
  sourceFile,
  member,
  targetPath,
  streamFileCcsid,
  verbose,
  runtime = {},
}) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] JDBC source export fallback for ${sourceLib}/${sourceFile}(${member}) -> ${targetPath}`);
  }

  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const result = runJavaHelperFn('IbmiSourceMemberExporter', [
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
  runtime = {},
}) {
  if (!runtime.skipConnectionGuard) {
    ensureFetchConnectionGuard({
      fetchConfig: { host, user, password },
      scopeLabel: runtime.scopeLabel || 'IBM i member export connection',
      probe: (probeOptions) => {
        const result = executeClCommandRaw({
          ...probeOptions,
          runtime: {
            ...runtime,
            skipConnectionGuard: true,
          },
        });
        if (!result.ok) {
          throw new Error(result.messages.join('; ') || result.stderr || 'IBM i member export probe failed.');
        }
        return result;
      },
    });
  }

  return executeExportSourceMemberViaJdbcRaw({
    host,
    user,
    password,
    sourceLib,
    sourceFile,
    member,
    targetPath,
    streamFileCcsid,
    verbose,
    runtime,
  });
}

module.exports = {
  executeClCommandRaw,
  executeExportSourceMemberViaJdbcRaw,
  executeListMembersRaw,
  ensureJavaHelperCompiled,
  runJavaHelper,
  runClCommand,
  listMembers,
  exportSourceMemberViaJdbc,
};
