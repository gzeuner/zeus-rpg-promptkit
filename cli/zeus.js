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
const { run: runQA } = require('../src/cli/commands/qaCommand');
const { runAssessRisk } = require('../src/cli/commands/assessRiskCommand');
const { runGenerateTest } = require('../src/cli/commands/generateTestCommand');
const { runGenerateChecklist } = require('../src/cli/commands/generateChecklistCommand');
const { runUpsertSql, runInsertSql, runUpdateSql } = require('../src/cli/commands/writeSqlCommand');
const { runInspectObject } = require('../src/cli/commands/inspectObjectCommand');
const { run: runTestRun } = require('../src/cli/commands/testRunCommand');
const { runBridge } = require('../src/cli/commands/bridgeCommand');
const { run: runPuiEdit } = require('../src/cli/commands/puiEditCommand');
const { runSearchSource } = require('../src/cli/commands/searchSourceCommand');
const { runJoblog } = require('../src/cli/commands/joblogCommand');
const { runDocsGenerateCatalog } = require('./commands/generate-tool-catalog');
const { run: runAnalyses } = require('../src/cli/commands/analysesCommand');
const { runMcp } = require('../src/cli/commands/mcpCommand');
const { runProfiles } = require('../src/cli/commands/profilesCommand');

function printHelp() {
  console.log('Usage:');
  console.log('  zeus [--config <path>] analyze --source <path> (--program <name> | --member <name>) [--profile <name>] [--out <path>] [--extensions .rpgle,.rpg] [--mode <name>] [--list-modes] [--list-diagnostic-packs] [--optimize-context] [--scan-ifs-paths] [--search-terms a,b] [--search-ignore path1,path2] [--search-max-results <n>] [--diagnostic-packs a,b] [--diagnostic-params k=v] [--host <hostname>] [--user <username>] [--password <password>] [--safe-sharing] [--emit-diagnostics] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]');
  console.log('  zeus [--config <path>] workflow --preset <name> --source <path> --program <name> [--profile <name>] [--out <path>] [--bundle-output <path>] [--extensions .rpgle,.rpg] [--list-presets] [--safe-sharing] [--reproducible] [--test-data-limit <n>] [--skip-test-data] [--verbose]');
  console.log('  zeus [--config <path>] workflow run --profile <name> [--preset <name>] [--out <path>] [--continue-on-error]');
  console.log('  zeus [--config <path>] bundle --program <name> [--output <path>] [--source-output-root <path>] [--include-json] [--include-md] [--include-html] [--safe-sharing] [--reproducible] [--profile <name>] [--verbose]');
  console.log('  zeus [--config <path>] impact (--target <name> | --field <name>) [--program <name> | --member <name>] [--out <path>] [--profile <name>] [--source <path>] [--reproducible] [--verbose]');
  console.log('  zeus [--config <path>] assess-risk --program <name> [--out <path>] [--verbose]');
  console.log('  zeus [--config <path>] generate-test --program <name> [--format jest|markdown] [--critical] [--change] [--table <name>] [--column <name>] [--out <path>] [--verbose]');
  console.log('  zeus [--config <path>] generate-checklist --program <name> [--type DDL_CHANGE|CODE_CHANGE|BOTH] [--affected <P1,P2,...>] [--table <name>] [--impact LOW|MEDIUM|HIGH] [--out <path>] [--verbose]');
  console.log('  zeus [--config <path>] fetch --host <hostname> --port <n> --user <username> --password <password> --source-lib <objectLib> [--source-library <objectLib>] --ifs-dir <ifsPath> --out <localPath> [--files <sourceFiles>] [--source-files <sourceFiles>] [--members <list>] [--replace true|false] [--streamfile-ccsid <ccsid>] [--transport auto|sftp|jt400|ftp] [--network-type local|internet] [--prefer-transport sftp|jt400|ftp] [--diagnose-transport] [--transport-timeout-ms <n>] [--clean-remote] [--profile <name>] [--verbose]');
  console.log('  zeus [--config <path>] fetch-member --profile <name> --lib <library> --member <name>[,<name>,...] [--file <QRPGLESRC>] [--out <dir>] [--verbose]  # Einzel- oder Mehrfach-Member-Download');
  console.log('  zeus [--config <path>] serve [--source-output-root <path>] [--profile <name>] [--host 127.0.0.1] [--port <n>] [--verbose]');
  console.log('  zeus [--config <path>] analyses <list|register|index|open|show|unregister> [options]');
  console.log('  zeus [--config <path>] doctor --profile <name> [--show-resolved]');
  console.log('  zeus [--config <path>] profiles [--profile <name>] [--show-env]  # Profile anzeigen; --show-env zeigt Env-Var-Status');
  console.log('  zeus [--config <path>] query-table --profile <name> --table <name> [--schema <name>] [--filter <pattern>] [--save <datei.csv|datei.json>]');
  console.log('  zeus [--config <path>] query-sql --profile <name> (--sql "SELECT ..." | --file <path>) [--default-schema <schema>] [--liblist <lib1,lib2,...>] [--max-rows <n>] [--output table|csv|json] [--save <datei.csv|datei.json>] [--watch <sek>]');
  console.log('  zeus [--config <path>] joblog --profile <name> [--job <job-name>] [--severity WARNING|ERROR|INFO] [--max-messages <n>]');
  console.log('  zeus [--config <path>] write-sql --profile <name> (--sql "INSERT/UPDATE/DELETE/MERGE ..." | --file <path>) [--confirm] [--force] [--dry-run] [--backup]  # allgemeiner DML-Befehl');
  console.log('  zeus [--config <path>] insert  --profile <name> (--sql "INSERT ..."              | --file <path>)');
  console.log('  zeus [--config <path>] update  --profile <name> (--sql "UPDATE ..."              | --file <path>) [--confirm] [--force] [--dry-run] [--backup]');
  console.log('  zeus [--config <path>] delete  --profile <name> (--sql "DELETE ..."              | --file <path>) [--confirm] [--force] [--dry-run] [--backup]');
  console.log('    --confirm    Bestaetigt Ausfuehrung nach Row-Count-Pruefung (erforderlich fuer DELETE/UPDATE)');
  console.log('    --force      Ueberspringt Row-Count-Pruefung (kein --confirm noetig)');
  console.log('    --dry-run    Zeigt nur Row-Count, fuehrt NICHTS aus');
  console.log('    --backup     Legt Backup-Tabelle an bevor DELETE/UPDATE ausgefuehrt wird');
  console.log('  zeus [--config <path>] search-source --source-root <path> (--search-term <term> | --member <name> | --table <name>) [--file-pattern <glob>] [--case-sensitive] [--max-results <n>]');
  console.log('  zeus [--config <path>] copy-to-workspace --profile <name> [--members <M1,M2,...>] [--force]');
  console.log('  zeus [--config <path>] diff --profile <name> --member <name>');
  console.log('  zeus [--config <path>] field-search --profile <name> --field <name> [--table <name>] [--source <path>] [--source-lib <lib>] [--source-file <file>] [--mode local|remote|xref|all] [--max-results <n>] [--verbose]');
  console.log('  zeus [--config <path>] qa [--input <path>] [--format jira|markdown|json] [--strict LENIENT|STRICT] [--post-comment] [--jira-ticket <ticket>] [--verbose]');
  console.log('  zeus [--config <path>] inspect-object --profile <name> --lib <lib> --name <name> [--type *PGM|*FILE|*SRVPGM|*MODULE] [--journal]');
  console.log('  zeus [--config <path>] test-run <start|capture|show|rollback> --profile <name> [options]');
  console.log('  zeus [--config <path>] bridge <plan|stage|apply|compile-plan|compile-run|report> --profile <name> [options]');
  console.log('  zeus pui-edit --file <path> --action <roundtrip-check|dump-json|validate-json|export-json|import-json|plan|apply|grid-add-column> [--changes-file <path>] [--out <path>] [--in <path>] [--format pretty|compact|dddl] [--confirm] [--sfl-record <name>] [--sfl-field "<DDS line>"]');
  console.log('  zeus [--config <path>] docs:generate-catalog [--output <path>] [--format markdown|json] [--json-output <path>]');
  console.log('  zeus [--config <path>] docs generate-catalog [--output <path>] [--format markdown|json] [--json-output <path>]');
  console.log('  zeus [--config <path>] mcp <serve|help> [--stdio true|false] [--verbose]');
}

function parseArgs(argv) {
  const args = { _: [] };
  const multiValueKeys = new Set(['sfl-field']);

  // Bekannte Flag-Aliases: singular â†’ kanonische Form
  const FLAG_ALIASES = {
    'member': 'members',  // --member war hÃ¤ufige Fehleingabe statt --members
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      let key = token.slice(2);

      // Alias auflÃ¶sen + Warnung ausgeben
      if (Object.prototype.hasOwnProperty.call(FLAG_ALIASES, key)) {
        const canonical = FLAG_ALIASES[key];
        process.stderr.write(`[WARN] --${key} ist kein bekannter Flag â€” meinten Sie --${canonical}? Wird automatisch als --${canonical} behandelt.\n`);
        key = canonical;
      }

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
  'query-sql', 'query-table', 'fetch', 'fetch-member', 'analyze', 'workflow',
  'upsert', 'upsert-sql', 'write-sql', 'insert', 'update', 'delete',
  'joblog', 'inspect-object', 'diff', 'field-search', 'bridge', 'test-run',
]);

const DB_ENV_VARS = ['ZEUS_DB_USER', 'ZEUS_DB_PASSWORD', 'ZEUS_DB_HOST', 'ZEUS_DB_URL'];
const FETCH_ENV_VARS = ['ZEUS_FETCH_USER', 'ZEUS_FETCH_PASSWORD', 'ZEUS_FETCH_HOST'];

function checkEnvLoaded(command) {
  if (!COMMANDS_NEEDING_ENV.has(command)) return;
  const missingDb = DB_ENV_VARS.filter(v => !process.env[v]);
  const missingFetch = command.startsWith('fetch') ? FETCH_ENV_VARS.filter(v => !process.env[v]) : [];
  const missing = [...new Set([...missingDb, ...missingFetch])];
  if (missing.length > 0) {
    process.stderr.write(
      `[WARN] Umgebungsvariablen nicht geladen: ${missing.join(', ')}\n`
      + '       Bitte zuerst ausfÃ¼hren:\n'
      + '       . .\\config\\load-env.ps1 -Environment <name>\n'
      + '       Ohne Env-Load werden falsche/leere Credentials verwendet â†’ Kontosperre mÃ¶glich!\n\n',
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    printHelp();
    process.exit(1);
  }

  const { command, args } = splitCommandArgs(argv);
  if (!command) {
    printHelp();
    process.exit(1);
  }

  checkEnvLoaded(command);

  if (command === 'analyze') {
    runAnalyze(args);
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

  if (command === 'doctor') {
    await runDoctor(args);
    return;
  }

  if (command === 'profiles') {
    await runProfiles(args);
    return;
  }

  if (command === 'query-table') {
    await runQueryTable(args);
    return;
  }

  if (command === 'query-sql') {
    await runQuerySql(args);
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

  if (command === 'qa') {
    await runQA(args, {});
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

  if (command === 'docs:generate-catalog') {
    await runDocsGenerateCatalog(args);
    return;
  }

  if (command === 'docs') {
    const subcommand = Array.isArray(args._) && args._.length > 0 ? String(args._[0]).trim().toLowerCase() : '';
    if (subcommand === 'generate-catalog') {
      await runDocsGenerateCatalog(args);
      return;
    }
  }

  if (command === 'mcp') {
    await runMcp(args);
    return;
  }

  printHelp();
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
