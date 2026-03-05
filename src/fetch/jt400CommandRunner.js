const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const JAVA_SOURCE_DIR = path.resolve(process.cwd(), 'java');
const JAVA_BIN_DIR = path.join(JAVA_SOURCE_DIR, 'bin');

function getJt400JarPath() {
  const jarPath = process.env.JT400_JAR;
  if (!jarPath) {
    throw new Error('JT400_JAR is not set. Example: set JT400_JAR=C:\\path\\to\\jt400.jar');
  }
  if (!fs.existsSync(jarPath)) {
    throw new Error(`JT400_JAR points to a missing file: ${jarPath}`);
  }
  return jarPath;
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

function ensureJavaHelperCompiled(sourceFileName, className) {
  const jarPath = getJt400JarPath();
  fs.mkdirSync(JAVA_BIN_DIR, { recursive: true });

  const sourcePath = path.join(JAVA_SOURCE_DIR, sourceFileName);
  const classPath = path.join(JAVA_BIN_DIR, `${className}.class`);
  const shouldCompile = !fs.existsSync(classPath)
    || fs.statSync(sourcePath).mtimeMs > fs.statSync(classPath).mtimeMs;

  if (!shouldCompile) {
    return;
  }

  const compileArgs = ['-cp', jarPath, '-d', JAVA_BIN_DIR, sourcePath];
  const compileResult = runProcess('javac', compileArgs, 'Failed to run javac');
  if (compileResult.status !== 0) {
    const stderr = (compileResult.stderr || '').trim();
    throw new Error(`Java compile failed for ${sourceFileName}: ${stderr || 'unknown error'}`);
  }
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
  const jarPath = getJt400JarPath();
  const classpath = `${jarPath}${path.delimiter}${JAVA_BIN_DIR}`;
  return runProcess('java', ['-cp', classpath, className, ...args], `Failed to run Java helper ${className}`);
}

function runClCommand({ host, user, password, command, verbose }) {
  ensureJavaHelperCompiled('IbmiCommandRunner.java', 'IbmiCommandRunner');
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
  ensureJavaHelperCompiled('IbmiMemberLister.java', 'IbmiMemberLister');
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

module.exports = {
  runClCommand,
  listMembers,
};

