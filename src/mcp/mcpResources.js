'use strict';

const fs = require('fs');
const path = require('path');
const { COMMAND_METADATA, COMMAND_ORDER } = require('../docs/toolCatalogMetadata');
const { listMcpTools } = require('./mcpTools');
const { DEFAULT_MCP_SAFE_TOOL_NAMES } = require('./mcpPolicy');
const { listWorkflowPresets } = require('../workflow/workflowPresetRegistry');
const { listPromptContracts } = require('../prompt/promptRegistry');
const { listAnalysisRuns, readAnalysisRun, readArtifactContent } = require('../ui/localUiDataApi');

const RESOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    uri: 'zeus://docs/tool-catalog.md',
    name: 'Tool Catalog (Markdown)',
    description: 'Authoritative CLI safety and command catalog.',
    mimeType: 'text/markdown',
    filePath: 'docs/tool-catalog.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/tool-catalog.json',
    name: 'Tool Catalog (JSON)',
    description: 'Generated machine-readable CLI safety and command catalog.',
    mimeType: 'application/json',
    filePath: 'docs/tool-catalog.json',
  }),
  Object.freeze({
    uri: 'zeus://docs/cli/reference.md',
    name: 'CLI Reference Alias',
    description: 'Stable CLI/MCP-first entrypoint documentation.',
    mimeType: 'text/markdown',
    filePath: 'docs/cli/reference.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/ai/session-prompt.md',
    name: 'AI Session Prompt',
    description: 'Standard CLI/MCP-first session bootstrap prompt.',
    mimeType: 'text/markdown',
    filePath: 'docs/ai/session-prompt.md',
  }),
  Object.freeze({
    uri: 'zeus://docs/mcp/operator-guide.md',
    name: 'MCP Operator Guide',
    description: 'Current MCP posture, allowlist policy, and troubleshooting guide.',
    mimeType: 'text/markdown',
    filePath: 'docs/mcp/operator-guide.md',
  }),
  Object.freeze({
    uri: 'zeus://metadata/command-catalog.json',
    name: 'Command Catalog Metadata',
    description: 'Structured CLI command metadata with safety levels and examples.',
    mimeType: 'application/json',
    generator: buildCommandCatalogResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/mcp-tools.json',
    name: 'MCP Tool Inventory',
    description: 'Structured inventory of currently registered MCP tools and default allowlist posture.',
    mimeType: 'application/json',
    generator: buildMcpToolInventoryResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/workflow-presets.json',
    name: 'Workflow Presets',
    description: 'Structured workflow preset metadata for review and automation.',
    mimeType: 'application/json',
    generator: buildWorkflowPresetResource,
  }),
  Object.freeze({
    uri: 'zeus://metadata/prompt-contracts.json',
    name: 'Prompt Contracts',
    description: 'Structured prompt template contracts and budget metadata.',
    mimeType: 'application/json',
    generator: buildPromptContractsResource,
  }),
]);

function listMcpResources(cwd = process.cwd()) {
  const staticResources = RESOURCE_DEFINITIONS.map((entry) => ({
    uri: entry.uri,
    name: entry.name,
    description: entry.description,
    mimeType: entry.mimeType,
  }));
  const dynamicResources = listRunResources(cwd);
  return [...staticResources, ...dynamicResources];
}

function readMcpResource(uri, context = {}) {
  const normalizedUri = typeof uri === 'string' ? uri.trim() : '';
  if (!normalizedUri) {
    const error = new Error('Invalid params: resources/read requires params.uri');
    error.code = 'RESOURCE_INVALID_ARGUMENTS';
    throw error;
  }

  const definition = RESOURCE_DEFINITIONS.find((entry) => entry.uri === normalizedUri);
  if (definition) {
    const text = typeof definition.generator === 'function'
      ? `${JSON.stringify(definition.generator(context), null, 2)}\n`
      : readRepoFile(definition.filePath, context.cwd || process.cwd());

    return {
      contents: [
        {
          uri: definition.uri,
          mimeType: definition.mimeType,
          text,
        },
      ],
    };
  }

  return readDynamicRunResource(normalizedUri, context.cwd || process.cwd());
}

function readRepoFile(relativePath, cwd) {
  const filePath = path.resolve(cwd, relativePath);
  return fs.readFileSync(filePath, 'utf8');
}

function buildCommandCatalogResource() {
  return {
    commands: COMMAND_ORDER.map((name) => ({
      command: name,
      ...COMMAND_METADATA[name],
    })),
  };
}

function buildMcpToolInventoryResource() {
  return {
    defaultAllowlist: [...DEFAULT_MCP_SAFE_TOOL_NAMES],
    tools: listMcpTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      defaultAllowlisted: DEFAULT_MCP_SAFE_TOOL_NAMES.includes(tool.name),
      inputSchema: tool.inputSchema,
    })),
  };
}

function buildWorkflowPresetResource() {
  return {
    presets: listWorkflowPresets().map((preset) => ({
      name: preset.name,
      title: preset.title,
      description: preset.description,
      analyzeMode: preset.analyzeMode,
      bundleArtifacts: [...preset.bundleArtifacts],
      reviewWorkflow: preset.reviewWorkflow,
    })),
  };
}

function buildPromptContractsResource() {
  return {
    promptContracts: listPromptContracts().map((contract) => ({
      name: contract.name,
      version: contract.version,
      workflow: contract.workflow,
      outputFileName: contract.outputFileName,
      requiredInputs: contract.requiredInputs,
      preferredOutputShape: contract.preferredOutputShape,
      budget: contract.budget,
    })),
  };
}

function resolveOutputRoot(cwd) {
  return path.resolve(cwd, 'output');
}

function listRunResources(cwd) {
  const outputRoot = resolveOutputRoot(cwd);
  const runs = listAnalysisRuns(outputRoot);
  const resources = [];

  for (const run of runs) {
    const program = String(run.program || '').trim();
    if (!program) {
      continue;
    }

    resources.push({
      uri: buildRunSummaryUri(program),
      name: `Run Summary: ${program}`,
      description: `Structured summary metadata for analysis run ${program}.`,
      mimeType: 'application/json',
    });
    resources.push({
      uri: buildRunViewsUri(program),
      name: `Run Views: ${program}`,
      description: `Structured interactive views metadata for analysis run ${program}.`,
      mimeType: 'application/json',
    });

    const runDetail = readAnalysisRun(outputRoot, program);
    for (const artifact of Array.isArray(runDetail.artifacts) ? runDetail.artifacts : []) {
      resources.push({
        uri: buildRunArtifactUri(program, artifact.path),
        name: `Run Artifact: ${program}/${artifact.path}`,
        description: `Generated artifact ${artifact.path} for analysis run ${program}.`,
        mimeType: inferArtifactMimeType(artifact.kind),
      });
    }
  }

  return resources;
}

function buildRunSummaryUri(program) {
  return `zeus://runs/${encodeURIComponent(program)}/summary.json`;
}

function buildRunViewsUri(program) {
  return `zeus://runs/${encodeURIComponent(program)}/views.json`;
}

function buildRunArtifactUri(program, artifactPath) {
  const encodedArtifactPath = String(artifactPath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `zeus://runs/${encodeURIComponent(program)}/artifacts/${encodedArtifactPath}`;
}

function inferArtifactMimeType(kind) {
  if (kind === 'json') return 'application/json';
  if (kind === 'markdown') return 'text/markdown';
  if (kind === 'html') return 'text/html';
  return 'text/plain';
}

function parseDynamicRunUri(uri) {
  const summaryMatch = uri.match(/^zeus:\/\/runs\/([^/]+)\/summary\.json$/);
  if (summaryMatch) {
    return {
      kind: 'summary',
      program: decodeURIComponent(summaryMatch[1]),
    };
  }

  const viewsMatch = uri.match(/^zeus:\/\/runs\/([^/]+)\/views\.json$/);
  if (viewsMatch) {
    return {
      kind: 'views',
      program: decodeURIComponent(viewsMatch[1]),
    };
  }

  const artifactMatch = uri.match(/^zeus:\/\/runs\/([^/]+)\/artifacts\/(.+)$/);
  if (artifactMatch) {
    return {
      kind: 'artifact',
      program: decodeURIComponent(artifactMatch[1]),
      artifactPath: artifactMatch[2]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/'),
    };
  }

  return null;
}

function readDynamicRunResource(uri, cwd) {
  const parsed = parseDynamicRunUri(uri);
  if (!parsed) {
    const error = new Error(`Invalid params: unknown resource uri: ${uri}`);
    error.code = 'RESOURCE_INVALID_ARGUMENTS';
    throw error;
  }

  const outputRoot = resolveOutputRoot(cwd);
  if (parsed.kind === 'summary') {
    const runDetail = readAnalysisRun(outputRoot, parsed.program);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: `${JSON.stringify(runDetail.summary, null, 2)}\n`,
        },
      ],
    };
  }

  if (parsed.kind === 'views') {
    const runDetail = readAnalysisRun(outputRoot, parsed.program);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: `${JSON.stringify(runDetail.views, null, 2)}\n`,
        },
      ],
    };
  }

  if (parsed.kind === 'artifact') {
    const artifact = readArtifactContent(outputRoot, parsed.program, parsed.artifactPath);
    return {
      contents: [
        {
          uri,
          mimeType: artifact.contentType.split(';')[0],
          text: artifact.content,
        },
      ],
    };
  }

  const error = new Error(`Invalid params: unknown resource uri: ${uri}`);
  error.code = 'RESOURCE_INVALID_ARGUMENTS';
  throw error;
}

module.exports = {
  listMcpResources,
  readMcpResource,
};
