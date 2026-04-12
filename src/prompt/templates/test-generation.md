# Test Generation Prompt

Program: `{{program}}`

## Summary
{{summary}}

## Tables
{{tables}}

## SQL Statements
{{sqlStatements}}

## Search Findings
{{searchResults}}

## Diagnostic Packs
{{diagnosticFindings}}

## Test Data
{{testDataHint}}

## Evidence Highlights
```text
{{sourceSnippet}}
```

Produce test-generation guidance covering:
- highest-priority scenarios and edge cases
- data setup and fixture needs
- dependency seams that need stubbing or isolation
- assertions tied directly to the cited evidence
