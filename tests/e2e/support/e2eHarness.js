'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createE2eWorkspace(prefix = 'zeus-e2e-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  let removed = false;
  return {
    root,
    path(...parts) {
      return path.join(root, ...parts);
    },
    cleanup() {
      if (removed) return;
      removed = true;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function runProcess(command, args = [], options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 120000;
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const error = new Error(`Process timed out after ${timeoutMs}ms: ${command}`);
      error.stdout = stdout;
      error.stderr = stderr;
      settled = true;
      reject(error);
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ command, args, code, signal, stdout, stderr });
    });
  });
}

async function waitFor(check, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 30000;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 100;
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  const error = new Error(options.message || `Condition was not met within ${timeoutMs}ms`);
  if (lastError) error.cause = lastError;
  throw error;
}

function assertNoSensitiveTerms(value, terms = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const term of terms) {
    if (term && text.includes(String(term))) {
      throw new Error(`E2E output contains a forbidden sensitive term: ${term}`);
    }
  }
}

function commandExists(command) {
  const result =
    process.platform === 'win32'
      ? require('node:child_process').spawnSync('where.exe', [command], { stdio: 'ignore' })
      : require('node:child_process').spawnSync('sh', ['-lc', `command -v ${command}`], {
          stdio: 'ignore',
        });
  return result.status === 0;
}

function skipUnlessAvailable(testContext, command, message) {
  if (!commandExists(command)) {
    const reason = `${message || command} is not available`;
    if (process.env.ZEUS_E2E_REQUIRED === '1') throw new Error(reason);
    testContext.skip(reason);
    return false;
  }
  return true;
}

function skipOrFailPrerequisite(testContext, message) {
  if (process.env.ZEUS_E2E_REQUIRED === '1') throw new Error(message);
  testContext.skip(message);
  return false;
}

module.exports = {
  assertNoSensitiveTerms,
  commandExists,
  createE2eWorkspace,
  runProcess,
  skipOrFailPrerequisite,
  skipUnlessAvailable,
  waitFor,
};
