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
const { listMembers } = require('./jt400CommandRunner');
const {
  exportMembersForSourceFile,
  buildLocalTargetPath,
  buildRemoteTargetPath,
  DEFAULT_STREAM_FILE_CCSID,
} = require('./ifsExporter');
const { downloadDirectory } = require('./sftpDownloader');
const { downloadDirectoryViaJt400 } = require('./jt400Downloader');
const { downloadDirectoryViaFtp } = require('./ftpDownloader');
const { buildImportManifest, writeImportManifest } = require('./importManifest');
const { SOURCE_FILES_PRIORITY } = require('./memberDiscovery');

const DEFAULT_SOURCE_FILES = [...SOURCE_FILES_PRIORITY];
const DEFAULT_TRANSPORT = 'auto';
const TRANSPORTS = ['auto', 'sftp', 'jt400', 'ftp'];

function describeEncodingPolicy(streamFileCcsid) {
  if (Number(streamFileCcsid) === DEFAULT_STREAM_FILE_CCSID) {
    return `UTF-8 stream files (CCSID ${DEFAULT_STREAM_FILE_CCSID})`;
  }
  return `stream files with CCSID ${streamFileCcsid}`;
}

function parseList(value, fallback) {
  if (!value) {
    return [...fallback];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toUpperCase());
}

async function resolveMembersForFile(options, sourceFile, services = {}) {
  const listMembersFn = services.listMembersFn || listMembers;
  if (options.members && options.members.length > 0) {
    return {
      members: [...options.members],
      notes: [],
    };
  }

  const result = await listMembersFn({
    host: options.host,
    user: options.user,
    password: options.password,
    sourceLib: options.sourceLib,
    sourceFile,
    verbose: options.verbose,
  });

  if (!result.ok) {
    return {
      members: [],
      notes: [`Failed to list members for ${options.sourceLib}/${sourceFile}: ${(result.messages || []).join('; ') || result.stderr || `exit ${result.exitCode}`}`],
    };
  }

  return {
    members: result.members.map((member) => String(member).trim().toUpperCase()).filter(Boolean),
    notes: [],
  };
}

async function fetchSources(options, services = {}) {
  const exportMembersForSourceFileFn = services.exportMembersForSourceFileFn || exportMembersForSourceFile;
  const downloadDirectoryFn = services.downloadDirectoryFn || downloadDirectory;
  const downloadDirectoryViaJt400Fn = services.downloadDirectoryViaJt400Fn || downloadDirectoryViaJt400;
  const downloadDirectoryViaFtpFn = services.downloadDirectoryViaFtpFn || downloadDirectoryViaFtp;
  const writeImportManifestFn = services.writeImportManifestFn || writeImportManifest;
  const files = parseList(options.files, DEFAULT_SOURCE_FILES);
  const globalMembers = options.members ? parseList(options.members, []) : null;
  const localDestination = path.resolve(process.cwd(), options.out);
  const exportRecords = [];

  const summary = {
    exportedSuccess: 0,
    exportedTotal: 0,
    downloadedCount: 0,
    localDestination,
    notes: [],
    encodingPolicy: describeEncodingPolicy(options.streamFileCcsid),
    transportUsed: null,
    importManifestPath: null,
  };

  for (const sourceFile of files) {
    const memberResolution = await resolveMembersForFile({
      ...options,
      members: globalMembers,
    }, sourceFile, services);

    const members = Array.isArray(memberResolution.members) ? memberResolution.members : [];
    summary.notes.push(...(memberResolution.notes || []));

    if (members.length === 0) {
      summary.notes.push(`No members discovered for ${options.sourceLib}/${sourceFile}.`);
      continue;
    }

    const exportResults = await exportMembersForSourceFileFn({
      host: options.host,
      user: options.user,
      password: options.password,
      sourceLib: options.sourceLib.toUpperCase(),
      sourceFile,
      members,
      ifsDir: options.ifsDir,
      replace: options.replace !== false,
      streamFileCcsid: options.streamFileCcsid,
      verbose: options.verbose,
    });

    for (const result of exportResults) {
      summary.exportedTotal += 1;
      if (result.ok) {
        summary.exportedSuccess += 1;
      } else {
        summary.notes.push(`Export failed ${result.sourceFile}/${result.member}: ${(result.messages || []).join('; ') || result.stderr || 'unknown error'}`);
      }

      exportRecords.push({
        ...result,
        sourceLib: options.sourceLib,
        localPath: buildLocalTargetPath({
          sourceFile: result.sourceFile,
          member: result.member,
          localRoot: localDestination,
        }),
        remotePath: buildRemoteTargetPath({
          sourceFile: result.sourceFile,
          member: result.member,
          ifsDir: options.ifsDir,
        }),
      });
    }
  }

  const transport = String(options.transport || DEFAULT_TRANSPORT).trim().toLowerCase();
  if (!TRANSPORTS.includes(transport)) {
    throw new Error(`Unsupported transport "${transport}". Valid values: ${TRANSPORTS.join(', ')}`);
  }

  const strategies = transport === 'auto'
    ? ['sftp', 'jt400', 'ftp']
    : [transport];

  let lastError = null;
  for (const strategy of strategies) {
    try {
      let downloadResult;
      if (strategy === 'sftp') {
        downloadResult = await downloadDirectoryFn({
          host: options.host,
          user: options.user,
          password: options.password,
          remoteDir: options.ifsDir,
          localDir: options.out,
          verbose: options.verbose,
        });
      } else if (strategy === 'jt400') {
        downloadResult = await downloadDirectoryViaJt400Fn({
          host: options.host,
          user: options.user,
          password: options.password,
          remoteDir: options.ifsDir,
          localDir: options.out,
          verbose: options.verbose,
        });
      } else {
        downloadResult = await downloadDirectoryViaFtpFn({
          host: options.host,
          user: options.user,
          password: options.password,
          remoteDir: options.ifsDir,
          localDir: options.out,
          verbose: options.verbose,
        });
      }

      summary.downloadedCount = downloadResult.downloadedCount || 0;
      summary.transportUsed = strategy;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      summary.notes.push(`Download via ${strategy} failed: ${error.message}`);
    }
  }

  if (lastError) {
    throw new Error(`All download transports failed. Last error: ${lastError.message}`);
  }

  const manifest = buildImportManifest({
    options,
    summary,
    exportRecords,
    localDestination,
  });
  summary.importManifestPath = await writeImportManifestFn(localDestination, manifest);

  return summary;
}

module.exports = {
  fetchSources,
  DEFAULT_SOURCE_FILES,
  DEFAULT_TRANSPORT,
  describeEncodingPolicy,
};
