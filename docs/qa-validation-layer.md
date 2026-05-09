# QA Validation Layer

## Overview

The **QA Validation Layer** is an optional, non-breaking extension to the Zeus RPG PromptKit that provides comprehensive quality assurance capabilities. It enables automated detection of:

- **Test precondition inconsistencies** (e.g., precondition vs. code implementation)
- **Regression risks** from code changes
- **SQL consistency issues** (filters, joins, NULL handling)
- **IBM i platform best practices** violations

## Architecture

### Design Principles

1. **Non-Breaking** - All QA features are opt-in and disabled by default
2. **Error Isolated** - QA failures do NOT crash the main analysis pipeline
3. **Staged** - QA stages run after canonical analysis is complete
4. **Configurable** - Strictness levels: LENIENT, STRICT

### Components

```
src/qa/
├── qaStageRegistry.js          # Central registry of all QA stages
├── qaStageRunner.js            # Individual stage executor with error isolation
├── qaIntegration.js            # Pipeline integration layer
├── qaValidators/
│   ├── testPreconditionValidator.js    # Detects precondition mismatches
│   ├── regressionRiskAnalyzer.js       # Analyzes code change risk
│   ├── sqlConsistencyValidator.js      # Validates SQL logic
│   └── ibmiPlatformChecker.js          # Checks platform best practices
└── qaPromptTemplates/
    └── qa-review.md            # AI prompt template for QA reviews

src/report/
└── qaReportGenerator.js        # Generates reports (Jira, Markdown, JSON)

cli/commands/
└── qaCommand.js                # CLI entry point for QA analysis
```

## Usage

### Command-Line

#### Run QA validation on existing analysis:

```bash
node cli/zeus.js qa --input ./analysis/my-program --format markdown
```

#### With strict mode (fail on warnings):

```bash
node cli/zeus.js qa --input ./analysis/my-program --strict STRICT --format jira
```

#### Output Jira-ready report:

```bash
node cli/zeus.js qa --input ./analysis/my-program --format jira --post-comment --jira-ticket WER-1024
```

### Configuration

#### profiles.json

```json
{
  "qa": {
    "qaMode": false,
    "qaStrict": "LENIENT",
    "reportFormat": "markdown",
    "enabledValidators": [],
    "disabledValidators": [
      "qa-test-precondition-validation",
      "qa-regression-risk-analyzer",
      "qa-sql-consistency-validator",
      "qa-ibm-i-platform-checker"
    ]
  }
}
```

#### Environment Variables

```bash
# Enable QA mode
ZEUS_QA_MODE=true

# Strictness level
ZEUS_QA_STRICT=LENIENT  # or STRICT

# Report format
ZEUS_QA_FORMAT=markdown # or jira, json
```

## Validators

### 1. Test Precondition Validator

**Purpose:** Detects mismatches between documented test preconditions and code implementation.

**Example Detection:**
```
Test Precondition: ldmlan = 6000
Code SQL Filter:   WHERE ldmlan <> 6000
Result:            ❌ INCONSISTENCY DETECTED
```

**Configuration:**
```
qa-test-precondition-validation
├── enabled: false (opt-in)
├── runsAfter: build-canonical-analysis
└── severity: ERROR
```

### 2. Regression Risk Analyzer

**Purpose:** Analyzes code changes between versions to predict regression risk.

**Risk Levels:**
- `LOW` - No functional changes
- `MEDIUM` - Structural changes, logic preserved
- `HIGH` - Changes to filters, loops, or conditions

**Example:**
```
Change: ldmlan filter logic modified
Risk Factor: HIGH
Affected Tests: Tests checking LDMLAN filtering
```

### 3. SQL Consistency Validator

**Purpose:** Validates SQL statement correctness.

**Checks:**
- NULL handling in exclusion filters (`<>` without `IS NOT NULL`)
- Duplicate table joins
- Missing WHERE clauses in DELETE/UPDATE
- Dynamic SQL with host variables

**Example Issue:**
```
Type: MISSING_NULL_HANDLING
Statement: SELECT
Issue: Exclusion filter (<>) without NULL handling
Suggestion: Add IS NOT NULL check
```

### 4. IBM i Platform Checker

**Purpose:** Validates platform best practices and common gotchas.

**Checks:**
- CCSID compliance (UTF-8 = 1208)
- Schema vs. Library syntax
- ROW_COUNT usage (not universally available)
- Commitment control markers
- Duplicate member names

## Report Formats

### Markdown Report

```markdown
# QA Validation Report

**Generated:** 2026-01-15T10:30:00Z

## Summary
- **Status:** ⚠️ WARNINGS
- **Total Issues:** 2
- **Critical:** 0
- **Errors:** 1
- **Warnings:** 1

## Findings

### TestPreconditionValidator
- **ERROR**: ldmlan
  - Expected: <> 6000
  - Got: 6000

## Recommendations
- Update precondition to match code filter: ldmlan <> 6000
```

### Jira Markup Report

```jira
h2. ✅ QA Validation Report

*Generated:* 2026-01-15T10:30:00Z

h3. Summary

*Status:* ⚠️ WARNINGS
*Total Issues:* 2
*Critical:* 0
*Errors:* 1
*Warnings:* 1

h3. Findings

* {{ERROR}} ldmlan: 6000 vs <> 6000

h3. Recommendations

* Update precondition to match code filter: ldmlan <> 6000
```

### JSON Report

```json
{
  "format": "json",
  "timestamp": "2026-01-15T10:30:00Z",
  "status": "ISSUES_FOUND",
  "summary": {
    "totalIssues": 2,
    "criticalCount": 0,
    "errorCount": 1,
    "warningCount": 1
  },
  "findings": [
    {
      "type": "PRECONDITION_MISMATCH",
      "severity": "ERROR",
      "field": "ldmlan",
      "preconditionValue": 6000,
      "codeFilterExpectation": "<> 6000"
    }
  ],
  "recommendations": [
    "Update precondition to match code filter: ldmlan <> 6000"
  ]
}
```

## Integration Points

### Analyze Pipeline

QA stages can be integrated into the analyze pipeline:

```javascript
const { runQAPipeline } = require('./src/qa/qaIntegration');

const qaResults = await runQAPipeline(context, {
  qa: {
    qaMode: true,
    qaStrict: 'LENIENT',
  },
});
```

### Report Generation

```javascript
const { generateQAReport } = require('./src/qa/qaIntegration');

const report = generateQAReport(qaResults, {
  format: 'jira',  // or 'markdown', 'json'
});
```

## Strictness Modes

### LENIENT (Default)

- Errors cause QA to report failures
- Warnings are logged but don't fail
- Main analysis pipeline continues uninterrupted
- Non-blocking validation

### STRICT

- Any issue (error or warning) causes QA to fail
- Useful for CI/CD pipelines with high quality standards
- Blocks analysis completion until issues resolved
- Recommended for production deployments

## Best Practices

### 1. Use LENIENT for Development

```bash
zeus qa --input ./analysis/my-program --strict LENIENT --format markdown
```

### 2. Use STRICT for CI/CD

```bash
zeus qa --input ./analysis/my-program --strict STRICT --format jira
```

### 3. Review Reports Before Implementation

Always review QA reports and understand findings before making code changes.

### 4. Enable Validators Gradually

Start with one validator, review results, then enable others:

```json
{
  "qa": {
    "enabledValidators": [
      "qa-test-precondition-validation"
    ]
  }
}
```

### 5. Post to Jira for Team Collaboration

```bash
zeus qa --input ./analysis/my-program --format jira --post-comment --jira-ticket WER-1024
```

## Testing

### Run QA Tests

```bash
npm test -- tests/qa-*.test.js
```

### Run Single Validator Test

```bash
npm test -- tests/qa-report-generator.test.js
```

## Troubleshooting

### QA Stages Not Running

Check configuration:
```bash
node cli/zeus.js doctor --profile myprofile --show-resolved | grep qa
```

### Empty Report

Ensure canonical analysis was generated:
```bash
# First run analysis
zeus analyze --source ./rpg --program MYPGM

# Then run QA
zeus qa --input ./analysis/MYPGM --format markdown
```

### Unexpected Issues Reported

Enable verbose mode:
```bash
zeus qa --input ./analysis/my-program --verbose --format markdown
```

## Contributing

To add a new QA validator:

1. Create `src/qa/qaValidators/<name>Validator.js`
2. Implement `validate(canonicalAnalysis, sourceFiles, context)` method
3. Register in `src/qa/qaStageRegistry.js`
4. Add tests in `tests/qa-<name>.test.js`
5. Document in this file

## Future Enhancements

- [ ] Integration with test execution engines
- [ ] Regression test coverage analysis
- [ ] Performance impact analysis
- [ ] Security vulnerability scanning
- [ ] AI-assisted root cause analysis
- [ ] Historical trend tracking
