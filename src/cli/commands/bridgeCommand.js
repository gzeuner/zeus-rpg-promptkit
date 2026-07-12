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
const path = require('path');
const {
  loadProfiles,
  resolveAnalyzeConfig,
  resolveProfile,
} = require('../../config/runtimeConfig');
const { appendBridgeAuditEvent } = require('../../bridge/bridgeAuditLog');
const {
  readApprovalArtifact,
  validateApprovalForAction,
} = require('../../bridge/bridgeApprovalModel');
const { normalizeBridgeConfig } = require('../../bridge/bridgeConfig');
const { validateCompileTemplateRequest } = require('../../bridge/bridgeCompileGuard');
const { BRIDGE_SUBCOMMANDS } = require('../../bridge/bridgeDefaults');
const {
  buildChangePlan,
  readChangePlanArtifact,
  writeChangePlanArtifacts,
} = require('../../bridge/bridgePlanModel');
const { BridgeRefusalError, throwBridgeRefusal } = require('../../bridge/bridgeRefusal');
const { validateBridgeTarget } = require('../../bridge/bridgeTargetValidator');
const { createJsonOutput } = require('../helpers/jsonOutput');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return fallback;
}

function printBridgeHelp() {
  console.log('Bridge commands (experimental, opt-in):');
  console.log(
    '  zeus bridge plan --profile <name> --program <name> --source <path> --target-lib <lib> --target-file <file> --target-member <member> [--target-type source-member|ifs-streamfile] [--target-ifs <path>] [--json]'
  );
  console.log(
    '  zeus bridge stage --profile <name> --program <name> [--dry-run] [--approval-file <path>] [--json]'
  );
  console.log(
    '  zeus bridge apply --profile <name> --program <name> [--dry-run] [--approval-file <path>] [--json]'
  );
  console.log(
    '  zeus bridge compile-plan --profile <name> --program <name> --template <id> [--json]'
  );
  console.log(
    '  zeus bridge compile-run --profile <name> --program <name> --template <id> [--dry-run] [--approval-file <path>] [--json]'
  );
  console.log('  zeus bridge report --profile <name> --program <name> [--json]');
}

function resolveBridgeContext(args, runtime) {
  if (!args.profile || !String(args.profile).trim()) {
    throw new Error('Missing required option: --profile <name>');
  }
  const cwd = runtime.cwd || process.cwd();
  const env = runtime.env || process.env;
  const profiles = loadProfiles({ cwd, env, args });
  const profile = resolveProfile(profiles, args.profile, { env });
  const bridgeConfig = normalizeBridgeConfig(profile);
  const analyzeConfig = resolveAnalyzeConfig(args, { cwd, env });
  const outputRoot = path.resolve(cwd, analyzeConfig.outputRoot);
  return {
    cwd,
    env,
    profile,
    bridgeConfig,
    analyzeConfig,
    outputRoot,
  };
}

function ensureBridgeEnabled(bridgeConfig) {
  if (bridgeConfig.enabled !== true) {
    throwBridgeRefusal({
      code: 'BRIDGE_DISABLED',
      message:
        'Bridge mode is disabled by default. Set profile.bridge.enabled=true to use bridge commands.',
      hints: [
        'Keep bridge mode disabled on production profiles by default.',
        'Use plan-only mode first and review artifacts before enabling stage/apply workflows.',
      ],
      exitCode: 3,
    });
  }
}

function buildBridgeTargetFromArgs(args) {
  return {
    targetType: args['target-type'] || 'source-member',
    library: args['target-lib'],
    sourceFile: args['target-file'],
    member: args['target-member'],
    memberType: args['target-member-type'],
    ifsPath: args['target-ifs'],
  };
}

function validateAllowlistedTarget(args, bridgeConfig) {
  const targetInfo = validateBridgeTarget(
    buildBridgeTargetFromArgs(args),
    bridgeConfig.allowedTargets
  );
  if (!targetInfo.allowlisted) {
    throwBridgeRefusal({
      code: 'TARGET_NOT_ALLOWLISTED',
      message: 'Bridge target is not allowlisted by profile.bridge.allowedTargets.',
      hints: [
        'Add the target library/source-file or IFS root path to the allowlist.',
        'Review the plan and risk artifacts before widening any allowlist.',
      ],
      exitCode: 3,
    });
  }
  return targetInfo.target;
}

function resolveProgram(args) {
  const value = String(args.program || '')
    .trim()
    .toUpperCase();
  if (!value) {
    throw new Error('Missing required option: --program <name>');
  }
  return value;
}

function resolveLocalSource(args) {
  const value = String(args.source || '').trim();
  if (!value) {
    throw new Error('Missing required option: --source <path>');
  }
  return value;
}

function executePlan(args, context) {
  const program = resolveProgram(args);
  const localSourcePath = resolveLocalSource(args);
  const target = validateAllowlistedTarget(args, context.bridgeConfig);
  const plan = buildChangePlan({
    program,
    profileName: String(args.profile || '').trim(),
    localSourcePath,
    target,
    targetType: target.targetType,
    beforeHash: String(args['before-hash'] || '').trim(),
    afterHash: String(args['after-hash'] || '').trim(),
    diffSummary: String(args['diff-summary'] || 'Diff summary is pending.').trim(),
    riskLevel: String(args['risk-level'] || 'UNKNOWN')
      .trim()
      .toUpperCase(),
    requiredApprovals: ['operator-review', 'change-approval'],
    staging: {
      library: context.bridgeConfig.staging.library,
      sourceFile: context.bridgeConfig.staging.sourceFile,
      ifsPath: context.bridgeConfig.staging.ifsPath,
    },
    rollbackHints: [
      'Keep the previous fetched member snapshot as rollback source.',
      'Record target compile object details before apply.',
    ],
    warnings: [
      'Plan generated without remote mutation.',
      'Apply/compile execution is intentionally scaffolded only in this branch.',
    ],
  });
  const artifacts = writeChangePlanArtifacts({
    outputRoot: context.outputRoot,
    program,
    plan,
  });
  const audit = appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: 'bridge plan',
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: 'plan',
      dryRun: true,
      approvalStatus: 'not-required',
      result: 'succeeded',
      localSource: localSourcePath,
      remoteTarget: target,
      maskedConfigurationSummary: {
        bridgeMode: context.bridgeConfig.mode,
        compileEnabled: context.bridgeConfig.compile.enabled,
      },
    },
  });
  return {
    command: 'plan',
    program,
    plan,
    artifacts,
    auditPath: audit.auditPath,
  };
}

function isApprovalRequired(command, bridgeConfig) {
  if (command === 'compile-run') {
    return Boolean(
      bridgeConfig.requireConfirmation ||
      (bridgeConfig.compile && bridgeConfig.compile.requireApproval)
    );
  }
  if (command === 'stage' || command === 'apply') {
    return Boolean(bridgeConfig.requireConfirmation);
  }
  return false;
}

function evaluateApprovalState({ args, context, command, program }) {
  const planResult = readChangePlanArtifact({
    outputRoot: context.outputRoot,
    program,
  });
  const approvalRequired = isApprovalRequired(command, context.bridgeConfig);

  if (!approvalRequired) {
    return {
      required: false,
      status: 'not-required',
      code: 'APPROVAL_NOT_REQUIRED',
      message: 'Approval is not required by current bridge configuration.',
      planPath: planResult.planPath,
      approvalPath: null,
      planId: planResult.plan && planResult.plan.planId ? planResult.plan.planId : '',
      planHash: planResult.plan && planResult.plan.planHash ? planResult.plan.planHash : '',
    };
  }

  if (!planResult.exists || !planResult.plan) {
    return {
      required: true,
      status: 'missing-plan',
      code: 'PLAN_MISSING',
      message: 'Change plan is missing. Generate a plan before approval checks.',
      planPath: planResult.planPath,
      approvalPath: null,
      planId: '',
      planHash: '',
    };
  }

  const approvalResult = readApprovalArtifact({
    outputRoot: context.outputRoot,
    program,
    approvalFile: args['approval-file'],
  });

  if (!approvalResult.exists || !approvalResult.approval) {
    return {
      required: true,
      status: 'missing',
      code: 'APPROVAL_MISSING',
      message: 'Approval artifact is missing.',
      planPath: planResult.planPath,
      approvalPath: approvalResult.approvalPath,
      planId: planResult.plan.planId || '',
      planHash: planResult.plan.planHash || '',
    };
  }

  try {
    validateApprovalForAction({
      approval: approvalResult.approval,
      requiredAction: command,
      expectedProgram: program,
      expectedProfileName: String(args.profile || '').trim(),
      expectedPlanId: planResult.plan.planId,
      expectedPlanHash: planResult.plan.planHash,
      now: new Date().toISOString(),
    });
    return {
      required: true,
      status: 'accepted',
      code: 'APPROVAL_ACCEPTED',
      message: 'Approval accepted.',
      planPath: planResult.planPath,
      approvalPath: approvalResult.approvalPath,
      planId: planResult.plan.planId || '',
      planHash: planResult.plan.planHash || '',
    };
  } catch (error) {
    return {
      required: true,
      status: 'rejected',
      code: error.code || 'APPROVAL_REJECTED',
      message: error.message,
      planPath: planResult.planPath,
      approvalPath: approvalResult.approvalPath,
      planId: planResult.plan.planId || '',
      planHash: planResult.plan.planHash || '',
    };
  }
}

function executeStageOrApply(args, context, command) {
  const program = resolveProgram(args);
  const dryRun = parseBoolean(args['dry-run'], true);
  const approval = evaluateApprovalState({
    args,
    context,
    command,
    program,
  });

  appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: `bridge ${command}`,
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: `${command}-approval-check`,
      dryRun,
      approvalStatus: approval.status,
      result: approval.code,
      warnings: approval.message ? [approval.message] : [],
      planId: approval.planId,
      planHash: approval.planHash,
    },
  });

  if (!dryRun) {
    appendBridgeAuditEvent({
      outputRoot: context.outputRoot,
      event: {
        command: `bridge ${command}`,
        profile: String(args.profile || '').trim(),
        actorMode: String(args['actor-mode'] || 'human').trim(),
        action: command,
        dryRun: false,
        approvalStatus: approval.status,
        result: 'refused-not-implemented',
        warnings: ['Remote mutation path not implemented in scaffold.'],
        planId: approval.planId,
        planHash: approval.planHash,
      },
    });
    throwBridgeRefusal({
      code: 'BRIDGE_EXECUTION_NOT_IMPLEMENTED',
      message: `${command} execution is intentionally not implemented in this scaffold branch.`,
      hints: [
        `Approval status: ${approval.status} (${approval.code})`,
        'Use --dry-run=true for planning and audit generation.',
        'Wait for human-reviewed implementation before enabling remote write behavior.',
      ],
      exitCode: 3,
    });
  }

  const audit = appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: `bridge ${command}`,
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: command,
      dryRun: true,
      approvalStatus: approval.status,
      result: 'skipped',
      warnings: ['Remote mutation path not implemented in scaffold.'],
      maskedConfigurationSummary: {
        bridgeMode: context.bridgeConfig.mode,
      },
      planId: approval.planId,
      planHash: approval.planHash,
    },
  });

  return {
    command,
    program,
    dryRun: true,
    status: 'skipped',
    reason: 'execution-not-implemented',
    approval,
    auditPath: audit.auditPath,
  };
}

function executeCompilePlan(args, context) {
  const program = resolveProgram(args);
  const templateId = validateCompileTemplateRequest({
    templateId: args.template,
    commandText: args.command,
    bridgeConfig: context.bridgeConfig,
  });
  const audit = appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: 'bridge compile-plan',
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: 'compile-plan',
      dryRun: true,
      approvalStatus: 'required',
      result: 'succeeded',
      compileTemplateId: templateId,
    },
  });
  return {
    command: 'compile-plan',
    program,
    compileTemplateId: templateId,
    auditPath: audit.auditPath,
  };
}

function executeCompileRun(args, context) {
  const program = resolveProgram(args);
  const templateId = validateCompileTemplateRequest({
    templateId: args.template,
    commandText: args.command,
    bridgeConfig: context.bridgeConfig,
  });
  const dryRun = parseBoolean(args['dry-run'], true);
  const approval = evaluateApprovalState({
    args,
    context,
    command: 'compile-run',
    program,
  });

  appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: 'bridge compile-run',
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: 'compile-run-approval-check',
      dryRun,
      approvalStatus: approval.status,
      result: approval.code,
      warnings: approval.message ? [approval.message] : [],
      planId: approval.planId,
      planHash: approval.planHash,
    },
  });

  if (!dryRun) {
    appendBridgeAuditEvent({
      outputRoot: context.outputRoot,
      event: {
        command: 'bridge compile-run',
        profile: String(args.profile || '').trim(),
        actorMode: String(args['actor-mode'] || 'human').trim(),
        action: 'compile-run',
        dryRun: false,
        approvalStatus: approval.status,
        result: 'refused-not-implemented',
        compileTemplateId: templateId,
        warnings: ['Remote compile path not implemented in scaffold.'],
        planId: approval.planId,
        planHash: approval.planHash,
      },
    });
    throwBridgeRefusal({
      code: 'BRIDGE_EXECUTION_NOT_IMPLEMENTED',
      message: 'compile-run execution is intentionally not implemented in this scaffold branch.',
      hints: [
        `Approval status: ${approval.status} (${approval.code})`,
        'Use compile-plan to validate template selection.',
        'Run compile-run with --dry-run while execution is under review.',
      ],
      exitCode: 3,
    });
  }
  const audit = appendBridgeAuditEvent({
    outputRoot: context.outputRoot,
    event: {
      command: 'bridge compile-run',
      profile: String(args.profile || '').trim(),
      actorMode: String(args['actor-mode'] || 'human').trim(),
      action: 'compile-run',
      dryRun: true,
      approvalStatus: approval.status,
      result: 'skipped',
      compileTemplateId: templateId,
      warnings: ['Remote compile path not implemented in scaffold.'],
      planId: approval.planId,
      planHash: approval.planHash,
    },
  });
  return {
    command: 'compile-run',
    program,
    compileTemplateId: templateId,
    dryRun: true,
    status: 'skipped',
    approval,
    auditPath: audit.auditPath,
  };
}

function executeReport(args, context) {
  const program = resolveProgram(args);
  const outputDir = path.join(context.outputRoot, program);
  return {
    command: 'report',
    program,
    expectedArtifacts: {
      changePlanJson: path.join(outputDir, 'change-plan.json'),
      changePlanMarkdown: path.join(outputDir, 'change-plan.md'),
      approvalJson: path.join(outputDir, 'bridge-approval.json'),
      approvalMarkdown: path.join(outputDir, 'bridge-approval.md'),
      auditLog: path.join(context.outputRoot, 'audit', 'bridge-audit.jsonl'),
    },
  };
}

function formatResultForConsole(result) {
  if (!result) {
    return [];
  }
  if (result.command === 'plan') {
    return [
      `Bridge plan generated for ${result.program}.`,
      `JSON: ${result.artifacts.jsonPath}`,
      `Markdown: ${result.artifacts.mdPath}`,
      `Audit log: ${result.auditPath}`,
    ];
  }
  if (result.command === 'report') {
    return [
      `Expected bridge artifacts for ${result.program}:`,
      `- ${result.expectedArtifacts.changePlanJson}`,
      `- ${result.expectedArtifacts.changePlanMarkdown}`,
      `- ${result.expectedArtifacts.approvalJson}`,
      `- ${result.expectedArtifacts.approvalMarkdown}`,
      `- ${result.expectedArtifacts.auditLog}`,
    ];
  }
  return [
    `Bridge ${result.command} status: ${result.status || 'ok'}`,
    result.auditPath ? `Audit log: ${result.auditPath}` : '',
  ].filter(Boolean);
}

async function executeBridgeCommand(args, runtime = {}) {
  const subcommand = String((Array.isArray(args._) && args._[0]) || '')
    .trim()
    .toLowerCase();
  if (!subcommand || subcommand === 'help') {
    return {
      command: 'help',
    };
  }
  if (!BRIDGE_SUBCOMMANDS.includes(subcommand)) {
    throw new Error(`Unknown bridge subcommand: ${subcommand}`);
  }

  const context = resolveBridgeContext(args, runtime);
  ensureBridgeEnabled(context.bridgeConfig);

  if (subcommand === 'plan') {
    return executePlan(args, context);
  }
  if (subcommand === 'stage') {
    return executeStageOrApply(args, context, 'stage');
  }
  if (subcommand === 'apply') {
    return executeStageOrApply(args, context, 'apply');
  }
  if (subcommand === 'compile-plan') {
    return executeCompilePlan(args, context);
  }
  if (subcommand === 'compile-run') {
    return executeCompileRun(args, context);
  }
  return executeReport(args, context);
}

async function runBridge(args) {
  const json = createJsonOutput(args);

  try {
    const result = await executeBridgeCommand(args, {
      cwd: process.cwd(),
      env: process.env,
    });
    if (result.command === 'help') {
      printBridgeHelp();
      return;
    }
    if (json.isJsonMode) {
      json.print(result);
      return;
    }
    for (const line of formatResultForConsole(result)) {
      console.log(line);
    }
  } catch (error) {
    if (error instanceof BridgeRefusalError) {
      if (json.isJsonMode) {
        const errObj = typeof error.toJSON === 'function' ? error.toJSON() : error;
        console.error(json.stringify(errObj));
      } else {
        console.error(error.message);
      }
      process.exit(error.exitCode);
    }
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  executeBridgeCommand,
  parseBoolean,
  printBridgeHelp,
  runBridge,
};
