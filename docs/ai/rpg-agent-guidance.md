---
Title: RPG Agent Guidance (project-neutral)
Description: Compact, safe RPG/ILE patterns and modernization notes for AI agents using Zeus evidence.
Last Updated: 2026-06-20
---

# RPG / ILE Guidance for AI Agents (Evidence-first)

Use only when working from Zeus-generated artifacts (canonical-analysis, rpgConstructs, reports). Never guess semantics.

## Key Evidence to Trust
- `rpgConstructs.languageFeatures`: counts + lists of %BIFs and *INxx indicators extracted from source.
- Procedures: name, exported, paramCount, hasPi, returnType, sourceForm.
- nativeFileAccesses + nativeFiles: real I/O opcodes used (CHAIN/READ/WRITE etc).
- sqlStatements: embedded SQL with host vars, tables, cursor actions.
- procedureCalls with resolution (INTERNAL/EXTERNAL/DYNAMIC/UNRESOLVED).

## Safe Patterns (Modern ILE Free Form)
- Replace global *INxx state machines with local qualified data structures or named booleans / indicators DS.
- *INLR = *ON belongs at end of main linear main; avoid in subprocedures unless cycle semantics required.
- Prefer `dcl-proc ... export;` + `dcl-pi ... end-pi;` with explicit types over implicit *ENTRY PLIST.
- Use `ctl-opt dftactgrp(*no) actgrp('QILE');` or named activation group for service programs.
- SQL host vars: always declare with same type/length as column; use `exec sql` blocks, handle SQLSTATE/SQLCOD explicitly.
- For native I/O + SQL mix: keep clear ownership; document when a file is still keyed native vs external described SQL.

## BIFs – Common and Preferred
- %TRIM, %TRIML, %TRIMR over manual substring for strings.
- %DATE, %TIME, %TIMESTAMP, %DEC, %CHAR with format for conversions.
- %SCAN / %CHECK / %CHECKR for search.
- %SUBST for slices (note 1-based in RPG).
- %ELEM, %SIZE, %LEN for arrays/DS.
- %ERROR, %FOUND, %EOF, %STATUS after I/O or opcodes – always check after CHAIN/READ/WRITE etc.

## Indicators – Modernization
- *IN01-*IN99: treat as booleans in DS.
- *INLR, *INOF, *INRT: special last record / overflow / return.
- Avoid *IN as control flow for new code; map to IF conditions early.

## Procedure / Call Rules
- Internal calls: resolved to local dcl-proc.
- External calls via prototype with extproc/extpgm.
- Dynamic calls: high risk – surface in riskMarkers.
- When suggesting new procedure: provide dcl-pr + dcl-pi snippet + matching dcl-proc body using same naming.

## Common Legacy Risks (Call Out)
- Cycle programming assumptions (*INLR flow).
- Unqualified table refs (use resolved evidence + DB2 catalog).
- Fixed format column math in C specs.
- Global fields modified across subroutines.
- Missing error handling after every native I/O or EXEC SQL.

## Agent Rules When Proposing RPG Changes
1. Quote exact source evidence line + file from artifacts.
2. Show minimal diff or before/after snippet.
3. State impact on callers, files, indicators, SQL.
4. Provide compile-safe ILE free form when possible.
5. Always note required human review + test on real IBM i.
6. For modernization: propose narrow, testable increments (one file or one proc at a time).

Never output ungrounded RPG code. Always tie back to Zeus evidence ids or snippets.
