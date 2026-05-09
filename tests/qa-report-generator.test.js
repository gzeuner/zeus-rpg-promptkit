/**
 * QA Report Generator Tests
 */

const assert = require('assert');
const qaReportGenerator = require('../../src/report/qaReportGenerator');

describe('QA Report Generator', () => {
  const mockResults = {
    testPrecondition: {
      validatorName: 'TestPreconditionValidator',
      inconsistencies: [
        {
          field: 'ldmlan',
          preconditionValue: 6000,
          codeFilterExpectation: '<> 6000',
          severity: 'ERROR',
          suggestion: 'Update precondition to ldmlan <> 6000',
        },
      ],
    },
    sqlConsistency: {
      validatorName: 'SQLConsistencyValidator',
      issues: [
        {
          type: 'MISSING_NULL_HANDLING',
          severity: 'WARNING',
          issue: 'Exclusion filter without NULL handling',
        },
      ],
    },
  };

  it('should generate markdown report', () => {
    const report = qaReportGenerator.generateReport(mockResults, { format: 'markdown' });
    
    assert.strictEqual(report.format, 'markdown');
    assert(report.content.includes('QA Validation Report'));
    assert(report.content.includes('ldmlan'));
  });

  it('should generate Jira report', () => {
    const report = qaReportGenerator.generateReport(mockResults, { format: 'jira' });
    
    assert.strictEqual(report.format, 'jira');
    assert(report.content.includes('h2'));
    assert(report.content.includes('ERROR'));
  });

  it('should generate JSON report', () => {
    const report = qaReportGenerator.generateReport(mockResults, { format: 'json' });
    
    assert.strictEqual(report.format, 'json');
    assert(report.timestamp);
    assert(report.summary);
    assert(Array.isArray(report.findings));
  });

  it('should count issues correctly', () => {
    const report = qaReportGenerator.generateReport(mockResults, { format: 'json' });
    
    assert.strictEqual(report.summary.totalIssues, 2);
    assert.strictEqual(report.summary.errorCount, 1);
    assert.strictEqual(report.summary.warningCount, 1);
  });

  it('should extract recommendations', () => {
    const report = qaReportGenerator.generateReport(mockResults, { format: 'json' });
    
    assert(Array.isArray(report.recommendations));
    assert(report.recommendations.length > 0);
  });
});
