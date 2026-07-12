const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

let VSCodeModule;
try {
  VSCodeModule = require('vscode');
} catch (_) {
  VSCodeModule = null;
}

let zeusApi;
try {
  zeusApi = require(path.join(__dirname, '..', '..', 'src', 'api', 'zeusApi'));
} catch (e) {
  console.warn('[Zeus] Could not load zeusApi:', e.message);
  zeusApi = null;
}

let code4iExports = null;
let zeusOutputChannel = null;
let recentAnalyses = [];
let isCode4iConnected = false;

function getCurrentProgram() {
  const editor = VSCodeModule ? VSCodeModule.window.activeTextEditor : null;
  if (!editor) return null;
  const doc = editor.document;
  const uri = doc.uri;
  let program = path.basename(doc.fileName || '', path.extname(doc.fileName || '')).toUpperCase();
  if (uri.scheme === 'member' || uri.scheme === 'streamfile') {
    const parts = uri.path.split(/[/\\]/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.includes('.MBR') || p.includes('.RPG') || p.includes('.CL')) {
        program = p.split('.')[0].toUpperCase();
        break;
      }
    }
  }
  return { program, uri: uri.toString(), scheme: uri.scheme, fullPath: uri.fsPath };
}

async function getCurrentMemberContentFromCode4i(current) {
  if (!code4iExports || !code4iExports.instance) return null;
  try {
    const conn = code4iExports.instance.getConnection?.();
    if (conn && conn.getContent) {
      return { note: 'Code4i Content API detected - deeper direct member read possible in future' };
    }
  } catch (e) {}
  return null;
}

function getConfig() {
  if (!VSCodeModule)
    return {
      defaultProfile: 'default',
      defaultDenseLevel: 'full',
      autoRegisterDemoAnalyzer: false,
    };
  const config = VSCodeModule.workspace.getConfiguration('zeus');
  return {
    defaultProfile: config.get('defaultProfile', 'default'),
    defaultDenseLevel: config.get('defaultDenseLevel', 'full'),
    autoRegisterDemoAnalyzer: config.get('autoRegisterDemoAnalyzer', false),
  };
}

/**
 * Compute a sensible sourceRoot for local (no-Code4i) analysis.
 * Walks up from the open file to find common IBM i source containers (QRPGLESRC etc).
 * Falls back to workspace root or cwd.
 */
function computeLocalSourceRoot(current, workspaceFolders) {
  const wsRoot =
    (workspaceFolders &&
      workspaceFolders[0] &&
      workspaceFolders[0].uri &&
      workspaceFolders[0].uri.fsPath) ||
    process.cwd();
  if (!current || !current.fullPath) {
    return wsRoot;
  }
  let dir = path.dirname(current.fullPath);
  const markers = ['QRPGLESRC', 'QCLSRC', 'QDDSSRC', 'rpg_sources', 'source', 'RPG', 'qrpglesrc'];
  // Walk up limited levels, return first parent dir that contains a marker subdir
  let candidate = dir;
  for (let i = 0; i < 5; i++) {
    const parent = path.dirname(candidate);
    if (!parent || parent === candidate) break;
    for (const m of markers) {
      if (fs.existsSync(path.join(parent, m))) {
        return parent;
      }
    }
    candidate = parent;
  }
  // No marker found: use the directory containing the open file itself (works for flat or custom layouts)
  if (fs.existsSync(dir)) return dir;
  return wsRoot;
}

function openReportWebview(reportPath, program) {
  if (!VSCodeModule) return;
  const panel = VSCodeModule.window.createWebviewPanel(
    'zeusReport',
    `Zeus Report: ${program}`,
    VSCodeModule.ViewColumn.Beside,
    { enableScripts: true }
  );
  let html = '';
  try {
    const md = fs.readFileSync(reportPath, 'utf8');
    html = `<html><head><style>body { font-family: monospace; white-space: pre-wrap; }</style></head><body><h1>Zeus Report: ${program}</h1><pre>${md.replace(/</g, '&lt;')}</pre></body></html>`;
  } catch (e) {
    html = `<html><body><h1>Error</h1><p>${e.message}</p></body></html>`;
  }
  panel.webview.html = html;
}

class ZeusAnalysesProvider {
  constructor() {
    this._onDidChangeTreeData = VSCodeModule ? new VSCodeModule.EventEmitter() : null;
    this.onDidChangeTreeData = this._onDidChangeTreeData ? this._onDidChangeTreeData.event : null;
  }
  refresh() {
    if (this._onDidChangeTreeData) this._onDidChangeTreeData.fire();
  }
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    if (!VSCodeModule || recentAnalyses.length === 0) {
      const msg = isCode4iConnected
        ? 'No analyses yet. Run "Zeus: Analyze Current"'
        : 'Local mode: No analyses yet. Open a local .rpgle/.cl file and run "Zeus: Analyze Current"';
      return [new VSCodeModule.TreeItem(msg)];
    }
    return recentAnalyses.map(a => {
      const item = new VSCodeModule.TreeItem(a.program);
      item.description = a.timestamp;
      item.command = {
        command: 'zeus.openWebviewReport',
        title: 'Open',
        arguments: [a.reportPath, a.program],
      };
      return item;
    });
  }
}

let analysesProvider;

async function activate(context) {
  console.log('[Zeus] RPG PromptKit VS Code extension activating...');

  const code4i = VSCodeModule
    ? VSCodeModule.extensions.getExtension('halcyontechltd.code-for-ibmi')
    : null;
  if (code4i) {
    if (!code4i.isActive) await code4i.activate();
    code4iExports = code4i.exports;
    const conn = code4iExports?.instance?.getConnection?.();
    isCode4iConnected = !!conn;
    console.log('[Zeus] Detected Code for IBM i. Connected:', isCode4iConnected);
  } else {
    console.log('[Zeus] Code for IBM i not detected. Running in standalone/local mode.');
  }

  const cfg = getConfig();
  zeusOutputChannel = VSCodeModule
    ? VSCodeModule.window.createOutputChannel('Zeus RPG PromptKit')
    : null;
  if (zeusOutputChannel) context.subscriptions.push(zeusOutputChannel);

  // Status bar to clearly show if we're using Code4i or local fallback
  if (VSCodeModule) {
    const statusBar = VSCodeModule.window.createStatusBarItem(
      VSCodeModule.StatusBarAlignment.Left,
      100
    );
    statusBar.command = 'zeus.analyzeCurrent';
    context.subscriptions.push(statusBar);

    function updateStatusBar() {
      if (isCode4iConnected) {
        statusBar.text = `$(link) Zeus + Code4i`;
        statusBar.tooltip =
          'Using active Code for IBM i connection. Click to analyze current member.';
      } else {
        statusBar.text = `$(folder-opened) Zeus (local)`;
        statusBar.tooltip =
          'No Code4i connection detected. Using local workspace/files. Click to analyze.';
      }
      statusBar.show();
    }
    updateStatusBar();

    // Refresh status if Code4i connection state might change (simple approach)
    setTimeout(updateStatusBar, 5000);
  }

  // Real Tree View (3)
  if (VSCodeModule) {
    analysesProvider = new ZeusAnalysesProvider();
    const treeView = VSCodeModule.window.createTreeView('zeus.analyses', {
      treeDataProvider: analysesProvider,
    });
    context.subscriptions.push(treeView);
    VSCodeModule.commands.executeCommand('setContext', 'zeus:enabled', true);
  }

  if (cfg.autoRegisterDemoAnalyzer && zeusApi && zeusApi.zeus) {
    zeusApi.zeus.analyzers.registerAnalyzer('vscode-extension-demo', {
      run: () => ({ extensionDemo: 'Auto from VS Code extension' }),
    });
  }

  // Analyze command with deeper integration (2)
  const analyzeCmd = VSCodeModule
    ? VSCodeModule.commands.registerCommand('zeus.analyzeCurrent', async () => {
        const current = getCurrentProgram();
        if (!current || !current.program) {
          const msg = isCode4iConnected
            ? 'Open a member (or local source file) first.'
            : 'Open a local .rpgle / .cl / .dds file first.';
          VSCodeModule.window.showErrorMessage(msg);
          return;
        }

        const config = getConfig();
        let profile = config.defaultProfile;
        let sourceRoot = VSCodeModule.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        if (isCode4iConnected && code4iExports && code4iExports.instance) {
          const conn = code4iExports.instance.getConnection?.();
          if (conn) {
            profile = conn.getConfig?.()?.name || profile;
            const note = await getCurrentMemberContentFromCode4i(current);
            if (note && zeusOutputChannel) zeusOutputChannel.appendLine(note.note);
          }
        } else {
          // Fallback when Code4i is not connected or not installed: fully local file-based analysis
          sourceRoot = computeLocalSourceRoot(current, VSCodeModule.workspace.workspaceFolders);
          if (zeusOutputChannel) {
            zeusOutputChannel.appendLine(
              `[Zeus] Running in local/standalone mode (no Code4i connection). Using source root: ${sourceRoot}`
            );
          }
          VSCodeModule.window.showInformationMessage(
            'Zeus: Running in local mode (Code for IBM i not connected). Analysis will use local files.'
          );
        }

        const modeLabel = isCode4iConnected ? 'via Code4i' : 'local mode';
        VSCodeModule.window.withProgress(
          {
            location: VSCodeModule.ProgressLocation.Notification,
            title: `Zeus: ${current.program} (${modeLabel})`,
          },
          async () => {
            try {
              if (!zeusApi || !zeusApi.zeus) {
                VSCodeModule.window.showWarningMessage('Zeus core unavailable');
                return;
              }
              const analyzeOptions = {
                source: sourceRoot,
                program: current.program,
                dense: config.defaultDenseLevel,
              };
              const result = await zeusApi.zeus.analyze(profile, analyzeOptions);

              // Use the actual outputProgramDir from result (profile may override outputRoot)
              const outBase =
                (result &&
                  (result.outputProgramDir || (result.result && result.result.outputProgramDir))) ||
                path.join(sourceRoot, 'output', current.program);
              const reportPath = path.join(outBase, 'report.md');
              recentAnalyses.unshift({
                program: current.program,
                timestamp: new Date().toLocaleTimeString(),
                reportPath,
              });
              if (recentAnalyses.length > 10) recentAnalyses.pop();
              if (analysesProvider) analysesProvider.refresh();

              if (zeusOutputChannel)
                zeusOutputChannel.appendLine(
                  `Analysis done for ${current.program} (${isCode4iConnected ? 'Code4i' : 'local'})`
                );

              const modeText = isCode4iConnected ? 'via Code4i' : 'local mode';
              VSCodeModule.window
                .showInformationMessage(
                  `Zeus done for ${current.program} (${modeText}).`,
                  'Webview',
                  'Report',
                  'AI Prompt'
                )
                .then(sel => {
                  const base = outBase;
                  if (sel === 'Webview')
                    openReportWebview(path.join(base, 'report.md'), current.program);
                  else if (sel === 'Report')
                    VSCodeModule.workspace
                      .openTextDocument(path.join(base, 'report.md'))
                      .then(d => VSCodeModule.window.showTextDocument(d));
                  else if (sel === 'AI Prompt')
                    VSCodeModule.workspace
                      .openTextDocument(path.join(base, 'ai_prompt_documentation.md'))
                      .then(d => VSCodeModule.window.showTextDocument(d));
                });
            } catch (e) {
              VSCodeModule.window.showErrorMessage('Zeus error: ' + e.message);
            }
          }
        );
      })
    : null;

  const showReportCmd = VSCodeModule
    ? VSCodeModule.commands.registerCommand('zeus.showReport', async () => {
        // Prefer a recent analysis report (works in both modes)
        if (recentAnalyses.length > 0) {
          const latest = recentAnalyses[0];
          try {
            const d = await VSCodeModule.workspace.openTextDocument(
              VSCodeModule.Uri.file(latest.reportPath)
            );
            await VSCodeModule.window.showTextDocument(d);
            return;
          } catch (_) {}
        }
        // Fallback to deriving from current editor (local mode friendly)
        const current = getCurrentProgram();
        const prog = current?.program || 'DATEUTIL';
        let baseDir = VSCodeModule.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        if (!isCode4iConnected && current && current.fullPath) {
          baseDir = computeLocalSourceRoot(current, VSCodeModule.workspace.workspaceFolders);
        }
        const rp = path.join(baseDir, 'output', prog, 'report.md');
        try {
          const d = await VSCodeModule.workspace.openTextDocument(VSCodeModule.Uri.file(rp));
          await VSCodeModule.window.showTextDocument(d);
        } catch {
          VSCodeModule.window.showInformationMessage(
            'No report yet. Run "Zeus: Analyze Current" first.'
          );
        }
      })
    : null;

  const webviewCmd = VSCodeModule
    ? VSCodeModule.commands.registerCommand('zeus.openWebviewReport', (rp, prog) => {
        if (rp) openReportWebview(rp, prog);
      })
    : null;

  const demoReg = VSCodeModule
    ? VSCodeModule.commands.registerCommand('zeus.registerDemoAnalyzer', () => {
        if (zeusApi && zeusApi.zeus) {
          zeusApi.zeus.analyzers.registerAnalyzer('ext-demo', {
            run: () => ({ fromVSCodeExt: true }),
          });
          VSCodeModule.window.showInformationMessage('Demo analyzer registered from extension.');
        }
      })
    : null;

  [analyzeCmd, showReportCmd, webviewCmd, demoReg].forEach(c => {
    if (c) context.subscriptions.push(c);
  });

  // Chat Participant (4)
  if (VSCodeModule && VSCodeModule.chat && VSCodeModule.chat.createChatParticipant) {
    const participant = VSCodeModule.chat.createChatParticipant(
      'zeus',
      async (req, ctx, stream) => {
        stream.progress('Gathering Zeus evidence...');
        const current = getCurrentProgram();
        let contextText = 'No Zeus analysis available.';
        if (zeusApi && zeusApi.zeus && current) {
          try {
            const chatCfg = getConfig();
            let chatSource =
              VSCodeModule.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            if (!isCode4iConnected) {
              chatSource = computeLocalSourceRoot(current, VSCodeModule.workspace.workspaceFolders);
            }
            const chatOpts = {
              source: chatSource,
              program: current.program,
              dense: chatCfg.defaultDenseLevel,
            };
            const res = await zeusApi.zeus.analyze(chatCfg.defaultProfile, chatOpts);
            if (res?.canonicalAnalysis)
              contextText = JSON.stringify(res.canonicalAnalysis).slice(0, 1200);
          } catch (e) {
            contextText = 'Error: ' + e.message;
          }
        }
        const mode = isCode4iConnected ? 'Code4i' : 'local';
        stream.markdown(
          `**Zeus context (${mode}) for ${current?.program || 'current'}:**\n\n${contextText}\n\n(Pluggable analyzers and dense output used where configured.)`
        );
      }
    );
    context.subscriptions.push(participant);
  }

  // Webview command (1)
  if (webviewCmd) context.subscriptions.push(webviewCmd);

  // Output + return API
  if (zeusOutputChannel) {
    const mode = isCode4iConnected ? 'Code4i connected' : 'standalone / local fallback';
    zeusOutputChannel.appendLine(`Activated in ${mode} mode. Pluggable zeus API ready.`);
  }

  // Show initial mode to user
  const modeMsg = isCode4iConnected
    ? 'Zeus extension activated with Code for IBM i connection.'
    : 'Zeus extension activated in local mode (Code for IBM i not connected). Local file analysis is fully supported.';
  if (VSCodeModule) {
    // Only show once per activation
    setTimeout(() => VSCodeModule.window.setStatusBarMessage(modeMsg, 4000), 1500);
  }

  // Return rich API
  return {
    zeus: zeusApi ? zeusApi.zeus : null,
    getCode4i: () => code4iExports,
    registerAnalyzer: (id, a) => zeusApi?.zeus?.analyzers?.registerAnalyzer(id, a),
    registerMcpTool: (n, d) => zeusApi?.zeus?.mcpTools?.registerTool(n, d),
    registerPlugin: p => zeusApi?.zeus?.registerPlugin(p),
  };
}

function deactivate() {}
module.exports = { activate, deactivate };
