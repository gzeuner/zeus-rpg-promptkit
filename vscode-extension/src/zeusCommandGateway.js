const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  analyze,
  fetch,
  queryTable,
} = require('../../src/api/zeusApi');
const {
  DEFAULT_EXTENSIONS,
  loadProfiles,
  readWorkflowConfig,
  resolveProfile,
} = require('../../src/config/runtimeConfig');
const { generateAiContextBundle } = require('../../src/agent/aiContextService');
const {
  maskSecretsInText,
  sanitizeValue,
} = require('../../src/security/secretMasking');
const { listSelectableProfiles, resolveActiveProfile } = require('../../src/vscode/profileSelection');
const {
  validateSqlIdentifier,
} = require('../../src/db2/readOnlyQueryService');
const { validateFilterPattern } = require('../../src/core/queryService');

const READ_ONLY_SAFE_ACTIONS = new Set([
  'zeus_doctor',
  'zeus_analyze_workspace',
  'zeus_query_table',
  'zeus_generate_ai_context',
  'zeus_get_latest_report',
]);
const FILTER_SAFE_PATTERN = /^[A-Z0-9_%$#@-]*$/i;
const AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'zeus_doctor',
    description: 'Run Zeus diagnostics for the active profile and return sanitized PASS/FAIL/SKIP checks.',
  },
  {
    name: 'zeus_fetch_sources',
    description: 'Fetch configured source members through safe read-only compatible pathways.',
  },
  {
    name: 'zeus_analyze_workspace',
    description: 'Analyze workspace members and return report paths, summary, and warnings.',
  },
  {
    name: 'zeus_query_table',
    description: 'Run read-only DB2 table metadata query with validated schema/table/filter inputs.',
  },
  {
    name: 'zeus_generate_ai_context',
    description: 'Generate sanitized AI context bundle paths and summary for agent workflows.',
  },
  {
    name: 'zeus_get_latest_report',
    description: 'Return the latest report path, type, timestamp, and summary.',
  },
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(filePath) {
  return String(filePath || '').split(path.sep).join('/');
}

function normalizeBooleanString(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback ? 'true' : 'false';
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'false' ? 'false' : 'true';
}

function resolvePathFromSetting(rootDir, rawValue, fallbackValue) {
  const fallback = String(fallbackValue || '').trim();
  const raw = String(rawValue || '').trim() || fallback;
  return path.resolve(rootDir, raw);
}

function maskEnvForLogs(env) {
  const safe = {};
  const keys = [
    'ZEUS_CONFIG_DIR',
    'ZEUS_PROFILE',
    'ZEUS_OUTPUT_ROOT',
    'ZEUS_READ_ONLY',
    'ZEUS_CLI_PATH',
    'ZEUS_JAVA_PATH',
  ];
  for (const key of keys) {
    if (env[key] === undefined) {
      continue;
    }
    safe[key] = sanitizeValue(env[key], key);
  }
  return safe;
}

function buildSafeTableIdentifier(value, label) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required option: ${label}`);
  }
  return validateSqlIdentifier(value, label);
}

function safeFilterPattern(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }
  if (!FILTER_SAFE_PATTERN.test(normalized)) {
    throw new Error(`Invalid --filter pattern: ${value}`);
  }
  return validateFilterPattern(normalized);
}

function createZeusCommandGateway({ vscode, outputChannel, workspaceState, lastAiPromptKey }) {
  function appendOutput(message) {
    if (!outputChannel) {
      return;
    }
    const rendered = typeof message === 'string'
      ? message
      : JSON.stringify(sanitizeValue(message), null, 2);
    outputChannel.appendLine(maskSecretsInText(rendered));
  }

  function ensureWorkspaceRoot() {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const root = folder ? folder.uri.fsPath : '';
    if (!root) {
      throw new Error('Open a workspace folder before running Zeus commands.');
    }
    return root;
  }

  function getSettings(rootDir) {
    return vscode.workspace.getConfiguration('zeusRpgToolkit', vscode.Uri.file(rootDir));
  }

  function resolveZeusEnv(settings, activeProfile) {
    const envSetting = (key) => String(settings.get(`env.${key}`) || '').trim();
    const topConfigPath = String(settings.get('configPath') || 'config/profiles.json').trim();
    const topProfile = String(settings.get('defaultProfile') || '').trim();
    const topOutput = String(settings.get('outputRoot') || 'analysis').trim();
    const topReadOnly = Boolean(settings.get('readOnlyMode'));
    const topCliPath = String(settings.get('cliPath') || 'cli/zeus.js').trim();
    const topJavaPath = String(settings.get('javaPath') || '').trim();

    const zeus = {
      ZEUS_CONFIG_DIR: envSetting('ZEUS_CONFIG_DIR') || topConfigPath,
      ZEUS_PROFILE: activeProfile || envSetting('ZEUS_PROFILE') || topProfile,
      ZEUS_OUTPUT_ROOT: envSetting('ZEUS_OUTPUT_ROOT') || topOutput,
      ZEUS_READ_ONLY: normalizeBooleanString(envSetting('ZEUS_READ_ONLY'), topReadOnly),
      ZEUS_CLI_PATH: envSetting('ZEUS_CLI_PATH') || topCliPath,
      ZEUS_JAVA_PATH: envSetting('ZEUS_JAVA_PATH') || topJavaPath,
    };

    return zeus;
  }

  function createProcessEnv(rootDir, settings, activeProfile) {
    const merged = { ...process.env };
    const zeus = resolveZeusEnv(settings, activeProfile);

    for (const [key, value] of Object.entries(zeus)) {
      if (!String(value || '').trim()) {
        continue;
      }
      merged[key] = String(value);
    }

    const javaPathRaw = String(zeus.ZEUS_JAVA_PATH || settings.get('javaPath') || '').trim();
    if (javaPathRaw) {
      const resolved = path.resolve(rootDir, javaPathRaw);
      const javaBinDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? resolved
        : path.dirname(resolved);
      merged.PATH = `${javaBinDir}${path.delimiter}${merged.PATH || ''}`;
    }

    return {
      env: merged,
      zeus,
    };
  }

  function resolveConfigArg(settings) {
    return String(settings.get('configPath') || 'config/profiles.json').trim();
  }

  function resolveCliInvocation(rootDir, settings, zeusEnv) {
    const cliSetting = String(zeusEnv.ZEUS_CLI_PATH || settings.get('cliPath') || 'cli/zeus.js').trim();
    const cliPath = path.resolve(rootDir, cliSetting);
    return {
      cliPath,
      exists: fs.existsSync(cliPath),
    };
  }

  function loadProfilesForWorkspace(rootDir, settings, env) {
    const configPath = resolveConfigArg(settings);
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

  function resolveActiveProfileName(settings, profileNames) {
    const preferred = String(settings.get('defaultProfile') || settings.get('env.ZEUS_PROFILE') || '').trim();
    return resolveActiveProfile(preferred, profileNames);
  }

  function resolveOutputRoot(rootDir, settings, zeusEnv) {
    const raw = String(zeusEnv.ZEUS_OUTPUT_ROOT || settings.get('outputRoot') || 'analysis').trim();
    return path.resolve(rootDir, raw || 'analysis');
  }

  function resolveContext() {
    const rootDir = ensureWorkspaceRoot();
    const settings = getSettings(rootDir);

    const provisionalEnv = createProcessEnv(rootDir, settings, String(settings.get('defaultProfile') || '').trim());
    const loaded = loadProfilesForWorkspace(rootDir, settings, provisionalEnv.env);
    const activeProfile = resolveActiveProfileName(settings, loaded.profileNames);
    const resolvedEnv = createProcessEnv(rootDir, settings, activeProfile);
    const outputRoot = resolveOutputRoot(rootDir, settings, resolvedEnv.zeus);
    const configPath = resolvePathFromSetting(rootDir, resolveConfigArg(settings), 'config/profiles.json');
    const readOnlyMode = String(resolvedEnv.zeus.ZEUS_READ_ONLY || '').toLowerCase() !== 'false';

    return {
      rootDir,
      settings,
      env: resolvedEnv.env,
      zeusEnv: resolvedEnv.zeus,
      profiles: loaded.profiles,
      profileNames: loaded.profileNames,
      activeProfile,
      outputRoot,
      configPath,
      readOnlyMode,
    };
  }

  async function setActiveProfile(profileName) {
    const ctx = resolveContext();
    const selected = String(profileName || '').trim();
    if (!selected) {
      throw new Error('Profile name is required.');
    }
    if (!ctx.profileNames.includes(selected)) {
      throw new Error(`Profile "${selected}" not found in config.`);
    }
    await ctx.settings.update('defaultProfile', selected, vscode.ConfigurationTarget.Workspace);
    await ctx.settings.update('env.ZEUS_PROFILE', selected, vscode.ConfigurationTarget.Workspace);
    return {
      status: 'PASS',
      profile: selected,
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

  async function runCliCommand(ctx, cliArgs) {
    const cli = resolveCliInvocation(ctx.rootDir, ctx.settings, ctx.zeusEnv);
    if (!cli.exists) {
      throw new Error(`CLI path not found: ${cli.cliPath}. Update zeusRpgToolkit.cliPath or zeusRpgToolkit.env.ZEUS_CLI_PATH.`);
    }

    const nodeArgs = [cli.cliPath, ...cliArgs];
    appendOutput(`[cli] node ${nodeArgs.join(' ')}`);

    const outputLines = [];
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, nodeArgs, {
        cwd: ctx.rootDir,
        env: ctx.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onData = (chunk) => {
        const text = String(chunk || '');
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          const masked = maskSecretsInText(line);
          outputLines.push(masked);
          appendOutput(masked);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI command failed with exit code ${code}.`));
        }
      });
    });

    return {
      status: 'PASS',
      outputLines,
    };
  }

  function runFallbackDoctorChecks(ctx) {
    const checks = [];
    const cli = resolveCliInvocation(ctx.rootDir, ctx.settings, ctx.zeusEnv);
    const nodeVersion = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
    const javaVersion = spawnSync('java', ['-version'], {
      cwd: ctx.rootDir,
      env: ctx.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const javaLibDir = path.join(ctx.rootDir, 'java', 'lib');
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
      status: fs.existsSync(ctx.configPath) ? 'PASS' : 'FAIL',
      details: fs.existsSync(ctx.configPath)
        ? `Found ${toPosix(path.relative(ctx.rootDir, ctx.configPath) || path.basename(ctx.configPath))}`
        : `Missing config at ${ctx.configPath}.`,
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
      status: jarCount > 0 ? 'PASS' : 'SKIP',
      details: `java/lib jars=${jarCount}${fs.existsSync(path.join(javaLibDir, 'jt400.jar')) ? ', jt400.jar detected' : ', jt400.jar not detected'}`,
    });

    return checks.map((entry) => sanitizeValue(entry));
  }

  function requireProfile(ctx, requestedProfile) {
    const effective = String(requestedProfile || '').trim() || ctx.activeProfile;
    if (!effective) {
      throw new Error('No active profile selected. Use "Zeus: Select Profile".');
    }
    return effective;
  }

  function ensureReadOnlyAllowed(ctx, actionName) {
    const isSafe = READ_ONLY_SAFE_ACTIONS.has(actionName);
    if (ctx.readOnlyMode || isSafe) {
      return null;
    }
    return {
      tool: actionName,
      status: 'BLOCKED',
      requiresUserConfirmation: true,
      reason: 'Action is blocked because read-only mode is disabled. Explicit user confirmation is required.',
    };
  }

  async function runDoctor(input = {}) {
    const ctx = resolveContext();
    const profile = requireProfile(ctx, input.profile);
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_doctor');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    const cli = resolveCliInvocation(ctx.rootDir, ctx.settings, ctx.zeusEnv);
    if (cli.exists) {
      await runCliCommand(ctx, [...buildCliBaseArgs(ctx.settings), 'doctor', '--profile', profile]);
      return {
        tool: 'zeus_doctor',
        status: 'PASS',
        profile,
        checks: [
          {
            name: 'CLI Doctor',
            status: 'PASS',
            details: 'Doctor command completed successfully.',
          },
        ],
        summary: 'Doctor command completed successfully.',
      };
    }

    const checks = runFallbackDoctorChecks(ctx);
    const hasFail = checks.some((check) => check.status === 'FAIL');
    for (const check of checks) {
      appendOutput(`[${check.status}] ${check.name}: ${check.details}`);
    }

    return {
      tool: 'zeus_doctor',
      status: hasFail ? 'FAIL' : 'PASS',
      profile,
      checks,
      summary: hasFail
        ? 'Doctor fallback checks reported failures.'
        : 'Doctor fallback checks passed.',
    };
  }

  async function fetchSources(input = {}) {
    const ctx = resolveContext();
    const profile = requireProfile(ctx, input.profile);
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_fetch_sources');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    let summary;
    const cli = resolveCliInvocation(ctx.rootDir, ctx.settings, ctx.zeusEnv);
    if (cli.exists) {
      const cliResult = await runCliCommand(ctx, [...buildCliBaseArgs(ctx.settings), 'fetch', '--profile', profile]);
      summary = {
        mode: 'cli',
        lines: cliResult.outputLines.length,
      };
    } else {
      const fallback = await fetch(profile, {
        runtime: {
          cwd: ctx.rootDir,
          env: ctx.env,
        },
      });
      summary = {
        mode: 'api',
        downloadedCount: Number(fallback.summary.downloadedCount || 0),
      };
      appendOutput('[fetch] completed via fallback API');
      appendOutput(fallback.summary);
    }

    const resolvedProfile = resolveProfile(ctx.profiles, profile, { env: ctx.env });
    const profileFetchOut = resolvedProfile && resolvedProfile.fetch && resolvedProfile.fetch.out
      ? path.resolve(ctx.rootDir, resolvedProfile.fetch.out)
      : path.resolve(ctx.rootDir, 'rpg_sources');

    return {
      tool: 'zeus_fetch_sources',
      status: 'PASS',
      profile,
      outputFolder: toPosix(path.relative(ctx.rootDir, profileFetchOut) || '.'),
      fetchedFileCount: Number(summary.downloadedCount || 0) || null,
      summary: sanitizeValue(summary),
    };
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

  function resolveAnalyzeSourceRoot(ctx, profile) {
    const resolvedProfile = resolveProfile(ctx.profiles, profile, { env: ctx.env });
    const defaultSourceRoot = resolvedProfile && resolvedProfile.sourceRoot
      ? path.resolve(ctx.rootDir, resolvedProfile.sourceRoot)
      : ctx.rootDir;
    return fs.existsSync(defaultSourceRoot) ? defaultSourceRoot : ctx.rootDir;
  }

  async function analyzeWorkspace(input = {}) {
    const ctx = resolveContext();
    const profile = requireProfile(ctx, input.profile);
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_analyze_workspace');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    const targetPath = String(input.targetPath || '').trim();
    let sourceRoot = resolveAnalyzeSourceRoot(ctx, profile);
    if (targetPath) {
      const candidate = path.resolve(ctx.rootDir, targetPath);
      const prefix = `${path.resolve(ctx.rootDir)}${path.sep}`;
      if (candidate !== path.resolve(ctx.rootDir) && !candidate.startsWith(prefix)) {
        throw new Error('targetPath must stay inside the workspace.');
      }
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
        throw new Error(`targetPath does not exist or is not a directory: ${targetPath}`);
      }
      sourceRoot = candidate;
    }

    const mode = String(input.mode || 'documentation').trim() || 'documentation';
    const members = Array.isArray(input.members) && input.members.length > 0
      ? input.members.map((member) => String(member || '').trim().toUpperCase()).filter(Boolean)
      : collectMembers(sourceRoot);
    if (members.length === 0) {
      throw new Error(`No source members found in ${sourceRoot}`);
    }

    const analyzed = [];
    for (const member of members) {
      const result = analyze(profile, {
        runtime: {
          cwd: ctx.rootDir,
          env: ctx.env,
        },
        source: sourceRoot,
        member,
        mode,
        out: ctx.outputRoot,
      });
      analyzed.push({
        member,
        outputProgramDir: result.outputProgramDir,
        reportPath: path.join(result.outputProgramDir, 'report.md'),
      });
    }

    return {
      tool: 'zeus_analyze_workspace',
      status: 'PASS',
      profile,
      mode,
      targetPath: toPosix(path.relative(ctx.rootDir, sourceRoot) || '.'),
      analyzedCount: analyzed.length,
      reportPaths: analyzed.map((entry) => toPosix(path.relative(ctx.rootDir, entry.reportPath))),
      warnings: [],
      summary: `${analyzed.length} member(s) analyzed.`,
    };
  }

  async function queryTableMetadata(input = {}) {
    const ctx = resolveContext();
    const profile = requireProfile(ctx, input.profile);
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_query_table');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    const table = buildSafeTableIdentifier(input.table, '--table');
    const schema = input.schema ? buildSafeTableIdentifier(input.schema, '--schema') : '';
    const filter = safeFilterPattern(input.filter);

    const result = queryTable(profile, table, {
      runtime: {
        cwd: ctx.rootDir,
        env: ctx.env,
      },
      schema: schema || undefined,
      filter: filter || undefined,
    });

    const queryRoot = path.join(ctx.outputRoot, 'queries');
    ensureDir(queryRoot);
    const outputPath = path.join(
      queryRoot,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${table}.json`,
    );
    fs.writeFileSync(outputPath, `${JSON.stringify(sanitizeValue({
      table: result.table,
      schema: result.schema,
      filter: result.filter,
      tableInfo: result.tableInfo.rows || [],
      columns: result.columns.rows || [],
    }), null, 2)}\n`, 'utf8');

    return {
      tool: 'zeus_query_table',
      status: 'PASS',
      profile,
      table,
      schema: result.schema || schema || '',
      filter,
      columnCount: Array.isArray(result.columns.rows) ? result.columns.rows.length : 0,
      tableMatches: Array.isArray(result.tableInfo.rows) ? result.tableInfo.rows.length : 0,
      reportPath: toPosix(path.relative(ctx.rootDir, outputPath)),
      summary: 'Read-only table metadata query completed.',
    };
  }

  async function generateAiContext(input = {}, selectedPaths = []) {
    const ctx = resolveContext();
    const profile = requireProfile(ctx, input.profile);
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_generate_ai_context');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    const taskContext = String(input.ticket || input.taskContext || '').trim();
    const includeLatestReport = input.includeLatestReport !== false;
    const bundle = generateAiContextBundle({
      workspaceRoot: ctx.rootDir,
      outputRoot: ctx.outputRoot,
      activeProfile: profile,
      taskContext,
      selectedPaths: Array.isArray(input.selectedFiles) && input.selectedFiles.length > 0
        ? input.selectedFiles
        : selectedPaths,
      timestamp: new Date(),
    });

    if (!includeLatestReport && bundle.files && bundle.files.report && fs.existsSync(bundle.files.report)) {
      fs.unlinkSync(bundle.files.report);
      bundle.files.report = null;
    }

    if (workspaceState && lastAiPromptKey) {
      await workspaceState.update(lastAiPromptKey, bundle.files.aiPrompt);
    }

    return {
      tool: 'zeus_generate_ai_context',
      status: 'PASS',
      profile,
      outputDir: toPosix(path.relative(ctx.rootDir, bundle.outputDir)),
      files: {
        ai_prompt_md: bundle.files.aiPrompt ? toPosix(path.relative(ctx.rootDir, bundle.files.aiPrompt)) : null,
        context_json: bundle.files.context ? toPosix(path.relative(ctx.rootDir, bundle.files.context)) : null,
        safety_rules_md: bundle.files.safetyRules ? toPosix(path.relative(ctx.rootDir, bundle.files.safetyRules)) : null,
      },
      summary: 'AI context bundle generated.',
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

  async function getLatestReport() {
    const ctx = resolveContext();
    const readOnlyBlock = ensureReadOnlyAllowed(ctx, 'zeus_get_latest_report');
    if (readOnlyBlock) {
      return readOnlyBlock;
    }

    const reports = findLatestFiles(
      ctx.outputRoot,
      (entry) => path.basename(entry).toLowerCase() === 'report.md',
      1,
    );
    if (reports.length === 0) {
      return {
        tool: 'zeus_get_latest_report',
        status: 'SKIP',
        reportPath: null,
        reportType: null,
        timestamp: null,
        summary: 'No report found.',
      };
    }

    const latest = reports[0];
    return {
      tool: 'zeus_get_latest_report',
      status: 'PASS',
      reportPath: toPosix(path.relative(ctx.rootDir, latest.absolutePath)),
      reportType: 'report.md',
      timestamp: new Date(latest.modifiedAt).toISOString(),
      summary: 'Latest report resolved.',
      absolutePath: latest.absolutePath,
    };
  }

  function buildEnvironmentSummary() {
    const ctx = resolveContext();
    const relativeConfig = toPosix(path.relative(ctx.rootDir, ctx.configPath));
    const relativeOutput = toPosix(path.relative(ctx.rootDir, ctx.outputRoot));

    return sanitizeValue({
      activeProfile: ctx.activeProfile || '',
      readOnlyMode: ctx.readOnlyMode,
      workspaceRoot: ctx.rootDir,
      configPath: relativeConfig || path.basename(ctx.configPath),
      outputRoot: relativeOutput || '.',
      cliPath: toPosix(path.relative(ctx.rootDir, resolveCliInvocation(ctx.rootDir, ctx.settings, ctx.zeusEnv).cliPath)),
      zeusEnv: maskEnvForLogs(ctx.zeusEnv),
    });
  }

  function createAgentTerminal() {
    const ctx = resolveContext();
    const terminalEnv = {
      ...ctx.env,
      ZEUS_PROFILE: ctx.activeProfile || '',
      ZEUS_READ_ONLY: ctx.readOnlyMode ? 'true' : 'false',
      ZEUS_CONFIG_DIR: ctx.zeusEnv.ZEUS_CONFIG_DIR || toPosix(path.relative(ctx.rootDir, ctx.configPath)),
      ZEUS_OUTPUT_ROOT: ctx.zeusEnv.ZEUS_OUTPUT_ROOT || toPosix(path.relative(ctx.rootDir, ctx.outputRoot)),
      ZEUS_CLI_PATH: ctx.zeusEnv.ZEUS_CLI_PATH || 'cli/zeus.js',
    };

    const terminal = vscode.window.createTerminal({
      name: 'Zeus Agent Terminal',
      cwd: ctx.rootDir,
      env: terminalEnv,
    });

    const configForBanner = toPosix(path.relative(ctx.rootDir, ctx.configPath) || path.basename(ctx.configPath));
    terminal.show();
    terminal.sendText('echo Zeus RPG Toolkit environment loaded.');
    terminal.sendText(`echo Active profile: ${maskSecretsInText(ctx.activeProfile || '<none>')}`);
    terminal.sendText(`echo Read-only mode: ${ctx.readOnlyMode ? 'true' : 'false'}`);
    terminal.sendText(`echo Config: ${maskSecretsInText(configForBanner)}`);

    return {
      status: 'PASS',
      terminalName: 'Zeus Agent Terminal',
      activeProfile: ctx.activeProfile,
      readOnlyMode: ctx.readOnlyMode,
      configPath: configForBanner,
    };
  }

  function getAnalyzeModeChoices() {
    const ctx = resolveContext();
    const profile = resolveProfile(ctx.profiles, requireProfile(ctx), { env: ctx.env });
    const workflowConfig = readWorkflowConfig(ctx.profiles, profile, ctx.env);
    return workflowConfig.analyzeModes || ['documentation', 'defect-analysis'];
  }

  function getMemberCandidates() {
    const ctx = resolveContext();
    const profile = requireProfile(ctx);
    const sourceRoot = resolveAnalyzeSourceRoot(ctx, profile);
    return {
      sourceRoot,
      members: collectMembers(sourceRoot),
    };
  }

  async function runAgentTool(toolName, input = {}, selectedPaths = []) {
    const name = String(toolName || '').trim();
    if (!name) {
      throw new Error('Tool name is required.');
    }

    if (name === 'zeus_doctor') {
      return runDoctor(input);
    }
    if (name === 'zeus_fetch_sources') {
      return fetchSources(input);
    }
    if (name === 'zeus_analyze_workspace') {
      return analyzeWorkspace(input);
    }
    if (name === 'zeus_query_table') {
      return queryTableMetadata(input);
    }
    if (name === 'zeus_generate_ai_context') {
      return generateAiContext(input, selectedPaths);
    }
    if (name === 'zeus_get_latest_report' || name === 'zeus_open_latest_report') {
      return getLatestReport();
    }

    return {
      tool: name,
      status: 'BLOCKED',
      requiresUserConfirmation: true,
      reason: 'Unsupported Zeus agent tool. Allowed tools are read-only safe operations only.',
      availableTools: AGENT_TOOL_DEFINITIONS.map((entry) => ({
        name: entry.name,
        description: entry.description,
      })),
    };
  }

  function getAgentTools() {
    return AGENT_TOOL_DEFINITIONS.map((entry) => ({ ...entry }));
  }

  return {
    appendOutput,
    buildEnvironmentSummary,
    createAgentTerminal,
    getAnalyzeModeChoices,
    getMemberCandidates,
    getLatestReport,
    resolveContext,
    runAgentTool,
    getAgentTools,
    runDoctor,
    fetchSources,
    analyzeWorkspace,
    queryTableMetadata,
    generateAiContext,
    setActiveProfile,
  };
}

module.exports = {
  createZeusCommandGateway,
};
