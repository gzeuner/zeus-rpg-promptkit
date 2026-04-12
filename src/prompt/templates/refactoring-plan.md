# Refactoring Plan Prompt

Program: `{{program}}`

## Summary
{{summary}}

## Tables
{{tables}}

## Program Calls
{{programCalls}}

## Native Files
{{nativeFiles}}

## SQL Statements
{{sqlStatements}}

## Diagnostic Packs
{{diagnosticFindings}}

## Risk Markers
{{riskMarkers}}

## Evidence Highlights
```text
{{sourceSnippet}}
```

Produce a pragmatic refactoring plan covering:
- the smallest safe refactoring candidates
- sequencing constraints created by data access and dependencies
- IBM i behaviors that must not regress
- concrete verification steps before and after the first change
