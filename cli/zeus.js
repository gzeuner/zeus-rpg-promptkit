#!/usr/bin/env node

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

const { runAnalyze } = require('../src/cli/commands/analyzeCommand');
const { runImpact } = require('../src/cli/commands/impactCommand');
const { runBundle } = require('../src/cli/commands/bundleCommand');
const { runFetch } = require('../src/cli/commands/fetchCommand');
const { runFetchMember } = require('../src/cli/commands/fetchMemberCommand');
const { runWorkflow } = require('../src/cli/commands/workflowCommand');
const { runServe } = require('../src/cli/commands/serveCommand');
const { runDoctor } = require('../src/cli/commands/doctorCommand');
const { runQueryTable } = require('../src/cli/commands/queryTableCommand');
const { runQuerySql } = require('../src/cli/commands/querySqlCommand');
const { runCopyToWorkspace } = require('../src/cli/commands/copyToWorkspaceCommand');
const { runDiff } = require('../src/cli/commands/diffCommand');
const { runFieldSearch } = require('../src/cli/commands/fieldSearchCommand');
const { runTrace } = require('../src/cli/commands/traceCommand');
const { runXref } = require('../src/cli/commands/xrefCommand');
const { run: runQA } = require('../src/cli/commands/qaCommand');
const { runAssessRisk } = require('../src/cli/commands/assessRiskCommand');
const { runGenerateTest } = require('../src/cli/commands/generateTestCommand');
const { runGenerateChecklist } = require('../src/cli/commands/generateChecklistCommand');
const {
  runUpsertSql,
  runInsertSql,
  runUpdateSql,
  runDeleteSql,
} = require('../src/cli/commands/writeSqlCommand');
const { runInspectObject } = require('../src/cli/commands/inspectObjectCommand');
const { run: runTestRun } = require('../src/cli/commands/testRunCommand');
const { runBridge } = require('../src/cli/commands/bridgeCommand');
const { run: runPuiEdit } = require('../src/cli/commands/puiEditCommand');
const { run: runPuiInspect } = require('../src/cli/commands/puiInspectCommand');
const { runSearchSource } = require('../src/cli/commands/searchSourceCommand');
const { runJoblog } = require('../src/cli/commands/joblogCommand');
const { runResolveObject } = require('../src/cli/commands/resolveObjectCommand');
const { runDocsGenerateCatalog } = require('./commands/generate-tool-catalog');
const { run: runAnalyses } = require('../src/cli/commands/analysesCommand');
const { runMcp } = require('../src/cli/commands/mcpCommand');
const { runProfiles } = require('../src/cli/commands/profilesCommand');
const { runResources } = require('../src/cli/commands/resourcesCommand');
const { runDiscoverEnvironment } = require('../src/cli/commands/discoverEnvironmentCommand');
const { runValidateRpgSql } = require('../src/cli/commands/validateRpgSqlCommand');
const { runOnboarding } = require('../src/cli/commands/onboardingCommand');
const { runSecret } = require('../src/cli/commands/secretCommand');
const { runInvestigate } = require('../src/cli/commands/investigateCommand');
const path = require('path');
const { autoLoadEnvFiles } = require('../src/config/envFileLoader');
const { detectPlaintextSecrets } = require('../src/security/plaintextSecretDetector');

// Compute the installation root of the zeus package.
// Useful for global `zeus` (via bin) so that config/env discovery has a stable
// fallback even when process.cwd() is unrelated to the project.
const zeusPackageRoot = path.resolve(__dirname, '..');

function printHelp() {
  console.log('Usage:');
  console.log(
    '  zeus [--config <path>] analyze --source <path> (--program <name> | --member <name>) [--profile <name>] [--out <path>] [--source-root <path>] [--schema <name>] [--library <name>] [--extensions .rpgle,.rpg] [--mode <name>] [--list-modes] [--list-diagnostic-packs] [--optimize-context] [--dense [lite|full|ultra]] [--prompt-max-tokens <n>] [--skip-db2-metadata] [--scan-ifs-paths] [--search-terms a,b] [--search-ignore path1,path2] [--search-max-results <n>] [--diagnostic-packs a,b] [--diagnostic-params k=v] [--host <hostname>] [--user <username>] [--password <password>] [--safe-sharing] [--with-known-facts] [--known-facts-profile <name>] [--known-facts-path <path>] [--emit-diagnostics] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] investigate --program <name> [--profile <name>] [--out <path>] [--goal "<text>"] [--list] [--focus "<scope>"] [--search "<term>"] [--generate-prompt]  # Investigation session (focus, search, prompt gen)'
  );
  // Note: --dense now performs rank-aware selection + compaction (see Phase 1-3 impl)
  console.log(
    '  zeus [--config <path>] workflow --preset <name> --source <path> --program <name> [--profile <name>] [--out <path>] [--bundle-output <path>] [--extensions .rpgle,.rpg] [--list-presets] [--safe-sharing] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--dense [lite|full|ultra]] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] workflow run --profile <name> [--preset <name>] [--out <path>] [--continue-on-error] [--dense [lite|full|ultra]]'
  );
  console.log(
    '  zeus [--config <path>] investigate --program <name> [--profile <name>] [--out <path>] [--goal "<text>"] [--list]'
  );
  console.log(
    '  zeus [--config <path>] bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--safe-sharing] [--reproducible] [--profile <name>] [--verbose]'
  );
  console.log(
    '  zeus [--config <path>] impact (--target <name> | --field <name>) [--program <name> | --member <name>] [--out <path>] [--profile <name>] [--source <path>] [--reproducible] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] assess-risk --program <name> [--out <path>] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] generate-test --program <name> [--format jest|markdown] [--critical] [--change] [--table <name>] [--column <name>] [--out <path>] [--verbose]'
  );
  console.log(
    '  zeus [--config <path>] generate-checklist --program <name> [--type DDL_CHANGE|CODE_CHANGE|BOTH] [--affected <P1,P2,...>] [--table <name>] [--impact LOW|MEDIUM|HIGH] [--out <path>] [--verbose]'
  );
  console.log(
    '  zeus [--config <path>] fetch --host <hostname> --port <n> --user <username> --password <password> --source-lib <objectLib> [--source-library <objectLib>] --ifs-dir <ifsPath> --out <localPath> [--files <sourceFiles>] [--source-files <sourceFiles>] [--members <list>] [--replace true|false] [--streamfile-ccsid <ccsid>] [--transport auto|sftp|jt400|ftp] [--network-type local|internet] [--prefer-transport sftp|jt400|ftp] [--diagnose-transport] [--transport-timeout-ms <n>] [--clean-remote] [--profile <name>] [--system <name>] [--verbose]'
  );
  console.log(
    '  zeus [--config <path>] fetch-member --profile <name> --lib <library> --member <name>[,<name>,...] [--file <QRPGLESRC>] [--out <dir>] [--verbose]  # Einzel- oder Mehrfach-Member-Download'
  );
  console.log(
    '  zeus [--config <path>] serve [--source-output-root <path>] [--profile <name>] [--host 127.0.0.1] [--port <n>] [--verbose]'
  );
  console.log(
    '  zeus [--config <path>] analyses <list|register|index|open|show|unregister> [options]'
  );
  console.log(
    '  zeus [--config <path>] doctor --profile <name> [--probe] [--show-resolved] [--strict]'
  );
  console.log(
    '    --strict: Hygiene-Probleme (Klartext-Secrets) als kritischer Fehler behandeln (spiegelt "secret check" Exit-Verhalten)'
  );
  console.log(
    '  zeus secret <init-key|status|encrypt|decrypt|check|migrate> [--value <text>] [--force] [--windows] [--dry-run] [--no-backup]'
  );
  console.log(
    '    # Passwörter verschlüsselt ablegen (enc:v1:...). "check" prüft Hygiene (Exit 1). --windows für DPAPI. migrate: --no-backup verhindert Klartext-Backup.'
  );
  console.log(
    '  zeus [--config <path>] profiles [--profile <name>] [--show-env]  # Profile anzeigen; empfohlen: dev, demo, sftp-fetch, readonly-db2, combined-fetch-and-query'
  );
  console.log(
    '  zeus [--config <path>] resources --profile <name> [--json]  # Zeigt das aufgeloeste Resource-Modell (Source/Objects/Metadata/Data) pro System'
  );
  console.log(
    '  zeus [--config <path>] discover-environment --profile <name> [--libraries L1,L2] [--schemas S1,S2] [--include-members] [--no-tables] [--role metadata|data] [--system <name>] [--json] [--out <path>]  # Read-only Auto-Discovery von Bibliotheken/Source-Files/Members/Tabellen + Resource-Vorschlag'
  );
  console.log(
    '  zeus [--config <path>] query-table --profile <name> --table <name> [--schema <name>] [--library <name>] [--filter <pattern>] [--save <datei.csv|datei.json>] [--json]'
  );
  console.log(
    '  zeus [--config <path>] query-sql --profile <name> (--sql "SELECT ...[; SELECT ...]" | --file <path>) [--default-schema <schema>] [--liblist <lib1,lib2,...>] [--max-rows <n>] [--output table|csv] [--save <datei.csv|datei.json>] [--watch <sek>] [--repl] [--json]'
  );
  console.log('  zeus sql (alias for query-sql, implies --repl if no --sql/--file)');
  console.log(
    '    --file supports multiple ;-separated statements (batch mode). --repl or no query for interactive REPL (reuses process/guard cache, avoids repeated probes).'
  );
  console.log(
    '  zeus [--config <path>] resolve-object --profile <name> --table <name> [--schema <name>] [--require-column <COLUMN>] [--include-row-count] [--json]'
  );
  console.log(
    '  zeus [--config <path>] joblog --profile <name> [--job <job-name>] [--severity WARNING|ERROR|INFO] [--max-messages <n>] [--json]'
  );
  console.log(
    '  zeus [--config <path>] write-sql --profile <name> (--sql "INSERT/UPDATE/DELETE/MERGE ...[; ...]" | --file <path>) [--confirm] [--force] [--dry-run] [--backup] [--require-backup] [--backup-schema <schema>]  # allgemeiner DML-Befehl'
  );
  console.log(
    '  zeus [--config <path>] insert  --profile <name> (--sql "INSERT ..."              | --file <path>)'
  );
  console.log(
    '  zeus [--config <path>] update  --profile <name> (--sql "UPDATE ..."              | --file <path>) [--confirm] [--force] [--dry-run] [--backup] [--require-backup]'
  );
  console.log(
    '  zeus [--config <path>] delete  --profile <name> (--sql "DELETE ..."              | --file <path>) [--confirm] [--force] [--dry-run] [--backup] [--require-backup]'
  );
  console.log(
    '    --confirm    Bestaetigt Ausfuehrung nach Row-Count-Pruefung (erforderlich fuer DELETE/UPDATE)'
  );
  console.log('    --force      Ueberspringt Row-Count-Pruefung (kein --confirm noetig)');
  console.log('    --dry-run    Zeigt nur Row-Count, fuehrt NICHTS aus');
  console.log('    --backup     Legt Backup-Tabelle an bevor DELETE/UPDATE ausgefuehrt wird');
  console.log('    --require-backup  Bricht ab, wenn die Sicherung nicht angelegt werden kann');
  console.log(
    '  zeus [--config <path>] search-source --source-root <path> (--search-term <term> | --member <name> | --table <name>) [--file-pattern <glob>] [--case-sensitive] [--max-results <n>]'
  );
  console.log(
    '  zeus [--config <path>] copy-to-workspace --profile <name> [--members <M1,M2,...>] [--force]'
  );
  console.log('  zeus [--config <path>] diff --profile <name> --member <name>');
  console.log(
    '  zeus [--config <path>] field-search --profile <name> --field <name> [--table <name>] [--source <path>] [--source-lib <lib>] [--source-file <file>] [--mode local|remote|xref|all] [--max-results <n>] [--verbose]'
  );
  console.log(
    '  zeus trace --value <VAL> [--start-table <T>] [--start-program <P>] [--profile <name>] [--source <dir>] [--json]   # Value / data lineage'
  );
  console.log(
    '  zeus xref (--program <NAME> | --table <NAME>) [--profile <name>] [--json]   # Who-calls / who-uses (catalog + graph)'
  );
  console.log(
    '  zeus [--config <path>] qa [--input <path>] [--format jira|markdown|json] [--strict LENIENT|STRICT] [--post-comment] [--jira-ticket <ticket>] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] validate-rpg-sql [--source <path>] [--program <name>] [--input <analyze-output>] [--format markdown|json] [--out <path>] [--verbose] [--json]'
  );
  console.log(
    '  zeus [--config <path>] onboarding | wizard | onboard   # Interactive zeus-onboarding-wizard for new IBM i systems'
  );
  console.log(
    '  zeus [--config <path>] inspect-object --profile <name> --lib <lib> --name <name> [--type *PGM|*FILE|*SRVPGM|*MODULE] [--journal]'
  );
  console.log(
    '  zeus [--config <path>] test-run <start|capture|show|rollback> --profile <name> [options]'
  );
  console.log(
    '  zeus [--config <path>] bridge <plan|stage|apply|compile-plan|compile-run|report> --profile <name> [options]'
  );
  console.log(
    '  zeus pui-edit --file <path> --action <roundtrip-check|dump-json|validate-json|export-json|import-json|plan|apply|grid-add-column> [--changes-file <path>] [--out <path>] [--in <path>] [--format pretty|compact|dddl] [--confirm] [--sfl-record <name>] [--sfl-field "<DDS line>"]'
  );
  console.log(
    '  zeus pui-inspect --file <path> [--json] [--trace <fieldName>]  # LOKAL: Grid-Spalten -> Feldbindung -> Tooltip einer PUI-Display-Datei sichtbar machen'
  );
  console.log(
    '  zeus [--config <path>] docs:generate-catalog [--output <path>] [--format markdown|json] [--json-output <path>] [--json]'
  );
  console.log(
    '  zeus [--config <path>] docs generate-catalog [--output <path>] [--format markdown|json] [--json-output <path>] [--json]'
  );
  console.log('  zeus [--config <path>] mcp <serve|help> [--stdio true|false] [--verbose]');
}

function parseArgs(argv) {
  const args = { _: [] };
  const multiValueKeys = new Set(['require-column', 'sfl-field']);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);

      if (key === 'liblist') {
        const values = [];
        while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
          values.push(argv[++i]);
        }
        args[key] = values.length > 0 ? values : true;
        continue;
      }
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      if (multiValueKeys.has(key)) {
        if (!Object.prototype.hasOwnProperty.call(args, key)) {
          args[key] = [];
        } else if (!Array.isArray(args[key])) {
          args[key] = [args[key]];
        }
        args[key].push(value);
      } else {
        args[key] = value;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

/**
 * Global normalization for JSON output mode.
 * Ensures that --json, --format json, --output json, and --json-output
 * all result in args.json === true for downstream commands and the
 * jsonOutput helper.
 *
 * This centralizes the logic so individual commands can rely on a
 * single `args.json` flag.
 */
function normalizeJsonArgs(args) {
  if (!args || Object.prototype.hasOwnProperty.call(args, 'json')) {
    return;
  }
  const format = String(args.format || args.output || '')
    .toLowerCase()
    .trim();
  if (format === 'json' || args['json-output']) {
    args.json = true;
  }
}

function splitCommandArgs(argv) {
  let commandIndex = -1;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      commandIndex = i;
      break;
    }
    if (token === '--config' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      i += 1;
    }
  }

  if (commandIndex === -1) {
    return {
      command: null,
      args: parseArgs(argv),
    };
  }

  return {
    command: argv[commandIndex],
    args: parseArgs([...argv.slice(0, commandIndex), ...argv.slice(commandIndex + 1)]),
  };
}

// Befehle die DB2 oder IBM i Verbindung brauchen â€” Env-Check wird nur fÃ¼r diese ausgefÃ¼hrt
const COMMANDS_NEEDING_ENV = new Set([
  'query-sql',
  'query-table',
  'fetch',
  'fetch-member',
  'analyze',
  'workflow',
  'upsert',
  'upsert-sql',
  'write-sql',
  'insert',
  'update',
  'delete',
  'joblog',
  'inspect-object',
  'diff',
  'field-search',
  'bridge',
  'test-run',
  'resolve-object',
  'trace',
  'xref',
]);

const FETCH_ENV_VARS = ['ZEUS_FETCH_USER', 'ZEUS_FETCH_PASSWORD', 'ZEUS_FETCH_HOST'];

// Commands that establish a live IBM i / DB2 connection benefit from env
// auto-discovery. Local-only commands (analyze, workflow, bundle, impact, ...)
// are intentionally excluded so offline analysis never silently acquires
// credentials and stays deterministic.
const COMMANDS_AUTO_ENV = new Set([
  'doctor',
  'query-sql',
  'query-table',
  'resolve-object',
  'joblog',
  'fetch',
  'fetch-member',
  'inspect-object',
  'diff',
  'field-search',
  'bridge',
  'test-run',
  'discover-environment',
  'resources',
  'upsert',
  'upsert-sql',
  'write-sql',
  'insert',
  'update',
  'delete',
  'trace',
  'xref',
]);

function hasNonEmptyEnvVar(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function collectMissingDbEnvVars() {
  const missing = [];
  if (!hasNonEmptyEnvVar('ZEUS_DB_USER')) {
    missing.push('ZEUS_DB_USER');
  }
  if (!hasNonEmptyEnvVar('ZEUS_DB_PASSWORD')) {
    missing.push('ZEUS_DB_PASSWORD');
  }
  if (!hasNonEmptyEnvVar('ZEUS_DB_HOST') && !hasNonEmptyEnvVar('ZEUS_DB_URL')) {
    missing.push('ZEUS_DB_HOST|ZEUS_DB_URL');
  }
  return missing;
}

function isFlagDisabled(value) {
  if (value === undefined || value === null) return false;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

// Node-native env auto-discovery. Loads `.env(.<environment>).local` from
// config/local-only, config/ and the project root WITHOUT overwriting variables
// already exported in the shell. This is a convenience fallback so commands work
// even when the user forgot to dot-source load-env.ps1 / load-env.sh.
function autoLoadEnvironment(command, args) {
  if (!COMMANDS_AUTO_ENV.has(command)) {
    return;
  }
  const optedOut =
    isFlagDisabled(args['no-auto-env']) || isFlagDisabled(process.env.ZEUS_NO_AUTO_ENV);
  if (optedOut) {
    return;
  }

  const environment =
    (typeof args.env === 'string' && args.env.trim()) ||
    (typeof args.environment === 'string' && args.environment.trim()) ||
    (process.env.ZEUS_ENV && String(process.env.ZEUS_ENV).trim()) ||
    'default';
  const configDir =
    typeof args.config === 'string' && args.config.trim() ? args.config.trim() : undefined;

  const primaryCwd = process.cwd();
  // Include the zeus package root as additional search location (lowest priority).
  // This helps when the CLI is invoked globally (npm link / bin) from an unrelated CWD.
  const searchRoots = [primaryCwd, zeusPackageRoot];

  let summary = null;
  let usedRoot = primaryCwd;
  for (const root of searchRoots) {
    try {
      const candidate = autoLoadEnvFiles({
        cwd: root,
        env: process.env,
        configDir: configDir && root === primaryCwd ? configDir : undefined,
        environment,
      });
      if (candidate && Array.isArray(candidate.files) && candidate.files.length > 0) {
        summary = candidate;
        usedRoot = root;
        break;
      }
      if (!summary) summary = candidate;
    } catch (error) {
      // continue searching other roots
    }
  }

  if (!summary) {
    try {
      summary = autoLoadEnvFiles({
        cwd: primaryCwd,
        env: process.env,
        configDir,
        environment,
      });
    } catch (error) {
      process.stderr.write(`[WARN] Env-Auto-Discovery fehlgeschlagen: ${error.message}\n`);
      return;
    }
  }

  if (summary && summary.loaded) {
    const loadedFiles = (summary.files || [])
      .filter(file => Array.isArray(file.variables) && file.variables.length > 0)
      .map(file => path.relative(usedRoot, file.path).replace(/\\/g, '/') || file.path);
    const fileLabel = loadedFiles.length > 0 ? loadedFiles.join(' + ') : '(none)';
    process.stderr.write(
      `[INFO] Env auto-discovery: ${summary.applied.length} Variable(n) aus ${fileLabel} geladen ` +
        `(bereits gesetzte Werte bleiben unveraendert; Secrets werden nicht ausgegeben).\n`
    );

    // Secrets-Hygiene early warning during auto-discovery
    try {
      const hygieneFiles = (summary.files || []).map(f => f.path);
      const findings = detectPlaintextSecrets({
        cwd: usedRoot,
        envFiles: hygieneFiles,
        env: process.env,
        checkProfiles: true,
      });
      if (findings.length > 0) {
        process.stderr.write(
          `[WARN] Secrets-Hygiene: ${findings.length} Klartext-Credential(s) in .env-Datei(en) erkannt (z. B. ${findings[0].key}). ` +
            `Bitte mit "zeus secret encrypt" migrieren!\n`
        );
      }
    } catch (_) {}
  }
}

function checkEnvLoaded(command) {
  if (!COMMANDS_NEEDING_ENV.has(command)) return;
  const missingDb = collectMissingDbEnvVars();
  const missingFetch = command.startsWith('fetch')
    ? FETCH_ENV_VARS.filter(envVar => !hasNonEmptyEnvVar(envVar))
    : [];
  const missing = [...new Set([...missingDb, ...missingFetch])];
  if (missing.length > 0) {
    process.stderr.write(
      `[WARN] Umgebungsvariablen nicht geladen: ${missing.join(', ')}\n` +
        '       Auto-Discovery hat keine passende .env-Datei gefunden oder die Werte fehlen darin.\n' +
        '       Bitte .env-Datei in config/local-only/ pflegen oder manuell laden:\n' +
        '       . .\\config\\load-env.ps1 -Environment <name>\n' +
        '       Ohne Env-Load werden falsche/leere Credentials verwendet -> Kontosperre moeglich!\n\n'
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exit(1);
  }

  let { command, args } = splitCommandArgs(argv);
  if (!command) {
    printHelp();
    process.exit(1);
  }

  // Normalize 'sql' alias early so env auto-load / checks apply correctly
  if (command === 'sql') {
    command = 'query-sql';
    if (!args.sql && !args.file) {
      args.repl = true;
    }
  }

  normalizeJsonArgs(args);

  autoLoadEnvironment(command, args);
  checkEnvLoaded(command);

  if (command === 'analyze') {
    await runAnalyze(args);
    return;
  }

  if (command === 'impact') {
    runImpact(args);
    return;
  }

  if (command === 'bundle') {
    runBundle(args);
    return;
  }

  if (command === 'workflow') {
    await runWorkflow(args);
    return;
  }

  if (command === 'fetch') {
    await runFetch(args);
    return;
  }

  if (command === 'fetch-member') {
    await runFetchMember(args);
    return;
  }

  if (command === 'serve') {
    await runServe(args);
    return;
  }

  if (command === 'analyses') {
    await runAnalyses(args);
    return;
  }

  const foundationCommands = ['doctor', 'profiles', 'resources', 'discover-environment'];
  if (foundationCommands.includes(command)) {
    if (command === 'doctor') await runDoctor(args);
    else if (command === 'profiles') await runProfiles(args);
    else if (command === 'resources') await runResources(args);
    else if (command === 'discover-environment') await runDiscoverEnvironment(args);
    return;
  }

  if (command === 'query-table') {
    await runQueryTable(args);
    return;
  }

  if (command === 'query-sql' || command === 'sql') {
    // 'sql' is a convenient alias that implies interactive REPL unless --sql/--file given
    if (command === 'sql' && !args.sql && !args.file) {
      args.repl = true;
    }
    await runQuerySql(args);
    return;
  }

  if (command === 'resolve-object') {
    await runResolveObject(args);
    return;
  }

  if (command === 'joblog') {
    await runJoblog(args);
    return;
  }

  if (command === 'upsert') {
    await runUpsertSql(args);
    return;
  }

  if (command === 'upsert-sql') {
    await runUpsertSql(args);
    return;
  }

  if (command === 'write-sql') {
    await runUpsertSql(args);
    return;
  }

  if (command === 'insert') {
    await runInsertSql(args);
    return;
  }

  if (command === 'update') {
    await runUpdateSql(args);
    return;
  }

  if (command === 'delete') {
    await runDeleteSql(args);
    return;
  }

  if (command === 'search-source') {
    await runSearchSource(args);
    return;
  }

  if (command === 'copy-to-workspace') {
    await runCopyToWorkspace(args);
    return;
  }

  if (command === 'diff') {
    await runDiff(args);
    return;
  }

  if (command === 'field-search') {
    await runFieldSearch(args);
    return;
  }

  if (command === 'trace') {
    await runTrace(args);
    return;
  }

  if (command === 'xref') {
    await runXref(args);
    return;
  }

  if (command === 'qa') {
    await runQA(args, {});
    return;
  }

  if (command === 'validate-rpg-sql' || command === 'validate-rpgsql') {
    await runValidateRpgSql(args);
    return;
  }

  if (
    command === 'onboarding' ||
    command === 'wizard' ||
    command === 'onboard' ||
    command === 'zeus-onboarding-wizard'
  ) {
    await runOnboarding(args);
    return;
  }

  if (command === 'assess-risk') {
    await runAssessRisk(args);
    return;
  }

  if (command === 'generate-test') {
    await runGenerateTest(args);
    return;
  }

  if (command === 'generate-checklist') {
    await runGenerateChecklist(args);
    return;
  }

  if (command === 'inspect-object') {
    await runInspectObject(args);
    return;
  }

  if (command === 'test-run') {
    await runTestRun(args);
    return;
  }

  if (command === 'bridge') {
    await runBridge(args);
    return;
  }

  if (command === 'pui-edit') {
    await runPuiEdit(args);
    return;
  }

  if (command === 'pui-inspect') {
    await runPuiInspect(args);
    return;
  }

  if (command === 'docs:generate-catalog') {
    await runDocsGenerateCatalog(args);
    return;
  }

  if (command === 'docs') {
    const subcommand =
      Array.isArray(args._) && args._.length > 0 ? String(args._[0]).trim().toLowerCase() : '';
    if (subcommand === 'generate-catalog') {
      await runDocsGenerateCatalog(args);
      return;
    }
  }

  if (command === 'mcp') {
    await runMcp(args);
    return;
  }

  if (command === 'secret') {
    await runSecret(args);
    return;
  }

  if (command === 'investigate' || command === 'investigation') {
    runInvestigate(args);
    return;
  }

  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  checkEnvLoaded,
  collectMissingDbEnvVars,
  hasNonEmptyEnvVar,
  normalizeJsonArgs,
  // Rich pluggable API
  zeus: require('../src/api/zeusApi').zeus,
  zeusApi: require('../src/api/zeusApi'),
  parseArgs,
  splitCommandArgs,
};
