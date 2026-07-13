'use strict';

const { execFileSync } = require('child_process');

function runGit(args) {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || e.message}`);
  }
}

function getCurrentBranchSha() {
  return runGit(['rev-parse', 'HEAD']);
}

function getRemoteMainSha() {
  return runGit(['rev-parse', 'origin/main']);
}

module.exports.getRemoteMainSha = getRemoteMainSha;

function compareWithMain(branchOrSha) {
  // Returns { behind, ahead, isAncestor }
  const range = `origin/main...${branchOrSha}`;
  const aheadBehind = runGit(['rev-list', '--left-right', '--count', range]);
  const [behindStr, aheadStr] = aheadBehind.split('\t').map(s => Number(s.trim()));
  let isAncestor = false;
  try {
    runGit(['merge-base', '--is-ancestor', 'origin/main', branchOrSha]);
    isAncestor = true;
  } catch (_) {
    isAncestor = false;
  }
  return {
    behind: behindStr || 0,
    ahead: aheadStr || 0,
    isAncestorOfMain: isAncestor,
  };
}

function getLocalSha(candidate) {
  if (!candidate) return null;
  try {
    return runGit(['rev-parse', '--verify', candidate]);
  } catch (_) {
    return null;
  }
}

module.exports = {
  getCurrentBranchSha,
  getRemoteMainSha,
  compareWithMain,
  getLocalSha,
};
