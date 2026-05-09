/**
 * QA Report Generator
 * 
 * Transforms QA validation results into various output formats.
 * Supports: Jira, Markdown, JSON
 */

class QAReportGenerator {
  constructor() {
    this.name = 'QAReportGenerator';
  }

  /**
   * Generate report from QA results
   * 
   * @param {Object} qaResults - Combined QA validation results
   * @param {Object} config - Report configuration
   * @returns {Object} Generated report
   */
  generateReport(qaResults, config = {}) {
    const format = config.format || 'markdown';
    const timestamp = new Date().toISOString();

    switch (format) {
      case 'jira':
        return this.generateJiraReport(qaResults, config, timestamp);
      case 'json':
        return this.generateJSONReport(qaResults, config, timestamp);
      case 'markdown':
      default:
        return this.generateMarkdownReport(qaResults, config, timestamp);
    }
  }

  /**
   * Generate Jira markup report
   * 
   * @param {Object} qaResults - QA results
   * @param {Object} config - Config
   * @param {String} timestamp - Timestamp
   * @returns {Object} Report
   */
  generateJiraReport(qaResults, config, timestamp) {
    let content = '';

    // Header
    content += 'h2. ✅ QA Validation Report\n\n';
    content += `*Generated:* ${timestamp}\n\n`;

    // Summary
    content += 'h3. Summary\n\n';
    content += `*Status:* ${this.calculateStatus(qaResults)}\n`;
    content += `*Total Issues:* ${this.countIssues(qaResults)}\n`;
    content += `*Critical:* ${this.countBySeverity(qaResults, 'CRITICAL')}\n`;
    content += `*Errors:* ${this.countBySeverity(qaResults, 'ERROR')}\n`;
    content += `*Warnings:* ${this.countBySeverity(qaResults, 'WARNING')}\n\n`;

    // Detailed findings
    content += 'h3. Findings\n\n';
    content += this.formatJiraFindings(qaResults);

    // Recommendations
    if (this.hasRecommendations(qaResults)) {
      content += 'h3. Recommendations\n\n';
      content += this.formatJiraRecommendations(qaResults);
    }

    return {
      format: 'jira',
      content,
      timestamp,
      canPostToJira: true,
    };
  }

  /**
   * Generate Markdown report
   * 
   * @param {Object} qaResults - QA results
   * @param {Object} config - Config
   * @param {String} timestamp - Timestamp
   * @returns {Object} Report
   */
  generateMarkdownReport(qaResults, config, timestamp) {
    let content = '';

    content += '# QA Validation Report\n\n';
    content += `**Generated:** ${timestamp}\n\n`;

    content += '## Summary\n\n';
    content += `- **Status:** ${this.calculateStatus(qaResults)}\n`;
    content += `- **Total Issues:** ${this.countIssues(qaResults)}\n`;
    content += `- **Critical:** ${this.countBySeverity(qaResults, 'CRITICAL')}\n`;
    content += `- **Errors:** ${this.countBySeverity(qaResults, 'ERROR')}\n`;
    content += `- **Warnings:** ${this.countBySeverity(qaResults, 'WARNING')}\n\n`;

    content += '## Findings\n\n';
    content += this.formatMarkdownFindings(qaResults);

    if (this.hasRecommendations(qaResults)) {
      content += '## Recommendations\n\n';
      content += this.formatMarkdownRecommendations(qaResults);
    }

    return {
      format: 'markdown',
      content,
      timestamp,
    };
  }

  /**
   * Generate JSON report
   * 
   * @param {Object} qaResults - QA results
   * @param {Object} config - Config
   * @param {String} timestamp - Timestamp
   * @returns {Object} Report
   */
  generateJSONReport(qaResults, config, timestamp) {
    return {
      format: 'json',
      timestamp,
      reportVersion: '1.0',
      status: this.calculateStatus(qaResults),
      summary: {
        totalIssues: this.countIssues(qaResults),
        criticalCount: this.countBySeverity(qaResults, 'CRITICAL'),
        errorCount: this.countBySeverity(qaResults, 'ERROR'),
        warningCount: this.countBySeverity(qaResults, 'WARNING'),
      },
      findings: this.flattenFindings(qaResults),
      recommendations: this.extractRecommendations(qaResults),
    };
  }

  // Helper methods

  calculateStatus(qaResults) {
    const errors = this.countBySeverity(qaResults, 'ERROR') + this.countBySeverity(qaResults, 'CRITICAL');
    if (errors > 0) return '❌ ISSUES FOUND';
    if (this.countBySeverity(qaResults, 'WARNING') > 0) return '⚠️ WARNINGS';
    return '✅ PASS';
  }

  countIssues(qaResults) {
    let count = 0;
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) count += validator.inconsistencies.length;
      if (validator.issues) count += validator.issues.length;
      if (validator.findings) count += validator.findings.length;
      if (validator.riskFactors) count += validator.riskFactors.length;
    }
    return count;
  }

  countBySeverity(qaResults, severity) {
    let count = 0;
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) {
        count += validator.inconsistencies.filter(i => i.severity === severity).length;
      }
      if (validator.issues) {
        count += validator.issues.filter(i => i.severity === severity).length;
      }
      if (validator.findings) {
        count += validator.findings.filter(f => f.severity === severity).length;
      }
      if (validator.riskFactors) {
        count += validator.riskFactors.filter(r => r.severity === severity).length;
      }
    }
    return count;
  }

  hasRecommendations(qaResults) {
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies?.some(i => i.suggestion)) return true;
      if (validator.issues?.some(i => i.suggestion)) return true;
      if (validator.findings?.some(f => f.suggestion)) return true;
    }
    return false;
  }

  formatJiraFindings(qaResults) {
    let content = '';
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) {
        for (const issue of validator.inconsistencies) {
          content += `* {{${issue.severity}}} ${issue.field}: ${issue.preconditionValue} vs ${issue.codeFilterExpectation}\n`;
        }
      }
    }
    return content || '_No issues found_\n';
  }

  formatJiraRecommendations(qaResults) {
    let content = '';
    const seen = new Set();
    
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) {
        for (const issue of validator.inconsistencies) {
          if (issue.suggestion && !seen.has(issue.suggestion)) {
            content += `* ${issue.suggestion}\n`;
            seen.add(issue.suggestion);
          }
        }
      }
    }
    return content || '_No recommendations_\n';
  }

  formatMarkdownFindings(qaResults) {
    let content = '';
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies?.length > 0) {
        content += `### ${validator.validatorName}\n\n`;
        for (const issue of validator.inconsistencies) {
          content += `- **${issue.severity}**: ${issue.field}\n`;
          content += `  - Expected: ${issue.codeFilterExpectation}\n`;
          content += `  - Got: ${issue.preconditionValue}\n\n`;
        }
      }
    }
    return content || '_No issues found_\n';
  }

  formatMarkdownRecommendations(qaResults) {
    let content = '';
    const seen = new Set();
    
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) {
        for (const issue of validator.inconsistencies) {
          if (issue.suggestion && !seen.has(issue.suggestion)) {
            content += `- ${issue.suggestion}\n`;
            seen.add(issue.suggestion);
          }
        }
      }
    }
    return content || '';
  }

  flattenFindings(qaResults) {
    const findings = [];
    for (const validator of Object.values(qaResults)) {
      if (validator.inconsistencies) findings.push(...validator.inconsistencies);
      if (validator.issues) findings.push(...validator.issues);
      if (validator.findings) findings.push(...validator.findings);
    }
    return findings;
  }

  extractRecommendations(qaResults) {
    const recs = [];
    const seen = new Set();
    
    for (const validator of Object.values(qaResults)) {
      for (const key of ['inconsistencies', 'issues', 'findings']) {
        if (validator[key]) {
          for (const item of validator[key]) {
            if (item.suggestion && !seen.has(item.suggestion)) {
              recs.push(item.suggestion);
              seen.add(item.suggestion);
            }
          }
        }
      }
    }
    return recs;
  }
}

module.exports = new QAReportGenerator();
