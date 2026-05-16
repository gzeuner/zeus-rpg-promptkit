# Safe Sharing

Use Zeus `--safe-sharing` mode before sharing generated artifacts outside the working repository.

## Purpose

Safe-sharing mode creates a parallel redacted artifact set under `output/<program>/safe-sharing/`.

It preserves:

- workflow structure
- graph shape
- evidence counts
- file and artifact contracts

It replaces:

- business-specific program, table, copy-member, module, and service-program identifiers
- source paths and imported member identity
- DB2 schema names when they appear in exported artifacts
- extracted data values and SQL string literals

## CLI Usage

Analyze with redacted variants:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --safe-sharing
```

Create a redacted bundle:

```bash
zeus bundle --program ORDERPGM --source-output-root ./output --safe-sharing
```

Run a preset and package only safe-sharing artifacts:

```bash
zeus workflow --preset modernization-review --source ./rpg_sources --program ORDERPGM --safe-sharing
```

## Artifact Contract

Safe-sharing mode writes:

- `safe-sharing/context.json`
- `safe-sharing/optimized-context.json` when available
- `safe-sharing/ai-knowledge.json`
- `safe-sharing/analysis-index.json`
- `safe-sharing/report.md`
- `safe-sharing/architecture-report.md`
- `safe-sharing/ai_prompt_*.md`
- `safe-sharing/dependency-graph.*`
- `safe-sharing/program-call-tree.*`
- `safe-sharing/architecture.html`
- `safe-sharing/analyze-run-manifest.json`
- `safe-sharing/redaction-manifest.json`

`safe-sharing/redaction-manifest.json` is safe to share. It records placeholder counts and generated safe-sharing files, but it does not contain reverse mappings back to the original identifiers.

## Repository Rules

- Do not copy raw prompts, reports, DB2 extracts, or bundle contents into GitHub issues when `--safe-sharing` output is available.
- Do not add non-redacted production-like fixture data to `tests/fixtures/`.
- Prefer safe-sharing artifacts when drafting issue summaries, bug reports, or architecture review packets.
- If a fixture or shared example needs data rows, use the redacted safe-sharing variant or a manually sanitized synthetic sample.

## Limits

- Safe-sharing mode is designed to preserve workflow usefulness, not to provide a legal or compliance certification.
- Review the redacted output before external sharing when repository-specific confidentiality requirements are strict.
