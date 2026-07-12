# Security Analysis — IBM i RPG Program

Program: `{{program}}`

## Summary

{{summary}}

## Risk Markers

{{riskMarkers}}

## Uncertainty Markers

{{uncertaintyMarkers}}

## SQL Statements (Focus: Injection, Unresolved, Dynamic)

{{sqlStatements}}

## Program and Procedure Calls (Focus: Unresolved, External)

{{programCalls}}

## Native Files (Focus: Mutating, Unprotected I/O)

{{nativeFiles}}

## Tables in Scope

{{tables}}

## Error Handling Paths

{{evidencePackSummary}}

## Evidence Highlights

```text
{{sourceSnippet}}
```

## Contract Budget

{{contractBudget}}

Produce a security-focused analysis of this IBM i RPG program covering:

### 1. SQL Injection and Dynamic SQL Risks

- Identify any PREPARE/EXECUTE patterns with host-variable-built statements
- Flag any unresolved table references in SELECT/INSERT/UPDATE/DELETE
- Check SQLSTATE / SQLCOD handling after every SQL statement block

### 2. Input Validation Gaps

- Identify parameters or externally-provided values passed to SQL or CALL without sanitization
- Check for missing length validation before moves (MOVE/MOVEL/EVAL with potential overflow)
- Look for indicators used as security gatekeepers that could be bypassed

### 3. Authorization and Access Control

- Flag any CALL to external programs with user data without authority checks
- Check for hard-coded library/schema assumptions that bypass authority checks
- Identify native file I/O to sensitive files (keyed = YES, mutating = YES) without pre-check

### 4. Error Handling and Disclosure

- Identify ON-ERROR / MONITOR blocks that swallow errors silently
- Flag cases where SQLSTATE error codes are ignored
- Check for cases where error messages expose internal paths, library names, or schema details

### 5. Commitment Control

- Verify that WRITE/UPDATE/DELETE operations use appropriate commitment control
- Flag any mixed commit/non-commit scenarios that could corrupt data consistency

For each finding, cite the evidence ID (EVxxxx) and file/line from the evidence highlights above.
