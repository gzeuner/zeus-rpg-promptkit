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
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ensureJavaSourcesCompiled, runJavaClass, SECRET_ENV_SENTINEL } = require('../java/javaRuntime');
const { ensureFetchConnectionGuard } = require('../security/connectionGuards');

const COMMAND_FILE_THRESHOLD = 1800;

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

function runJavaHelper(className, args, options) {
  return runJavaClass(className, args, options);
}

function normalizeCommandList({ command, commands }) {
  if (Array.isArray(commands)) {
    return commands.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (Array.isArray(command)) {
    return command.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const single = String(command || '').trim();
  return single ? [single] : [];
}

function writeCommandFile(commands) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ibmi-commands-'));
  const filePath = path.join(tempDir, 'commands.txt');
  fs.writeFileSync(filePath, `${commands.join('\n')}\n`, 'utf8');
  return {
    tempDir,
    filePath,
  };
}

function shouldUseCommandFile(commands, runtime = {}) {
  if (runtime.forceCommandFile) {
    return true;
  }
  return commands.length !== 1 || commands.some((entry) => entry.length > COMMAND_FILE_THRESHOLD);
}

function buildCommandRunnerArgs({
  host,
  user,
  commands,
  outputFile,
  outputCcsid,
  deleteOutputFile,
  runtime = {},
}) {
  const args = [host, user, SECRET_ENV_SENTINEL];
  let commandFile = null;

  if (shouldUseCommandFile(commands, runtime)) {
    commandFile = writeCommandFile(commands);
    args.push('--commands-file', commandFile.filePath);
  } else {
    args.push(commands[0]);
  }

  if (outputFile) {
    args.push('--output-file', outputFile);
    args.push('--output-ccsid', outputCcsid || 'Cp037');
    args.push('--delete-output-file', deleteOutputFile ? 'true' : 'false');
  }

  return {
    args,
    commandFile,
  };
}

function removeCommandFile(commandFile) {
  if (!commandFile || !commandFile.tempDir) {
    return;
  }
  fs.rmSync(commandFile.tempDir, { recursive: true, force: true });
}

function quoteClString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildRemoteOutputPath(prefix = 'zeus-qsh-output') {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return `/tmp/${prefix}-${suffix}.out`;
}

function buildQshCaptureCommand(script, outputFile) {
  const remoteOutput = String(outputFile || buildRemoteOutputPath()).trim();
  const qshScript = `{ ${String(script || ':').trim()} ; } > ${remoteOutput} 2>&1`;
  return {
    command: `QSH CMD(${quoteClString(qshScript)})`,
    outputFile: remoteOutput,
  };
}

function executeClCommandRaw({
  host,
  user,
  password,
  command,
  commands,
  outputFile,
  outputCcsid,
  deleteOutputFile,
  verbose,
  runtime = {},
}) {
  ensureJavaHelperCompiled();
  const commandList = normalizeCommandList({ command, commands });
  if (commandList.length === 0) {
    throw new Error('IBM i command runner requires at least one command.');
  }
  if (verbose) {
    if (commandList.length === 1) {
      console.log(`[verbose] CL command: ${commandList[0]}`);
    } else {
      console.log(`[verbose] CL command batch: ${commandList.length} commands`);
      commandList.forEach((entry, index) => console.log(`[verbose]   [${index + 1}] ${entry}`));
    }
    if (outputFile) {
      console.log(`[verbose] CL output capture: ${outputFile} (${outputCcsid || 'Cp037'})`);
    }
  }

  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const { args, commandFile } = buildCommandRunnerArgs({
    host,
    user,
    commands: commandList,
    outputFile,
    outputCcsid,
    deleteOutputFile,
    runtime,
  });

  let result;
  try {
    result = runJavaHelperFn('IbmiCommandRunner', args, { password, timeout: runtime.timeoutMs });
  } finally {
    removeCommandFile(commandFile);
  }

  const parsed = parseJsonResult(result.stdout, {
    ok: result.status === 0,
    command: commandList.length === 1 ? commandList[0] : undefined,
    commands: commandList,
    results: [],
    messages: [(result.stderr || '').trim()].filter(Boolean),
    timestamp: new Date().toISOString(),
  });

  return {
    ...parsed,
    commands: Array.isArray(parsed.commands) ? parsed.commands : commandList,
    command: parsed.command || (commandList.length === 1 ? commandList[0] : undefined),
    results: Array.isArray(parsed.results) ? parsed.results : [],
    outputText: parsed.outputText || parsed.stdout || '',
    stdout: parsed.stdout || parsed.outputText || '',
    exitCode: result.status,
    stderr: (result.stderr || '').trim(),
  };
}

function runClCommand({
  host,
  user,
  password,
  command,
  commands,
  outputFile,
  outputCcsid,
  deleteOutputFile,
  verbose,
  runtime = {},
}) {
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

  return executeClCommandRaw({
    host,
    user,
    password,
    command,
    commands,
    outputFile,
    outputCcsid,
    deleteOutputFile,
    verbose,
    runtime,
  });
}

function runClCommands({ host, user, password, commands, verbose, runtime = {} }) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('runClCommands requires a non-empty commands array.');
  }
  return runClCommand({
    host,
    user,
    password,
    commands,
    verbose,
    runtime,
  });
}

function runQshCommand({
  host,
  user,
  password,
  script,
  outputFile,
  outputCcsid = 'Cp037',
  deleteOutputFile,
  verbose,
  runtime = {},
}) {
  const capture = buildQshCaptureCommand(script, outputFile);
  const shouldDeleteOutputFile = deleteOutputFile !== undefined
    ? Boolean(deleteOutputFile)
    : !outputFile;
  const result = runClCommand({
    host,
    user,
    password,
    command: capture.command,
    outputFile: capture.outputFile,
    outputCcsid,
    deleteOutputFile: shouldDeleteOutputFile,
    verbose,
    runtime,
  });
  return {
    ...result,
    qshScript: script,
    outputFile: capture.outputFile,
    outputText: result.outputText || result.stdout || '',
    stdout: result.stdout || result.outputText || '',
  };
}

function executeListMembersRaw({ host, user, password, sourceLib, sourceFile, verbose, runtime = {} }) {
  ensureJavaHelperCompiled();
  if (verbose) {
    console.log(`[verbose] Listing members in ${sourceLib}/${sourceFile}`);
  }

  const runJavaHelperFn = runtime.runJavaHelper || runJavaHelper;
  const result = runJavaHelperFn('IbmiMemberLister', [host, user, SECRET_ENV_SENTINEL, sourceLib, sourceFile], { password });
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
  writeMode = 'ifs',
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
    SECRET_ENV_SENTINEL,
    sourceLib,
    sourceFile,
    member,
    targetPath,
    String(streamFileCcsid),
    String(writeMode || 'ifs'),
  ], { password });

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
  writeMode = 'ifs',
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
    writeMode,
    verbose,
    runtime,
  });
}

module.exports = {
  SECRET_ENV_SENTINEL,
  buildQshCaptureCommand,
  executeClCommandRaw,
  executeExportSourceMemberViaJdbcRaw,
  executeListMembersRaw,
  ensureJavaHelperCompiled,
  quoteClString,
  runJavaHelper,
  runClCommands,
  runClCommand,
  runQshCommand,
  listMembers,
  exportSourceMemberViaJdbc,
};
