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

const COMMAND_METADATA = Object.freeze({
  doctor: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Validate runtime, profiles, Java/runtime wiring, and env contracts.',
    example: 'node cli/zeus.js doctor --profile default --show-resolved',
  }),
  secret: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Manage encrypted credentials (Secret Vault). Create key, encrypt/decrypt values (enc:v1:...) for .env or profiles. Transparent decryption at runtime. Never store plaintext passwords.',
    example: 'node cli/zeus.js secret init-key && node cli/zeus.js secret encrypt --value "myDbPass"',
  }),
  profiles: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'List profiles and show masked runtime defaults and resolved routing hints.',
    example: 'node cli/zeus.js profiles --profile default --show-env',
  }),
  fetch: Object.freeze({
    safety: 'S2',
    scope: 'IBM i read',
    purpose: 'Fetch source members/IFS content into the local workspace.',
    example: 'node cli/zeus.js fetch --profile default-fetch',
  }),
  'fetch-member': Object.freeze({
    safety: 'S2',
    scope: 'IBM i read',
    purpose: 'Fetch one or more specific source members into a local output directory.',
    example: 'node cli/zeus.js fetch-member --profile default --lib APPLIB --member ORDERPGM',
  }),
  analyze: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Analyze RPG/CL/DDS and generate evidence artifacts.',
    example: 'node cli/zeus.js analyze --source ./rpg_sources --program ORDERPGM --out ./output --optimize-context',
  }),
  workflow: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Run preset-guided analyze and bundle flow.',
    example: 'node cli/zeus.js workflow --preset architecture-review --source ./rpg_sources --program ORDERPGM --out ./output',
  }),
  'workflow run': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Run workflow definitions from profile/runtime configuration.',
    example: 'node cli/zeus.js workflow run --profile default --preset onboarding --out ./output',
  }),
  bundle: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Package analysis artifacts for sharing and review.',
    example: 'node cli/zeus.js bundle --program ORDERPGM --source-output-root ./output --include-md --include-json',
  }),
  impact: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Build reverse-impact analysis by target or field.',
    example: 'node cli/zeus.js impact --field RECORD_ID --program ORDERPGM --source ./rpg_sources --out ./output',
  }),
  'assess-risk': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Produce a risk-oriented summary for a program.',
    example: 'node cli/zeus.js assess-risk --program ORDERPGM --out ./output',
  }),
  'generate-test': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Generate test plan or test template artifacts.',
    example: 'node cli/zeus.js generate-test --program ORDERPGM --format markdown --out ./output',
  }),
  'generate-checklist': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Generate deployment and change checklist artifacts.',
    example: 'node cli/zeus.js generate-checklist --program ORDERPGM --type BOTH --impact HIGH --out ./output',
  }),
  'query-table': Object.freeze({
    safety: 'S2',
    scope: 'DB2 read',
    purpose: 'Query DB2 table metadata. Supports --json for machine readable output.',
    example: 'node cli/zeus.js query-table --profile default --table APP_TABLE_00 --schema APPDATA --json',
  }),
  'resolve-object': Object.freeze({
    safety: 'S2',
    scope: 'DB2 read',
    purpose: 'Resolve SQL/system object names and optionally verify required columns.',
    example: 'node cli/zeus.js resolve-object --profile default --table APP_TABLE_00 --require-column STATUS',
  }),
  'query-sql': Object.freeze({
    safety: 'S2',
    scope: 'DB2 read',
    purpose: 'Run read-only SQL statements (SELECT/WITH).',
    example: 'node cli/zeus.js query-sql --profile default --sql "SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"',
  }),
  joblog: Object.freeze({
    safety: 'S2',
    scope: 'IBM i read',
    purpose: 'Inspect IBM i joblog messages.',
    example: 'node cli/zeus.js joblog --profile default --severity ERROR --max-messages 100',
  }),
  'field-search': Object.freeze({
    safety: 'S0/S2',
    scope: 'Local + IBM i read',
    purpose: 'Find field/table usage in local sources and or remote members.',
    example: 'node cli/zeus.js field-search --profile default --field FIELD_ALPHA --table APP_TABLE --source ./rpg_sources --mode all',
  }),
  'search-source': Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Search the local source tree by term, member, or table.',
    example: 'node cli/zeus.js search-source --source-root ./rpg_sources --search-term "CHAIN(" --max-results 50',
  }),
  'copy-to-workspace': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Copy fetched source members into the active workspace.',
    example: 'node cli/zeus.js copy-to-workspace --profile default --members ORDERPGM,INVOICEPGM',
  }),
  diff: Object.freeze({
    safety: 'S2',
    scope: 'IBM i read + local',
    purpose: 'Compare local source members with IBM i members.',
    example: 'node cli/zeus.js diff --profile default --member ORDERPGM',
  }),
  serve: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Start the optional local artifact viewer and experimental UI shell.',
    example: 'node cli/zeus.js serve --source-output-root ./output --host 127.0.0.1 --port 4782',
  }),
  qa: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Render QA validations/checks to jira, markdown, or json.',
    example: 'node cli/zeus.js qa --input ./output/ORDERPGM --format markdown --strict STRICT',
  }),
  'validate-rpg-sql': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Validate embedded SQL in RPG sources for cursor/fetch mismatches, dynamic SQL patterns and host variable issues. Uses scanner + sqlRpgValidator.',
    example: 'node cli/zeus.js validate-rpg-sql --source ./rpg_sources --program ORDERPGM --format markdown --out ./output',
  }),
  onboarding: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Interactive zeus-onboarding-wizard. Guides through profile setup, doctor checks, source/object discovery, first fetch and analyze for a new IBM i system.',
    example: 'node cli/zeus.js onboarding',
  }),
  wizard: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Alias for the zeus-onboarding-wizard.',
    example: 'node cli/zeus.js wizard',
  }),
  'inspect-object': Object.freeze({
    safety: 'S2',
    scope: 'IBM i read',
    purpose: 'Read object metadata and journaling details.',
    example: 'node cli/zeus.js inspect-object --profile default --lib APPLIB --name APP_TABLE_00 --type *FILE --journal',
  }),
  'test-run': Object.freeze({
    safety: 'S2/S1',
    scope: 'DB2 read + local',
    purpose: 'Capture before and after test snapshots plus rollback SQL text.',
    example: 'node cli/zeus.js test-run start --profile default --program ORDERPGM --table APPLIB.APP_TABLE_00 --key ID=1',
  }),
  'write-sql': Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'Execute guarded DML with confirmation, backup, and safety preflight options.',
    example: 'node cli/zeus.js write-sql --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS=\'X\'" --confirm --backup',
  }),
  upsert: Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'DML wrapper for INSERT/UPDATE/DELETE/MERGE with guardrails.',
    example: 'node cli/zeus.js upsert --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS=\'X\' WHERE ID=1"',
  }),
  'upsert-sql': Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'Backward-compatible alias for the upsert flow.',
    example: 'node cli/zeus.js upsert-sql --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"',
  }),
  insert: Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'Strict insert-only DML command.',
    example: 'node cli/zeus.js insert --profile default --sql "INSERT INTO APPDATA.APP_TABLE_00 (ID) VALUES (1)"',
  }),
  update: Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'Strict update-only DML command.',
    example: 'node cli/zeus.js update --profile default --sql "UPDATE APPDATA.APP_TABLE_00 SET STATUS=\'Y\' WHERE ID=1"',
  }),
  delete: Object.freeze({
    safety: 'S3',
    scope: 'DB2 write',
    purpose: 'Strict delete-only DML command with the shared write-safety guardrails.',
    example: 'node cli/zeus.js delete --profile default --sql "DELETE FROM APPDATA.APP_TABLE_00 WHERE STATUS=\'X\'" --confirm --backup',
  }),
  analyses: Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'List, register, inspect, and open locally tracked analysis artifacts.',
    example: 'node cli/zeus.js analyses list --profile default',
  }),
  bridge: Object.freeze({
    safety: 'S4',
    scope: 'Operator-gated',
    purpose: 'Bridge planning/staging/apply/compile/report flow; never implicit.',
    example: 'node cli/zeus.js bridge plan --profile default --help',
  }),
  'pui-edit': Object.freeze({
    safety: 'S1',
    scope: 'Local',
    purpose: 'Apply structured UI edit operations to local display artifacts.',
    example: 'node cli/zeus.js pui-edit --file ./display/DSPFILE.MBR --action plan --changes-file ./changes.json',
  }),
  'docs:generate-catalog': Object.freeze({
    safety: 'S0',
    scope: 'Local read-only',
    purpose: 'Regenerate docs/tool-catalog.md (and optional JSON projection) from the CLI command surface; also callable as `zeus docs generate-catalog`.',
    example: 'node cli/zeus.js docs:generate-catalog',
  }),
  help: Object.freeze({
    safety: 'S0',
    scope: 'Local',
    purpose: 'Structured help for any command or overview of MCP-safe capabilities for AI agents. Returns purpose, safety, examples and agent guidance.',
    example: 'node cli/zeus.js help --command analyze  (or via MCP zeus.help)',
  }),
  mcp: Object.freeze({
    safety: 'S0',
    scope: 'Local read-mostly',
    purpose: 'Start local MCP stdio server for safe read-mostly Zeus tool exposure with allowlist policy gating, guarded write controls, and opaque cursor pagination on supported tools.',
    example: 'node cli/zeus.js mcp serve --verbose --allow-tools zeus.health,zeus.version,zeus.profiles,zeus.doctor,zeus.help,zeus.onboarding,zeus.analyze,zeus.workflow,zeus.bundle,zeus.search-source,zeus.field-search,zeus.resolve-object,zeus.inspect-object,zeus.query-table,zeus.query-sql,zeus.impact,zeus.assess-risk,zeus.generate-test,zeus.generate-checklist,zeus.qa,zeus.validate-rpg-sql,zeus.analyses,zeus.fetch-member,zeus.diff,zeus.copy-to-workspace,zeus.joblog,zeus.docs-generate-catalog,zeus.serve,zeus.test-run',
  }),
});

const COMMAND_ORDER = Object.freeze([
  'doctor',
  'profiles',
  'help',
  'fetch',
  'fetch-member',
  'analyze',
  'workflow',
  'workflow run',
  'bundle',
  'impact',
  'assess-risk',
  'generate-test',
  'generate-checklist',
  'query-table',
  'resolve-object',
  'query-sql',
  'joblog',
  'field-search',
  'search-source',
  'copy-to-workspace',
  'diff',
  'serve',
  'qa',
  'inspect-object',
  'test-run',
  'write-sql',
  'upsert',
  'upsert-sql',
  'insert',
  'update',
  'delete',
  'analyses',
  'bridge',
  'pui-edit',
  'docs:generate-catalog',
  'mcp',
]);

const SAFETY_LEVELS = Object.freeze([
  Object.freeze({ level: 'S0', meaning: 'Local read-only', typicalAction: 'Read local files, inspect generated artifacts.' }),
  Object.freeze({ level: 'S1', meaning: 'Local write', typicalAction: 'Create or update local artifacts in the workspace only.' }),
  Object.freeze({ level: 'S2', meaning: 'Remote read-only', typicalAction: 'Read from IBM i/DB2 without mutations.' }),
  Object.freeze({ level: 'S3', meaning: 'Controlled write', typicalAction: 'Data mutation with explicit user approval only.' }),
  Object.freeze({ level: 'S4', meaning: 'High-risk / operator-gated', typicalAction: 'Bridge/apply/compile style operations; never implicit.' }),
]);

const MANDATORY_AI_RULES = Object.freeze([
  'Default to read-only behavior (`S0`/`S2`).',
  'Require explicit user approval before any `S3` or `S4` action.',
  'Never execute destructive or production-impacting actions implicitly.',
  'Prefer local preparation plus explicit diff/report output.',
  'Always report exact command lines before execution when risk is non-trivial.',
]);

const RECOMMENDED_AI_SEQUENCE = Object.freeze([
  '`doctor` (environment contract)',
  '`fetch` (only if source refresh is needed and approved)',
  '`analyze` or `workflow --preset ...`',
  '`query-table`/`query-sql`/`joblog`/`field-search`/`search-source`/`inspect-object` for evidence deepening',
  '`impact`/`assess-risk`/`generate-test`/`generate-checklist`/`qa` for planning and validation',
  'generated artifacts and `bundle` for review/sharing; optional `serve` for local viewing',
  '`upsert`/`upsert-sql`/`insert`/`update` only after explicit user approval',
  '`bridge` only in operator-gated, explicitly approved flows',
]);

module.exports = {
  COMMAND_METADATA,
  COMMAND_ORDER,
  SAFETY_LEVELS,
  MANDATORY_AI_RULES,
  RECOMMENDED_AI_SEQUENCE,
};
