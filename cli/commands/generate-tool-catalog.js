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

const fs = require('fs');
const path = require('path');
const {
  listWorkflowPresets,
  resolveWorkflowPresetSettings,
} = require('../../src/workflow/workflowPresetRegistry');
const {
  COMMAND_METADATA,
  COMMAND_ORDER,
  SAFETY_LEVELS,
  MANDATORY_AI_RULES,
  RECOMMENDED_AI_SEQUENCE,
} = require('../../src/docs/toolCatalogMetadata');

const DEFAULT_MARKDOWN_OUTPUT = 'docs/tool-catalog.md';
const DEFAULT_JSON_OUTPUT = 'docs/tool-catalog.json';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDateOnly(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function readFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function listCommandSourceFiles(repoRoot) {
  const files = [];
  const cliEntry = path.resolve(repoRoot, 'cli', 'zeus.js');
  files.push(cliEntry);

  const commandsDir = path.resolve(repoRoot, 'cli', 'commands');
  if (!fs.existsSync(commandsDir)) {
    return files;
  }

  const queue = [commandsDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  return [...new Set(files)];
}

function extractCliCommands(cliSource) {
  const commands = new Set();
  const re = /if \(command === '([^']+)'\)/g;
  for (const match of cliSource.matchAll(re)) {
    commands.add(String(match[1]).trim());
  }
  return commands;
}

function extractUsageLines(cliSource) {
  const usageLines = [];
  const re = /console\.log\((['"`]) {2}zeus ([\s\S]*?)\1\);/g;
  for (const match of cliSource.matchAll(re)) {
    usageLines.push(String(match[2]).trim());
  }
  return usageLines;
}

function normalizeCommandFromUsage(usageLine) {
  const cleaned = String(usageLine || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return null;
  }

  const tokens = cleaned.split(' ');
  const command = tokens[0] || '';
  const subcommand = tokens[1] || '';

  if (command === 'workflow' && subcommand === 'run') {
    return 'workflow run';
  }

  if (command === 'docs' && subcommand === 'generate-catalog') {
    return 'docs:generate-catalog';
  }

  return command;
}

function extractOptionsFromUsage(usageLine) {
  return [...new Set(String(usageLine).match(/--[a-z0-9-]+/g) || [])];
}

function escapePipe(value) {
  return String(value).replace(/\|/g, '\\|');
}

function collectCommandSurface(repoRoot) {
  const sources = [];
  for (const filePath of listCommandSourceFiles(repoRoot)) {
    const source = readFileIfExists(filePath);
    if (typeof source !== 'string') {
      continue;
    }
    sources.push({
      filePath,
      relativePath: path.relative(repoRoot, filePath),
      source,
    });
  }
  return sources;
}

function buildCatalogModel({ repoRoot }) {
  const commandSources = collectCommandSurface(repoRoot);
  const routedCommands = new Set();
  const usageLines = [];

  for (const sourceFile of commandSources) {
    const relativePath = sourceFile.relativePath.split(path.sep).join('/');
    if (relativePath === 'cli/zeus.js') {
      for (const command of extractCliCommands(sourceFile.source)) {
        routedCommands.add(command);
      }
    }
    usageLines.push(...extractUsageLines(sourceFile.source));
  }

  const usageByCommand = new Map();
  for (const usageLine of usageLines) {
    const command = normalizeCommandFromUsage(usageLine);
    if (!command) {
      continue;
    }
    if (!usageByCommand.has(command)) {
      usageByCommand.set(command, []);
    }
    usageByCommand.get(command).push(usageLine);
  }

  const commandsInCode = new Set();
  for (const command of routedCommands) {
    if (command === 'docs') {
      commandsInCode.add('docs:generate-catalog');
      continue;
    }
    commandsInCode.add(command);
  }

  const ordered = [];
  for (const command of COMMAND_ORDER) {
    if (command === 'workflow run') {
      if (commandsInCode.has('workflow') || usageByCommand.has('workflow run')) {
        ordered.push(command);
      }
      continue;
    }

    if (commandsInCode.has(command) || usageByCommand.has(command)) {
      ordered.push(command);
    }
  }

  const extras = [...commandsInCode]
    .filter(command => !ordered.includes(command))
    .sort((a, b) => a.localeCompare(b));
  ordered.push(...extras);

  const commandRows = ordered.map(command => {
    let metadata = COMMAND_METADATA[command] || {
      safety: 'S0',
      scope: 'Local',
      purpose: 'Command metadata missing; update src/docs/toolCatalogMetadata.js.',
      example: `node cli/zeus.js ${command}`,
    };

    // Package 06: prefer capability registry as source of truth for foundation commands
    try {
      const { capabilities } = require('../src/api/zeusApi');
      const capIdMap = {
        doctor: 'configure.doctor',
        profiles: 'configure.profiles',
        resources: 'configure.resources',
        'discover-environment': 'configure.discover-environment',
        analyze: 'analysis.analyze',
        workflow: 'analysis.workflow',
        bundle: 'bundle.create',
      };
      const capId = capIdMap[command];
      if (capId) {
        const cap = capabilities && capabilities.resolve ? capabilities.resolve(capId) : null;
        console.error('DEBUG cap for', command, 'capId', capId, 'found?', !!cap);
        if (cap) {
          metadata = {
            safety: cap.safety && cap.safety.level ? cap.safety.level : metadata.safety,
            scope: 'Local',
            purpose: cap.description || cap.title || metadata.purpose,
            example: (cap.docs && cap.docs.examples && cap.docs.examples[0]) || metadata.example,
          };
        }
      }
    } catch (e) {
      // fall back to static metadata
    }

    const usage = usageByCommand.get(command) || [];
    const options = [...new Set(usage.flatMap(extractOptionsFromUsage))];

    return {
      command,
      safety: metadata.safety,
      scope: metadata.scope,
      purpose: metadata.purpose,
      example: metadata.example,
      usage,
      options,
      source: {
        routeDetected: commandsInCode.has(command),
        usageDetected: usage.length > 0,
      },
    };
  });

  const workflowPresets = listWorkflowPresets()
    .map(preset => {
      const settings = resolveWorkflowPresetSettings(preset.name);
      return {
        name: preset.name,
        analyzeMode: settings.analyzeMode,
        goal: preset.description,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    commandRows,
    workflowPresets,
    safetyLevels: SAFETY_LEVELS,
    rules: MANDATORY_AI_RULES,
    sequence: RECOMMENDED_AI_SEQUENCE,
    repoRoot,
    cliFile: 'cli/zeus.js',
  };
}

function renderMarkdown(model, now = new Date()) {
  const generatedTs = formatTimestamp(now);
  const generatedDate = formatDateOnly(now);

  const lines = [];
  lines.push('<!-- ');
  lines.push('AUTO-GENERATED FILE – do not edit manually!');
  lines.push('Regenerate with: zeus docs:generate-catalog');
  lines.push(`Last generated: ${generatedTs}`);
  lines.push('-->');
  lines.push('');
  lines.push('---');
  lines.push('Title: Zeus RPG PromptKit Tool Catalog');
  lines.push(
    'Description: Verbindlicher, sicherheitsklassifizierter Katalog aller CLI-Befehle und Workflow-Presets fuer Menschen und KI-Assistenten.'
  );
  lines.push(`Last Updated: ${generatedDate}`);
  lines.push('---');
  lines.push('');
  lines.push('# Zeus RPG PromptKit Tool Catalog');
  lines.push('');
  lines.push('This document is the authoritative tool reference for Zeus RPG PromptKit.');
  lines.push(
    'All AI assistants (GPT, Claude, Grok, Copilot, local agents) should treat this file as the single source of truth for command purpose, risk level, and usage.'
  );
  lines.push('');
  lines.push('Related:');
  lines.push('- [`index.md`](index.md)');
  lines.push('- [`ai/session-prompt.md`](ai/session-prompt.md)');
  lines.push('- [`cli/reference.md`](cli/reference.md)');
  lines.push('');
  lines.push('## Safety Levels');
  lines.push('');
  lines.push('| Level | Meaning | Typical Action |');
  lines.push('|---|---|---|');
  for (const level of model.safetyLevels) {
    lines.push(
      `| \`${level.level}\` | ${escapePipe(level.meaning)} | ${escapePipe(level.typicalAction)} |`
    );
  }
  lines.push('');
  lines.push('## AI Execution Rules (Mandatory)');
  lines.push('');
  model.rules.forEach((rule, index) => {
    lines.push(`${index + 1}. ${rule}`);
  });
  lines.push('');
  lines.push('## CLI Command Catalog');
  lines.push('');
  lines.push('| Command | Safety | Scope | Purpose | Example |');
  lines.push('|---|---|---|---|---|');
  for (const row of model.commandRows) {
    lines.push(
      `| \`${escapePipe(row.command)}\` | \`${escapePipe(row.safety)}\` | ${escapePipe(row.scope)} | ${escapePipe(row.purpose)} | \`${escapePipe(row.example)}\` |`
    );
  }
  lines.push('');
  lines.push('## Workflow Presets');
  lines.push('');
  lines.push('| Preset | Analyze Mode | Goal |');
  lines.push('|---|---|---|');
  for (const preset of model.workflowPresets) {
    lines.push(
      `| \`${escapePipe(preset.name)}\` | \`${escapePipe(preset.analyzeMode)}\` | ${escapePipe(preset.goal)} |`
    );
  }
  lines.push('');
  lines.push('## Recommended AI Operating Sequence');
  lines.push('');
  model.sequence.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });
  lines.push('');
  lines.push('## How To Keep This File Up To Date');
  lines.push('');
  lines.push('- Regenerate with `zeus docs:generate-catalog` after CLI command-surface changes.');
  lines.push('- Command metadata lives in `src/docs/toolCatalogMetadata.js`.');
  lines.push(
    '- Historical proposal is no longer needed; generation logic lives in `cli/commands/generate-tool-catalog.js`.'
  );
  lines.push('');

  return `${lines.join('\n')}`;
}

function writeFileEnsuringDir(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
}

function generateToolCatalog({
  repoRoot = process.cwd(),
  markdownOutputPath = DEFAULT_MARKDOWN_OUTPUT,
  jsonOutputPath = DEFAULT_JSON_OUTPUT,
} = {}) {
  const model = buildCatalogModel({ repoRoot });
  const markdown = renderMarkdown(model);

  const markdownTarget = path.isAbsolute(markdownOutputPath)
    ? markdownOutputPath
    : path.resolve(repoRoot, markdownOutputPath);
  writeFileEnsuringDir(markdownTarget, markdown);

  let jsonTarget = null;
  if (jsonOutputPath) {
    jsonTarget = path.isAbsolute(jsonOutputPath)
      ? jsonOutputPath
      : path.resolve(repoRoot, jsonOutputPath);
    // Sanitize absolute repoRoot for committed/public catalog output
    const jsonModel = { ...model, repoRoot: model.repoRoot ? path.basename(model.repoRoot) : null };
    writeFileEnsuringDir(jsonTarget, `${JSON.stringify(jsonModel, null, 2)}\n`);
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

    console.log(`Tool catalog markdown written to: ${result.markdownPath}`);
    if (result.jsonPath) {
      console.log(`Tool catalog json written to: ${result.jsonPath}`);
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
  generateToolCatalog,
  renderMarkdown,
  runDocsGenerateCatalog,
};
