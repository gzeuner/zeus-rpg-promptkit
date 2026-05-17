---
Title: Scanner Corpus
Description: Interne technische Dokumentation zu Architektur, Vertragen und Implementierungsdetails.
Last Updated: 2026-05-17
---

# Scanner Corpus

The scanner corpus is a deterministic regression fixture set for RPG, SQLRPGLE, and ILE detection behavior.

Current location:

- `tests/fixtures/sanitized-corpus/scanner/core-patterns.json`

Current scope:

- free-form RPG
- fixed-form RPG
- SQLRPGLE SQL table detection
- SQL uncertainty markers: `DYNAMIC_SQL`, `UNRESOLVED_SQL`, `UNRESOLVED_TABLES`, `UNRESOLVED_LIBRARY`
  - `UNRESOLVED_LIBRARY` wird gesetzt wenn SQL-Tabellennamen kein Schema-Praefix haben (z.B. `FROM CUSTOMERS` statt `FROM APPDATA.CUSTOMERS`)
- ILE module, binder, and binding-directory patterns

Runner:

- `tests/scanner-corpus.test.js`
- `npm run test:corpus`

Design notes:

- corpus inputs are synthetic sanitized fixtures authored in-repo for regression coverage
- fixture expectations focus on stable scanner contracts such as tables, calls, copy members, source types, procedures, prototypes, modules, service programs, and binding directories
- the corpus is intended to fail CI with readable mismatch diagnostics when scanner behavior changes unexpectedly

External references and licensing:

- the current corpus does not embed third-party copyrighted source members
- pattern categories were selected to reflect common IBM i RPG and ILE constructs, but the fixture text itself is original repository content
- if future corpus cases import external examples, the source, license, and sanitization notes must be recorded in this file before those fixtures are committed
