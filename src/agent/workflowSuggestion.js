'use strict';

const { buildWorkflowSuggestion } = require('../mcp/workflowSuggest');

function renderArgument(value, placeholder) {
  const text = String(value || '').trim();
  if (!text) return `<${placeholder}>`;
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function cliCommandForTool(tool, options = {}) {
  const profile = renderArgument(options.profile, 'profile');
  const program = renderArgument(options.program, 'program');
  const source = renderArgument(options.source, 'source-root');
  const out = renderArgument(options.out, 'output-root');
  const goal = options.goal ? JSON.stringify(String(options.goal)) : '"<goal>"';

  if (tool === 'zeus.agent.bootstrap') return 'node cli/zeus.js agent bootstrap --json';
  if (tool === 'zeus.help') return 'node cli/zeus.js tools list --json';
  if (tool === 'zeus.doctor') {
    return `node cli/zeus.js doctor --profile ${profile} --show-resolved`;
  }
  if (tool === 'zeus.resources') {
    return `node cli/zeus.js resources --profile ${profile} --json`;
  }
  if (tool === 'zeus.analyze') {
    return `node cli/zeus.js analyze --source ${source} --program ${program} --out ${out} --optimize-context --json`;
  }
  if (tool === 'zeus.workflow') {
    const preset = renderArgument(options.preset, 'preset');
    return `node cli/zeus.js workflow --preset ${preset} --source ${source} --program ${program} --out ${out} --json`;
  }
  if (tool === 'zeus.bundle') {
    return `node cli/zeus.js bundle --program ${program} --source-output-root ${out} --include-md --include-json --safe-sharing`;
  }
  if (tool === 'zeus.impact') {
    return `node cli/zeus.js impact --target <target> --program ${program} --source ${source} --out ${out} --json`;
  }
  if (tool === 'zeus.assess-risk') {
    return `node cli/zeus.js assess-risk --program ${program} --out ${out} --json`;
  }
  if (tool === 'zeus.generate-test') {
    return `node cli/zeus.js generate-test --program ${program} --format markdown --out ${out}`;
  }
  if (tool === 'zeus.generate-checklist') {
    return `node cli/zeus.js generate-checklist --program ${program} --out ${out}`;
  }
  if (tool === 'zeus.qa') {
    return `node cli/zeus.js qa --input ${out}/${program} --format markdown`;
  }
  if (tool === 'zeus.search-source') {
    return `node cli/zeus.js search-source --source-root ${source} --search-term "<term>" --max-results 50`;
  }
  if (tool === 'zeus.field-search') {
    return `node cli/zeus.js field-search --profile ${profile} --field <field> --source ${source} --mode all --json`;
  }
  if (tool === 'zeus.project-knowledge.discover') {
    return 'node cli/zeus.js project-knowledge discover --json';
  }
  if (tool === 'zeus.project-knowledge.status') {
    return 'node cli/zeus.js project-knowledge status --json';
  }
  if (tool === 'zeus.project-knowledge.query') {
    return 'node cli/zeus.js project-knowledge query --json';
  }
  if (tool.startsWith('zeus.project-knowledge.')) {
    const operation = tool.slice('zeus.project-knowledge.'.length);
    return `node cli/zeus.js project-knowledge ${operation} --json`;
  }
  if (tool.startsWith('zeus.investigation.')) {
    return `node cli/zeus.js investigate --program ${program} --goal ${goal}`;
  }

  const command = tool.startsWith('zeus.') ? tool.slice('zeus.'.length) : tool;
  return `node cli/zeus.js ${command} --json`;
}

function buildCliWorkflowSuggestion(options = {}) {
  const base = buildWorkflowSuggestion(options);
  const hasProfile = Boolean(String(options.profile || '').trim());
  const skippedTools = hasProfile ? new Set() : new Set(['zeus.doctor', 'zeus.resources']);
  const presetByPlan = {
    architecture: 'architecture-review',
    security: 'security-review',
    'test-generation': 'test-generation-review',
  };
  const plannedSteps = base.steps.filter(step => !skippedTools.has(step.tool));
  const steps = plannedSteps.map((step, index) => ({
    ...step,
    order: index + 1,
    command: cliCommandForTool(step.tool, {
      ...options,
      preset: presetByPlan[base.plan] || `${base.plan}`,
    }),
  }));
  const plannedTools = new Set(steps.map(step => step.tool));
  const checkpoints = base.checkpoints
    .filter(checkpoint => plannedTools.has(checkpoint.tool))
    .map(checkpoint => ({
      ...checkpoint,
      afterStep: steps.find(step => step.tool === checkpoint.tool).order,
    }));
  const baseNotes = base.notes.filter(note => !note.startsWith('Use tools/list or zeus.help'));

  return {
    ...base,
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    steps,
    checkpoints,
    notes: [
      'This is a CLI command suggestion only; no command was executed.',
      'Use tools list/describe to verify the installed command surface before execution.',
      'Replace angle-bracket placeholders with evidence-backed values.',
      ...(hasProfile
        ? []
        : [
            'No profile supplied; profile-dependent remote steps were omitted from this local suggestion.',
          ]),
      ...baseNotes,
    ],
    next: cliCommandForTool(steps[0] && steps[0].tool, options),
  };
}

module.exports = {
  buildCliWorkflowSuggestion,
  cliCommandForTool,
};
