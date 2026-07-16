/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

const fs = require('fs');
const path = require('path');
const {
  listWorkflowPresets,
  resolveWorkflowPresetSettings,
} = require('../../src/workflow/workflowPresetRegistry');
const {
  COMMAND_METADATA,
  COMMAND_CATALOG_CONTRACTS,
  COMMAND_ORDER,
  SAFETY_LEVELS,
  MANDATORY_AI_RULES,
  RECOMMENDED_AI_SEQUENCE,
} = require('../../src/docs/toolCatalogMetadata');

const DEFAULT_MARKDOWN_OUTPUT = 'docs/tool-catalog.md';
const DEFAULT_JSON_OUTPUT = 'docs/tool-catalog.json';
const CATALOG_SCHEMA_VERSION = 1;
const STATUS_VALUES = new Set(['stable', 'experimental', 'deprecated']);
const NON_PUBLIC_CONTROL_ROUTES = new Set(['-h']);

function readRequiredText(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} is required: ${path.basename(filePath)} (${error.code || 'read error'})`
    );
  }
}

function readPackageIdentity(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(readRequiredText(packagePath, 'Package identity'));
  } catch (error) {
    throw new Error(`Invalid package identity: ${error.message}`);
  }
  if (!packageJson || typeof packageJson.name !== 'string' || !packageJson.name.trim()) {
    throw new Error('Package identity requires a non-empty name.');
  }
  if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
    throw new Error('Package identity requires a non-empty version.');
  }
  return Object.freeze({ name: packageJson.name.trim(), version: packageJson.version.trim() });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveGeneratedAt(repoRoot, env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'SOURCE_DATE_EPOCH')) {
    const raw = env.SOURCE_DATE_EPOCH;
    if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) {
      throw new Error('SOURCE_DATE_EPOCH must be an unsigned integer number of UTC seconds.');
    }
    const milliseconds = Number(raw) * 1000;
    if (!Number.isSafeInteger(milliseconds)) {
      throw new Error('SOURCE_DATE_EPOCH is outside the supported date range.');
    }
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      throw new Error('SOURCE_DATE_EPOCH is outside the supported date range.');
    }
    return date.toISOString();
  }

  const packageIdentity = readPackageIdentity(repoRoot);
  const changelog = readRequiredText(path.join(repoRoot, 'CHANGELOG.md'), 'Release changelog');
  const releasePattern = new RegExp(
    `^## \\[${escapeRegExp(packageIdentity.version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
    'gm'
  );
  const matches = [...changelog.matchAll(releasePattern)];
  if (matches.length !== 1) {
    throw new Error(
      `CHANGELOG.md must contain exactly one release date for package version ${packageIdentity.version}.`
    );
  }
  const generatedAt = `${matches[0][1]}T00:00:00.000Z`;
  const parsedDate = new Date(generatedAt);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== matches[0][1]
  ) {
    throw new Error(
      `CHANGELOG.md contains an invalid release date for ${packageIdentity.version}.`
    );
  }
  return generatedAt;
}

function formatOutputLabel(repoRoot, targetPath) {
  const relativePath = path.relative(repoRoot, targetPath);
  if (
    relativePath &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  ) {
    return relativePath.split(path.sep).join('/');
  }
  return '<external-output>';
}

function extractCliRoutes(cliSource) {
  const routes = new Set();
  for (const match of cliSource.matchAll(/\bcommand\s*===\s*'([^']+)'/g)) {
    routes.add(match[1]);
  }

  const arrayDeclarations = new Map();
  for (const match of cliSource.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\];/g)) {
    arrayDeclarations.set(match[1], match[2]);
  }
  for (const [identifier, contents] of arrayDeclarations) {
    const includePattern = new RegExp(`\\b${escapeRegExp(identifier)}\\.includes\\(command\\)`);
    if (!includePattern.test(cliSource)) continue;
    for (const literal of contents.matchAll(/'([^']+)'/g)) routes.add(literal[1]);
  }
  return routes;
}

function routeName(value) {
  return String(value).trim().split(/\s+/)[0];
}

function validateCatalogMetadata({
  metadata = COMMAND_METADATA,
  contracts = COMMAND_CATALOG_CONTRACTS,
  order = COMMAND_ORDER,
  cliSource,
} = {}) {
  const errors = [];
  const metadataIds = Object.keys(metadata);
  const contractIds = Object.keys(contracts);
  const orderedIds = [...order];
  const knownSafety = new Set(SAFETY_LEVELS.map(entry => entry.level));
  const seenIds = new Set();
  const publicNames = new Map();

  for (const id of orderedIds) {
    if (seenIds.has(id)) errors.push(`duplicate command order entry: ${id}`);
    seenIds.add(id);
    const commandMetadata = metadata[id];
    const contract = contracts[id];
    if (!commandMetadata) errors.push(`missing command metadata: ${id}`);
    if (!contract) errors.push(`missing command catalog contract: ${id}`);
    if (!commandMetadata || !contract) continue;

    for (const field of ['safety', 'scope', 'purpose', 'example']) {
      if (typeof commandMetadata[field] !== 'string' || !commandMetadata[field].trim()) {
        errors.push(`${id}.${field} must be a non-empty string`);
      }
    }
    if (!knownSafety.has(commandMetadata.safety)) {
      errors.push(`${id}.safety is not a declared safety level: ${commandMetadata.safety}`);
    }
    if (!Array.isArray(contract.aliases)) errors.push(`${id}.aliases must be an array`);
    if (!STATUS_VALUES.has(contract.status))
      errors.push(`${id}.status is invalid: ${contract.status}`);
    if (!contract.availability || typeof contract.availability !== 'object') {
      errors.push(`${id}.availability must be an object`);
    } else {
      for (const surface of ['cli', 'api', 'mcp']) {
        if (typeof contract.availability[surface] !== 'boolean') {
          errors.push(`${id}.availability.${surface} must be boolean`);
        }
      }
      if (contract.availability.cli !== true) {
        errors.push(`${id} is not an implemented public CLI command`);
      }
    }
    if (!Array.isArray(contract.sideEffects)) errors.push(`${id}.sideEffects must be an array`);
    if (
      contract.capabilityId !== null &&
      (typeof contract.capabilityId !== 'string' || !contract.capabilityId.trim())
    ) {
      errors.push(`${id}.capabilityId must be null or a non-empty string`);
    }

    for (const publicName of [id, ...(Array.isArray(contract.aliases) ? contract.aliases : [])]) {
      if (typeof publicName !== 'string' || !publicName.trim()) {
        errors.push(`${id} contains an empty public command name`);
        continue;
      }
      const owner = publicNames.get(publicName);
      if (owner) errors.push(`duplicate public command name: ${publicName} (${owner}, ${id})`);
      else publicNames.set(publicName, id);
    }
  }

  for (const id of metadataIds)
    if (!seenIds.has(id)) errors.push(`unordered command metadata: ${id}`);
  for (const id of contractIds)
    if (!seenIds.has(id)) errors.push(`unordered command contract: ${id}`);

  if (typeof cliSource === 'string') {
    const detectedRoutes = extractCliRoutes(cliSource);
    const declaredRoutes = new Set();
    for (const id of orderedIds) {
      const contract = contracts[id];
      if (!contract || !contract.availability || !contract.availability.cli) continue;
      declaredRoutes.add(routeName(id));
      for (const alias of contract.aliases || []) declaredRoutes.add(routeName(alias));
    }
    for (const route of declaredRoutes) {
      if (!detectedRoutes.has(route))
        errors.push(`declared public CLI route is not implemented: ${route}`);
    }
    for (const route of detectedRoutes) {
      if (!declaredRoutes.has(route) && !NON_PUBLIC_CONTROL_ROUTES.has(route)) {
        errors.push(`implemented CLI route has no public catalog contract: ${route}`);
      }
    }
  }

  if (errors.length)
    throw new Error(`Tool catalog metadata validation failed:\n- ${errors.join('\n- ')}`);
  return true;
}

function buildCatalogModel({ repoRoot, env = process.env } = {}) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw new Error('repoRoot is required to build the tool catalog.');
  }
  const cliSource = readRequiredText(path.join(repoRoot, 'cli', 'zeus.js'), 'CLI route source');
  validateCatalogMetadata({ cliSource });
  const packageIdentity = readPackageIdentity(repoRoot);

  const commandRows = COMMAND_ORDER.map(command => {
    const metadata = COMMAND_METADATA[command];
    const contract = COMMAND_CATALOG_CONTRACTS[command];
    return {
      command,
      aliases: [...contract.aliases],
      status: contract.status,
      safety: metadata.safety,
      scope: metadata.scope,
      sideEffects: [...contract.sideEffects],
      availability: { ...contract.availability },
      capabilityId: contract.capabilityId,
      purpose: metadata.purpose,
      example: metadata.example,
    };
  });

  const workflowPresets = listWorkflowPresets()
    .map(preset => {
      const settings = resolveWorkflowPresetSettings(preset.name);
      return { name: preset.name, analyzeMode: settings.analyzeMode, goal: preset.description };
    })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    package: packageIdentity,
    generatedAt: resolveGeneratedAt(repoRoot, env),
    cliFile: 'cli/zeus.js',
    commandRows,
    workflowPresets,
    safetyLevels: SAFETY_LEVELS.map(entry => ({ ...entry })),
    rules: [...MANDATORY_AI_RULES],
    sequence: [...RECOMMENDED_AI_SEQUENCE],
  };
}

function escapePipe(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderMarkdown(model) {
  const generatedDate = model.generatedAt.slice(0, 10);
  const lines = [
    '<!-- ',
    'AUTO-GENERATED FILE – do not edit manually!',
    'Regenerate with: zeus docs:generate-catalog',
    `Last generated: ${model.generatedAt}`,
    '-->',
    '',
    '---',
    'Title: Zeus RPG PromptKit Tool Catalog',
    'Description: Verbindlicher, sicherheitsklassifizierter Katalog aller CLI-Befehle und Workflow-Presets fuer Menschen und KI-Assistenten.',
    `Last Updated: ${generatedDate}`,
    '---',
    '',
    '# Zeus RPG PromptKit Tool Catalog',
    '',
    `Package: \`${model.package.name}@${model.package.version}\``,
    '',
    'This document is the authoritative tool reference for Zeus RPG PromptKit.',
    'All AI assistants (GPT, Claude, Grok, Copilot, local agents) should treat this file as the single source of truth for command purpose, risk level, and usage.',
    '',
    'Related:',
    '- [`index.md`](index.md)',
    '- [`ai/session-prompt.md`](ai/session-prompt.md)',
    '- [`cli/reference.md`](cli/reference.md)',
    '',
    '## Safety Levels',
    '',
    '| Level | Meaning | Typical Action |',
    '|---|---|---|',
  ];
  for (const level of model.safetyLevels) {
    lines.push(
      `| \`${level.level}\` | ${escapePipe(level.meaning)} | ${escapePipe(level.typicalAction)} |`
    );
  }
  lines.push('', '## AI Execution Rules (Mandatory)', '');
  model.rules.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
  lines.push(
    '',
    '## CLI Command Catalog',
    '',
    '| Command | Aliases | Status | Safety | Scope | Side Effects | Availability | Capability | Purpose | Example |',
    '|---|---|---|---|---|---|---|---|---|---|'
  );
  for (const row of model.commandRows) {
    const aliases = row.aliases.length ? row.aliases.map(alias => `\`${alias}\``).join(', ') : '—';
    const sideEffects = row.sideEffects.length ? row.sideEffects.join(', ') : 'none';
    const availability = Object.entries(row.availability)
      .filter(([, available]) => available)
      .map(([surface]) => surface)
      .join(', ');
    lines.push(
      `| \`${escapePipe(row.command)}\` | ${escapePipe(aliases)} | \`${row.status}\` | \`${row.safety}\` | ${escapePipe(row.scope)} | ${escapePipe(sideEffects)} | ${escapePipe(availability)} | ${row.capabilityId ? `\`${row.capabilityId}\`` : '—'} | ${escapePipe(row.purpose)} | \`${escapePipe(row.example)}\` |`
    );
  }
  lines.push('', '## Workflow Presets', '', '| Preset | Analyze Mode | Goal |', '|---|---|---|');
  for (const preset of model.workflowPresets) {
    lines.push(`| \`${preset.name}\` | \`${preset.analyzeMode}\` | ${escapePipe(preset.goal)} |`);
  }
  lines.push('', '## Recommended AI Operating Sequence', '');
  model.sequence.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push(
    '',
    '## How To Keep This File Up To Date',
    '',
    '- Regenerate with `zeus docs:generate-catalog` after CLI command-surface changes.',
    '- Public command contracts live in `src/docs/toolCatalogMetadata.js`.',
    '- The generator validates public CLI routes against those declarative contracts and fails closed on drift.',
    ''
  );
  return lines.join('\n');
}

function renderJson(model) {
  return `${JSON.stringify(model, null, 2)}\n`;
}

function validateRenderedCatalog(model, markdown, json) {
  const parsed = JSON.parse(json);
  if (JSON.stringify(parsed) !== JSON.stringify(model)) {
    throw new Error('Rendered JSON does not preserve the in-memory catalog model.');
  }
  for (const row of model.commandRows) {
    if (!markdown.includes(`| \`${row.command}\` |`)) {
      throw new Error(`Rendered Markdown is missing command: ${row.command}`);
    }
  }
  const forbiddenPatterns = [
    /(?:^|[\s"'=(])\/(?!\/)[^\s"'`<>()]+/m,
    /[A-Za-z]:\\[^\s"'`<>()]+/,
    /"repoRoot"\s*:/,
  ];
  for (const content of [markdown, json]) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content))
        throw new Error(`Catalog output contains forbidden local metadata: ${pattern}`);
    }
  }
  return true;
}

function stageFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  return temporaryPath;
}

function generateToolCatalog({
  repoRoot = process.cwd(),
  markdownOutputPath = DEFAULT_MARKDOWN_OUTPUT,
  jsonOutputPath = DEFAULT_JSON_OUTPUT,
  env = process.env,
} = {}) {
  const model = buildCatalogModel({ repoRoot, env });
  const markdown = renderMarkdown(model);
  const json = renderJson(model);
  validateRenderedCatalog(model, markdown, json);

  const markdownTarget = path.resolve(repoRoot, markdownOutputPath);
  const jsonTarget = jsonOutputPath ? path.resolve(repoRoot, jsonOutputPath) : null;
  if (jsonTarget && markdownTarget === jsonTarget) {
    throw new Error('Markdown and JSON output paths must be different.');
  }

  const staged = [];
  try {
    staged.push({ temporaryPath: stageFile(markdownTarget, markdown), targetPath: markdownTarget });
    if (jsonTarget)
      staged.push({ temporaryPath: stageFile(jsonTarget, json), targetPath: jsonTarget });
    for (const entry of staged) fs.renameSync(entry.temporaryPath, entry.targetPath);
  } catch (error) {
    for (const entry of staged) fs.rmSync(entry.temporaryPath, { force: true });
    throw error;
  }

  return {
    markdownPath: markdownTarget,
    jsonPath: jsonTarget,
    commandCount: model.commandRows.length,
    presetCount: model.workflowPresets.length,
  };
}

async function runDocsGenerateCatalog(args) {
  try {
    const format = args.format ? String(args.format).trim().toLowerCase() : 'markdown';
    if (!['markdown', 'json'].includes(format)) {
      throw new Error('Invalid --format value. Use markdown or json.');
    }
    const outputArg = args.output ? String(args.output).trim() : null;
    const jsonOutputArg = args['json-output'] ? String(args['json-output']).trim() : null;
    const markdownOutputPath =
      format === 'markdown' ? outputArg || DEFAULT_MARKDOWN_OUTPUT : DEFAULT_MARKDOWN_OUTPUT;
    const jsonOutputPath =
      format === 'json'
        ? outputArg || jsonOutputArg || DEFAULT_JSON_OUTPUT
        : jsonOutputArg || DEFAULT_JSON_OUTPUT;
    const result = generateToolCatalog({
      repoRoot: process.cwd(),
      markdownOutputPath,
      jsonOutputPath,
    });
    const repoRoot = process.cwd();
    console.log(
      `Tool catalog markdown written to: ${formatOutputLabel(repoRoot, result.markdownPath)}`
    );
    if (result.jsonPath) {
      console.log(`Tool catalog json written to: ${formatOutputLabel(repoRoot, result.jsonPath)}`);
    }
    console.log(`Commands exported: ${result.commandCount}`);
    console.log(`Workflow presets exported: ${result.presetCount}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  buildCatalogModel,
  extractCliRoutes,
  formatOutputLabel,
  generateToolCatalog,
  renderJson,
  renderMarkdown,
  resolveGeneratedAt,
  runDocsGenerateCatalog,
  validateCatalogMetadata,
  validateRenderedCatalog,
};
