# QA Subsystem Implementation Guide

This directory contains the **QA Validation Layer** - an optional, non-breaking extension to the Zeus RPG PromptKit.

## Directory Structure

```
src/qa/
├── README.md                      # This file
├── qaStageRegistry.js             # Registers all QA stages (opt-in)
├── qaStageRunner.js               # Executes individual stages with error isolation
├── qaIntegration.js               # Integrates QA into main pipeline
├── qaValidators/
│   ├── testPreconditionValidator.js    # Detects test-code mismatches
│   ├── regressionRiskAnalyzer.js       # Analyzes code change risk
│   ├── sqlConsistencyValidator.js      # Validates SQL logic
│   └── ibmiPlatformChecker.js          # Checks platform best practices
└── qaPromptTemplates/
    └── qa-review.md               # AI prompt template

src/report/
└── qaReportGenerator.js           # Generates Jira/Markdown/JSON reports

src/cli/commands/
└── qaCommand.js                   # CLI entry point
```

## Key Design Decisions

### 1. All Stages Disabled by Default

```javascript
// qaStageRegistry.js
qa-test-precondition-validation: {
  enabled: false,  // ← DEFAULT OFF - Opt-in only
  ...
}
```

**Why?** Ensures backward compatibility - existing workflows are unaffected.

### 2. Error Isolation

```javascript
// qaStageRunner.js
try {
  const result = await this.config.stage.validate(...);
} catch (error) {
  return { status: 'FAILED', errors: [...] };  // ← Never throws
}
```

**Why?** QA failures don't crash the main analysis pipeline.

### 3. Strictness Levels

```javascript
shouldFailHard(qaStrict) {
  if (qaStrict === 'STRICT')   return true;   // ← Fail on any issue
  if (qaStrict === 'LENIENT')  return false;  // ← Only log
  // Default: Errors fail, warnings don't
}
```

**Why?** Accommodates both development (LENIENT) and CI/CD (STRICT) scenarios.

## Validator Contract

All validators must implement this interface:

```javascript
module.exports = {
  async validate(canonicalAnalysis, sourceFiles, context) {
    return {
      validatorName: 'MyValidator',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      result: {/* findings */},
      // or errors: [ { message, code } ]
    };
  },
};
```

## Stage Registry Pattern

```javascript
// qaStageRegistry.js
const QA_STAGE_REGISTRY = Object.freeze({
  'qa-my-stage': {
    name: 'qa-my-stage',
    title: 'My Validator Title',
    description: 'What this does',
    enabled: false,  // ← Opt-in
    stage: require('./qaValidators/myValidator'),
    runsAfter: 'build-canonical-analysis',
    optional: true,
    severity: 'ERROR',  // or WARNING
  }
});

function loadQAStages(config = {}) {
  if (!config.qaMode) return [];  // ← No QA if disabled
  return Object.values(QA_STAGE_REGISTRY).filter(...);
}
```

**To add a new validator:**

1. Create `qaValidators/<name>.js` with `validate()` method
2. Add entry to `QA_STAGE_REGISTRY` in `qaStageRegistry.js`
3. Add `loadQAStages()` to load it

## Report Generation

```javascript
// qaReportGenerator.js
generateReport(qaResults, config = {}) {
  const format = config.format || 'markdown';  // jira|markdown|json
  switch (format) {
    case 'jira':
      return this.generateJiraReport(...);
    case 'json':
      return this.generateJSONReport(...);
    case 'markdown':
    default:
      return this.generateMarkdownReport(...);
  }
}
```

**Output:** Object with `.content` (formatted report)

## CLI Integration

```bash
# Standalone QA
node cli/zeus.js qa --input ./output/MYPGM --format markdown

# Jira-ready
node cli/zeus.js qa --input ./output/MYPGM --format jira --post-comment

# Strict CI/CD mode
node cli/zeus.js qa --input ./output/MYPGM --strict STRICT --format json
```

## Configuration Loading

```javascript
// qaIntegration.js
const qaConfig = {
  qaMode: true, // Enable QA
  qaStrict: 'LENIENT', // LENIENT or STRICT
};

const qaResults = await runQAPipeline(context, { qa: qaConfig });
```

**Config sources** (priority order):

1. Command-line args (`--qa-mode`, `--qa-strict`)
2. Profile config (`profiles.json` - qa section)
3. Environment variables (`ZEUS_QA_MODE`, etc.)
4. Defaults (all disabled)

## Testing Pattern

```javascript
// tests/qa-stage-registry.test.js
describe('QA Stage Registry', () => {
  it('should have all stages disabled by default', () => {
    for (const stage of Object.values(QA_STAGE_REGISTRY)) {
      assert.strictEqual(stage.enabled, false);
    }
  });
});
```

## Common Validator Patterns

### Pattern 1: Validation with Findings

```javascript
async validate(canonicalAnalysis, sourceFiles, context) {
  const findings = [];

  if (!canonicalAnalysis.entities) {
    return { status: 'NO_DATA', findings: [] };
  }

  // Analyze entities
  for (const entity of canonicalAnalysis.entities.tables) {
    // Check something
    if (hasProblem(entity)) {
      findings.push({
        type: 'MY_ISSUE',
        severity: 'ERROR',
        entity: entity.name,
        suggestion: 'What to do'
      });
    }
  }

  return {
    validatorName: 'MyValidator',
    timestamp: new Date().toISOString(),
    status: findings.length > 0 ? 'ISSUES_FOUND' : 'CLEAN',
    findings
  };
}
```

### Pattern 2: Comparison Validator

```javascript
async validate(canonicalAnalysis, sourceFiles, context) {
  if (!context.oldCanonicalAnalysis) {
    return { status: 'NO_BASELINE' };
  }

  const oldData = extractData(context.oldCanonicalAnalysis);
  const newData = extractData(canonicalAnalysis);

  const changes = compareData(oldData, newData);

  return {
    validatorName: 'ComparisonValidator',
    changes,
    riskLevel: calculateRisk(changes)
  };
}
```

## Debug/Troubleshooting

### Enable verbose logging

```bash
node cli/zeus.js qa --input ./output/MYPGM --verbose --format markdown
```

### Check registry

```javascript
const { getRegistryMetadata } = require('./src/qa/qaStageRegistry');
console.log(getRegistryMetadata());
```

### Test individual validator

```javascript
const validator = require('./src/qa/qaValidators/testPreconditionValidator');
const result = await validator.validate(canonicalAnalysis, sourceFiles, {});
console.log(result);
```

## Performance Considerations

- **Validation runs after canonical analysis** → can access all analysis data
- **No re-scanning** → uses existing analysis artifacts
- **Error isolated** → slow validators don't crash pipeline
- **Cacheable** → results can be cached for repeated runs

## Future Enhancements

- [ ] Integration with external test runners
- [ ] Historical trend tracking
- [ ] AI-powered root cause analysis
- [ ] Performance impact analysis
- [ ] Security vulnerability detection

## Contributing

To add a new validator:

1. Create `qaValidators/<name>.js`
2. Implement `validate(canonicalAnalysis, sourceFiles, context)` async method
3. Return object with `{ validatorName, timestamp, status, result|findings }`
4. Add entry to `QA_STAGE_REGISTRY` in `qaStageRegistry.js`
5. Create test in `tests/qa-<name>.test.js`
6. Update documentation

## See Also

- [QA Quick Start](../../docs/quickstart/qa-quickstart.md) - User guide
- [CLI Integration](./README.md) - This implementation guide
