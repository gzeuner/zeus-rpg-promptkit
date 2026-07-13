# Release integrity policy

## General release-integrity policy

Every future release uses one immutable source commit and one package artifact. The release
workflow captures the source SHA before building, builds the npm tarball once, and passes that
same artifact to Linux Node 20, Linux current LTS, and Windows Node 20 verification. The checksum
file and CycloneDX SBOM describe that artifact and package version. Build-provenance attestation
covers the same tarball and must pass canonical verification for the expected repository and
signer workflow.

Only after those gates succeed may the workflow create a release tag targeting the captured
source SHA and publish the verified tarball, SBOM, and checksum file. Required integrity failures
are not suppressed, and an existing tag or release is never replaced.

## Historical release-integrity exception: v0.2.0-beta.2

Status: **ACCEPTED HISTORICAL EXCEPTION**

The following facts were independently verified:

- the immutable release tag points to
  `6b0786becbb3d9044acc3b8628557fbb1a2c2f66`;
- the published tarball SHA-256 is
  `a14ffe303bc7158a2c0144e3d2a8e422b9301331175bd617b7364251a7f223ea`;
- rebuilding the tagged commit produces SHA-256
  `f137b52ddc61ae4bae60484a0777028d73631094629f8bdd583a2909628b7a40`;
- the published tarball is byte-identical to a build from commit
  `7345100964ed43166224e3b67847b036817554e5`;
- its checksum, CycloneDX SBOM, clean installation, public API import, and installed CLI help were
  verified;
- no valid public artifact attestation exists and no build provenance is claimed;
- the release tag and release assets are intentionally unchanged.

The package-content difference observed between the tagged rebuild and published tarball was the
packaged repository workflow file `.github/workflows/release.yml`. This finding does not imply a
functional defect in the installed product package.

No retroactive attestation will be created. The owner accepts this immutable historical exception,
and the missing historical attestation no longer blocks subsequent product iterations after this
policy and the hardened future release workflow are merged and publicly documented. No future
release may use this exception.
