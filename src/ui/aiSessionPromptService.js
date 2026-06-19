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

const { sanitizeValue } = require('../security/secretMasking');

const AI_SESSION_PROMPT_TEMPLATE_PATH = 'docs/ai/session-prompt.md';
const AI_SESSION_PROMPT_PLACEHOLDER = '[INSERT USER GOAL HERE]';
const AI_SESSION_GOAL_MAX_LENGTH = 4000;
class AiSessionPromptError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AiSessionPromptError';
    this.statusCode = statusCode;
  }
}

function defaultTemplateLoader(templatePath = AI_SESSION_PROMPT_TEMPLATE_PATH) {
  const absolutePath = path.resolve(__dirname, '..', '..', templatePath);
  if (!fs.existsSync(absolutePath)) {
    throw new AiSessionPromptError(`AI session prompt template is unavailable: ${templatePath}`, 500);
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function extractSessionPromptTemplate(markdown) {
  const source = String(markdown || '');
  const sectionMatch = source.match(/##\s+Session Start Prompt[^\n]*/m);
  if (!sectionMatch || typeof sectionMatch.index !== 'number') {
    throw new AiSessionPromptError('AI session prompt template is missing the Session Start Prompt text block.', 500);
  }

  const sectionStart = sectionMatch.index;
  const fenceMatch = /^(`{3,})text\r?\n/gm;
  fenceMatch.lastIndex = sectionStart;
  const openingFenceMatch = fenceMatch.exec(source);
  if (!openingFenceMatch) {
    throw new AiSessionPromptError('AI session prompt template is missing the Session Start Prompt text block.', 500);
  }

  const promptStart = openingFenceMatch.index + openingFenceMatch[0].length;
  const closingFenceIndex = source.indexOf(`\n${openingFenceMatch[1]}`, promptStart);
  if (closingFenceIndex < promptStart) {
    throw new AiSessionPromptError('AI session prompt template is missing the Session Start Prompt closing fence.', 500);
  }

  const promptTemplate = source.slice(promptStart, closingFenceIndex);
  if (!promptTemplate.includes(AI_SESSION_PROMPT_PLACEHOLDER)) {
    throw new AiSessionPromptError('AI session prompt template is missing the session goal placeholder.', 500);
  }
  return promptTemplate;
}

function formatDoctorSummary(doctorSummary) {
  if (!doctorSummary || typeof doctorSummary !== 'object') {
    return null;
  }

  const summary = doctorSummary.summary && typeof doctorSummary.summary === 'object'
    ? doctorSummary.summary
    : null;
  const counts = [];
  if (summary) {
    for (const key of ['pass', 'warn', 'fail', 'info', 'skip']) {
      if (Number.isFinite(summary[key])) {
        counts.push(`${key}=${Number(summary[key])}`);
      }
    }
  }

  const details = [
    `status=${String(doctorSummary.status || 'unknown').trim() || 'unknown'}`,
    counts.length > 0 ? counts.join(', ') : null,
    doctorSummary.finishedAt ? `finishedAt=${String(doctorSummary.finishedAt).trim()}` : null,
  ].filter(Boolean);

  return details.length > 0 ? details.join(' | ') : null;
}

function buildSessionGoalBlock({
  profile,
  environment,
  includeDoctorSummary = false,
  doctorSummary = null,
}) {
  const lines = [
    'Session context from Local UI Setup (safe metadata only):',
    `- Profile: ${profile}`,
    environment ? `- Environment hint: ${environment}` : null,
    '- Env loading is shell-scoped. The Local UI cannot inject env vars into the user\'s already-open terminal session.',
    '- The Local UI server only sees env vars that were present when it started.',
    includeDoctorSummary && formatDoctorSummary(doctorSummary)
      ? `- Doctor summary: ${formatDoctorSummary(doctorSummary)}`
      : '- Doctor summary: not included; run `doctor` first in this session before deeper work.',
    '- Treat `docs/tool-catalog.md` as the authoritative command and safety reference.',
    '- Use allowlisted Zeus CLI and Zeus MCP tools if available. Do not invent tools or assume unsupported capabilities.',
    '- Never request, paste, echo, or persist credentials, env dumps, or credential-bearing JDBC URLs.',
    '',
    'User goal:',
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
}

function createAiSessionPromptService({
  templateLoader = defaultTemplateLoader,
  templatePath = AI_SESSION_PROMPT_TEMPLATE_PATH,
} = {}) {
  function generatePrompt({
    profile,
    environment = '',
    goal,
    includeDoctorSummary = false,
    doctorSummary = null,
  }) {
    const markdown = templateLoader(templatePath);
    const promptTemplate = extractSessionPromptTemplate(markdown);
    const sessionGoalPrefix = buildSessionGoalBlock({
      profile: sanitizeValue(profile),
      environment: environment ? sanitizeValue(environment) : '',
      includeDoctorSummary,
      doctorSummary,
    });
    const sanitizedGoal = sanitizeValue(String(goal || '').trim());
    const prompt = promptTemplate.replace(
      AI_SESSION_PROMPT_PLACEHOLDER,
      `${sessionGoalPrefix}${sanitizedGoal}`,
    );
    const warnings = [
      includeDoctorSummary
        ? 'Doctor summary was included as a compact status hint only. The assistant should still run doctor first.'
        : 'No doctor summary was included. The assistant should still run doctor first.',
      'Do not paste credentials or env secret values into the session goal.',
      'Use docs/tool-catalog.md as the authoritative Zeus command reference.',
    ];

    return {
      prompt,
      warnings,
      metadata: {
        profile: sanitizeValue(profile),
        environment: environment ? sanitizeValue(environment) : null,
        includedDoctorSummary: Boolean(includeDoctorSummary && formatDoctorSummary(doctorSummary)),
        templateSource: templatePath,
      },
    };
  }

  return {
    generatePrompt,
    extractSessionPromptTemplate,
  };
}

module.exports = {
  AI_SESSION_GOAL_MAX_LENGTH,
  AI_SESSION_PROMPT_PLACEHOLDER,
  AI_SESSION_PROMPT_TEMPLATE_PATH,
  AiSessionPromptError,
  buildSessionGoalBlock,
  createAiSessionPromptService,
  defaultTemplateLoader,
  extractSessionPromptTemplate,
};
