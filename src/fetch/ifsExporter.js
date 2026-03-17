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
const path = require('path');
const { runClCommand } = require('./jt400CommandRunner');

const DEFAULT_STREAM_FILE_CCSID = 1208;

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

function buildCopyCommandWithEncoding({
  sourceLib,
  sourceFile,
  member,
  ifsDir,
  replace,
  streamFileCcsid,
}) {
  const extension = memberToExtension(sourceFile);
  const fromMember = `/QSYS.LIB/${sourceLib}.LIB/${sourceFile}.FILE/${member}.MBR`;
  const toFile = path.posix.join(ifsDir, sourceFile, `${member}${extension}`);
  const stmfOpt = replace ? '*REPLACE' : '*NONE';
  const targetCcsid = Number.isInteger(streamFileCcsid) && streamFileCcsid > 0
    ? streamFileCcsid
    : DEFAULT_STREAM_FILE_CCSID;
  return `CPYTOSTMF FROMMBR(${clQuote(fromMember)}) TOSTMF(${clQuote(toFile)}) STMFOPT(${stmfOpt}) STMFCODPAG(${targetCcsid})`;
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
    || combined.includes('CPFA0A0')
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
  streamFileCcsid = DEFAULT_STREAM_FILE_CCSID,
  verbose,
}) {
  const baseOptions = { host, user, password, verbose };
  ensureRemoteDirectory(baseOptions, ifsDir);
  ensureRemoteDirectory(baseOptions, path.posix.join(ifsDir, sourceFile));

  const results = [];
  for (const member of members) {
    const command = buildCopyCommandWithEncoding({
      sourceLib,
      sourceFile,
      member,
      ifsDir,
      replace,
      streamFileCcsid,
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
  buildCopyCommand: buildCopyCommandWithEncoding,
  DEFAULT_STREAM_FILE_CCSID,
};
