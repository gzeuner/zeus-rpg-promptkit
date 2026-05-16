# Viewer Asset Strategy

The generated `architecture.html` artifact is intended to be portable and usable in restricted local environments. It therefore cannot depend on a CDN-hosted runtime script.

## Current strategy

- `architecture.html` is generated as a self-contained local artifact
- the viewer bundles `vis-network` inline at generation time
- the pinned package version comes from the project dependency lockfile
- no extra local server or adjacent asset directory is required for basic viewing

## Why inline instead of CDN

- offline corporate environments often block external package CDNs
- bundled analysis ZIP files should remain usable after being copied elsewhere
- a pinned dependency avoids future behavior drift from whatever version a CDN serves later
- safe-sharing artifacts should preserve the same local usability contract

## Bundled library details

Current bundled source:

- package: `vis-network`
- asset path: `vis-network/standalone/umd/vis-network.min.js`
- source mode: inline in generated HTML

The analyzer also records viewer asset metadata in the artifact-writer stage metadata so manifests and diagnostics can show which viewer asset version was used for a run.

## Licensing note

`vis-network` is distributed under a dual `(Apache-2.0 OR MIT)` license according to the package metadata currently pinned in this repository.

Implications for Zeus:

- the project pins the library version in `package.json` / `package-lock.json`
- generated HTML includes the bundled runtime bytes needed for local use
- future dependency upgrades should review the package metadata again before changing the pinned version

## Verification

Offline viewer verification currently checks that:

- generated `architecture.html` contains no external `<script src=...>` reference
- the old CDN URL is absent
- smoke and reproducibility tests continue to pass with the self-contained viewer artifact
