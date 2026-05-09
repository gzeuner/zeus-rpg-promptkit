# QA Review Prompt Template

## Context

This template is used to generate AI-assisted QA reviews based on QA validation results.

## Template Variables

- `{{summary}}` - Executive summary of findings
- `{{criticalIssues}}` - Critical issues only
- `{{recommendations}}` - Recommendations from validators
- `{{riskLevel}}` - Regression risk level
- `{{affectedTests}}` - Tests that may be affected

## Content

---

# QA Validation Review

## Executive Summary

{{summary}}

## Critical Findings

{{criticalIssues}}

## Regression Risk Assessment

Risk Level: {{riskLevel}}

Potentially Affected Tests:
{{affectedTests}}

## Recommendations

{{recommendations}}

## Next Steps

1. Review all critical findings
2. Update test preconditions or code as needed
3. Re-run affected test cases
4. Verify no regression in passing tests

---
