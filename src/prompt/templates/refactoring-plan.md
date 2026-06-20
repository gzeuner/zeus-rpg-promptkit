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
- the smallest safe refactoring candidates (prefer local procedures, then service program extraction)
- sequencing constraints created by data access, native I/O, indicators, and dependencies
- IBM i behaviors (LR, indicators, activation groups, file cursors) that must not regress
- concrete verification steps before and after the first change
Leverage any provided rpgConstructs (bifUsages, indicatorUsages, procedure paramCount/hasPi) for precision.
