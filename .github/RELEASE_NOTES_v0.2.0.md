# Zeus RPG PromptKit 0.2.0

Stable Community release after the beta.5 freeze.

## Highlights

- explicit Community/Commercial host integration with fail-closed entitlement behavior;
- Project Intelligence Community contracts and local engines remain usable without Commercial;
- safe Windows company-pilot documentation for local, read-oriented evaluation;
- reproducible package, deployment, release-integrity, SBOM, checksum, and provenance gates.

## Safety and scope

- Commercial modules are never auto-discovered or auto-registered;
- license files and public keys are explicitly configured and remain outside the Community repository;
- private signing keys and internal license-management scripts are not part of the published package;
- write, index, S3/S4 mutation, and live Package 09 paths remain explicit and operator-gated;
- Project Intelligence is not a source of truth and does not compile, deploy, or execute live IBM i.

## Verification

The release workflow validates the exact `main` commit, runs the full quality/test/audit gates, builds one tarball, emits a CycloneDX SBOM and SHA256SUMS, verifies build provenance, and verifies the published assets from a fresh download.
