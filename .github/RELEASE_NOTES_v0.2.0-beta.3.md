## Zeus RPG PromptKit 0.2.0-beta.3

Public Community beta after Zeus Project Intelligence (ZPI) delivery and the commercial host loader.

**Purpose of Beta 3**

- Ship the Project Intelligence Community baseline (contracts through engines, retrieval, and context packages).
- Provide thin CLI/MCP Project Intelligence adapters with commercial present/absent behavior only.
- Expose an explicit commercial module host loader (`createHostZeus` / `registerCommercialModules`) with no auto-discovery and no paid handlers in Community.
- Document ZPI closure status, non-claims, and the next-release maintainer checklist.
- Publish under the hardened single-artifact release workflow (checksum, SBOM, and build-provenance attestation required).

**Major additions since Beta 2**

- Project Intelligence: contracts, SQLite knowledge store, content-addressed store, pure-JS lexical search, snapshot/incremental engine, RPG/IBM i analyzer baseline, hybrid retrieval and context assembly.
- CLI: `zeus project-knowledge` thin adapter.
- MCP: `zeus.project-knowledge.*` tools and metadata resource when registered.
- API: `createHostZeus`, `registerCommercialModules`, and `zeus-rpg-promptkit/project-intelligence-contracts`.
- Hardening and benchmark evidence suites (metrics are evidence only, not SLAs).
- Public closure status: `docs/knowledgebase/zpi-closure-status.md`.

**Non-claims**

- Project Knowledge is not source of truth; preserved source evidence remains authoritative.
- Not a compile, deploy, or live IBM i execution product.
- Community adapters contain no paid commercial implementation.
- Core does not enforce commercial licenses (ADR-006).
- Benchmark numbers are evidence, not production guarantees.

**Installation from GitHub release tarball (recommended for beta)**

```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.2.0-beta.3/zeus-rpg-promptkit-0.2.0-beta.3.tgz
```

**Verify the release**

```bash
# checksums
sha256sum --check SHA256SUMS
# smoke from tarball only
mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install ../zeus-rpg-promptkit-0.2.0-beta.3.tgz && ./node_modules/.bin/zeus --help
```

**Provenance**

This release uses the hardened workflow: one immutable source commit on `main`, one npm tarball,
checksum file, CycloneDX SBOM, and build-provenance attestation for that same artifact. The
historical beta.2 attestation exception is **not** reused. See
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
Beta 2 (v0.2.0-beta.2) remains available as an immutable historical prerelease. Prefer Beta 3 for
Project Intelligence and the commercial host loader. After installing Beta 3, commercial modules
must pin this Community SHA before claiming compatibility.

This is a **prerelease**. Contracts may evolve before 0.2.0.
