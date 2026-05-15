# Program Modernization Analysis — IBM i RPG

Program: `{{program}}`

## Summary
{{summary}}

## Native Files and Operational Boundaries
{{nativeFiles}}

## Tables Used
{{tables}}

## Program and Procedure Calls
{{programCalls}}

## SQL Statements
{{sqlStatements}}

## Risk Markers
{{riskMarkers}}

## Uncertainty Markers
{{uncertaintyMarkers}}

## Evidence Pack Summary
{{evidencePackSummary}}

## Dependency Graph
{{dependencyGraphSummary}}

## Contract Budget
{{contractBudget}}

## Evidence Highlights
```text
{{sourceSnippet}}
```

Produce a modernization analysis for this IBM i RPG program covering all sections below.
Cite evidence IDs (EVxxxx) and file/line references for every claim.

### 1. IBM i Specific Behaviors to Preserve
- Native file I/O via RPG opcodes (CHAIN, SETLL, READ, WRITE, UPDATE, DELETE) — these are not equivalent to SQL and must be mapped explicitly
- Indicator logic (*IN01–*IN99, *INLR, *INOF) used for program flow or output formatting
- Fixed-format RPG column dependencies if present (form types H/F/D/I/C/O/P)
- CL command calls that trigger IBM i-specific system actions (SBMJOB, CALL, OVRDLKW, etc.)
- Physical and Logical File (PF/LF) access that implies implicit key ordering and record locking

### 2. Extraction Seams and Encapsulation Candidates
- Functions or subroutines that operate on a clearly scoped dataset → candidate service/module
- SQL-only access blocks → candidate for SQL abstraction layer
- Native I/O blocks over a single PF/LF → candidate for file abstraction layer
- CL→RPG call chains → candidate for orchestration separation

### 3. Data Access and Integration Constraints
- Tables accessed via both native I/O and SQL simultaneously → highest-risk migration target
- Files with multiple record formats → complex mappings in any ORM or REST layer
- Keyed-access files → must preserve key structure and access paths in target architecture
- Transaction boundaries (COMMIT/ROLLBACK) that span multiple files → must be preserved atomically

### 4. Highest-Risk Modernization Blockers
- Programs called dynamically (CALLP with variable target or CALL with *ENTRY) → cannot safely extract without dynamic dispatch support
- DYNAMIC_SQL markers → runtime-constructed queries that prevent static analysis
- Copy members (/COPY) shared across many programs → changing them is cross-cutting
- Interactive display files (EXFMT) → deep coupling to 5250 display semantics

### 5. Pragmatic First Modernization Step
Recommend ONE concrete, reversible first step based on the evidence above:
- Extract a clearly bounded SQL-access block to a new ILE procedure or service program
- Replace a native I/O loop with equivalent SQL (CHAIN → SELECT with key, READ → FETCH cursor)
- Wrap a CL call in an ILE module boundary to enable independent testing
- Add an SQL abstraction layer over a PF with highest sqlReferenceCount

Justify the recommendation with a specific evidence ID from the evidence highlights above.
