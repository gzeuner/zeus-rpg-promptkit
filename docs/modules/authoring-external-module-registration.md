---
Title: External Module Registration
Description: How trusted in-process modules register against the public core without core license enforcement.
Last Updated: 2026-08-17
---

# External Module Registration (Public Core)

This guide describes the **public neutral module boundary** introduced in Iteration 30.
It implements the executable subset of [ADR-006](../architecture/adr-006-commercial-extension-architecture.md).

## Core principles

- The public core remains fully useful **without** any external module. Integrated built-in modules
  are the primary product path; this guide covers separately supplied extensions.
- Registration is **explicit and trusted**: the host imports an installed package and calls
  `registerModule({ descriptor, register })`.
- The core **never** scans directories for modules, never consults marketplaces, and never
  auto-loads packages by product ID. Optional CLI/MCP host wiring may load **one operator-specified**
  package name or filesystem path (see [External host loader](#external-host-loader-optional)).
- `edition` and `entitlement.mode` are **display/classification metadata only**. The core does
  **not** parse license keys, validate signatures, or unlock paid features.
- Entitlement enforcement belongs in the external module (for commercial packages).
- Module code runs with the same process rights as the host. Loading arbitrary third-party code
  is **not** a security sandbox.
- Every registered capability ID and version must exactly match one descriptor declaration. Extra,
  missing or version-mismatched capabilities reject the whole module.
- Capability safety may be stricter, never weaker, than module safety. Capability side effects
  must use the public vocabulary and be fully covered by the module aggregate declaration.

## Descriptor v1

Required shape (normalized):

```json
{
  "descriptorVersion": "zeus.module-descriptor/v1",
  "id": "vendor.module-name",
  "version": "1.0.0",
  "edition": "community",
  "compatibility": { "moduleApi": ">=1.0.0 <2.0.0" },
  "capabilities": [{ "id": "vendor.capability", "version": 1 }],
  "safety": { "level": "S1", "sideEffects": ["local-read"] },
  "runtime": { "requiredFeatures": ["local-filesystem"] },
  "entitlement": { "mode": "none" },
  "docs": { "title": "Example", "reference": "docs/modules/example.md" }
}
```

- `edition`: `community` | `professional` | `enterprise` (classification only).
- `entitlement.mode`: `none` | `module-managed` (no license material).
- Runtime features must come from the public allowlist (`local-filesystem`, `local-process`,
  `node-crypto`, `offline-only`).
- Capability side effects must come from exported `CAPABILITY_SIDE_EFFECTS`: `local-read`,
  `local-artifact-write`, `local-config-write`, `local-secret-write`, `local-listener`,
  `local-process-stdio`, `remote-read`, `remote-write`, or `operator-gated`.

## Registration API

```js
const { createZeus } = require('zeus-rpg-promptkit/api');
const zeus = createZeus();

const result = await zeus.modules.registerModule({
  descriptor: {/* ... */},
  register({ capabilityRegistry, module, coreModuleApiVersion }) {
    capabilityRegistry.register({
      id: 'vendor.capability',
      version: 1,
      title: 'Example',
      safety: { level: 'S1', sideEffects: ['local-read'], requiresExplicitApproval: false },
      availability: { api: true },
      execute: async () => ({ ok: true }),
    });
  },
  status: {
    availability: 'available',
    reasonCode: 'AVAILABLE',
  },
});
```

Registration is **atomic**: the callback first writes only to an isolated staging registry. The
host validates the complete capability ID/alias batch and publishes it in one transaction. A
conflict at any capability leaves host IDs, aliases, module list and module status unchanged. The
core continues to serve Community analysis and existing user artifacts.

## Availability reason codes

Public status uses fixed redacted codes such as `AVAILABLE`, `NOT_INSTALLED`,
`INCOMPATIBLE_CORE`, `DESCRIPTOR_INVALID`, `REGISTRATION_FAILED`, `RUNTIME_UNAVAILABLE`,
`POLICY_DENIED`, `ENTITLEMENT_REQUIRED`, `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_INVALID`.

Entitlement-, policy-, runtime-, and module-availability codes may be **reported by modules** for
UI honesty. The core does not evaluate licenses to produce them. Core-owned registration outcomes
such as `NOT_INSTALLED`, descriptor/API failures, duplicate IDs, capability conflicts, and
initialization failures cannot be supplied by a module. Unknown, core-owned, or secret-bearing
strings fail closed to `MODULE_UNAVAILABLE` and are never echoed.

## Contract Test Kit

```js
const { runModuleContractTests } = require('zeus-rpg-promptkit/module-contract-test');
await runModuleContractTests();
```

The kit contains no commercial implementation and no signing keys.

It exercises the executable public guarantees, including late multi-capability conflicts, closed
reason codes, exact capability versions and side-effect coverage.

## Failure isolation

If a module is missing, incompatible, or fails registration:

- Community commands, evidence, and artifacts remain available;
- only the module's capabilities are absent;
- diagnostics are redacted (no secrets, license keys, customer IDs, or local paths).

## External host loader (optional)

For CLI/MCP hosts that need separately supplied entitlement-managed wiring, use the explicit loader.
The integrated built-in registration path remains the recommended public-product path:

```js
const { createHostZeus } = require('zeus-rpg-promptkit/api');

const { zeus, commercial } = await createHostZeus({
  modulePath: process.env.ZEUS_COMMERCIAL_MODULE, // package name OR filesystem path (required to load)
  // entitlement material is passed through to the commercial package (module-managed):
  // licenseDocument / publicKeyPem, or paths via ZEUS_LICENSE_DOCUMENT_PATH + ZEUS_LICENSE_PUBLIC_KEY_PATH
});
```

CLI / env / profile surface (explicit only; highest precedence first):

| Input                                   | Meaning                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `--commercial-module <name-or-path>`    | explicit commercial package (also `ZEUS_COMMERCIAL_MODULE`)     |
| `ZEUS_LICENSE_DOCUMENT_PATH`            | path to signed offline license JSON (commercial package)        |
| `ZEUS_LICENSE_PUBLIC_KEY_PATH`          | path to verification public key PEM                             |
| `ZEUS_COMMERCIAL_MODULES`               | optional comma list of commercial module keys (package-defined) |
| `profile.commercial` (with `--profile`) | explicit profile object — same fields, lowest precedence        |

Profile example (private `profiles.json` only; use env placeholders for secrets/paths):

```json
{
  "dev": {
    "commercial": {
      "module": "${env:ZEUS_COMMERCIAL_MODULE}",
      "modules": ["project-intelligence"],
      "licenseDocumentPath": "${env:ZEUS_LICENSE_DOCUMENT_PATH}",
      "publicKeyPath": "${env:ZEUS_LICENSE_PUBLIC_KEY_PATH}"
    }
  }
}
```

Then:

```bash
zeus project-knowledge discover --profile dev --json
```

Precedence: **CLI / API options → environment variables → `profile.commercial`**.  
There is no marketplace, product-id auto-load, or directory crawl.

The commercial package must export:

```js
async function registerWithZeus(zeus, options) {
  /* register entitled modules */ return { ok: true };
}
module.exports = { registerWithZeus /* ... */ };
```

Rules:

- No load when CLI, env, **and** `profile.commercial.module` are all unset (Community-only behavior).
- No directory crawl and no marketplace resolution.
- Profile commercial fields are explicit operator config only (validated; unknown keys rejected).
- Absolute paths are redacted in loader diagnostics and `zeus profiles` output.
- Entitlement verification remains **inside** the commercial package.
