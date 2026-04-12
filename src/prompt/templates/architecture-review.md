# Architecture Review Prompt

Program: `{{program}}`

## Summary
{{summary}}

## Tables
{{tables}}

## Program Calls
{{programCalls}}

## Native Files
{{nativeFiles}}

## IFS Paths
{{ifsPaths}}

## Search Findings
{{searchResults}}

## Diagnostic Packs
{{diagnosticFindings}}

## Dependency Graph
{{dependencyGraphSummary}}

## Evidence Highlights
```text
{{sourceSnippet}}
```

Produce an architecture review covering:
- structural boundaries and dominant dependencies
- IBM i specific operational constraints
- unresolved edges or hotspots that weaken confidence
- the next investigation step justified by the cited evidence
