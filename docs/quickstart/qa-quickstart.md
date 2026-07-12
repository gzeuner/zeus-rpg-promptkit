---
Title: QA Validation Layer - Quick Start
Description: Schneller operativer Einstieg in typische Zeus-Workflows.
Last Updated: 2026-05-17
---

# QA Validation Layer - Quick Start

## What Just Happened?

The Zeus RPG PromptKit now includes an optional **QA Validation Layer** that enables:

✅ **Detect test precondition mismatches** (e.g., "precondition says X but code does Y")
✅ **Analyze regression risks** from code changes
✅ **Validate SQL filters and joins** for correctness
✅ **Check IBM i best practices** (CCSID, schema syntax, etc.)

## Getting Started in 5 Minutes

### 1. Run QA Analysis (Standalone)

After running a normal `analyze`:

```bash
# Generate analysis
node cli/zeus.js analyze --source ./rpg_sources --program MYPGM

# Run QA validation
node cli/zeus.js qa --input ./output/MYPGM --format markdown
```

### 2. View Output

The QA report shows:

- Summary of issues found
- Detailed findings per validator
- Recommendations for fixes

### 3. Generate Jira-Ready Report

```bash
node cli/zeus.js qa --input ./output/MYPGM --format jira --post-comment
```

Copy the output into your Jira ticket comment!

## File Structure

```
src/qa/                           # QA subsystem (all new files)
├── qaStageRegistry.js            # Stage registration (all opt-in)
├── qaStageRunner.js              # Stage execution with error isolation
├── qaIntegration.js              # Pipeline integration layer
├── qaValidators/                 # 4 validator modules
│   ├── testPreconditionValidator.js
│   ├── regressionRiskAnalyzer.js
│   ├── sqlConsistencyValidator.js
│   └── ibmiPlatformChecker.js
└── qaPromptTemplates/
    └── qa-review.md

src/report/
└── qaReportGenerator.js          # Report generation (Markdown/Jira/JSON)

src/cli/commands/
└── qaCommand.js                  # CLI entry point

```

## Important Design Properties

### ✅ Non-Breaking

- All QA features are **opt-in and disabled by default**
- Existing workflows are **completely unaffected**
- No changes to core analysis pipeline

### ✅ Error Isolated

- QA failures do **NOT crash the main pipeline**
- Can run in LENIENT (warnings don't fail) or STRICT (everything fails) mode
- Perfect for both development and CI/CD

### ✅ Modular

- Each validator is independent
- Enable/disable individually
- Easy to add new validators

## Configuration

### profiles.json (Global QA Config)

```json
{
  "qa": {
    "qaMode": false, // Opt-in (default: disabled)
    "qaStrict": "LENIENT", // LENIENT or STRICT
    "reportFormat": "markdown", // markdown, jira, or json
    "disabledValidators": [
      // All validators start disabled
      "qa-test-precondition-validation",
      "qa-regression-risk-analyzer",
      "qa-sql-consistency-validator",
      "qa-ibm-i-platform-checker"
    ]
  }
}
```

To enable QA:

```json
{
  "qa": {
    "qaMode": true,
    "enabledValidators": ["qa-test-precondition-validation"]
  }
}
```

## Example: PROJECT Use Case

Original Problem: Test precondition said `ldmlan = 6000` but code had `ldmlan <> 6000`

**QA Output:**

```
ERROR: TestPreconditionValidator
├── Field: ldmlan
├── Precondition: 6000
├── Code Filter: <> 6000
└── Suggestion: Update precondition to ldmlan <> 6000
```

## Tests Included

```bash
# Run all QA tests
npm test -- tests/qa-*.test.js

# Run specific test
npm test -- tests/qa-stage-registry.test.js
```

## Next Steps

1. **Review documentation:** See `src/qa/IMPLEMENTATION_GUIDE.md` and tests for details.
2. **Try it out:** Run QA on an existing analysis
3. **Enable validators gradually:** Start with one, add more as needed
4. **Integrate with CI/CD:** Use `--strict STRICT` in pipelines

## Files Added

**Core Implementation (11 files):**

- `src/qa/qaStageRegistry.js`
- `src/qa/qaStageRunner.js`
- `src/qa/qaIntegration.js`
- `src/qa/qaValidators/testPreconditionValidator.js`
- `src/qa/qaValidators/regressionRiskAnalyzer.js`
- `src/qa/qaValidators/sqlConsistencyValidator.js`
- `src/qa/qaValidators/ibmiPlatformChecker.js`
- `src/qa/qaPromptTemplates/qa-review.md`
- `src/cli/commands/qaCommand.js`
- `src/report/qaReportGenerator.js`

**Tests (3 files):**

- `tests/qa-stage-registry.test.js`
- `tests/qa-stage-runner.test.js`
- `tests/qa-report-generator.test.js`

**Documentation:**

- `docs/quickstart/qa-quickstart.md` (this file)
- `src/qa/IMPLEMENTATION_GUIDE.md` (implementation details)

**Modified (2 files):**

- `cli/zeus.js` - Added QA command routing
- `config/profiles.example.json` - Added QA config section

## Safety Guarantees

✅ **No existing code modified** (except CLI routing)
✅ **All QA stages disabled by default**
✅ **QA failures don't crash main pipeline**
✅ **Error isolation in place**
✅ **Backward compatible**

## Support

For issues or questions, refer to:

- Test examples: `tests/qa-*.test.js`
- CLI usage: `node cli/zeus.js qa --help`
- Implementation: `src/qa/IMPLEMENTATION_GUIDE.md`

---

**Welcome to better QA!**
