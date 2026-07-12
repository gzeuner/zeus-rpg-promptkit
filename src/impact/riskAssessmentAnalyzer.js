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
 * Risk Assessment Analyzer
 * Classifies SQL/RPG access patterns as GREEN (low risk), YELLOW (medium), or RED (critical)
 * Based on:
 * - Access type: READ vs. WRITE vs. TRANSFER
 * - Criticality: Status flags, completion paths
 * - Frequency: Single vs. multiple locations
 * - Fallback patterns: Error handling
 */

function assessSqlStatement(stmt, context = {}) {
  const { type, intent, tables, hasErrorHandling } = stmt || {};

  if (!type) return { risk: 'UNKNOWN', score: 0 };

  // WRITE operations are always at least YELLOW
  if (intent === 'WRITE' || type === 'INSERT' || type === 'UPDATE' || type === 'DELETE') {
    // DELETE with error handling is YELLOW, else RED
    if (type === 'DELETE' && hasErrorHandling) return { risk: 'YELLOW', score: 65 };
    // TRANSFER operations (especially at workflow completion) are RED
    if (context.isTransferPath) return { risk: 'RED', score: 90 };
    return { risk: 'YELLOW', score: 70 };
  }

  // READ operations are GREEN unless in critical path
  if (intent === 'READ' || type === 'SELECT') {
    if (context.isCriticalPath) return { risk: 'YELLOW', score: 55 };
    return { risk: 'GREEN', score: 20 };
  }

  return { risk: 'YELLOW', score: 60 };
}

function assessAccessPattern(access, canonicalAnalysis = {}) {
  const { type, location, table, isLoop, isDynamic, fallbackValue, evidence } = access || {};

  // Dynamic SQL = always YELLOW at minimum
  if (isDynamic) {
    return { risk: 'YELLOW', score: 65, reason: 'Dynamic SQL detected' };
  }

  // Nested subqueries in loops = RED
  if (isLoop && type === 'SUBQUERY') {
    return { risk: 'RED', score: 85, reason: 'Nested subquery in loop detected' };
  }

  // EAV pattern with type conversion = YELLOW
  if (table === 'SKZAATT_00' || table === 'ATTRIBUTE_TABLE') {
    return { risk: 'YELLOW', score: 60, reason: 'EAV pattern detected (type conversion risk)' };
  }

  // Fallback patterns = GREEN (defensive programming)
  if (fallbackValue !== null && fallbackValue !== undefined) {
    return { risk: 'GREEN', score: 25, reason: 'Has fallback value' };
  }

  return { risk: 'GREEN', score: 30 };
}

function assessWorkflowCriticality(program, stage, evidenceContext) {
  const { status, completionPath, errorSafety } = stage || {};

  // Status=5 completion paths are CRITICAL
  if (status === 5 || completionPath) {
    return {
      risk: 'RED',
      score: 90,
      reason: 'Status=5 completion path (critical workflow milestone)',
    };
  }

  // Status transitions with no rollback = YELLOW
  if (status && !errorSafety) {
    return { risk: 'YELLOW', score: 65, reason: 'Status change without error safety' };
  }

  return { risk: 'GREEN', score: 20 };
}

/**
 * Main function: Assess canonical analysis model for risks
 */
function assessCanonicalModel(canonicalAnalysis, options = {}) {
  const { program, entities, relations, sourceFiles } = canonicalAnalysis || {};
  const results = {
    program,
    summary: {},
    accessPoints: [],
    riskMetrics: {
      totalAccesses: 0,
      greenCount: 0,
      yellowCount: 0,
      redCount: 0,
    },
    criticalPaths: [],
    recommendations: [],
  };

  if (!entities || !entities.sqlStatements) {
    return results;
  }

  // Analyze SQL statements
  entities.sqlStatements.forEach(stmt => {
    const assessment = assessSqlStatement(stmt, {
      isCriticalPath: stmt.intent === 'WRITE' && stmt.type === 'UPDATE',
      isTransferPath:
        stmt.type === 'UPDATE' &&
        stmt.tables &&
        stmt.tables.some(t => t.toLowerCase().includes('arzusp')),
    });

    results.riskMetrics.totalAccesses += 1;
    if (assessment.risk === 'GREEN') results.riskMetrics.greenCount += 1;
    if (assessment.risk === 'YELLOW') results.riskMetrics.yellowCount += 1;
    if (assessment.risk === 'RED') results.riskMetrics.redCount += 1;

    if (assessment.risk !== 'GREEN') {
      results.accessPoints.push({
        type: 'SQL',
        subtype: stmt.type,
        tables: stmt.tables,
        intent: stmt.intent,
        evidence: stmt.evidence,
        assessment,
      });

      if (assessment.risk === 'RED') {
        results.criticalPaths.push({
          type: 'SQL',
          reason: assessment.reason,
          tables: stmt.tables,
          evidence: stmt.evidence,
        });
      }
    }
  });

  // Analyze program calls
  if (entities.programCalls) {
    entities.programCalls.forEach(call => {
      // External program calls are YELLOW unless known system program
      const knownSystemPrograms = new Set(['SKZAEAB', 'SKZAEIM', 'RELSKUS']);
      if (!knownSystemPrograms.has(call.name)) {
        results.accessPoints.push({
          type: 'PROGRAM_CALL',
          name: call.name,
          evidence: call.evidence,
          assessment: { risk: 'YELLOW', score: 60, reason: 'External program call' },
        });
      }
    });
  }

  // Build summary
  results.summary = {
    riskLevel:
      results.riskMetrics.redCount > 0
        ? 'RED'
        : results.riskMetrics.yellowCount > 0
          ? 'YELLOW'
          : 'GREEN',
    distribution: `${results.riskMetrics.greenCount}🟢 / ${results.riskMetrics.yellowCount}🟡 / ${results.riskMetrics.redCount}🔴`,
  };

  // Generate recommendations
  if (results.riskMetrics.redCount > 0) {
    results.recommendations.push(
      '⚠️  CRITICAL PATHS DETECTED: Require intensive UAT and regression testing'
    );
  }
  if (results.accessPoints.length > 5) {
    results.recommendations.push(
      'ℹ️  High number of access points: Consider refactoring or documentation'
    );
  }

  return results;
}

/**
 * Format assessment for markdown output
 */
function formatAssessmentMarkdown(assessment) {
  const { program, summary, accessPoints, criticalPaths, recommendations } = assessment;

  let markdown = `# Risk Assessment Report\n\n`;
  markdown += `**Program:** ${program}\n`;
  markdown += `**Overall Risk Level:** ${summary.riskLevel}\n`;
  markdown += `**Risk Distribution:** ${summary.distribution}\n\n`;

  if (criticalPaths.length > 0) {
    markdown += `## 🔴 Critical Paths (${criticalPaths.length})\n\n`;
    criticalPaths.forEach(path => {
      markdown += `- **${path.type}**: ${path.reason}\n`;
      if (path.tables) markdown += `  Tables: ${path.tables.join(', ')}\n`;
      if (path.evidence && path.evidence.length > 0) {
        markdown += `  Evidence: ${path.evidence.map(e => `${e.file}:${e.startLine}`).join(', ')}\n`;
      }
    });
    markdown += '\n';
  }

  if (recommendations.length > 0) {
    markdown += `## Recommendations\n\n`;
    recommendations.forEach(rec => {
      markdown += `- ${rec}\n`;
    });
    markdown += '\n';
  }

  markdown += `## All Access Points (${accessPoints.length})\n\n`;
  accessPoints.forEach(access => {
    const riskEmoji =
      access.assessment.risk === 'GREEN' ? '🟢' : access.assessment.risk === 'YELLOW' ? '🟡' : '🔴';
    markdown += `${riskEmoji} **${access.type}** (${access.assessment.risk})\n`;
    markdown += `   Score: ${access.assessment.score}/100\n`;
    markdown += `   Reason: ${access.assessment.reason}\n`;
    if (access.evidence && access.evidence.length > 0) {
      markdown += `   Evidence: ${access.evidence.map(e => `${e.file}:${e.startLine}`).join(', ')}\n`;
    }
    markdown += '\n';
  });

  return markdown;
}

module.exports = {
  assessCanonicalModel,
  assessSqlStatement,
  assessAccessPattern,
  assessWorkflowCriticality,
  formatAssessmentMarkdown,
};
