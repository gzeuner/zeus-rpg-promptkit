---
Title: External Module Registration
Description: How trusted in-process modules register against Zeus Community Core without core license enforcement.
Last Updated: 2026-07-19
---

# External Module Registration (Community Core)

This guide describes the **public neutral module boundary** introduced in Iteration 30.
It implements the executable subset of [ADR-006](../architecture/adr-006-commercial-extension-architecture.md).

## Core principles

- Zeus Community Core remains fully useful **without** any external module.
- Registration is **explicit and trusted**: the host imports an installed package and calls
  `registerModule({ descriptor, register })`.
- The core **never** scans directories, environment paths, or marketplaces, and never
  dynamically loads untrusted module names.
- `edition` and `entitlement.mode` are **display/classification metadata only**. The core does
  **not** parse license keys, validate signatures, or unlock paid features.
- Entitlement enforcement belongs in the external module (for commercial packages).
- Module code runs with the same process rights as the host. Loading arbitrary third-party code
  is **not** a security sandbox.

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

Registration is **atomic**: on failure, the module is not listed and capabilities are not
committed. The core continues to serve Community analysis and existing user artifacts.

## Availability reason codes

Public status uses fixed redacted codes such as `AVAILABLE`, `NOT_INSTALLED`,
`INCOMPATIBLE_CORE`, `DESCRIPTOR_INVALID`, `REGISTRATION_FAILED`, `RUNTIME_UNAVAILABLE`,
`POLICY_DENIED`, `ENTITLEMENT_REQUIRED`, `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_INVALID`.

Entitlement-related codes may be **reported by modules** for UI honesty. The core does not
evaluate licenses to produce them.

## Contract Test Kit

```js
const { runModuleContractTests } = require('zeus-rpg-promptkit/module-contract-test');
await runModuleContractTests();
```

The kit contains no commercial implementation and no signing keys.

## Failure isolation

If a module is missing, incompatible, or fails registration:

- Community commands, evidence, and artifacts remain available;
- only the module's capabilities are absent;
- diagnostics are redacted (no secrets, license keys, customer IDs, or local paths).
