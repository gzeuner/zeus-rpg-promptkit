## Zeus RPG PromptKit 0.2.0-beta.2

Hardened beta with complete MCP test coverage and deterministic test discovery.

**Purpose of Beta 2**
- Restore and harden the full MCP server test suite and contract validation.
- Introduce deterministic recursive test discovery with omission/duplicate failure gates.
- Update all GitHub Actions to current Node-24-based implementations with immutable pins.
- Add release preflight, SBOM, and SHA-256 checksums.
- Enforce identical tarball verification across Linux (Node 20 + LTS) and Windows.

**Major fixes since Beta 1**
- Full MCP test suite restored; capability dispatch and payload contracts repaired.
- Quality hardening completed; Windows-invalid cache paths removed.
- CI extended with explicit failure propagation and cross-platform coverage.

**Installation from GitHub release tarball (recommended for beta)**
```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.2.0-beta.2/zeus-rpg-promptkit-0.2.0-beta.2.tgz
```

**Verify the release**
```bash
# checksums
sha256sum --check SHA256SUMS
# smoke from tarball only
mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install ../zeus-...tgz && ./node_modules/.bin/zeus --help
```

**Historical provenance note**

The published v0.2.0-beta.2 tarball is checksum-verified, SBOM-verified and fresh-install verified.
Its SHA-256 is
`a14ffe303bc7158a2c0144e3d2a8e422b9301331175bd617b7364251a7f223ea`.

The artifact is byte-identical to a build from commit
`7345100964ed43166224e3b67847b036817554e5`. The immutable v0.2.0-beta.2 release tag points to
`6b0786becbb3d9044acc3b8628557fbb1a2c2f66`.

Because the tagged source and published artifact source do not match, no build-provenance
attestation is claimed for this historical prerelease. The tag and release assets remain
unchanged. Future releases require source SHA, release tag, artifact digest, SBOM and attestation
provenance to agree before publication. See the
[release-integrity policy](https://github.com/gzeuner/zeus-rpg-promptkit/blob/main/docs/maintainers/release-integrity.md).

**Supported environments**
- Node.js >= 20 (tested on 20 and current LTS)
- Linux and Windows runners in CI

**Known limitations**
- Type checking covers the declared core contract subset, not the complete JavaScript repository.
- Some legacy no-unused-vars exceptions remain outside hardened paths.
- Selected remote IBM i / Db2 behavior requires environment-specific validation.
- Experimental surfaces remain experimental as documented.

**Upgrade note**
Beta 1 (v0.2.0-beta.1) remains available as an immutable historical prerelease. Its tag and assets are unchanged. Use Beta 2 for the hardened test integrity and release artifacts.

This is a **prerelease**. Contracts may evolve before 0.2.0.
