## Zeus RPG PromptKit 0.2.0-beta.4

Public Community beta after Tracks B–E on top of the beta.3 Project Intelligence baseline.

**Purpose of Beta 4**

- Ship post-beta.3 operator and PI depth surface without cutting a non-beta `0.2.0` yet.
- Make commercial host wiring ergonomic via explicit `profile.commercial` (CLI → env → profile).
- Add portable snapshot export packaging, offline corpora fixtures, and embeddings **default off**.
- Align ADR-009…013 bodies with accepted + delivered status.
- Keep the hardened single-artifact release workflow (checksum, SBOM, build-provenance attestation).

**Major additions since Beta 3**

- Loader UX: `profile.commercial` for package path, module keys, and license path fields.
- PI export: `exportPortableSnapshotPackage` / `openPortableSnapshotPackage` (redacted, offline).
- PI corpora: `listCorpora` / `materializeCorpus` (`mini-multi-program-rpg`).
- Embeddings policy: `resolveEmbeddingPolicy` — storage opt-in only; Community ranking stays lexical.
- Architecture ADR hygiene (009–013 delivery pointers).
- Freeze readiness notes for a future owner-gated `0.2.0` cut.

**Non-claims**

- Project Knowledge is not source of truth; preserved source evidence remains authoritative.
- Not a compile, deploy, or live IBM i execution product.
- Community adapters contain no paid commercial implementation.
- Core does not enforce commercial licenses (ADR-006).
- Benchmark numbers are evidence, not production guarantees.
- This is a **prerelease** — not production certification of `0.2.0`.

**Installation from GitHub release tarball (recommended for beta)**

```bash
npm install https://github.com/gzeuner/zeus-rpg-promptkit/releases/download/v0.2.0-beta.4/zeus-rpg-promptkit-0.2.0-beta.4.tgz
```

**Verify the release**

```bash
# checksums
sha256sum --check SHA256SUMS
# smoke from tarball only
mkdir /tmp/verify && cd /tmp/verify && npm init -y && npm install ../zeus-rpg-promptkit-0.2.0-beta.4.tgz && ./node_modules/.bin/zeus --help
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

Prefer Beta 4 over Beta 3 for loader profile UX and PI export/corpora/embeddings policy. After
installing Beta 4, commercial packages must re-pin this Community release SHA before claiming
compatibility.

This is a **prerelease**. Contracts may still evolve before `0.2.0`.
