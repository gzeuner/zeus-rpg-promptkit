/*
Copyright 2026 Zeus PromptKit Contributors

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
const crypto = require('crypto');

function buildPlanIdentityPayload({
  program,
  profileName,
  localSourcePath,
  target,
  targetType,
  beforeHash,
  afterHash,
  diffSummary,
  riskLevel,
  requiredApprovals,
  intendedAction,
  staging,
}) {
  return {
    program: String(program || '').trim().toUpperCase(),
    profileName: String(profileName || '').trim(),
    localSourcePath: String(localSourcePath || '').trim(),
    remoteTarget: target || null,
    targetType: String(targetType || '').trim(),
    beforeHash: String(beforeHash || '').trim(),
    afterHash: String(afterHash || '').trim(),
    diffSummary: String(diffSummary || '').trim(),
    riskLevel: String(riskLevel || '').trim().toUpperCase(),
    requiredApprovals: Array.isArray(requiredApprovals) ? requiredApprovals : [],
    intendedAction: String(intendedAction || '').trim(),
    staging: staging || {},
  };
}

function computePlanHash(payload) {
  const text = JSON.stringify(payload);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function buildChangePlan({
  program,
  profileName,
  localSourcePath,
  target,
  targetType,
  beforeHash = '',
  afterHash = '',
  diffSummary = '',
  riskLevel = 'UNKNOWN',
  requiredApprovals = [],
  intendedAction = 'stage-and-apply',
  staging = {},
  rollbackHints = [],
  warnings = [],
  createdAt = new Date().toISOString(),
}) {
  const identityPayload = buildPlanIdentityPayload({
    program,
    profileName,
    localSourcePath,
    target,
    targetType,
    beforeHash,
    afterHash,
    diffSummary,
    riskLevel,
    requiredApprovals,
    intendedAction,
    staging,
  });
  const planHash = computePlanHash(identityPayload);
  const planId = `plan-${planHash.slice(0, 12)}`;

  return {
    kind: 'bridge-change-plan',
    schemaVersion: 2,
    planId,
    planHash,
    createdAt,
    generatedAt: createdAt,
    program: String(program || '').trim().toUpperCase(),
    profileName: String(profileName || '').trim(),
    localSourcePath: String(localSourcePath || '').trim(),
    remoteTarget: target,
    targetType: String(targetType || '').trim(),
    beforeHash: String(beforeHash || '').trim(),
    afterHash: String(afterHash || '').trim(),
    diffSummary: String(diffSummary || '').trim(),
    riskLevel: String(riskLevel || '').trim().toUpperCase(),
    requiredApprovals: Array.isArray(requiredApprovals) ? requiredApprovals : [],
    intendedAction: String(intendedAction || '').trim(),
    staging,
    rollbackHints: Array.isArray(rollbackHints) ? rollbackHints : [],
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

function renderChangePlanMarkdown(plan) {
  const targetSummary = plan && plan.remoteTarget && plan.targetType === 'source-member'
    ? `${plan.remoteTarget.library}/${plan.remoteTarget.sourceFile}(${plan.remoteTarget.member})`
    : (plan && plan.remoteTarget && plan.remoteTarget.ifsPath ? plan.remoteTarget.ifsPath : 'n/a');
  const approvals = (plan.requiredApprovals || []).length > 0 ? plan.requiredApprovals.join(', ') : 'none';
  const warnings = (plan.warnings || []).length > 0
    ? plan.warnings.map((warning) => `- ${warning}`).join('\n')
    : '- none';
  const rollbackHints = (plan.rollbackHints || []).length > 0
    ? plan.rollbackHints.map((hint) => `- ${hint}`).join('\n')
    : '- none';

  return `# Change Plan: ${plan.program}

- Plan ID: ${plan.planId || 'n/a'}
- Plan Hash: ${plan.planHash || 'n/a'}
- Created: ${plan.createdAt || plan.generatedAt || 'n/a'}
- Profile: ${plan.profileName}
- Local source: ${plan.localSourcePath}
- Target type: ${plan.targetType}
- Remote target: ${targetSummary}
- Risk level: ${plan.riskLevel}
- Intended action: ${plan.intendedAction}
- Required approvals: ${approvals}

## Diff Summary

${plan.diffSummary || 'No diff summary captured yet.'}

## Staging

\`\`\`json
${JSON.stringify(plan.staging || {}, null, 2)}
\`\`\`

## Rollback Hints

${rollbackHints}

## Warnings

${warnings}
`;
}

function writeChangePlanArtifacts({
  outputRoot,
  program,
  plan,
}) {
  const programName = String(program || '').trim().toUpperCase();
  const programDir = path.join(outputRoot, programName);
  fs.mkdirSync(programDir, { recursive: true });
  const jsonPath = path.join(programDir, 'change-plan.json');
  const mdPath = path.join(programDir, 'change-plan.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderChangePlanMarkdown(plan), 'utf8');
  return {
    jsonPath,
    mdPath,
  };
}

function readChangePlanArtifact({
  outputRoot,
  program,
}) {
  const programName = String(program || '').trim().toUpperCase();
  const planPath = path.join(outputRoot, programName, 'change-plan.json');
  if (!fs.existsSync(planPath)) {
    return {
      exists: false,
      planPath,
      plan: null,
    };
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  return {
    exists: true,
    planPath,
    plan,
  };
}

module.exports = {
  buildChangePlan,
  buildPlanIdentityPayload,
  computePlanHash,
  readChangePlanArtifact,
  renderChangePlanMarkdown,
  writeChangePlanArtifacts,
};
