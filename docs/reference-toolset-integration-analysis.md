# Reference Toolset Integration Analysis

## Purpose

This note captures what Zeus should learn from the supplied IBM i reference toolset without inheriting its case-specific content or operational shortcuts.

The reference archive confirms the project direction:

- Zeus should be an IBM i analysis system, not just a prompt file generator
- the highest-value next steps are richer IBM i semantics, better workflow packaging, and safer output sharing
- reference ideas must be generalized before they enter the repository

## Current Zeus Position

Zeus already has the correct architectural spine:

- `fetch -> analyze -> impact -> bundle` is a coherent CLI-first workflow
- `canonical-analysis.json` is a credible semantic source of truth
- reports, prompts, graphs, manifests, and bundles are already produced from structured analysis outputs
- IBM i transport and DB2 integration are isolated behind helper services instead of being spread across the Node.js codebase

This means the project does not need a restart. It needs targeted enrichment and workflow hardening.

## Reusable Reference Patterns

The following ideas are worth adapting into Zeus.

### 1. Richer DB2 catalog intelligence

The reference toolset leans heavily on IBM i catalog views rather than plain JDBC metadata. Zeus should adopt the same architectural direction for:

- SQL name plus system name identity
- descriptive text and object type
- estimated row counts
- derived objects such as logical or view-style dependents
- trigger metadata
- richer foreign-key semantics

This aligns directly with:

- [#86](https://github.com/gzeuner/zeus-rpg-promptkit/issues/86)
- [#85](https://github.com/gzeuner/zeus-rpg-promptkit/issues/85)
- [#87](https://github.com/gzeuner/zeus-rpg-promptkit/issues/87)

### 2. Catalog-backed resolution for missing source

The reference scripts use IBM i object and routine metadata to answer questions even when source is incomplete. Zeus should generalize that idea to classify unresolved external references instead of leaving them as anonymous calls whenever source is missing.

This aligns with:

- [#88](https://github.com/gzeuner/zeus-rpg-promptkit/issues/88)
- [#70](https://github.com/gzeuner/zeus-rpg-promptkit/issues/70)

### 3. Search-oriented workflows

The reference archive is strong at investigative search:

- scanning for IFS paths
- broad full-text search
- targeted read-only diagnostics

Zeus should adapt these as first-class workflows with structured outputs instead of ad-hoc script execution.

This aligns with:

- [#89](https://github.com/gzeuner/zeus-rpg-promptkit/issues/89)
- [#90](https://github.com/gzeuner/zeus-rpg-promptkit/issues/90)
- [#91](https://github.com/gzeuner/zeus-rpg-promptkit/issues/91)

### 4. Task-specific prompt and report discipline

The reference prompt files are too case-specific to reuse directly, but they do validate a useful idea: prompts should be specialized by workflow, not only by generic template name.

Zeus should keep its structured artifact model and continue toward:

- workflow-specific context projection
- evidence-backed prompt contracts
- prompt and report variants that match concrete investigation tasks

This aligns with:

- [#73](https://github.com/gzeuner/zeus-rpg-promptkit/issues/73)
- [#74](https://github.com/gzeuner/zeus-rpg-promptkit/issues/74)
- [#75](https://github.com/gzeuner/zeus-rpg-promptkit/issues/75)
- [#76](https://github.com/gzeuner/zeus-rpg-promptkit/issues/76)

### 5. Safe sharing and sanitized fixtures

The reference archive also shows the risk surface clearly: logs, prompt files, and examples can expose business names very quickly.

Zeus should treat sanitization as a first-class architecture concern for:

- prompts
- reports
- bundles
- fixtures
- issue drafting

This aligns with:

- [#92](https://github.com/gzeuner/zeus-rpg-promptkit/issues/92)
- [#94](https://github.com/gzeuner/zeus-rpg-promptkit/issues/94)

## What Zeus Should Not Reuse

The following reference patterns are not good targets for direct adoption.

### 1. Case-specific scripts, prompts, and logs

Do not import:

- one-off batch wrappers
- investigation-specific SQL scripts
- program-specific prompts
- example logs

They are useful as architectural inspiration only.

### 2. Hardcoded environment assumptions

Do not reuse:

- workspace-specific paths
- hardcoded library defaults
- machine-local dependency locations
- manual operator steps as the primary workflow contract

Zeus should stay profile-driven and repository-local.

### 3. Monolithic scan scripts

The reference archive includes a large mixed-responsibility script for FTP download, remote IFS scan, local scan, and reporting. Zeus should not collapse its architecture into one script-shaped workflow. The current staged pipeline is stronger and should remain modular.

### 4. Raw logs as the main product

The reference toolset uses log files as a primary output. Zeus should keep manifests, JSON artifacts, and deterministic Markdown as the source of truth. Logs are supporting diagnostics, not the contract.

### 5. Direct member download as plain `.txt`

The reference fetch workaround stores source members as `.txt` to avoid editor side effects. Zeus should not adopt that approach because:

- source type is valuable analysis metadata
- the current scanner relies on meaningful extensions
- typed source handling is necessary for future CL, DDS, and SQL-specific analyzers

## Windows Readability and Charset Findings

### Current strengths

Zeus already does several important things right:

- it exports to IFS first instead of depending on direct member download semantics
- it defaults to `CCSID 1208` for stream-file export
- it has a JDBC fallback for problematic member export cases
- it validates imported files before analysis and records manifest metadata

### Current gap

The current implementation is not fully consistent when a non-UTF-8 stream-file CCSID is configured:

- fetch allows any positive `streamFileCcsid`
- analyze accepts only UTF-8 input
- the JDBC fallback writes UTF-8 bytes even when another CCSID is configured

That means the repository currently has one fully trusted local analysis contract:

- exported local source should be UTF-8 and Windows-readable
- operationally, that means `CCSID 1208` should be treated as the only supported contract until broader multi-CCSID handling is implemented end to end

### Required next steps

The roadmap should explicitly treat the following as near-term work:

- finish the UTF-8 import contract and source normalization track
- add transport parity and encoding regression coverage
- record stronger encoding evidence in import metadata
- keep Windows-readable output as a non-negotiable success criterion

This aligns with:

- [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55)
- [#56](https://github.com/gzeuner/zeus-rpg-promptkit/issues/56)
- [#57](https://github.com/gzeuner/zeus-rpg-promptkit/issues/57)
- [#93](https://github.com/gzeuner/zeus-rpg-promptkit/issues/93)

## Recommended Integration Sequence

### Phase 1: Finish source trust and Windows readability

Ship a single trusted local source contract before expanding semantics further.

Priority issues:

- [#55](https://github.com/gzeuner/zeus-rpg-promptkit/issues/55)
- [#56](https://github.com/gzeuner/zeus-rpg-promptkit/issues/56)
- [#57](https://github.com/gzeuner/zeus-rpg-promptkit/issues/57)
- [#58](https://github.com/gzeuner/zeus-rpg-promptkit/issues/58)
- [#93](https://github.com/gzeuner/zeus-rpg-promptkit/issues/93)

### Phase 2: Raise IBM i semantic fidelity with catalog intelligence

Make DB2 and external object metadata materially richer.

Priority issues:

- [#86](https://github.com/gzeuner/zeus-rpg-promptkit/issues/86)
- [#85](https://github.com/gzeuner/zeus-rpg-promptkit/issues/85)
- [#87](https://github.com/gzeuner/zeus-rpg-promptkit/issues/87)
- [#88](https://github.com/gzeuner/zeus-rpg-promptkit/issues/88)

### Phase 3: Add search and investigation workflows

Give users a practical workflow surface for early-stage debugging and modernization work.

Priority issues:

- [#89](https://github.com/gzeuner/zeus-rpg-promptkit/issues/89)
- [#90](https://github.com/gzeuner/zeus-rpg-promptkit/issues/90)
- [#91](https://github.com/gzeuner/zeus-rpg-promptkit/issues/91)
- [#76](https://github.com/gzeuner/zeus-rpg-promptkit/issues/76)

### Phase 4: Protect shared outputs and improve evaluation quality

Make the system safer to use on real project data.

Priority issues:

- [#92](https://github.com/gzeuner/zeus-rpg-promptkit/issues/92)
- [#94](https://github.com/gzeuner/zeus-rpg-promptkit/issues/94)
- [#47](https://github.com/gzeuner/zeus-rpg-promptkit/issues/47)

## Bottom Line

The reference toolset should influence Zeus in three ways:

- richer IBM i catalog usage
- better search and diagnostic workflows
- stronger confidentiality and Windows-readability discipline

It should not pull Zeus toward script sprawl, case-specific assets, or log-centric contracts.
