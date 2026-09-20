# Zeus RPG PromptKit `0.3.0-rc.2`

This release candidate continues the Community feature cut after `0.3.0-rc.1`.

## Highlights

- CLI-first, evidence-backed process and glossary workflows remain available.
- Display-file UI inspection, structured projection, round-trip checks, and
  validated editing are exposed under neutral canonical command names.
- Agent orientation, migration guidance, generated catalogs, tests, and example
  artifacts are synchronized with the current public surface.
- Privacy gates continue to keep raw source content, credentials, environment
  details, and project-specific identifiers out of shareable knowledge artifacts.

## Canonical commands

```bash
node cli/zeus.js display-ui-inspect --file <path> --json
node cli/zeus.js display-ui-edit --file <path> --action <action> --json
```

See [`docs/ai/neutral-display-ui-migration.md`](../docs/ai/neutral-display-ui-migration.md)
and [`docs/tool-catalog.md`](../docs/tool-catalog.md) for the current agent contract.

## Verification

The release workflow runs the complete quality, safety, portability, package,
SBOM, checksum, provenance, and fresh-download verification gates before
publishing the single release artifact.

This is a prerelease candidate and does not replace the stable `0.2.0`
baseline until a subsequent stable release is explicitly published.
