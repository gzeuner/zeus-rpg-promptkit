'use strict';

const fs = require('fs');
const path = require('path');
const { createAiSessionPromptService } = require('../ui/aiSessionPromptService');
const { listPromptContracts } = require('../prompt/promptRegistry');

const SESSION_START_PROMPT = Object.freeze({
  name: 'zeus.session.start',
  description: 'Generates the standard CLI/MCP-first Zeus AI session bootstrap prompt.',
  arguments: Object.freeze([
    Object.freeze({
      name: 'goal',
      description: 'Concrete user goal to insert into the session bootstrap prompt.',
      required: true,
    }),
    Object.freeze({
      name: 'profile',
      description: 'Optional runtime profile label to include in the prompt context.',
      required: false,
    }),
    Object.freeze({
      name: 'environment',
      description: 'Optional environment hint to include in the prompt context.',
      required: false,
    }),
    Object.freeze({
      name: 'includeDoctorSummary',
      description:
        'When true, include a compact doctor summary block if doctorSummary is provided.',
      required: false,
    }),
    Object.freeze({
      name: 'doctorSummary',
      description: 'Optional compact doctor summary object used by the session prompt service.',
      required: false,
    }),
  ]),
});

function listMcpPrompts() {
  const templatePrompts = listPromptContracts().map(contract => ({
    name: buildTemplatePromptName(contract.name),
    description: `Returns the curated Zeus prompt template for ${contract.name}.`,
    arguments: [],
  }));

  return [SESSION_START_PROMPT, ...templatePrompts];
}

function getMcpPrompt(name, args = {}, context = {}) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName) {
    const error = new Error('Invalid params: prompts/get requires params.name');
    error.code = 'PROMPT_INVALID_ARGUMENTS';
    throw error;
  }

  if (normalizedName === SESSION_START_PROMPT.name) {
    return buildSessionStartPrompt(args);
  }

  const contract = listPromptContracts().find(
    entry => buildTemplatePromptName(entry.name) === normalizedName
  );
  if (!contract) {
    const error = new Error(`Prompt not found: ${normalizedName}`);
    error.code = 'PROMPT_NOT_FOUND';
    throw error;
  }

  return buildTemplatePrompt(contract, context);
}

function buildTemplatePromptName(contractName) {
  return `zeus.prompt.${contractName}`;
}

function buildSessionStartPrompt(args) {
  const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
  if (!goal) {
    const error = new Error(
      'Invalid params: prompts/get zeus.session.start requires arguments.goal'
    );
    error.code = 'PROMPT_INVALID_ARGUMENTS';
    throw error;
  }

  const promptService = createAiSessionPromptService();
  const result = promptService.generatePrompt({
    profile:
      typeof args.profile === 'string' && args.profile.trim() ? args.profile.trim() : 'default',
    environment: typeof args.environment === 'string' ? args.environment.trim() : '',
    goal,
    includeDoctorSummary: args.includeDoctorSummary === true,
    doctorSummary:
      args.doctorSummary && typeof args.doctorSummary === 'object' ? args.doctorSummary : null,
  });

  return {
    description: SESSION_START_PROMPT.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: result.prompt,
        },
      },
    ],
  };
}

function buildTemplatePrompt(contract, context = {}) {
  const templatePath = path.resolve(
    context.cwd || process.cwd(),
    'src',
    'prompt',
    'templates',
    `${contract.templateFile}.md`
  );
  const templateText = fs.readFileSync(templatePath, 'utf8');
  const prelude = [
    `# Zeus Prompt Template`,
    '',
    `Template: ${contract.name}`,
    `Workflow: ${contract.workflow}`,
    `Output file: ${contract.outputFileName}`,
    '',
    'Preferred output shape:',
    ...contract.preferredOutputShape.map(entry => `- ${entry}`),
    '',
    'Template body:',
    '',
    templateText.trimEnd(),
  ].join('\n');

  return {
    description: `Zeus prompt template: ${contract.name}`,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${prelude}\n`,
        },
      },
    ],
  };
}

module.exports = {
  getMcpPrompt,
  listMcpPrompts,
};
