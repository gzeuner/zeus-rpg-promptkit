# Changelog

All notable changes to Zeus RPG PromptKit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta.2] - 2026-07-12

Hardened beta with complete MCP test coverage, deterministic recursive test discovery, and Node-24-based CI actions.

### Fixed

- restored the full MCP server test suite;
- fixed MCP capability dispatch for checklist, QA and risk-assessment adapters;
- restored structured MCP payload and validation contracts;
- removed the MCP test exclusion;
- removed Windows-invalid tracked generated cache paths;
- repaired incomplete quality-hardening behavior.

### Added

- deterministic recursive test discovery;
- test-category integrity checking;
- omission and duplicate-classification failure gates;
- governed temporary test-exception validation;
- complete file-level test summaries;
- explicit core typecheck scope guard;
- repository portability checks.

### Changed

- hardened formatting, lint and typecheck commands;
- made failure propagation explicit;
- extended CI validation across Linux Node 20, Linux current LTS and Windows;
- made generated documentation checks leave tracked catalog files clean;
- updated GitHub Actions to supported Node-24-based implementations;
- hardened release consistency and artifact verification.

### Known Limitations (Beta)

- type checking currently covers the declared core contract subset, not the complete JavaScript repository;
- some legacy `no-unused-vars` exceptions remain outside the hardened paths;
- selected remote IBM i and Db2 behavior still requires environment-specific validation;
- experimental surfaces remain experimental as documented.

## [0.2.0-beta.1] - 2026-07-12

This is the first governed prerelease after completing the implementation pack (packages 01–13).

### Added

- Unified capability registry as the foundation for CLI, API, and MCP surfaces (packages 05, 08, 09).
- Investigation sessions with focus, search, provenance, and additive events (package 04 + 08).
- Full migration of analysis and review workflows (impact, risk, test generation, checklists, QA) through capabilities (packages 07, 08).
- MCP surface generated from capabilities (package 09) with safe default allowlist.
- Comprehensive CI quality and release gates: format, lint, typecheck, full test matrix (Linux/Windows, Node 20/LTS), package smoke, docs check (package 10).
- Golden corpus with measurable quality metrics (precision/recall proxies, unresolved, reproducibility, safe-sharing leakage) and evaluator (package 11).
- Canonical "evidence investigation golden path" documentation: 5-minute entry point + detailed tutorial covering question → analyze → investigate → impact/risk → generate → bundle → verify (package 12).
- Local offline `docs:check` smoke test for documentation and examples.
- `test:quality` and expanded test scripts.

### Changed

- Package description updated to "Evidence and Investigation Platform for IBM i — turn source, metadata and runtime evidence into reproducible, review-ready artifacts with humans in control."
- All core surfaces (CLI commands, MCP tools) now route through the capability registry where applicable.
- Documentation hub, quickstarts, and README aligned to the golden path and consistent safety-first language.
- Demo scripts extended to demonstrate the full investigation-to-bundle journey on the public mini-system.
- Tool catalog and generated docs kept up-to-date via generator.

### Fixed / Improved

- Numerous boundary, reproducibility, and safe-sharing tests strengthened.
- CI now enforces least-privilege, concurrency cancellation, and full gates on every PR and main push.
- Generated artifacts (catalogs, etc.) are always produced through their official generators.

### Known Limitations (Beta)

- Some advanced Db2 catalog and remote features are best-effort or require explicit profile/credentials.
- Certain investigation features (full remote xref, PUI editing) remain experimental.
- MCP server is local-only (stdio transport); no remote transport in this release.
- The project does not yet publish to npm by default (GitHub prerelease + tarball is the supported distribution for beta).
- Versioned contracts are in place; some surfaces may evolve during the 0.2 beta series.

### Compatibility

- Node.js >= 20
- Java 11+ (for optional components)
- CLI, API (`require('zeus-rpg-promptkit/api')`), and MCP interfaces are the primary supported surfaces.
- All contracts from packages 01–12 are considered stable for this beta unless explicitly marked experimental in docs/tool-catalog.md.

### Security & Safety

- Default MCP allowlist remains least-privilege (read-mostly + explicitly gated write tools).
- `--safe-sharing` mode and redaction are the recommended path for any external sharing.
- No production writes or autonomous execution are performed.
- All tests and demos run without real IBM i credentials unless the user explicitly provides them.

See the [GitHub release](https://github.com/gzeuner/zeus-rpg-promptkit/releases) and `docs/` for full details.

## [0.1.0] - Earlier

Initial public development version with core analysis, investigation primitives, and safety model.
