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

function normalizeActionList(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(entry =>
          String(entry || '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildApprovalRecord({
  program,
  profileName,
  plan,
  approvedActions,
  approvedBy,
  approvedAt = new Date().toISOString(),
  expiresAt = '',
  approvalNote = '',
  warningsAcknowledged = [],
  dryRun = false,
}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Approval record requires a change plan.');
  }
  if (!plan.planId || !plan.planHash) {
    throw new Error('Approval record requires plan.planId and plan.planHash.');
  }

  const normalizedProgram = String(program || plan.program || '')
    .trim()
    .toUpperCase();
  const normalizedProfile = String(profileName || plan.profileName || '').trim();
  const normalizedApprovedBy = String(approvedBy || '').trim();
  if (!normalizedProgram) {
    throw new Error('Approval record requires program.');
  }
  if (!normalizedProfile) {
    throw new Error('Approval record requires profileName.');
  }
  if (!normalizedApprovedBy) {
    throw new Error('Approval record requires approvedBy.');
  }

  return {
    kind: 'bridge-approval-record',
    schemaVersion: 1,
    program: normalizedProgram,
    profileName: normalizedProfile,
    planId: String(plan.planId).trim(),
    planHash: String(plan.planHash).trim(),
    approvedActions: normalizeActionList(approvedActions),
    approvedBy: normalizedApprovedBy,
    approvedAt: String(approvedAt || '').trim(),
    expiresAt: String(expiresAt || '').trim(),
    approvalNote: String(approvalNote || '').trim(),
    targetSummary: {
      targetType: String(plan.targetType || '').trim(),
      remoteTarget: plan.remoteTarget || null,
    },
    localSourceSummary: {
      path: String(plan.localSourcePath || '').trim(),
      beforeHash: String(plan.beforeHash || '').trim(),
      afterHash: String(plan.afterHash || '').trim(),
    },
    warningsAcknowledged: Array.isArray(warningsAcknowledged)
      ? warningsAcknowledged.map(entry => String(entry || '').trim()).filter(Boolean)
      : [],
    dryRun: Boolean(dryRun),
  };
}

function renderApprovalMarkdown(approval) {
  const warnings =
    (approval.warningsAcknowledged || []).length > 0
      ? approval.warningsAcknowledged.map(entry => `- ${entry}`).join('\n')
      : '- none';
  const actions =
    (approval.approvedActions || []).length > 0 ? approval.approvedActions.join(', ') : 'none';

  return `# Bridge Approval: ${approval.program}

- Plan ID: ${approval.planId}
- Plan Hash: ${approval.planHash}
- Profile: ${approval.profileName}
- Approved actions: ${actions}
- Approved by: ${approval.approvedBy}
- Approved at: ${approval.approvedAt}
- Expires at: ${approval.expiresAt || 'n/a'}
- Dry run: ${approval.dryRun ? 'true' : 'false'}

## Approval Note

${approval.approvalNote || 'No note provided.'}

## Warnings Acknowledged

${warnings}

## Target Summary

\`\`\`json
${JSON.stringify(approval.targetSummary || {}, null, 2)}
\`\`\`

## Local Source Summary

\`\`\`json
${JSON.stringify(approval.localSourceSummary || {}, null, 2)}
\`\`\`
`;
}

function writeApprovalArtifacts({ outputRoot, program, approval }) {
  const programName = String(program || approval.program || '')
    .trim()
    .toUpperCase();
  const programDir = path.join(outputRoot, programName);
  fs.mkdirSync(programDir, { recursive: true });
  const jsonPath = path.join(programDir, 'bridge-approval.json');
  const mdPath = path.join(programDir, 'bridge-approval.md');
  const sanitizedApproval = sanitizeValue(approval);
  fs.writeFileSync(jsonPath, `${JSON.stringify(sanitizedApproval, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderApprovalMarkdown(sanitizedApproval), 'utf8');
  return {
    jsonPath,
    mdPath,
    approval: sanitizedApproval,
  };
}

function readApprovalArtifact({ outputRoot, program, approvalFile = '' }) {
  const programName = String(program || '')
    .trim()
    .toUpperCase();
  const defaultPath = path.join(outputRoot, programName, 'bridge-approval.json');
  const approvalPath = approvalFile ? path.resolve(approvalFile) : defaultPath;
  if (!fs.existsSync(approvalPath)) {
    return {
      exists: false,
      approvalPath,
      approval: null,
    };
  }
  const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
  return {
    exists: true,
    approvalPath,
    approval,
  };
}

function buildApprovalValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateApprovalForAction({
  approval,
  requiredAction,
  expectedProgram,
  expectedProfileName,
  expectedPlanId,
  expectedPlanHash,
  now = new Date().toISOString(),
}) {
  if (!approval || typeof approval !== 'object') {
    throw buildApprovalValidationError('APPROVAL_MISSING', 'Approval artifact is missing.');
  }

  const normalizedProgram = String(expectedProgram || '')
    .trim()
    .toUpperCase();
  if (
    normalizedProgram &&
    String(approval.program || '')
      .trim()
      .toUpperCase() !== normalizedProgram
  ) {
    throw buildApprovalValidationError(
      'APPROVAL_PROGRAM_MISMATCH',
      'Approval program does not match command program.'
    );
  }
  const normalizedProfile = String(expectedProfileName || '').trim();
  if (normalizedProfile && String(approval.profileName || '').trim() !== normalizedProfile) {
    throw buildApprovalValidationError(
      'APPROVAL_PROFILE_MISMATCH',
      'Approval profile does not match command profile.'
    );
  }

  if (expectedPlanId && String(approval.planId || '').trim() !== String(expectedPlanId).trim()) {
    throw buildApprovalValidationError(
      'APPROVAL_PLAN_MISMATCH',
      'Approval planId does not match current change plan.'
    );
  }
  if (
    expectedPlanHash &&
    String(approval.planHash || '').trim() !== String(expectedPlanHash).trim()
  ) {
    throw buildApprovalValidationError(
      'APPROVAL_PLAN_MISMATCH',
      'Approval planHash does not match current change plan.'
    );
  }

  const normalizedAction = String(requiredAction || '')
    .trim()
    .toLowerCase();
  const approvedActions = normalizeActionList(approval.approvedActions);
  if (normalizedAction && !approvedActions.includes(normalizedAction)) {
    throw buildApprovalValidationError(
      'APPROVAL_ACTION_NOT_APPROVED',
      `Approval does not include required action: ${normalizedAction}`
    );
  }

  const normalizedExpiresAt = String(approval.expiresAt || '').trim();
  if (normalizedExpiresAt) {
    const expiryMs = Date.parse(normalizedExpiresAt);
    const nowMs = Date.parse(String(now || '').trim());
    if (!Number.isFinite(expiryMs) || !Number.isFinite(nowMs)) {
      throw buildApprovalValidationError(
        'APPROVAL_EXPIRED',
        'Approval expiry timestamp is invalid.'
      );
    }
    if (expiryMs < nowMs) {
      throw buildApprovalValidationError('APPROVAL_EXPIRED', 'Approval has expired.');
    }
  }

  return {
    valid: true,
    code: 'APPROVAL_ACCEPTED',
    message: 'Approval accepted.',
  };
}

module.exports = {
  buildApprovalRecord,
  buildApprovalValidationError,
  normalizeActionList,
  readApprovalArtifact,
  renderApprovalMarkdown,
  validateApprovalForAction,
  writeApprovalArtifacts,
};
