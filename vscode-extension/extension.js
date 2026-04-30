/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const vscode = require('vscode');
const {
  analyze,
  fetch,
  queryTable,
  runWorkflow,
} = require('../src/api/zeusApi');
const {
  DEFAULT_EXTENSIONS,
  loadProfiles,
  readWorkflowConfig,
  resolveProfile,
} = require('../src/config/runtimeConfig');
const { generateAiContextBundle } = require('../src/agent/aiContextService');
const { maskSecretsInText, sanitizeValue } = require('../src/security/secretMasking');
const { listSelectableProfiles, resolveActiveProfile } = require('../src/vscode/profileSelection');

const AI_CONTEXT_SELECTION_KEY = 'zeusRpgToolkit.aiContextSelection';
const LAST_AI_PROMPT_KEY = 'zeusRpgToolkit.lastAiPromptPath';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function getWorkspaceRoot() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder ? folder.uri.fsPath : '';
}

function getSettings(resource) {
  return vscode.workspace.getConfiguration('zeusRpgToolkit', resource || null);
}

function resolveSettingPath(rootDir, settingValue, fallback) {
  const raw = String(settingValue || '').trim() || fallback;
  return path.resolve(rootDir, raw);
}

function createExtensionEnv(settings) {
  const env = { ...process.env };
  const javaPathSetting = String(settings.get('javaPath') || '').trim();
  if (!javaPathSetting) {
    return env;
  }
  const resolved = path.resolve(javaPathSetting);
  const javaBinDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  env.PATH = `${javaBinDir}${path.delimiter}${env.PATH || ''}`;
  return env;
}

function appendOutput(output, message) {
  const line = typeof message === 'string'
    ? message
    : JSON.stringify(sanitizeValue(message), null, 2);
  output.appendLine(maskSecretsInText(line));
}

function loadProfilesForWorkspace(rootDir, settings, env) {
  const configPath = String(settings.get('configPath') || 'config/profiles.json').trim();
  const profileLoadArgs = configPath ? { config: configPath } : {};
  const profiles = loadProfiles({
    cwd: rootDir,
    env,
    args: profileLoadArgs,
  });
  return {
    profiles,
    profileNames: listSelectableProfiles(profiles),
  };
}

function getActiveProfileName(settings, profileNames) {
  return resolveActiveProfile(settings.get('defaultProfile'), profileNames);
}

async function setActiveProfile(settings, profile) {
  await settings.update('defaultProfile', profile, vscode.ConfigurationTarget.Workspace);
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

function collectMembers(sourceRoot) {
  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    return [];
  }
  const extensionSet = new Set(DEFAULT_EXTENSIONS.map((entry) => entry.toLowerCase()));
  const members = new Set();
  const pending = [sourceRoot];

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
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensionSet.has(ext)) {
        continue;
      }
      members.add(path.basename(entry.name, ext).toUpperCase());
    }
  }

  return Array.from(members).sort((left, right) => left.localeCompare(right));
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

function resolveConfigArg(settings) {
  return String(settings.get('configPath') || 'config/profiles.json').trim();
}

function resolveCliInvocation(rootDir, settings) {
  const cliPathSetting = String(settings.get('cliPath') || 'cli/zeus.js').trim() || 'cli/zeus.js';
  const cliPath = path.resolve(rootDir, cliPathSetting);
  return {
    cliPath,
    exists: fs.existsSync(cliPath),
  };
}

function buildCliBaseArgs(settings) {
  const args = [];
  const configPath = resolveConfigArg(settings);
  if (configPath) {
    args.push('--config', configPath);
  }
  return args;
}

function streamMaskedOutput(output, text) {
  const chunks = String(text || '').split(/\r?\n/);
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    appendOutput(output, chunk);
  }
}

async function runCliCommand({ output, rootDir, env, settings, cliArgs }) {
  const cli = resolveCliInvocation(rootDir, settings);
  if (!cli.exists) {
    throw new Error(`CLI path not found: ${cli.cliPath}. Update zeusRpgToolkit.cliPath or open config first.`);
  }

  const args = [cli.cliPath, ...cliArgs];
  appendOutput(output, `[cli] node ${args.join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      streamMaskedOutput(output, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      streamMaskedOutput(output, chunk.toString());
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`CLI command failed with exit code ${code}.`));
      }
    });
  });
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
    lastDoctorChecks: [],
    providers: [],
  };

  const refreshViews = () => {
    for (const provider of runtimeState.providers) {
      provider.refresh();
    }
  };

  const persistSelectionState = async () => {
    await context.workspaceState.update(AI_CONTEXT_SELECTION_KEY, Array.from(selectionState.values()).sort((a, b) => a.localeCompare(b)));
  };

  const ensureWorkspace = () => {
    const root = getWorkspaceRoot();
    if (!root) {
      throw new Error('Open a workspace folder before running Zeus commands.');
    }
    return root;
  };

  const getCurrentContext = () => {
    const root = ensureWorkspace();
    const settings = getSettings(vscode.Uri.file(root));
    const env = createExtensionEnv(settings);
    const loaded = loadProfilesForWorkspace(root, settings, env);
    const activeProfile = getActiveProfileName(settings, loaded.profileNames);

    runtimeState.statusBar.text = activeProfile
      ? `Zeus: ${activeProfile}`
      : 'Zeus: <no profile>';

    return {
      root,
      settings,
      env,
      profiles: loaded.profiles,
      profileNames: loaded.profileNames,
      activeProfile,
    };
  };

  const resolveOutputRoot = (root, settings) => resolveSettingPath(root, settings.get('outputRoot'), 'analysis');

  function runFallbackDoctorChecks(ctx) {
    const checks = [];
    const cli = resolveCliInvocation(ctx.root, ctx.settings);
    const configPath = resolveSettingPath(ctx.root, resolveConfigArg(ctx.settings), 'config/profiles.json');
    const nodeVersion = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
    const javaVersion = spawnSync('java', ['-version'], {
      cwd: ctx.root,
      env: ctx.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const javaLibDir = path.join(ctx.root, 'java', 'lib');
    const jarCount = fs.existsSync(javaLibDir)
      ? fs.readdirSync(javaLibDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar')).length
      : 0;

    checks.push({
      name: 'CLI',
      status: cli.exists ? 'PASS' : 'FAIL',
      details: cli.exists ? `Found ${cli.cliPath}` : `CLI path not found: ${cli.cliPath}`,
    });
    checks.push({
      name: 'Config',
      status: fs.existsSync(configPath) ? 'PASS' : 'FAIL',
      details: fs.existsSync(configPath)
        ? `Found ${toPosix(path.relative(ctx.root, configPath) || path.basename(configPath))}`
        : `Missing config at ${configPath}. Run "Zeus: Open Config".`,
    });
    checks.push({
      name: 'Profile',
      status: ctx.profileNames.includes(ctx.activeProfile) ? 'PASS' : 'FAIL',
      details: ctx.profileNames.includes(ctx.activeProfile)
        ? `Selected profile "${ctx.activeProfile}" is available.`
        : `Selected profile "${ctx.activeProfile}" not found in config.`,
    });
    checks.push({
      name: 'Node Runtime',
      status: nodeVersion.status === 0 ? 'PASS' : 'FAIL',
      details: nodeVersion.status === 0
        ? String(nodeVersion.stdout || '').trim()
        : (nodeVersion.error ? nodeVersion.error.message : String(nodeVersion.stderr || '').trim()),
    });
    checks.push({
      name: 'Java Runtime',
      status: javaVersion.status === 0 ? 'PASS' : 'FAIL',
      details: javaVersion.status === 0
        ? String(javaVersion.stderr || javaVersion.stdout || '').split(/\r?\n/).find(Boolean) || 'java -version'
        : (javaVersion.error ? javaVersion.error.message : String(javaVersion.stderr || javaVersion.stdout || '').trim()),
    });
    checks.push({
      name: 'Classpath Hints',
      status: jarCount > 0 ? 'PASS' : 'WARN',
      details: `java/lib jars=${jarCount}${fs.existsSync(path.join(javaLibDir, 'jt400.jar')) ? ', jt400.jar detected' : ', jt400.jar not detected'}`,
    });
    return checks;
  }

  async function selectProfile(explicitProfile) {
    const ctx = getCurrentContext();
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
      return;
    }
    await setActiveProfile(ctx.settings, selected);
    runtimeState.statusBar.text = `Zeus: ${selected}`;
    appendOutput(output, `[profile] active profile set to ${selected}`);
    refreshViews();
  }

  async function openConfig() {
    const root = ensureWorkspace();
    const settings = getSettings(vscode.Uri.file(root));
    const configPath = resolveSettingPath(root, settings.get('configPath'), 'config/profiles.json');
    if (!fs.existsSync(configPath)) {
      ensureDir(path.dirname(configPath));
      fs.writeFileSync(configPath, `${JSON.stringify(buildExampleConfig(), null, 2)}\n`, 'utf8');
      appendOutput(output, `[config] created example config at ${configPath}`);
    }
    const document = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function runDoctorCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }
    const cli = resolveCliInvocation(ctx.root, ctx.settings);
    runtimeState.lastDoctorChecks = [];

    if (cli.exists) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Zeus doctor (${ctx.activeProfile})`,
      }, async () => {
        await runCliCommand({
          output,
          rootDir: ctx.root,
          env: ctx.env,
          settings: ctx.settings,
          cliArgs: [...buildCliBaseArgs(ctx.settings), 'doctor', '--profile', ctx.activeProfile],
        });
      });
      runtimeState.lastDoctorChecks = [
        {
          name: 'CLI Doctor',
          status: 'PASS',
          details: 'Doctor command completed successfully.',
        },
      ];
      refreshViews();
      vscode.window.showInformationMessage('Zeus doctor checks passed.');
      return;
    }

    appendOutput(output, '[doctor] CLI not reachable; running fallback checks.');
    runtimeState.lastDoctorChecks = runFallbackDoctorChecks(ctx);
    for (const check of runtimeState.lastDoctorChecks) {
      appendOutput(output, `[${check.status}] ${check.name}: ${check.details}`);
    }
    refreshViews();
    if (runtimeState.lastDoctorChecks.some((entry) => entry.status === 'FAIL')) {
      throw new Error('Doctor fallback checks reported failures. See "Zeus RPG Toolkit" output.');
    }
    vscode.window.showInformationMessage('Zeus fallback doctor checks passed.');
  }

  async function fetchSourcesCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const cli = resolveCliInvocation(ctx.root, ctx.settings);
    if (cli.exists) {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Zeus fetch (${ctx.activeProfile})`,
      }, async () => {
        await runCliCommand({
          output,
          rootDir: ctx.root,
          env: ctx.env,
          settings: ctx.settings,
          cliArgs: [...buildCliBaseArgs(ctx.settings), 'fetch', '--profile', ctx.activeProfile],
        });
        appendOutput(output, '[fetch] completed via CLI');
      });
    } else {
      appendOutput(output, '[fetch] CLI not reachable, using core API fallback.');
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Zeus fetch (${ctx.activeProfile})`,
      }, async () => {
        const result = await fetch(ctx.activeProfile, {
          runtime: {
            cwd: ctx.root,
            env: ctx.env,
          },
        });
        appendOutput(output, '[fetch] completed via fallback');
        appendOutput(output, result.summary);
      });
    }

    refreshViews();
    vscode.window.showInformationMessage('Fetch completed.');
  }

  async function analyzeCurrentFileCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document || editor.document.uri.scheme !== 'file') {
      throw new Error('Open a local source file first.');
    }

    const currentPath = editor.document.uri.fsPath;
    const member = path.basename(currentPath, path.extname(currentPath)).toUpperCase();
    const sourceRoot = path.dirname(currentPath);
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Zeus analyze ${member}`,
    }, async () => {
      const result = analyze(ctx.activeProfile, {
        runtime: {
          cwd: ctx.root,
          env: ctx.env,
        },
        source: sourceRoot,
        member,
        mode: 'documentation',
        out: outputRoot,
      });
      appendOutput(output, '[analyze-current-file] completed');
      appendOutput(output, {
        member,
        outputProgramDir: result.outputProgramDir,
      });
    });

    refreshViews();
  }

  async function analyzeWorkspaceCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const resolvedProfile = resolveProfile(ctx.profiles, ctx.activeProfile, { env: ctx.env });
    const defaultSourceRoot = resolvedProfile && resolvedProfile.sourceRoot
      ? path.resolve(ctx.root, resolvedProfile.sourceRoot)
      : ctx.root;
    const sourceRoot = fs.existsSync(defaultSourceRoot) ? defaultSourceRoot : ctx.root;
    const members = collectMembers(sourceRoot);
    if (members.length === 0) {
      throw new Error(`No source members found in ${sourceRoot}`);
    }

    const selectedMembers = await vscode.window.showQuickPick(
      members.map((member) => ({ label: member })),
      {
        canPickMany: true,
        placeHolder: 'Select one or more members to analyze',
      },
    );
    if (!selectedMembers || selectedMembers.length === 0) {
      return;
    }

    const workflowConfig = readWorkflowConfig(ctx.profiles, resolvedProfile, ctx.env);
    const modePick = await vscode.window.showQuickPick(
      (workflowConfig.analyzeModes || ['documentation', 'defect-analysis']).map((mode) => ({
        label: mode,
      })),
      {
        placeHolder: 'Select analyze mode',
      },
    );
    if (!modePick) {
      return;
    }

    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Zeus analyze workspace',
    }, async (progress) => {
      for (let index = 0; index < selectedMembers.length; index += 1) {
        const member = selectedMembers[index].label;
        progress.report({
          message: `${member} (${index + 1}/${selectedMembers.length})`,
          increment: Math.floor(100 / selectedMembers.length),
        });
        const result = analyze(ctx.activeProfile, {
          runtime: {
            cwd: ctx.root,
            env: ctx.env,
          },
          source: sourceRoot,
          member,
          mode: modePick.label,
          out: outputRoot,
        });
        appendOutput(output, {
          type: 'analyze-workspace',
          member,
          outputProgramDir: result.outputProgramDir,
        });
      }
    });

    refreshViews();
  }

  async function queryTableCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const table = await vscode.window.showInputBox({
      prompt: 'DB table name (required)',
      placeHolder: 'CUSTOMERS',
    });
    if (!table) {
      return;
    }
    const schema = await vscode.window.showInputBox({
      prompt: 'Schema (optional)',
      placeHolder: 'MYLIB',
    });
    const filter = await vscode.window.showInputBox({
      prompt: 'Column filter (optional SQL LIKE pattern)',
      placeHolder: 'CUST%',
    });

    const result = queryTable(ctx.activeProfile, table, {
      runtime: {
        cwd: ctx.root,
        env: ctx.env,
      },
      schema: schema || undefined,
      filter: filter || undefined,
    });

    appendOutput(output, '[query-table] completed');
    appendOutput(output, {
      table: result.table,
      schema: result.schema,
      tableRows: Array.isArray(result.tableInfo.rows) ? result.tableInfo.rows.length : 0,
      columnRows: Array.isArray(result.columns.rows) ? result.columns.rows.length : 0,
    });

    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const queryRoot = path.join(outputRoot, 'queries');
    ensureDir(queryRoot);
    const targetPath = path.join(queryRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(result.table).toUpperCase()}.json`);
    fs.writeFileSync(targetPath, `${JSON.stringify(sanitizeValue({
      table: result.table,
      schema: result.schema,
      filter: result.filter,
      tableInfo: result.tableInfo.rows || [],
      columns: result.columns.rows || [],
    }), null, 2)}\n`, 'utf8');
    const document = await vscode.workspace.openTextDocument(targetPath);
    await vscode.window.showTextDocument(document, { preview: false });

    refreshViews();
  }

  async function runWorkflowCommand() {
    const ctx = getCurrentContext();
    if (!ctx.activeProfile) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }

    const readOnlyMode = Boolean(ctx.settings.get('readOnlyMode'));
    if (!readOnlyMode) {
      const confirmation = await vscode.window.showWarningMessage(
        'Read-only mode is disabled. Continue with workflow execution?',
        { modal: true },
        'Continue',
      );
      if (confirmation !== 'Continue') {
        return;
      }
    }

    const resolvedProfile = resolveProfile(ctx.profiles, ctx.activeProfile, { env: ctx.env });
    const workflowConfig = readWorkflowConfig(ctx.profiles, resolvedProfile, ctx.env);
    const presetNames = Object.keys(workflowConfig.presets || {}).sort((left, right) => left.localeCompare(right));
    const quickPickItems = [
      { label: '(Use Default Preset)', preset: '' },
      ...presetNames.map((name) => ({ label: name, preset: name })),
    ];
    const presetPick = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select workflow preset',
    });
    if (!presetPick) {
      return;
    }

    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const cli = resolveCliInvocation(ctx.root, ctx.settings);
    if (cli.exists) {
      const cliArgs = [...buildCliBaseArgs(ctx.settings), 'workflow', 'run', '--profile', ctx.activeProfile, '--out', outputRoot];
      if (presetPick.preset) {
        cliArgs.push('--preset', presetPick.preset);
      }
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Zeus workflow (${ctx.activeProfile})`,
      }, async () => {
        await runCliCommand({
          output,
          rootDir: ctx.root,
          env: ctx.env,
          settings: ctx.settings,
          cliArgs,
        });
        appendOutput(output, '[workflow] completed via CLI');
      });
    } else {
      appendOutput(output, '[workflow] CLI not reachable, using core API fallback.');
      const workflowState = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Zeus workflow (${ctx.activeProfile})`,
      }, async () => runWorkflow(ctx.activeProfile, presetPick.preset, {
        runtime: {
          cwd: ctx.root,
          env: ctx.env,
        },
        out: outputRoot,
      }));

      appendOutput(output, '[workflow] completed via fallback');
      appendOutput(output, {
        status: workflowState.status,
        runId: workflowState.runId,
        runRoot: workflowState.paths.runRoot,
        reportPath: workflowState.paths.reportPath,
      });
    }

    const latestReports = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 1);
    if (latestReports.length > 0) {
      const document = await vscode.workspace.openTextDocument(latestReports[0].absolutePath);
      await vscode.window.showTextDocument(document, { preview: false });
    }

    refreshViews();
  }

  async function openLatestReportCommand() {
    const ctx = getCurrentContext();
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const reports = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 1);
    if (reports.length === 0) {
      throw new Error(`No report.md found under ${outputRoot}`);
    }
    const document = await vscode.workspace.openTextDocument(reports[0].absolutePath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function openDashboardCommand() {
    const ctx = getCurrentContext();
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const reportEntries = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 5);
    const aiEntries = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 5);
    const dashboardPath = path.join(ctx.root, '.local', 'zeus-dashboard.md');
    ensureDir(path.dirname(dashboardPath));

    const content = [
      '# Zeus RPG Toolkit Dashboard',
      '',
      `- Active profile: ${ctx.activeProfile || '<none>'}`,
      `- Config: ${resolveSettingPath(ctx.root, ctx.settings.get('configPath'), 'config/profiles.json')}`,
      `- Output root: ${outputRoot}`,
      `- Read-only mode: ${Boolean(ctx.settings.get('readOnlyMode'))}`,
      '',
      '## Latest Reports',
      ...(reportEntries.length > 0 ? reportEntries.map((entry) => `- ${toPosix(path.relative(ctx.root, entry.absolutePath))}`) : ['- none']),
      '',
      '## Latest AI Prompts',
      ...(aiEntries.length > 0 ? aiEntries.map((entry) => `- ${toPosix(path.relative(ctx.root, entry.absolutePath))}`) : ['- none']),
      '',
      '## Commands',
      '- Zeus: Select Profile',
      '- Zeus: Run Doctor',
      '- Zeus: Run Workflow',
      '- Zeus: Generate AI Context',
      '- Zeus: Open Latest Report',
    ].join('\n');

    fs.writeFileSync(dashboardPath, `${content}\n`, 'utf8');
    const document = await vscode.workspace.openTextDocument(dashboardPath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function generateAiContextCommand() {
    const ctx = getCurrentContext();
    if (!Boolean(ctx.settings.get('enableAgentMode'))) {
      throw new Error('Agent mode is disabled in settings.');
    }

    const taskContext = await vscode.window.showInputBox({
      prompt: 'Optional ticket/task context for AI prompt',
      placeHolder: 'Ticket-123: add XYZ validation',
    }) || '';
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);

    const result = generateAiContextBundle({
      workspaceRoot: ctx.root,
      outputRoot,
      activeProfile: ctx.activeProfile,
      taskContext,
      selectedPaths: Array.from(selectionState.values()),
      timestamp: new Date(),
    });
    await context.workspaceState.update(LAST_AI_PROMPT_KEY, result.files.aiPrompt);

    appendOutput(output, '[ai-context] generated');
    appendOutput(output, result);

    const document = await vscode.workspace.openTextDocument(result.files.aiPrompt);
    await vscode.window.showTextDocument(document, { preview: false });
    refreshViews();
  }

  async function copyAiPromptToClipboardCommand() {
    const ctx = getCurrentContext();
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const lastPrompt = context.workspaceState.get(LAST_AI_PROMPT_KEY, '');
    let promptPath = '';

    if (lastPrompt && fs.existsSync(lastPrompt)) {
      promptPath = lastPrompt;
    } else {
      const latest = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 1);
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
    const root = ensureWorkspace();
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

    const relative = resolveSafeRelativePath(root, targetPath);
    if (!relative) {
      throw new Error('Only paths inside the current workspace can be added.');
    }
    selectionState.add(relative);
    await persistSelectionState();
    appendOutput(output, `[ai-context] added ${relative}`);
    refreshViews();
  }

  async function clearAiContextSelectionCommand() {
    selectionState.clear();
    await persistSelectionState();
    appendOutput(output, '[ai-context] selection cleared');
    refreshViews();
  }

  const profilesProvider = new SimpleTreeProvider(async () => {
    const ctx = getCurrentContext();
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
    const ctx = getCurrentContext();
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
    const root = ensureWorkspace();
    const candidates = [];
    const defaultFetchRoot = path.join(root, 'rpg_sources');
    if (fs.existsSync(defaultFetchRoot)) {
      const item = new vscode.TreeItem(toPosix(path.relative(root, defaultFetchRoot)), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = vscode.Uri.file(defaultFetchRoot);
      candidates.push(item);
    }
    const runFetchRoots = findLatestFiles(path.join(root, 'analysis'), (entry) => entry.toLowerCase().endsWith(`${path.sep}fetch${path.sep}zeus-import-manifest.json`), 10)
      .map((entry) => path.dirname(entry.absolutePath));
    for (const fetchRoot of runFetchRoots) {
      const item = new vscode.TreeItem(toPosix(path.relative(root, fetchRoot)), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = vscode.Uri.file(fetchRoot);
      candidates.push(item);
    }
    if (candidates.length === 0) {
      return [new vscode.TreeItem('No fetched sources found', vscode.TreeItemCollapsibleState.None)];
    }
    return candidates;
  });

  const reportsProvider = new SimpleTreeProvider(async () => {
    const ctx = getCurrentContext();
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const reports = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'report.md', 15);
    if (reports.length === 0) {
      return [new vscode.TreeItem('No reports found', vscode.TreeItemCollapsibleState.None)];
    }
    return reports.map((entry) => {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.root, entry.absolutePath)), vscode.TreeItemCollapsibleState.None);
      item.command = {
        command: 'vscode.open',
        title: 'Open Report',
        arguments: [vscode.Uri.file(entry.absolutePath)],
      };
      return item;
    });
  });

  const aiContextProvider = new SimpleTreeProvider(async () => {
    const ctx = getCurrentContext();
    const outputRoot = resolveOutputRoot(ctx.root, ctx.settings);
    const items = [];
    items.push(new vscode.TreeItem(`Selected Paths: ${selectionState.size}`, vscode.TreeItemCollapsibleState.None));
    for (const selected of Array.from(selectionState.values()).sort((left, right) => left.localeCompare(right))) {
      items.push(new vscode.TreeItem(`- ${selected}`, vscode.TreeItemCollapsibleState.None));
    }
    const prompts = findLatestFiles(outputRoot, (entry) => path.basename(entry).toLowerCase() === 'ai_prompt.md', 10);
    for (const prompt of prompts) {
      const item = new vscode.TreeItem(toPosix(path.relative(ctx.root, prompt.absolutePath)), vscode.TreeItemCollapsibleState.None);
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
      item.description = maskSecretsInText(check.details);
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
    vscode.commands.registerCommand('zeusRpgToolkit.openConfig', async () => {
      try {
        await openConfig();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.selectProfile', async (profile) => {
      try {
        await selectProfile(profile);
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.runDoctor', async () => {
      try {
        await runDoctorCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.fetchSources', async () => {
      try {
        await fetchSourcesCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.analyzeWorkspace', async () => {
      try {
        await analyzeWorkspaceCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.analyzeCurrentFile', async () => {
      try {
        await analyzeCurrentFileCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.queryTable', async () => {
      try {
        await queryTableCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.runWorkflow', async () => {
      try {
        await runWorkflowCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.openLatestReport', async () => {
      try {
        await openLatestReportCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.openDashboard', async () => {
      try {
        await openDashboardCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.generateAiContext', async () => {
      try {
        await generateAiContextCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.copyAiPromptToClipboard', async () => {
      try {
        await copyAiPromptToClipboardCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.addFileToAiContext', async (uri) => {
      try {
        await addPathSelectionCommand(uri, false);
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.addFolderToAiContext', async (uri) => {
      try {
        await addPathSelectionCommand(uri, true);
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
    vscode.commands.registerCommand('zeusRpgToolkit.clearAiContextSelection', async () => {
      try {
        await clearAiContextSelectionCommand();
      } catch (error) {
        vscode.window.showErrorMessage(maskSecretsInText(error.message));
      }
    }),
  );

  try {
    const ctx = getCurrentContext();
    if (ctx.activeProfile) {
      runtimeState.statusBar.text = `Zeus: ${ctx.activeProfile}`;
    }
  } catch (_) {
    runtimeState.statusBar.text = 'Zeus: <no workspace>';
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
