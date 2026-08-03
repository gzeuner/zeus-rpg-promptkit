# Zeus RPG PromptKit 0.2.0-beta.5

Agent-oriented Community beta after Tracks G and H0.

## Highlights

- zero-search MCP startup via zeus.agent.bootstrap and the agent-bootstrap resource;
- stable CLI help JSON and goal-based workflow suggestions;
- bounded MCP tool packs and PI agent fallback guidance;
- capability-surface parity metadata;
- clean production dependency audit, including the brace-expansion security fix;
- updated pinned GitHub Actions for CI and release automation.

## Safety and scope

- MCP defaults remain bounded and read-oriented;
- write, index, S3/S4 mutation, and live Package 09 paths remain explicit/owner-gated;
- Project Knowledge is not source of truth and this prerelease is not production certification;
- no paid implementation is added to the Apache-2.0 Community package.

## Verification

The release workflow validates the exact main commit, runs the full quality/test/audit gates,
builds one tarball, emits a CycloneDX SBOM and SHA256SUMS, and verifies build provenance before
publishing the prerelease assets.
