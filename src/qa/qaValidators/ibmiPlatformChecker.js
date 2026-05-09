/**
 * IBM i Platform Checker
 * 
 * Validates code against IBM i platform best practices and common gotchas.
 * 
 * Checks:
 * - CCSID compliance (UTF-8 = 1208)
 * - Schema vs Library syntax
 * - Row count queries
 * - Commitment control
 * - Duplicate member names
 */

class IBMiPlatformChecker {
  constructor() {
    this.name = 'IBMiPlatformChecker';
  }

  /**
   * Check IBM i platform compliance
   * 
   * @param {Object} canonicalAnalysis - Canonical analysis
   * @param {Array} sourceFiles - Source files
   * @param {Object} context - Context
   * @returns {Promise<Object>} Check result
   */
  async check(canonicalAnalysis, sourceFiles, context = {}) {
    const findings = [];

    // Check for duplicate member names
    findings.push(...this.checkDuplicateMembers(sourceFiles));

    // Check for schema/library syntax issues
    findings.push(...this.checkSchemaLibrarySyntax(canonicalAnalysis));

    // Check for ROW_COUNT usage
    findings.push(...this.checkRowCountUsage(canonicalAnalysis));

    // Check for commitment control markers
    findings.push(...this.checkCommitmentControl(canonicalAnalysis));

    // Check for CCSID issues
    findings.push(...this.checkCCSID(sourceFiles, context));

    return {
      checkerName: 'IBMiPlatformChecker',
      timestamp: new Date().toISOString(),
      platform: 'IBM i',
      findingsCount: findings.length,
      status: findings.filter(f => f.severity === 'ERROR').length > 0 ? 'ISSUES_FOUND' : 'COMPLIANT',
      findings,
    };
  }

  /**
   * Check for duplicate member names
   * 
   * @param {Array} sourceFiles - Source files
   * @returns {Array} Findings
   */
  checkDuplicateMembers(sourceFiles = []) {
    const findings = [];
    const memberMap = {};

    for (const file of sourceFiles) {
      const memberKey = file.memberName.toUpperCase();
      
      if (memberMap[memberKey]) {
        findings.push({
          type: 'DUPLICATE_MEMBER_NAME',
          severity: 'WARNING',
          members: [memberMap[memberKey], file],
          message: `Member name '${file.memberName}' appears in multiple source files`,
          suggestion: 'Rename one member to avoid confusion',
        });
      } else {
        memberMap[memberKey] = file;
      }
    }

    return findings;
  }

  /**
   * Check for schema vs library syntax
   * 
   * @param {Object} canonicalAnalysis - Analysis
   * @returns {Array} Findings
   */
  checkSchemaLibrarySyntax(canonicalAnalysis) {
    const findings = [];

    if (!canonicalAnalysis.entities || !canonicalAnalysis.entities.sqlStatements) {
      return findings;
    }

    for (const sql of canonicalAnalysis.entities.sqlStatements) {
      if (sql.tables) {
        for (const table of sql.tables) {
          // Check for LIBRARY/FILE syntax in SQL context
          if (table.includes('/')) {
            findings.push({
              type: 'LIBRARY_FILE_SYNTAX',
              severity: 'WARNING',
              table,
              message: 'Table reference uses LIBRARY/FILE syntax',
              suggestion: 'Use SCHEMA.TABLE syntax in SQL: ' + table.replace('/', '.'),
              evidence: sql.evidence,
            });
          }
        }
      }
    }

    return findings;
  }

  /**
   * Check for ROW_COUNT usage
   * 
   * @param {Object} canonicalAnalysis - Analysis
   * @returns {Array} Findings
   */
  checkRowCountUsage(canonicalAnalysis) {
    const findings = [];

    if (!canonicalAnalysis.entities || !canonicalAnalysis.entities.sqlStatements) {
      return findings;
    }

    for (const sql of canonicalAnalysis.entities.sqlStatements) {
      if (sql.whereClause && (sql.whereClause.includes('ROW_COUNT') || sql.whereClause.includes('NUMBER_ROWS'))) {
        findings.push({
          type: 'ROW_COUNT_USAGE',
          severity: 'WARNING',
          issue: 'ROW_COUNT or NUMBER_ROWS from QSYS2.SYSTABLES may not be available',
          suggestion: 'Use COUNT(*) or alternative method',
          evidence: sql.evidence,
        });
      }
    }

    return findings;
  }

  /**
   * Check for commitment control considerations
   * 
   * @param {Object} canonicalAnalysis - Analysis
   * @returns {Array} Findings
   */
  checkCommitmentControl(canonicalAnalysis) {
    const findings = [];

    // Check for operations that might trigger commitment control errors
    if (canonicalAnalysis.entities && canonicalAnalysis.entities.sqlStatements) {
      const hasReadOnly = canonicalAnalysis.entities.sqlStatements.some(s => s.intent === 'READ');
      const hasWrite = canonicalAnalysis.entities.sqlStatements.some(s => s.intent === 'WRITE');

      if (hasReadOnly && hasWrite) {
        findings.push({
          type: 'COMMITMENT_CONTROL_MIXED',
          severity: 'INFO',
          message: 'Program contains both READ and WRITE SQL operations',
          suggestion: 'Verify commitment control configuration matches application requirements',
        });
      }
    }

    return findings;
  }

  /**
   * Check CCSID compliance
   * 
   * @param {Array} sourceFiles - Source files
   * @param {Object} context - Context
   * @returns {Array} Findings
   */
  checkCCSID(sourceFiles = [], context = {}) {
    const findings = [];

    for (const file of sourceFiles) {
      // Check for non-UTF-8 encoding indicators
      if (file.encoding && file.encoding !== 'UTF-8' && file.encoding !== 'UTF8') {
        findings.push({
          type: 'CCSID_MISMATCH',
          severity: 'WARNING',
          file: file.name,
          currentCCSID: file.encoding,
          expectedCCSID: 'UTF-8 (1208)',
          suggestion: 'Convert source to UTF-8 for local analysis',
        });
      }
    }

    return findings;
  }
}

module.exports = new IBMiPlatformChecker();
