const path = require('path');
const { runClCommand } = require('./jt400CommandRunner');

const EXTENSION_MAP = {
  QRPGLESRC: '.rpgle',
  QSQLRPGLESRC: '.sqlrpgle',
  QRPGSRC: '.rpg',
  QCLSRC: '.clp',
  QCLLESRC: '.clle',
  QCPYSRC: '.cpy',
  QDDSSRC: '.dds',
};

function clQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function memberToExtension(sourceFile) {
  return EXTENSION_MAP[String(sourceFile || '').toUpperCase()] || '.src';
}

function buildMkdirCommand(remoteDir) {
  return `MKDIR DIR(${clQuote(remoteDir)})`;
}

function buildCopyCommand({ sourceLib, sourceFile, member, ifsDir, replace }) {
  const extension = memberToExtension(sourceFile);
  const fromMember = `/QSYS.LIB/${sourceLib}.LIB/${sourceFile}.FILE/${member}.MBR`;
  const toFile = path.posix.join(ifsDir, sourceFile, `${member}${extension}`);
  const stmfOpt = replace ? '*REPLACE' : '*NONE';
  return `CPYTOSTMF FROMMBR(${clQuote(fromMember)}) TOSTMF(${clQuote(toFile)}) STMFOPT(${stmfOpt}) STMFCODPAG(*STMF)`;
}

function ensureRemoteDirectory(options, remoteDir) {
  const mkdirResult = runClCommand({
    ...options,
    command: buildMkdirCommand(remoteDir),
  });

  if (mkdirResult.ok) {
    return;
  }

  const combined = `${mkdirResult.stderr || ''} ${(mkdirResult.messages || []).join(' ')}`.toUpperCase();
  const alreadyExists = combined.includes('ALREADY EXISTS')
    || combined.includes('CPFA0A9')
    || combined.includes('CPF0000');

  if (!alreadyExists) {
    throw new Error(`Failed to ensure IFS directory ${remoteDir}: ${combined || 'unknown error'}`);
  }
}

function exportMembersForSourceFile({
  host,
  user,
  password,
  sourceLib,
  sourceFile,
  members,
  ifsDir,
  replace,
  verbose,
}) {
  const baseOptions = { host, user, password, verbose };
  ensureRemoteDirectory(baseOptions, ifsDir);
  ensureRemoteDirectory(baseOptions, path.posix.join(ifsDir, sourceFile));

  const results = [];
  for (const member of members) {
    const command = buildCopyCommand({
      sourceLib,
      sourceFile,
      member,
      ifsDir,
      replace,
    });

    const result = runClCommand({
      ...baseOptions,
      command,
    });

    results.push({
      sourceFile,
      member,
      ok: result.ok === true,
      command,
      messages: result.messages || [],
      stderr: result.stderr || '',
    });
  }

  return results;
}

module.exports = {
  exportMembersForSourceFile,
};

