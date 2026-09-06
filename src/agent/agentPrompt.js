'use strict';

const { createAiSessionPromptService } = require('../ui/aiSessionPromptService');
const { buildCliAgentPreflightPayload } = require('./agentPreflight');
const { sanitizeValue } = require('../security/secretMasking');

const AGENT_PROMPT_SCHEMA_VERSION = 1;

function formatPromptContext(preflight) {
  const context = preflight.context || {};
  const active = context.active || {};
  const lines = [
    `- Preflight status: ${preflight.ok ? 'ready' : 'blocked'}`,
    `- Effective profile: ${context.profile || '(not set)'}`,
    `- Active resource: ${context.activeKind || '(not set)'}`,
    `- Effective scope: ${active.system || '(system unset)'} / ${active.library || '(library/schema unset)'} / ${active.sourceFile || active.table || '(file/table unset)'} / ${active.member || '(member unset)'}`,
    `- Profile catalog: ${preflight.profileInventory.status} (${preflight.profileInventory.count} visible profile(s))`,
    `- Experience log: ${preflight.experience.exists ? `${preflight.experience.eventCount} event(s)` : 'empty'}`,
    `- Recommended next command: ${preflight.nextCommands[0] || 'node cli/zeus.js tools guide --json'}`,
  ];

  const lessons = Array.isArray(preflight.experience.summary?.lessons)
    ? preflight.experience.summary.lessons.slice(0, 3)
    : [];
  if (lessons.length > 0) {
    lines.push('- Recent reusable lessons:');
    for (const lesson of lessons) {
      lines.push(`  - [${lesson.failureCode}] ${lesson.lesson}`);
    }
  }
  const suggestions = Array.isArray(preflight.experience.intelligence?.suggestions)
    ? preflight.experience.intelligence.suggestions.slice(0, 2)
    : [];
  for (const suggestion of suggestions) {
    if (suggestion.workaround) lines.push(`- Suggested workaround: ${suggestion.workaround}`);
    if (suggestion.nextSafeStep)
      lines.push(`- Suggested next safe step: ${suggestion.nextSafeStep}`);
  }
  const missingInputs = Array.isArray(preflight.inputRequirements?.missingInputs)
    ? preflight.inputRequirements.missingInputs.slice(0, 6)
    : [];
  for (const input of missingInputs) {
    lines.push(`- Missing input: ${input.name} — ${input.reason}`);
  }
  const concepts = Array.isArray(preflight.legacyConcepts) ? preflight.legacyConcepts : [];
  if (concepts.length > 0) {
    lines.push(
      `- Recognized legacy vocabulary: ${concepts.map(concept => concept.label).join(', ')}`
    );
  }
  if (preflight.resume?.available) {
    lines.push(
      `- Existing run manifest: ${preflight.resume.manifestPath} (${preflight.resume.status})`
    );
    lines.push(`- Resume command: ${preflight.resume.commands[0] || '(inspect manifest first)'}`);
  }
  return lines.map(line => sanitizeValue(line));
}

function buildCliAgentPromptPayload({
  cwd = process.cwd(),
  goal,
  profile = null,
  environment = '',
  program = null,
  source = null,
  out = null,
} = {}) {
  const normalizedGoal = String(goal || '').trim();
  if (!normalizedGoal) {
    const error = new Error('Missing required option: --goal "<goal>"');
    error.code = 'TOOL_INVALID_ARGUMENTS';
    throw error;
  }

  const preflight = buildCliAgentPreflightPayload({
    cwd,
    goal: normalizedGoal,
    profile,
    program,
    source,
    out,
  });
  const effectiveProfile = preflight.effectiveProfile || '(not set)';
  const service = createAiSessionPromptService();
  const generated = service.generatePrompt({
    profile: effectiveProfile,
    environment,
    goal: normalizedGoal,
    additionalContext: formatPromptContext(preflight),
  });

  return {
    ok: true,
    operation: 'prompt',
    service: 'zeus-rpg-promptkit',
    schemaVersion: AGENT_PROMPT_SCHEMA_VERSION,
    transport: 'cli',
    canonicalSurface: 'cli',
    mcpOptional: true,
    readOnly: true,
    executionStarted: false,
    goal: sanitizeValue(normalizedGoal),
    prompt: generated.prompt,
    warnings: generated.warnings,
    metadata: {
      ...generated.metadata,
      effectiveProfile: effectiveProfile === '(not set)' ? null : effectiveProfile,
      preflightSchemaVersion: preflight.schemaVersion,
      nextCommands: preflight.nextCommands,
    },
    preflight: {
      context: preflight.context,
      checks: preflight.checks,
      experience: preflight.experience,
      suggestion: preflight.suggestion,
      inputRequirements: preflight.inputRequirements,
      resume: preflight.resume,
    },
  };
}

module.exports = {
  AGENT_PROMPT_SCHEMA_VERSION,
  buildCliAgentPromptPayload,
  formatPromptContext,
};
