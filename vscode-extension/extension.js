/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { runWorkflow } = require('../src/api/zeusApi');
const {
  readWorkflowConfig,
  resolveProfile,
} = require('../src/config/runtimeConfig');
const { maskSecretsInText, sanitizeValue } = require('../src/security/secretMasking');
const { createZeusCommandGateway } = require('./src/zeusCommandGateway');

const AI_CONTEXT_SELECTION_KEY = 'zeusRpgToolkit.aiContextSelection';
const LAST_AI_PROMPT_KEY = 'zeusRpgToolkit.lastAiPromptPath';
const AGENT_TOOL_COMMANDS = Object.freeze([
  'zeus_doctor',
  'zeus_fetch_sources',
  'zeus_analyze_workspace',
  'zeus_query_table',
  'zeus_generate_ai_context',
  'zeus_get_latest_report',
  'zeus_open_latest_report',
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function resolveSafeRelativePath(rootDir, inputPath) {
  const resolved = path.resolve(inputPath);
  const normalizedRoot = path.resolve(rootDir);
  const rootPrefix = `${normalizedRoot}${path.sep}`;
  if (resolved !== normalizedRoot && !resolved.startsWith(rootPrefix)) {
    return '';
  }
  return toPosix(path.relative(normalizedRoot, resolved));
}

function buildExampleConfig() {
  return {
    contextOptimizer: {
      maxTables: 20,
      maxProgramCalls: 20,
      maxCopyMembers: 10,
      maxSQLStatements: 10,
      maxSourceSnippets: 20,
      maxSnippetLines: 12,
      softTokenLimit: 3000,
    },
    'PROJECT-X-TEST': {
      sourceRoot: '${env:ZEUS_SOURCE_ROOT}',
      outputRoot: 'analysis',
      extensions: ['.rpgle', '.rpg', '.sqlrpgle', '.clle', '.dds', '.pf', '.lf'],
      fetch: {
        host: '${env:ZEUS_FETCH_HOST}',
        user: '${env:ZEUS_FETCH_USER}',
        password: '${env:ZEUS_FETCH_PASSWORD}',
        sourceLib: '${env:ZEUS_FETCH_SOURCE_LIB}',
        ifsDir: '${env:ZEUS_FETCH_IFS_DIR}',
        out: './rpg_sources',
        files: ['QRPGLESRC', 'QCLLESRC', 'QSQLSRC', 'QDDSSRC'],
        streamFileCcsid: 1208,
        replace: true,
        transport: 'auto',
      },
      db: {
        host: '${env:ZEUS_DB_HOST}',
        url: '${env:ZEUS_DB_URL}',
        user: '${env:ZEUS_DB_USER}',
        password: '${env:ZEUS_DB_PASSWORD}',
        defaultSchema: '${env:ZEUS_DB_DEFAULT_SCHEMA}',
      },
      workflow: {
        outputRoot: 'analysis',
        defaultPreset: 'legacy-rpg-analysis',
        presets: {
          'legacy-rpg-analysis': {
            steps: ['fetch', 'copy', 'analyze', 'impact', 'query-table', 'report'],
          },
        },
      },
    },
  };
}

function findLatestFiles(rootDir, matcher, maxEntries = 20) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const results = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!matcher(absolutePath)) {
        continue;
      }
      results.push({
        absolutePath,
        modifiedAt: fs.statSync(absolutePath).mtimeMs,
      });
    }
  }

  return results
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, maxEntries);
}

class SimpleTreeProvider {
  constructor(loader) {
    this.loader = loader;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren() {
    return this.loader();
  }
}

function createGuardedCommand(output, fn, successMessage) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      if (successMessage) {
        vscode.window.showInformationMessage(successMessage);
      }
      return result;
    } catch (error) {
      const masked = maskSecretsInText(error.message);
      output.appendLine(`[error] ${masked}`);
      vscode.window.showErrorMessage(masked);
      return null;
    }
  };
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Zeus RPG Toolkit');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'zeusRpgToolkit.selectProfile';
  statusBar.show();

  const selectionState = new Set(context.workspaceState.get(AI_CONTEXT_SELECTION_KEY, []));
  const runtimeState = {
    output,
    statusBar,
    selectionState,
    providers: [],
    lastDoctorChecks: [],
  };

  const gateway = createZeusCommandGateway({
    vscode,
    outputChannel: output,
    workspaceState: context.workspaceState,
    lastAiPromptKey: LAST_AI_PROMPT_KEY,
  });

  const refreshViews = () => {
    for (const provider of runtimeState.providers) {
      provider.refresh();
    }
  };

  const persistSelectionState = async () => {
    await context.workspaceState.update(
      AI_CONTEXT_SELECTION_KEY,
      Array.from(selectionState.values()).sort((a, b) => a.localeCompare(b)),
    );
  };

  const updateStatusBar = () => {
    try {
      const ctx = gateway.resolveContext();
      runtimeState.statusBar.text = ctx.activeProfile
        ? `Zeus: ${ctx.activeProfile}`
        : 'Zeus: <no profile>';
    } catch (_) {
      runtimeState.statusBar.text = 'Zeus: <no workspace>';
    }
  };

  const applyTerminalEnvironmentCollection = () => {
    try {
      const ctx = gateway.resolveContext();
      const collection = context.environmentVariableCollection;
      if (!collection || typeof collection.replace !== 'function') {
        return;
      }
      collection.clear();
      const keys = [
        'ZEUS_CONFIG_DIR',
        'ZEUS_PROFILE',
        'ZEUS_OUTPUT_ROOT',
        'ZEUS_READ_ONLY',
        'ZEUS_CLI_PATH',
        'ZEUS_JAVA_PATH',
      ];
      for (const key of keys) {
        if (!ctx.zeusEnv[key]) {
          continue;
        }
        collection.replace(key, String(ctx.zeusEnv[key]));
      }
      collection.description = 'Zeus RPG Toolkit session environment';
      output.appendLine('[env] terminal environment collection refreshed.');
    } catch (error) {
      output.appendLine(`[env] could not refresh terminal environment collection: ${maskSecretsInText(error.message)}`);
    }
  };

  async function selectProfile(explicitProfile) {
    const ctx = gateway.resolveContext();
    if (ctx.profileNames.length === 0) {
      throw new Error('No profiles were found. Run "Zeus: Open Config" first.');
    }

    let selected = explicitProfile;
    if (!selected) {
      selected = await vscode.window.showQuickPick(ctx.profileNames, {
        placeHolder: 'Select Zeus profile',
      });
    }
    if (!selected) {
      return null;
    }

    const result = await gateway.setActiveProfile(selected);
    runtimeState.statusBar.text = `Zeus: ${result.profile}`;
    output.appendLine(`[profile] active profile set to ${result.profile}`);
    applyTerminalEnvironmentCollection();
    refreshViews();
    return result;
  }

  async function showActiveEnvironmentCommand() {
    const summary = gateway.buildEnvironmentSummary();
    output.appendLine('[env] active environment');
    output.appendLine(JSON.stringify(summary, null, 2));

    const details = [
      `Profile: ${summary.activeProfile || '<none>'}`,
      `Read-only: ${summary.readOnlyMode ? 'true' : 'false'}`,
      `Config: ${summary.configPath}`,
      `Output: ${summary.outputRoot}`,
    ].join(' | ');
    vscode.window.showInformationMessage(details);
    return summary;
  }

  async function createAgentTerminalCommand() {
    const result = gateway.createAgentTerminal();
    applyTerminalEnvironmentCollection();
    output.appendLine('[terminal] Zeus Agent Terminal created.');
    return result;
  }

  async function openConfigCommand() {
    const ctx = gateway.resolveContext();
    if (!fs.existsSync(ctx.configPath)) {
      ensureDir(path.dirname(ctx.configPath));
      fs.writeFileSync(ctx.configPath, `${JSON.stringify(buildExampleConfig(), null, 2)}\n`, 'utf8');
      output.appendLine(`[config] created example config at ${ctx.configPath}`);
    }

    const document = await vscode.workspace.openTextDocument(ctx.configPath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function runDoctorCommand() {
    const ctx = gateway.resolveContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Zeus doctor (${ctx.activeProfile})`,
    }, async () => gateway.runDoctor({ profile: ctx.activeProfile }));

    runtimeState.lastDoctorChecks = Array.isArray(result.checks) ? result.checks : [];
    refreshViews();

    if (result.status === 'FAIL') {
      throw new Error(result.summary || 'Doctor failed.');
    }

    vscode.window.showInformationMessage(result.summary || 'Doctor checks passed.');
    return result;
  }

  async function fetchSourcesCommand() {
    const ctx = gateway.resolveContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Zeus fetch (${ctx.activeProfile})`,
    }, async () => gateway.fetchSources({ profile: ctx.activeProfile }));

    if (result.status === 'BLOCKED') {
      throw new Error(result.reason);
    }

    refreshViews();
    vscode.window.showInformationMessage('Fetch completed.');
    return result;
  }

  async function analyzeCurrentFileCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document || editor.document.uri.scheme !== 'file') {
      throw new Error('Open a local source file first.');
    }

    const currentPath = editor.document.uri.fsPath;
    const member = path.basename(currentPath, path.extname(currentPath)).toUpperCase();
    const sourceRoot = path.dirname(currentPath);
    const result = await gateway.analyzeWorkspace({
      members: [member],
      mode: 'documentation',
      targetPath: sourceRoot,
    });

    if (result.status === 'BLOCKED') {
      throw new Error(result.reason);
    }

    output.appendLine(`[analyze-current-file] ${result.summary}`);
    refreshViews();
    return result;
  }

  async function analyzeWorkspaceCommand() {
    const ctx = gateway.resolveContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const memberCandidates = gateway.getMemberCandidates();
    if (memberCandidates.members.length === 0) {
      throw new Error(`No source members found in ${memberCandidates.sourceRoot}`);
    }

    const selectedMembers = await vscode.window.showQuickPick(
      memberCandidates.members.map((member) => ({ label: member })),
      {
        canPickMany: true,
        placeHolder: 'Select one or more members to analyze',
      },
    );
    if (!selectedMembers || selectedMembers.length === 0) {
      return null;
    }

    const modePick = await vscode.window.showQuickPick(
      gateway.getAnalyzeModeChoices().map((mode) => ({ label: mode })),
      {
        placeHolder: 'Select analyze mode',
      },
    );
    if (!modePick) {
      return null;
    }

    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Zeus analyze workspace',
    }, async (progress) => {
      progress.report({ message: `Analyzing ${selectedMembers.length} member(s)` });
      return gateway.analyzeWorkspace({
        profile: ctx.activeProfile,
        mode: modePick.label,
        members: selectedMembers.map((entry) => entry.label),
        targetPath: memberCandidates.sourceRoot,
      });
    });

    if (result.status === 'BLOCKED') {
      throw new Error(result.reason);
    }

    output.appendLine(`[analyze-workspace] ${result.summary}`);
    refreshViews();
    return result;
  }

  async function queryTableCommand() {
    const table = await vscode.window.showInputBox({
      prompt: 'DB table name (required)',
      placeHolder: 'CUSTOMERS',
    });
    if (!table) {
      return null;
    }

    const schema = await vscode.window.showInputBox({
      prompt: 'Schema (optional)',
      placeHolder: 'MYLIB',
    });
    const filter = await vscode.window.showInputBox({
      prompt: 'Column filter (optional SQL LIKE pattern)',
      placeHolder: 'CUST%',
    });

    const result = await gateway.queryTableMetadata({
      table,
      schema: schema || '',
      filter: filter || '',
    });

    if (result.status === 'BLOCKED') {
      throw new Error(result.reason);
    }

    if (result.reportPath) {
      const ctx = gateway.resolveContext();
      const absolutePath = path.resolve(ctx.rootDir, result.reportPath);
      const document = await vscode.workspace.openTextDocument(absolutePath);
      await vscode.window.showTextDocument(document, { preview: false });
    }

    refreshViews();
    return result;
  }

  async function runWorkflowCommand() {
    const ctx = gateway.resolveContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    if (!ctx.readOnlyMode) {
      const confirmation = await vscode.window.showWarningMessage(
        'Read-only mode is disabled. Continue with workflow execution?',
        { modal: true },
        'Continue',
      );
      if (confirmation !== 'Continue') {
        return null;
      }
    }

    const resolvedProfile = resolveProfile(ctx.profiles, ctx.activeProfile, { env: ctx.env });
    const workflowConfig = readWorkflowConfig(ctx.profiles, resolvedProfile, ctx.env);
    const presetNames = Object.keys(workflowConfig.presets || {}).sort((left, right) => left.localeCompare(right));
    const presetPick = await vscode.window.showQuickPick(
      [
        { label: '(Use Default Preset)', preset: '' },
        ...presetNames.map((name) => ({ label: name, preset: name })),
      ],
      { placeHolder: 'Select workflow preset' },
    );
    if (!presetPick) {
      return null;
    }

    const workflowState = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Zeus workflow (${ctx.activeProfile})`,
    }, async () => runWorkflow(ctx.activeProfile, presetPick.preset, {
      runtime: {
        cwd: ctx.rootDir,
        env: ctx.env,
      },
      out: ctx.outputRoot,
    }));

    output.appendLine('[workflow] completed via core API fallback path');
    output.appendLine(JSON.stringify(sanitizeValue({
      status: workflowState.status,
      runId: workflowState.runId,
      runRoot: workflowState.paths.runRoot,
      reportPath: workflowState.paths.reportPath,
    }), null, 2));

    const latest = await gateway.getLatestReport();
    if (latest && latest.absolutePath) {
      const document = await vscode.workspace.openTextDocument(latest.absolutePath);
      await vscode.window.showTextDocument(document, { preview: false });
    }

    refreshViews();
    return workflowState;
  }

  async function openLatestReportCommand() {
    const latest = await gateway.getLatestReport();
    if (!latest || latest.status !== 'PASS' || !latest.absolutePath) {
      throw new Error('No report.md found under current output root.');
    }

    const document = await vscode.workspace.openTextDocument(latest.absolutePath);
    await vscode.window.showTextDocument(document, { preview: false });
    return latest;
  }

  async function openDashboardCommand() {
    const ctx = gateway.resolveContext();
    const reportEntries = findLatestFiles(ctx.outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 5);
    const aiEntries = findLatestFiles(ctx.outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 5);
    const dashboardPath = path.join(ctx.rootDir, '.local', 'zeus-dashboard.md');
    ensureDir(path.dirname(dashboardPath));

    const content = [
      '# Zeus RPG Toolkit Dashboard',
      '',
      `- Active profile: ${ctx.activeProfile || '<none>'}`,
      `- Config: ${toPosix(path.relative(ctx.rootDir, ctx.configPath) || path.basename(ctx.configPath))}`,
      `- Output root: ${toPosix(path.relative(ctx.rootDir, ctx.outputRoot) || '.')}`,
      `- Read-only mode: ${ctx.readOnlyMode}`,
      '',
      '## Latest Reports',
      ...(reportEntries.length > 0 ? reportEntries.map((entry) => `- ${toPosix(path.relative(ctx.rootDir, entry.absolutePath))}`) : ['- none']),
      '',
      '## Latest AI Prompts',
      ...(aiEntries.length > 0 ? aiEntries.map((entry) => `- ${toPosix(path.relative(ctx.rootDir, entry.absolutePath))}`) : ['- none']),
      '',
      '## Commands',
      '- Zeus: Select Profile',
      '- Zeus: Show Active Environment',
      '- Zeus: Create Agent Terminal',
      '- Zeus: Run Doctor',
      '- Zeus: Generate AI Context',
      '- Zeus: Open Latest Report',
    ].join('\n');

    fs.writeFileSync(dashboardPath, `${content}\n`, 'utf8');
    const document = await vscode.workspace.openTextDocument(dashboardPath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function generateAiContextCommand() {
    const ctx = gateway.resolveContext();
    if (!Boolean(ctx.settings.get('enableAgentMode'))) {
      throw new Error('Agent mode is disabled in settings.');
    }

    const taskContext = await vscode.window.showInputBox({
      prompt: 'Optional ticket/task context for AI prompt',
      placeHolder: 'Ticket-123: add XYZ validation',
    }) || '';

    const result = await gateway.generateAiContext(
      {
        profile: ctx.activeProfile,
        ticket: taskContext,
        selectedFiles: Array.from(selectionState.values()),
        includeLatestReport: true,
      },
      Array.from(selectionState.values()),
    );

    if (result.status === 'BLOCKED') {
      throw new Error(result.reason);
    }

    if (result.files && result.files.ai_prompt_md) {
      const document = await vscode.workspace.openTextDocument(path.resolve(ctx.rootDir, result.files.ai_prompt_md));
      await vscode.window.showTextDocument(document, { preview: false });
    }

    output.appendLine('[ai-context] generated');
    output.appendLine(JSON.stringify(sanitizeValue(result), null, 2));
    refreshViews();
    return result;
  }

  async function copyAiPromptToClipboardCommand() {
    const ctx = gateway.resolveContext();
    const lastPrompt = context.workspaceState.get(LAST_AI_PROMPT_KEY, '');
    let promptPath = '';

    if (lastPrompt && fs.existsSync(lastPrompt)) {
      promptPath = lastPrompt;
    } else {
      const latest = findLatestFiles(ctx.outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 1);
      promptPath = latest.length > 0 ? latest[0].absolutePath : '';
    }
    if (!promptPath) {
      throw new Error('No AI prompt found. Run "Zeus: Generate AI Context" first.');
    }

    const text = fs.readFileSync(promptPath, 'utf8');
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('AI prompt copied to clipboard.');
  }

  async function addPathSelectionCommand(uri, expectedFolder) {
    const ctx = gateway.resolveContext();
    let targetPath = '';
    if (uri && uri.fsPath) {
      targetPath = uri.fsPath;
    } else if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
      targetPath = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    if (!targetPath) {
      throw new Error('No file or folder selected.');
    }

    if (expectedFolder !== null) {
      const isFolder = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
      if (expectedFolder && !isFolder) {
        throw new Error('Selected path is not a folder.');
      }
      if (!expectedFolder && isFolder) {
        throw new Error('Selected path is not a file.');
      }
    }

    const relative = resolveSafeRelativePath(ctx.rootDir, targetPath);
    if (!relative) {
      throw new Error('Only paths inside the current workspace can be added.');
    }

    selectionState.add(relative);
    await persistSelectionState();
    output.appendLine(`[ai-context] added ${relative}`);
    refreshViews();
  }

  async function clearAiContextSelectionCommand() {
    selectionState.clear();
    await persistSelectionState();
    output.appendLine('[ai-context] selection cleared');
    refreshViews();
  }

  async function invokeAgentToolCommand(toolName, input) {
    const result = await gateway.runAgentTool(
      toolName,
      input || {},
      Array.from(selectionState.values()),
    );
    output.appendLine(`[agent-tool] ${toolName || '<unknown>'} -> ${result.status}`);
    output.appendLine(JSON.stringify(sanitizeValue(result), null, 2));
    return result;
  }

  const profilesProvider = new SimpleTreeProvider(async () => {
    const ctx = gateway.resolveContext();
    const items = [];

    if (!ctx.activeProfile) {
      items.push(new vscode.TreeItem('No active profile', vscode.TreeItemCollapsibleState.None));
      return items;
    }

    items.push(new vscode.TreeItem(`Active: ${ctx.activeProfile}`, vscode.TreeItemCollapsibleState.None));
    for (const profile of ctx.profileNames) {
      const item = new vscode.TreeItem(profile, vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: 'zeusRpgToolkit.selectProfile',
        title: 'Select Profile',
        arguments: [profile],
      };
      items.push(item);
    }
    return items;
  });

  const workflowsProvider = new SimpleTreeProvider(async () => {
    const ctx = gateway.resolveContext();
    if (!ctx.activeProfile) {
      return [new vscode.TreeItem('No active profile', vscode.TreeItemCollapsibleState.None)];
    }

    const profile = resolveProfile(ctx.profiles, ctx.activeProfile, { env: ctx.env });
    const workflowConfig = readWorkflowConfig(ctx.profiles, profile, ctx.env);
    const presetNames = Object.keys(workflowConfig.presets || {}).sort((left, right) => left.localeCompare(right));
    if (presetNames.length === 0) {
      return [new vscode.TreeItem('No workflow presets configured', vscode.TreeItemCollapsibleState.None)];
    }

    return presetNames.map((presetName) => {
      const item = new vscode.TreeItem(presetName, vscode.TreeItemCollapsibleState.None);
      item.description = (workflowConfig.presets[presetName].steps || []).join(', ');
      item.command = {
        command: 'zeusRpgToolkit.runWorkflow',
        title: 'Run Workflow',
      };
      return item;
    });
  });

  const fetchedSourcesProvider = new SimpleTreeProvider(async () => {
    const ctx = gateway.resolveContext();
    const candidates = [];
    const defaultFetchRoot = path.join(ctx.rootDir, 'rpg_sources');
    if (fs.existsSync(defaultFetchRoot)) {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.rootDir, defaultFetchRoot)), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = vscode.Uri.file(defaultFetchRoot);
      candidates.push(item);
    }

    const runFetchRoots = findLatestFiles(path.join(ctx.rootDir, 'analysis'), (entry) => entry.toLowerCase().endsWith(`${path.sep}fetch${path.sep}zeus-import-manifest.json`), 10)
      .map((entry) => path.dirname(entry.absolutePath));
    for (const fetchRoot of runFetchRoots) {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.rootDir, fetchRoot)), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = vscode.Uri.file(fetchRoot);
      candidates.push(item);
    }

    if (candidates.length === 0) {
      return [new vscode.TreeItem('No fetched sources found', vscode.TreeItemCollapsibleState.None)];
    }

    return candidates;
  });

  const reportsProvider = new SimpleTreeProvider(async () => {
    const ctx = gateway.resolveContext();
    const reports = findLatestFiles(ctx.outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 15);
    if (reports.length === 0) {
      return [new vscode.TreeItem('No reports found', vscode.TreeItemCollapsibleState.None)];
    }

    return reports.map((entry) => {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.rootDir, entry.absolutePath)), vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: 'vscode.open',
        title: 'Open Report',
        arguments: [vscode.Uri.file(entry.absolutePath)],
      };
      return item;
    });
  });

  const aiContextProvider = new SimpleTreeProvider(async () => {
    const ctx = gateway.resolveContext();
    const prompts = findLatestFiles(ctx.outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 10);
    const items = [new vscode.TreeItem(`Selected Paths: ${selectionState.size}`, vscode.TreeItemCollapsibleState.None)];

    for (const selected of Array.from(selectionState.values()).sort((left, right) => left.localeCompare(right))) {
      items.push(new vscode.TreeItem(`- ${selected}`, vscode.TreeItemCollapsibleState.None));
    }

    for (const prompt of prompts) {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.rootDir, prompt.absolutePath)), vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: 'vscode.open',
        title: 'Open AI Prompt',
        arguments: [vscode.Uri.file(prompt.absolutePath)],
      };
      items.push(item);
    }

    return items;
  });

  const diagnosticsProvider = new SimpleTreeProvider(async () => {
    if (runtimeState.lastDoctorChecks.length === 0) {
      return [new vscode.TreeItem('Run doctor to populate diagnostics', vscode.TreeItemCollapsibleState.None)];
    }
    return runtimeState.lastDoctorChecks.map((check) => {
      const item = new vscode.TreeItem(`[${check.status}] ${check.name}`, vscode.TreeItemCollapsibleState.None);
      item.description = maskSecretsInText(check.details || '');
      return item;
    });
  });

  runtimeState.providers.push(
    profilesProvider,
    workflowsProvider,
    fetchedSourcesProvider,
    reportsProvider,
    aiContextProvider,
    diagnosticsProvider,
  );

  context.subscriptions.push(
    output,
    statusBar,
    vscode.window.registerTreeDataProvider('zeusProfilesView', profilesProvider),
    vscode.window.registerTreeDataProvider('zeusWorkflowsView', workflowsProvider),
    vscode.window.registerTreeDataProvider('zeusFetchedSourcesView', fetchedSourcesProvider),
    vscode.window.registerTreeDataProvider('zeusReportsView', reportsProvider),
    vscode.window.registerTreeDataProvider('zeusAiContextView', aiContextProvider),
    vscode.window.registerTreeDataProvider('zeusDiagnosticsView', diagnosticsProvider),
    vscode.commands.registerCommand('zeusRpgToolkit.refreshViews', refreshViews),
    vscode.commands.registerCommand('zeusRpgToolkit.openConfig', createGuardedCommand(output, openConfigCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.selectProfile', createGuardedCommand(output, async (profile) => selectProfile(profile))),
    vscode.commands.registerCommand('zeusRpgToolkit.showActiveEnvironment', createGuardedCommand(output, showActiveEnvironmentCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.createAgentTerminal', createGuardedCommand(output, createAgentTerminalCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.runDoctor', createGuardedCommand(output, runDoctorCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.fetchSources', createGuardedCommand(output, fetchSourcesCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.analyzeWorkspace', createGuardedCommand(output, analyzeWorkspaceCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.analyzeCurrentFile', createGuardedCommand(output, analyzeCurrentFileCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.queryTable', createGuardedCommand(output, queryTableCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.runWorkflow', createGuardedCommand(output, runWorkflowCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.openLatestReport', createGuardedCommand(output, openLatestReportCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.openDashboard', createGuardedCommand(output, openDashboardCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.generateAiContext', createGuardedCommand(output, generateAiContextCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.copyAiPromptToClipboard', createGuardedCommand(output, copyAiPromptToClipboardCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.addFileToAiContext', createGuardedCommand(output, async (uri) => addPathSelectionCommand(uri, false))),
    vscode.commands.registerCommand('zeusRpgToolkit.addFolderToAiContext', createGuardedCommand(output, async (uri) => addPathSelectionCommand(uri, true))),
    vscode.commands.registerCommand('zeusRpgToolkit.clearAiContextSelection', createGuardedCommand(output, clearAiContextSelectionCommand)),
    vscode.commands.registerCommand('zeusRpgToolkit.invokeAgentTool', createGuardedCommand(output, async (toolName, input) => invokeAgentToolCommand(toolName, input))),
    vscode.commands.registerCommand('zeusRpgToolkit.listAgentTools', createGuardedCommand(output, async () => gateway.getAgentTools())),
  );

  for (const toolName of AGENT_TOOL_COMMANDS) {
    const commandId = `zeusRpgToolkit.tool.${toolName}`;
    context.subscriptions.push(
      vscode.commands.registerCommand(
        commandId,
        createGuardedCommand(output, async (input) => invokeAgentToolCommand(toolName, input)),
      ),
    );
  }

  updateStatusBar();
  applyTerminalEnvironmentCollection();
  refreshViews();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
