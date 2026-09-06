'use strict';

const LEGACY_VOCABULARY = Object.freeze([
  Object.freeze({
    id: 'rpg',
    label: 'RPG/RPGLE',
    aliases: Object.freeze(['rpg', 'rpgle', 'sqlrpgle']),
  }),
  Object.freeze({
    id: 'cl',
    label: 'CL/CLLE',
    aliases: Object.freeze(['cl', 'clle', 'control language']),
  }),
  Object.freeze({
    id: 'dds',
    label: 'DDS',
    aliases: Object.freeze(['dds', 'display file', 'physical file', 'logical file']),
  }),
  Object.freeze({
    id: 'db2',
    label: 'Db2',
    aliases: Object.freeze(['db2', 'sql', 'table', 'schema']),
  }),
  Object.freeze({
    id: 'ibmi',
    label: 'IBM i',
    aliases: Object.freeze(['ibm i', 'ibmi', 'as400', 'as/400']),
  }),
  Object.freeze({
    id: 'job',
    label: 'IBM i job/joblog',
    aliases: Object.freeze(['job', 'joblog', 'job log']),
  }),
  Object.freeze({
    id: 'spoolfile',
    label: 'spoolfile',
    aliases: Object.freeze(['spoolfile', 'spool file', 'spool']),
  }),
  Object.freeze({
    id: 'source',
    label: 'source library/file/member',
    aliases: Object.freeze(['library', 'source file', 'member', 'qrpglesrc', 'qclsrc', 'qddssrc']),
  }),
]);

function normalizedText(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function detectLegacyConcepts(goal) {
  const text = normalizedText(goal);
  return LEGACY_VOCABULARY.filter(entry => entry.aliases.some(alias => text.includes(alias))).map(
    entry => ({
      id: entry.id,
      label: entry.label,
      matchedAliases: entry.aliases.filter(alias => text.includes(alias)),
    })
  );
}

function hasTool(suggestion, ...tools) {
  const names = new Set((suggestion?.steps || []).map(step => step.tool));
  return tools.some(tool => names.has(tool));
}

function buildAgentInputRequirements({ goal, suggestion, profile, program, source, out } = {}) {
  const concepts = detectLegacyConcepts(goal);
  const conceptIds = new Set(concepts.map(concept => concept.id));
  const missingInputs = [];
  const add = (name, reason, requiredFor, nextSafeStep) => {
    if (!missingInputs.some(input => input.name === name)) {
      missingInputs.push({ name, reason, requiredFor, nextSafeStep });
    }
  };

  if (hasTool(suggestion, 'zeus.analyze', 'zeus.search-source') && !String(source || '').trim()) {
    add(
      'source-root',
      'Local source is required before source-backed analysis.',
      'analyze/search-source',
      'Provide --source <source-root> after confirming the local path.'
    );
  }
  if (
    hasTool(suggestion, 'zeus.analyze', 'zeus.impact', 'zeus.investigation.start') &&
    !String(program || '').trim()
  ) {
    add(
      'program',
      'A program or member is required to select the analysis scope.',
      'analyze/impact/investigate',
      'Provide --program <name> only after verifying the member name.'
    );
  }
  if (
    hasTool(
      suggestion,
      'zeus.doctor',
      'zeus.resources',
      'zeus.spool-read',
      'zeus.joblog',
      'zeus.query-table',
      'zeus.query-sql',
      'zeus.write-sql'
    ) &&
    !String(profile || '').trim()
  ) {
    add(
      'profile',
      'Remote IBM i or Db2 access requires an explicitly selected profile.',
      'remote-read',
      'Run profiles or provide --profile <name>; never infer credentials or a system.'
    );
  }
  if (conceptIds.has('spoolfile') || hasTool(suggestion, 'zeus.spool-read')) {
    for (const input of [
      ['job-number', 'The exact job identity is required to select one spoolfile.', 'spool-read'],
      ['job-user', 'The exact job identity is required to select one spoolfile.', 'spool-read'],
      ['job-name', 'The exact job identity is required to select one spoolfile.', 'spool-read'],
      ['spool-file', 'The spoolfile name is required for a bounded read.', 'spool-read'],
    ]) {
      add(
        input[0],
        input[1],
        input[2],
        `Provide --${input[0]} only from verified operator evidence.`
      );
    }
  }
  if (
    conceptIds.has('source') &&
    !String(source || '').trim() &&
    hasTool(suggestion, 'zeus.analyze', 'zeus.search-source')
  ) {
    add(
      'source-root',
      'The source library/file/member vocabulary maps to a local source root for offline analysis.',
      'source-selection',
      'Confirm the local source root before analyzing.'
    );
  }
  if (
    hasTool(suggestion, 'zeus.write-sql', 'zeus.update', 'zeus.delete', 'zeus.insert') ||
    suggestion?.steps?.some(step => step.approvalRequired)
  ) {
    add(
      'operator-approval',
      'Mutation or apply-style work needs explicit approval after a dry-run and scope review.',
      'mutation-gate',
      'Generate a dry-run/checklist and stop until approval is recorded.'
    );
  }

  const needsOutput = hasTool(suggestion, 'zeus.analyze', 'zeus.impact', 'zeus.bundle', 'zeus.qa');
  if (needsOutput && !String(out || '').trim()) {
    add(
      'output-root',
      'Generated evidence needs a bounded output root for manifests and reports.',
      'artifact-output',
      'Provide --out <output-root> inside the workspace.'
    );
  }

  return {
    concepts,
    missingInputs,
    ready: missingInputs.length === 0,
  };
}

module.exports = {
  LEGACY_VOCABULARY,
  buildAgentInputRequirements,
  detectLegacyConcepts,
};
