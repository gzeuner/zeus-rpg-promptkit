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
const path = require('path');

const { loadProfiles, resolveProfile } = require('../../config/runtimeConfig');
const { renderAsciiTable } = require('../helpers/asciiTable');
const {
  deriveWorkspaceId,
  listWorkspaces,
  readWorkspaceById,
  registerWorkspace,
  resolveRegistryPath,
  touchWorkspace,
  unregisterWorkspace,
} = require('../../workspace/analysisRegistryService');
const {
  readWorkspaceIndex,
  writeWorkspaceIndex,
} = require('../../workspace/workspaceIndexBuilder');
const { startLocalUiServer, DEFAULT_UI_HOST, DEFAULT_UI_PORT } = require('../../ui/localUiServer');

function parsePort(value, fallback) {
  if (value === undefined || value === null || value === true) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Invalid option: --port must be a non-negative integer');
  }
  return parsed;
}

function resolveProfileIfRequested(args, runtime) {
  if (!args.profile) {
    return null;
  }
  const profiles = loadProfiles({ cwd: runtime.cwd, env: runtime.env, args });
  return resolveProfile(profiles, args.profile, { env: runtime.env });
}

function resolveCommandContext(args, runtime = {}) {
  const resolvedRuntime = {
    cwd: runtime.cwd || process.cwd(),
    env: runtime.env || process.env,
  };
  const profile = resolveProfileIfRequested(args, resolvedRuntime);
  const registryPath = resolveRegistryPath({
    registryPath: args['registry-path'],
    cwd: resolvedRuntime.cwd,
    env: resolvedRuntime.env,
    profile,
  });

  return {
    ...resolvedRuntime,
    profile,
    registryPath,
  };
}

function requireSubcommand(args) {
  const subcommand = Array.isArray(args._) && args._.length > 0
    ? String(args._[0] || '').trim().toLowerCase()
    : '';
  if (!subcommand) {
    throw new Error('Missing analyses subcommand. Use: list | register | index | open | show | unregister');
  }
  return subcommand;
}

function resolveWorkspacePathForIndex(args, context) {
  if (args.path) {
    return path.resolve(context.cwd, String(args.path));
  }
  if (args.id) {
    const workspace = readWorkspaceById(context.registryPath, args.id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${args.id}`);
    }
    return workspace.path;
  }
  throw new Error('Missing required option: --path <workspace-root> (or --id <workspace-id>)');
}

function printWorkspaceList(context) {
  const workspaces = listWorkspaces(context.registryPath);
  if (workspaces.length === 0) {
    console.log(`No workspaces registered in ${context.registryPath}`);
    return;
  }

  const rows = workspaces.map((workspace) => {
    const index = readWorkspaceIndex(workspace.path);
    const programCount = index && Array.isArray(index.programs) ? index.programs.length : 0;
    return [
      workspace.id,
      workspace.name || '',
      workspace.outputDir || 'output',
      programCount,
      workspace.lastAccessedAt || '',
    ];
  });

  console.log(renderAsciiTable(
    ['ID', 'Name', 'Output Dir', 'Programs', 'Last Accessed'],
    rows,
    { maxCellWidth: 42 },
  ));
}

function runRegister(args, context) {
  if (!args.path) {
    throw new Error('Missing required option: --path <workspace-root>');
  }

  const workspacePath = path.resolve(context.cwd, String(args.path));
  const id = args.id ? String(args.id).trim().toLowerCase() : deriveWorkspaceId(path.basename(workspacePath));
  const workspace = registerWorkspace(context.registryPath, {
    id,
    name: args.name || id,
    description: args.description || '',
    system: args.system || '',
    library: args.library || '',
    profile: args['profile-name'] || args.profile || '',
    path: workspacePath,
    outputDir: args['output-dir'] || 'output',
    sourceDir: args['source-dir'] || 'rpg_sources',
    tags: args.tags ? String(args.tags).split(',').map((entry) => entry.trim()).filter(Boolean) : [],
  });

  const indexResult = writeWorkspaceIndex(workspace.path, workspace);

  console.log(`Workspace registered: ${workspace.id}`);
  console.log(`Registry: ${context.registryPath}`);
  console.log(`Index: ${indexResult.path}`);
}

function runIndex(args, context) {
  const workspacePath = resolveWorkspacePathForIndex(args, context);
  const knownWorkspace = args.id ? readWorkspaceById(context.registryPath, args.id) : null;
  const entry = knownWorkspace || {
    id: args.id || deriveWorkspaceId(path.basename(workspacePath)),
    name: args.name || path.basename(workspacePath),
    system: args.system || '',
    library: args.library || '',
    outputDir: args['output-dir'] || 'output',
    sourceDir: args['source-dir'] || 'rpg_sources',
  };

  const indexResult = writeWorkspaceIndex(workspacePath, entry);
  console.log(`Workspace index written: ${indexResult.path}`);
  console.log(`Programs indexed: ${indexResult.index.programs.length}`);
}

function runShow(args, context) {
  if (!args.id) {
    throw new Error('Missing required option: --id <workspace-id>');
  }
  const workspace = readWorkspaceById(context.registryPath, args.id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${args.id}`);
  }

  const index = readWorkspaceIndex(workspace.path);
  const programs = index && Array.isArray(index.programs) ? index.programs : [];

  console.log(`ID: ${workspace.id}`);
  console.log(`Name: ${workspace.name}`);
  console.log(`Path: ${workspace.path}`);
  console.log(`Output Dir: ${workspace.outputDir}`);
  console.log(`Source Dir: ${workspace.sourceDir}`);
  console.log(`Programs: ${programs.length}`);
  console.log(`Last Accessed: ${workspace.lastAccessedAt || 'n/a'}`);
}

async function runOpen(args, context) {
  if (!args.id) {
    throw new Error('Missing required option: --id <workspace-id>');
  }

  const workspace = touchWorkspace(context.registryPath, args.id);
  const outputRoot = path.resolve(workspace.path, workspace.outputDir || 'output');
  const host = args.host || DEFAULT_UI_HOST;
  const port = parsePort(args.port, DEFAULT_UI_PORT);

  const result = await startLocalUiServer({
    outputRoot,
    host,
    port,
    registryPath: context.registryPath,
  });

  console.log(`Zeus local UI available at: ${result.url}`);
  console.log(`Serving workspace: ${workspace.id}`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = () => {
    result.server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return result;
}

function runUnregister(args, context) {
  if (!args.id) {
    throw new Error('Missing required option: --id <workspace-id>');
  }
  const removed = unregisterWorkspace(context.registryPath, args.id);
  if (!removed) {
    throw new Error(`Workspace not found: ${args.id}`);
  }
  console.log(`Workspace removed: ${args.id}`);
}

async function run(args = {}, runtime = {}) {
  const context = resolveCommandContext(args, runtime);
  const subcommand = requireSubcommand(args);

  if (subcommand === 'list') {
    printWorkspaceList(context);
    return;
  }
  if (subcommand === 'register') {
    runRegister(args, context);
    return;
  }
  if (subcommand === 'index') {
    runIndex(args, context);
    return;
  }
  if (subcommand === 'show') {
    runShow(args, context);
    return;
  }
  if (subcommand === 'open') {
    await runOpen(args, context);
    return;
  }
  if (subcommand === 'unregister') {
    runUnregister(args, context);
    return;
  }

  throw new Error(`Unsupported analyses subcommand: ${subcommand}`);
}

module.exports = {
  run,
  resolveCommandContext,
};
