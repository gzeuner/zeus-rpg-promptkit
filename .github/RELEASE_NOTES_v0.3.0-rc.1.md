# Zeus RPG PromptKit `0.3.0-rc.1`

This release candidate is the next Community feature cut after `0.2.0`.

## Highlights

- Business Process Intelligence is available through the CLI and public API.
- Process retrieval supports `list`, `describe`, `query`, `impact`, and `diff`.
- Scoped Business Glossary / Legacy Vocabulary catalogs map local terminology
  without leaking project-specific knowledge into the public package.
- Ambiguous or stale knowledge is reported explicitly; the toolkit does not
  guess a process answer.
- AI-facing documentation is CLI-first and points agents to the authoritative
  command catalog, process guide, evidence rules, and experience loop.

## Quick start

```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.3.0-rc.1/zeus-rpg-promptkit-0.3.0-rc.1.tgz
node cli/zeus.js process list --catalog ./output/process-candidates.json --json
node cli/zeus.js process query \
  --catalog ./output/process-candidates.json \
  --glossary ./output/process-glossary.json \
  --question "What does interface <id> do?" \
  --json
```

Use [`docs/ai/process-intelligence.md`](../docs/ai/process-intelligence.md)
for the evidence model, glossary scopes, freshness rules, and review workflow.

## Verification

The release workflow runs the complete quality, safety, portability, package,
SBOM, checksum, provenance, and fresh-download verification gates before
publishing the single release artifact.

This is a prerelease candidate and does not replace the stable `0.2.0`
baseline until a subsequent stable release is explicitly published.
