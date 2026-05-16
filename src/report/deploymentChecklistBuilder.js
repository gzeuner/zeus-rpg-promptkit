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

/**
 * Deployment Checklist Generator
 * Creates structured deployment checklists for program/table changes
 */

function generateDeploymentChecklist(changeContext = {}) {
  const {
    program,
    table,
    changeType, // 'DDL_CHANGE', 'CODE_CHANGE', 'BOTH'
    affectedPrograms,
    hasCriticalPath,
    estimatedImpact, // 'LOW', 'MEDIUM', 'HIGH'
  } = changeContext;

  let checklist = `# Deployment Checklist\n\n`;

  checklist += `**Program(s):** ${Array.isArray(affectedPrograms) ? affectedPrograms.join(', ') : program || 'N/A'}\n`;
  if (table) checklist += `**Table(s):** ${table}\n`;
  checklist += `**Change Type:** ${changeType || 'Unknown'}\n`;
  checklist += `**Estimated Impact:** ${estimatedImpact || 'Medium'}\n`;
  if (hasCriticalPath) checklist += `**⚠️ Contains Critical Paths:** YES\n`;
  checklist += '\n';

  // Phase 1: Preparation
  checklist += `## Phase 1: Preparation (8h before deployment)\n\n`;
  checklist += `### A. Code Review\n`;
  checklist += `- [ ] Source code changes reviewed by RPG-Lead\n`;
  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    checklist += `- [ ] DDL syntax validated (no SQLSTATE errors)\n`;
  }
  checklist += `- [ ] All changes committed to version control\n`;
  checklist += `- [ ] Change approval documented\n\n`;

  checklist += `### B. Build Verification\n`;
  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    checklist += `- [ ] DDL compiles without errors on TEST system\n`;
    checklist += `- [ ] Tables created with correct structure\n`;
    checklist += `- [ ] Indexes/constraints applied\n`;
  }
  checklist += `- [ ] All RPG programs recompiled (CRTSQLRPGI)\n`;
  checklist += `- [ ] Binding successful (no unresolved symbols)\n`;
  checklist += `- [ ] Build logs reviewed for warnings\n\n`;

  checklist += `### C. Pre-Deployment Testing (Unit Level)\n`;
  checklist += `- [ ] Unit tests execute successfully\n`;
  checklist += `- [ ] Code coverage ≥ 80%\n`;
  checklist += `- [ ] No SQL errors in test runs\n\n`;

  // Phase 2: UAT
  checklist += `## Phase 2: UAT (16h, Business Validation)\n\n`;
  checklist += `### A. Functional Testing (Happy Path)\n`;
  checklist += `- [ ] Core business functions work correctly\n`;
  checklist += `- [ ] Data reads return expected results\n`;
  checklist += `- [ ] Data writes persist correctly\n`;
  checklist += `- [ ] User workflows execute end-to-end\n\n`;

  checklist += `### B. Data Validation\n`;
  checklist += `- [ ] Existing data unaffected (backward compatibility)\n`;
  checklist += `- [ ] New data patterns processed correctly\n`;
  checklist += `- [ ] NULL/empty handling works\n`;
  checklist += `- [ ] Edge cases handled gracefully\n\n`;

  if (hasCriticalPath) {
    checklist += `### ⚠️ C. Critical Path Testing (INTENSIVE)\n`;
    checklist += `- [ ] Status transitions tested exhaustively\n`;
    checklist += `- [ ] Completion paths verified\n`;
    checklist += `- [ ] Rollback scenarios covered\n`;
    checklist += `- [ ] Error recovery tested\n`;
    checklist += `- [ ] Audit trails verified\n\n`;
  }

  checklist += `### D. Error Scenario Testing\n`;
  checklist += `- [ ] DB connection failures handled\n`;
  checklist += `- [ ] Constraint violations caught\n`;
  checklist += `- [ ] Permission errors logged\n`;
  checklist += `- [ ] Transaction rollbacks work\n\n`;

  checklist += `### E. Performance Testing\n`;
  checklist += `- [ ] Response times acceptable (< 5s)\n`;
  checklist += `- [ ] Batch operations complete timely\n`;
  checklist += `- [ ] No memory leaks detected\n\n`;

  checklist += `### F. Sign-off\n`;
  checklist += `- [ ] Business Analyst approves functionality\n`;
  checklist += `- [ ] QA Lead signs off on testing\n`;
  checklist += `- [ ] RPG-Lead approves code quality\n\n`;

  // Phase 3: Deployment
  checklist += `## Phase 3: Production Deployment (2h)\n\n`;
  checklist += `### A. Pre-Deployment\n`;
  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    checklist += `- [ ] Production database backed up\n`;
    checklist += `- [ ] Backup verified (test restore)\n`;
  }
  checklist += `- [ ] Communication sent to stakeholders\n`;
  checklist += `- [ ] Rollback plan documented\n`;
  checklist += `- [ ] On-call support briefed\n\n`;

  checklist += `### B. Deployment Execution\n`;
  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    checklist += `- [ ] DDL applied to PROD\n`;
    checklist += `- [ ] Tables/columns verified to exist\n`;
  }
  checklist += `- [ ] Programs deployed to PROD library\n`;
  checklist += `- [ ] Binding completed\n`;
  checklist += `- [ ] Permissions granted (if needed)\n`;
  checklist += `- [ ] Journal entries recorded\n\n`;

  checklist += `### C. Post-Deployment Validation\n`;
  checklist += `- [ ] System running normally\n`;
  checklist += `- [ ] No error messages in job log\n`;
  checklist += `- [ ] Smoke tests passed\n`;
  checklist += `- [ ] Job queues processing\n\n`;

  // Phase 4: Monitoring
  checklist += `## Phase 4: Post-Deployment Monitoring (24h)\n\n`;
  checklist += `### A. Real-World Testing\n`;
  checklist += `- [ ] Users report normal operation\n`;
  checklist += `- [ ] No complaints about performance\n`;
  checklist += `- [ ] New features working as expected\n\n`;

  checklist += `### B. Log Analysis\n`;
  checklist += `- [ ] Application logs clean\n`;
  checklist += `- [ ] No SQL errors\n`;
  checklist += `- [ ] Journal shows correct audit trail\n`;
  checklist += `- [ ] Alert monitoring active\n\n`;

  checklist += `### C. Cleanup\n`;
  if (changeType === 'CODE_CHANGE' || changeType === 'BOTH') {
    checklist += `- [ ] Old EAV data cleaned up (if applicable)\n`;
  }
  checklist += `- [ ] Temporary test data removed\n`;
  checklist += `- [ ] Test libraries archived\n\n`;

  // Rollback Plan
  checklist += `## Phase 5: Rollback Plan (if needed)\n\n`;
  checklist += `### Trigger Conditions\n`;
  checklist += `- [ ] Critical functionality unavailable\n`;
  checklist += `- [ ] Performance degradation > 50%\n`;
  checklist += `- [ ] Data corruption detected\n`;
  checklist += `- [ ] Unrecoverable error state\n\n`;

  checklist += `### Rollback Steps\n`;
  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    checklist += `1. [ ] Stop all users/processes\n`;
    checklist += `2. [ ] Restore database from backup\n`;
    checklist += `3. [ ] Deploy previous program versions\n`;
  } else {
    checklist += `1. [ ] Deploy previous program versions\n`;
    checklist += `2. [ ] Clear cache/sessions\n`;
  }
  checklist += `4. [ ] Run smoke tests\n`;
  checklist += `5. [ ] Notify stakeholders\n\n`;

  return checklist;
}

/**
 * Generate timeline estimate based on changes
 */
function estimateDeploymentTimeline(changeContext = {}) {
  const { changeType, affectedProgramCount, hasCriticalPath } = changeContext;

  let hours = {
    codeReview: 2,
    build: 1,
    unitTest: 2,
    functionalUAT: 4,
    errorUAT: 2,
    deploy: 1,
    monitoring: 4,
  };

  if (hasCriticalPath) {
    hours.functionalUAT = 8; // Intensive testing
    hours.errorUAT = 4;
  }

  if (changeType === 'DDL_CHANGE' || changeType === 'BOTH') {
    hours.build += 1; // DDL compilation
    hours.functionalUAT += 2; // Data validation
  }

  const totalHours = Object.values(hours).reduce((a, b) => a + b, 0);

  return {
    hours,
    totalHours,
    workDays: Math.ceil(totalHours / 8),
    recommendedWindow: 'Off-peak hours (night/weekend)',
  };
}

/**
 * Identify high-risk areas that need special attention
 */
function identifyRiskAreas(canonicalAnalysis, changeContext) {
  const risks = [];
  const { entities } = canonicalAnalysis || {};

  // Check for complex UPDATE patterns
  if (entities && entities.sqlStatements) {
    const complexUpdates = entities.sqlStatements.filter(
      (s) => s.type === 'UPDATE' && s.tables && s.tables.length > 2,
    );
    if (complexUpdates.length > 0) {
      risks.push({
        type: 'COMPLEX_WRITE',
        severity: 'HIGH',
        description: `${complexUpdates.length} UPDATE statements touching multiple tables`,
        mitigation: 'Review each UPDATE for transaction safety',
      });
    }
  }

  // Check for DELETE operations
  if (entities && entities.sqlStatements) {
    const deletes = entities.sqlStatements.filter((s) => s.type === 'DELETE');
    if (deletes.length > 0) {
      risks.push({
        type: 'DATA_DELETION',
        severity: 'CRITICAL',
        description: `${deletes.length} DELETE operations found`,
        mitigation: 'Backup required before deployment; test DELETE logic thoroughly',
      });
    }
  }

  return risks;
}

module.exports = {
  generateDeploymentChecklist,
  estimateDeploymentTimeline,
  identifyRiskAreas,
};
