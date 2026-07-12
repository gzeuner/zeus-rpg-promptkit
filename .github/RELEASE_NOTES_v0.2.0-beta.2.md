## Zeus RPG PromptKit 0.2.0-beta.2

Hardened beta with complete MCP test coverage and deterministic test discovery.

**Purpose of Beta 2**
- Restore and harden the full MCP server test suite and contract validation.
- Introduce deterministic recursive test discovery with omission/duplicate failure gates.
- Update all GitHub Actions to current Node-24-based implementations with immutable pins.
- Add release preflight, SBOM, SHA-256 checksums, and build-provenance attestation.
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
# attestation (after download)
gh attestation verify zeus-rpg-promptkit-0.2.0-beta.2.tgz --repo gzeuner/zeus-rpg-promptkit
# smoke from tarball only
mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install ../zeus-...tgz && ./node_modules/.bin/zeus --help
```

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
