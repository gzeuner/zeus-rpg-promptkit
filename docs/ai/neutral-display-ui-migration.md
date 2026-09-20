---
Title: Neutral Display-File UI Migration
Description: Migration and discovery guide for the neutral display-file UI surface.
---

# Neutral Display-File UI Migration

The display-file UI capabilities now use neutral public names. The behavior is
unchanged: local inspection, structured JSON projection, round-trip checks,
validated edits, import/export, and the privacy boundary remain available.

## Canonical agent surface

Use the CLI names below as the authoritative interface:

```text
node cli/zeus.js display-ui-inspect --file <path> --json
node cli/zeus.js display-ui-edit --file <path> --action <action> --json
```

The corresponding optional MCP tools are:

```text
zeus.display-ui-inspect
zeus.display-ui-edit
```

Discover the current actions and safety metadata instead of inferring options:

```text
node cli/zeus.js tools guide --json
node cli/zeus.js tools list --json
node cli/zeus.js docs:generate-catalog --check
```

## Repository layout

- `src/displayUi/` contains the local parser, projection, edit, and structured
  interchange modules.
- `src/cli/commands/displayUiEditCommand.js` and
  `src/cli/commands/displayUiInspectCommand.js` contain the CLI adapters.
- `src/knowledge/extractors/displayUiPatternExtractor.js` and
  `src/knowledge/extractors/displayUiBatchExtractor.js` provide the privacy-gated
  neutral extraction path.
- `tests/display-ui-*.test.js` covers the public behavior and safety boundary.

## Compatibility and safety

The public command and tool names are now canonical neutral names. Callers should
discover these names from the live catalog and update stored prompts or scripts
accordingly; no undocumented aliases are maintained.

The feature remains local-first and evidence-first. Raw display-file UI content,
source paths, credentials, environment details, and project-specific identifiers
must not be placed in shareable knowledge artifacts. Use the privacy checks and
the generated catalog before sharing results.

This project describes technical behavior only. It does not claim affiliation,
endorsement, or compatibility with a particular vendor product.
