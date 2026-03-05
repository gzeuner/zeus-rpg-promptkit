# RPG Error Analysis Prompt

You are troubleshooting RPG program `{{program}}` on IBM i.

## Tables in Scope
{{tables}}

## Program Calls in Scope
{{calls}}

## Copy Members in Scope
{{copyMembers}}

## SQL Statements in Scope
{{sqlStatements}}

## Source Snippet
```rpg
{{sourceSnippet}}
```

Analyze possible runtime and logic failures. Focus on file I/O issues, SQL failures, parameter mismatch in calls, and missing copy definitions. Provide diagnostics and remediation steps.