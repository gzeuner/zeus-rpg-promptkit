const path = require('path');
const { ensureJavaHelperCompiled, runJavaHelper } = require('./jt400CommandRunner');

function parseJsonResult(stdout, fallback) {
  const text = (stdout || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

async function downloadDirectoryViaJt400({
  host,
  user,
  password,
  remoteDir,
  localDir,
  verbose,
}) {
  ensureJavaHelperCompiled('IbmiIfsDownloader.java', 'IbmiIfsDownloader');
  const resolvedLocal = path.resolve(process.cwd(), localDir);
  if (verbose) {
    console.log(`[verbose] JT400 IFS download ${remoteDir} -> ${resolvedLocal}`);
  }

  const result = runJavaHelper('IbmiIfsDownloader', [host, user, password, remoteDir, resolvedLocal]);
  const parsed = parseJsonResult(result.stdout, {
    ok: result.status === 0,
    downloadedCount: 0,
    messages: [(result.stderr || '').trim()].filter(Boolean),
    timestamp: new Date().toISOString(),
  });

  if (result.status !== 0 || parsed.ok !== true) {
    const details = (parsed.messages || []).join('; ') || (result.stderr || '').trim() || `exit ${result.status}`;
    throw new Error(`JT400 download failed: ${details}`);
  }

  return {
    downloadedCount: Number(parsed.downloadedCount || 0),
  };
}

module.exports = {
  downloadDirectoryViaJt400,
};

