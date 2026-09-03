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
'use strict';

const vscode = require('vscode');
const { spawn } = require('node:child_process');
const path = require('node:path');
const {
  buildCliInvocation,
  computeLocalSourceRoot,
  formatTarget,
  isPathWithin,
  resolveCurrentTarget,
} = require('./adapter');

let outputChannel = null;
let treeProvider = null;
let recentAnalyses = [];

function workspaceRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : null;
}

function getConfig() {
  const config = vscode.workspace.getConfiguration('zeus');
  return {
    defaultProfile: config.get('defaultProfile', 'default'),
    defaultDenseLevel: config.get('defaultDenseLevel', 'full'),
    workingSourceRoot: config.get('workingSourceRoot', ''),
    outputRoot: config.get('outputRoot', '.zeus/output'),
    cliPath: config.get('cliPath', ''),
  };
}

function runCli(invocation, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = (stderr || stdout || `Zeus CLI exited with code ${code}`).trim();
      reject(new Error(detail));
    });
  });
}

function currentTarget() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  return resolveCurrentTarget({
    scheme: document.uri.scheme,
    path: document.uri.path,
    fsPath: document.uri.fsPath,
    fileName: document.fileName,
  });
}

function resolveSourceRoot(target) {
  const root = workspaceRoot();
  if (!root) throw new Error('Open a workspace before using Zeus analysis.');
  const config = getConfig();
  if (config.workingSourceRoot) {
    const configured = path.resolve(root, config.workingSourceRoot);
    if (!isPathWithin(root, configured)) {
      throw new Error('The configured Zeus source root must remain inside the workspace.');
    }
    return configured;
  }
  return computeLocalSourceRoot(target, vscode.workspace.workspaceFolders);
}

function resolveOutputRoot() {
  const root = workspaceRoot();
  if (!root) throw new Error('Open a workspace before using Zeus analysis.');
  const configured = path.resolve(root, getConfig().outputRoot || '.zeus/output');
  if (!isPathWithin(root, configured)) {
    throw new Error('The configured Zeus output root must remain inside the workspace.');
  }
  return configured;
}

function describeCurrentContext(target, sourceRoot) {
  return `${formatTarget(target)}\nSource root: ${sourceRoot}\nOutput root: ${resolveOutputRoot()}`;
}

function showWorkingContext() {
  const target = currentTarget();
  if (!target) {
    vscode.window.showInformationMessage(
      'Zeus: Open a source member to inspect the working context.'
    );
    return;
  }
  try {
    const message = describeCurrentContext(target, resolveSourceRoot(target));
    outputChannel.appendLine(`[working-context]\n${message}`);
    outputChannel.show(true);
    vscode.window.showInformationMessage(message.replace(/\n/g, ' | '));
  } catch (error) {
    vscode.window.showErrorMessage(`Zeus working context: ${error.message}`);
  }
}

async function setWorkingSourceRoot() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('Zeus: Open a workspace before selecting a source root.');
    return;
  }
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as Zeus source root',
  });
  if (!selected || selected.length === 0) return;
  const chosen = selected[0].fsPath;
  if (!isPathWithin(root, chosen)) {
    vscode.window.showErrorMessage(
      'Zeus: The source root must remain inside the current workspace.'
    );
    return;
  }
  await vscode.workspace
    .getConfiguration('zeus')
    .update(
      'workingSourceRoot',
      path.relative(root, chosen) || '.',
      vscode.ConfigurationTarget.Workspace
    );
  outputChannel.appendLine(
    `[working-context] source root set to workspace-relative path: ${path.relative(root, chosen) || '.'}`
  );
  vscode.window.showInformationMessage('Zeus: Working source root updated.');
}

async function clearWorkingSourceRoot() {
  await vscode.workspace
    .getConfiguration('zeus')
    .update('workingSourceRoot', '', vscode.ConfigurationTarget.Workspace);
  vscode.window.showInformationMessage('Zeus: Explicit working source root cleared.');
}

async function openReport(reportPath) {
  const document = await vscode.workspace.openTextDocument(reportPath);
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

async function analyzeCurrent() {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showErrorMessage('Zeus: Workspace Trust is required for local analysis.');
    return;
  }
  const target = currentTarget();
  if (!target || !target.program) {
    vscode.window.showErrorMessage('Zeus: Open an RPG, CL, DDS, or SQL source member first.');
    return;
  }

  try {
    const sourceRoot = resolveSourceRoot(target);
    const outputRoot = resolveOutputRoot();
    const contextSummary = describeCurrentContext(target, sourceRoot);
    const choice = await vscode.window.showInformationMessage(
      `Analyze this Zeus target?\n${contextSummary}`,
      { modal: true },
      'Analyze'
    );
    if (choice !== 'Analyze') return;

    const config = getConfig();
    const invocation = buildCliInvocation({
      workspaceRoot: workspaceRoot(),
      cliPath: config.cliPath,
      target,
      sourceRoot,
      outputRoot,
      profile: config.defaultProfile,
      denseLevel: config.defaultDenseLevel,
    });
    outputChannel.appendLine(`[analyze] ${contextSummary}`);
    await runCli(invocation, workspaceRoot());
    const reportPath = path.join(outputRoot, target.program, 'report.md');
    recentAnalyses.unshift({ target, reportPath, timestamp: new Date().toLocaleTimeString() });
    recentAnalyses = recentAnalyses.slice(0, 10);
    if (treeProvider) treeProvider.refresh();
    outputChannel.appendLine(`[analyze] completed: ${reportPath}`);
    const action = await vscode.window.showInformationMessage(
      `Zeus analysis completed for ${target.program}.`,
      'Open report',
      'Show context'
    );
    if (action === 'Open report') await openReport(reportPath);
    else if (action === 'Show context') showWorkingContext();
  } catch (error) {
    outputChannel.appendLine(`[analyze] failed: ${error.message}`);
    vscode.window.showErrorMessage(`Zeus analysis failed: ${error.message}`);
  }
}

class AnalysesProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    if (recentAnalyses.length === 0) {
      const item = new vscode.TreeItem('No Zeus analyses yet');
      item.description = 'Analyze the current member to begin';
      return [item];
    }
    return recentAnalyses.map(entry => {
      const item = new vscode.TreeItem(entry.target.program);
      item.description = `${entry.timestamp} · ${entry.target.sourceFile || 'source unknown'}`;
      item.tooltip = formatTarget(entry.target);
      item.command = {
        command: 'zeus.openLatestReport',
        title: 'Open Zeus report',
        arguments: [entry.reportPath],
      };
      return item;
    });
  }
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Zeus RPG PromptKit');
  context.subscriptions.push(outputChannel);
  treeProvider = new AnalysesProvider();
  const treeView = vscode.window.createTreeView('zeus.analyses', {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  const code4iAvailable = Boolean(vscode.extensions.getExtension('halcyontechltd.code-for-ibmi'));
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = code4iAvailable
    ? '$(link) Zeus · Code4i available'
    : '$(folder-opened) Zeus · local';
  statusBar.tooltip = code4iAvailable
    ? 'Code for IBM i is installed. Zeus still uses the explicitly shown local working context.'
    : 'Zeus uses the explicitly shown local working context.';
  statusBar.command = 'zeus.showWorkingContext';
  statusBar.show();
  context.subscriptions.push(statusBar);

  const commands = [
    vscode.commands.registerCommand('zeus.analyzeCurrent', analyzeCurrent),
    vscode.commands.registerCommand('zeus.showWorkingContext', showWorkingContext),
    vscode.commands.registerCommand('zeus.setWorkingSourceRoot', setWorkingSourceRoot),
    vscode.commands.registerCommand('zeus.clearWorkingSourceRoot', clearWorkingSourceRoot),
    vscode.commands.registerCommand('zeus.openLatestReport', openReport),
  ];
  context.subscriptions.push(...commands);
  outputChannel.appendLine(
    `[activation] ready; mode=${code4iAvailable ? 'code4i-available-local-context' : 'local'}`
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
