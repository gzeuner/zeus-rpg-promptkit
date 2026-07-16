---
Title: ADR-007 Provider-Neutral AI Contracts
Description: Versioned offline provider contracts, explicit trusted registration, private-by-default egress policy, redaction, and optional test doubles.
Last Updated: 2026-07-16
---

# ADR-007: Provider-Neutral AI Contracts

**Status:** Accepted and implemented as Community contracts and offline test infrastructure

## Context

Zeus prepares evidence and must remain fully useful when no AI provider is configured. Future local
and private adapters need one public contract boundary without making a model response evidence or
creating a second plugin, capability, policy, or commercial-management system.

ADR-006 defines explicit, trusted in-process extension and open-core ownership. This decision adds
only the provider-related extension point needed above the evidence layer. It does not implement the
future general module registrar described by ADR-006.

## Decision

### Versioned public contracts

The package registers version 1 schemas for:

- model, embedding, and vector-store descriptors;
- matching request and response envelopes;
- passive provider lifecycle, health, and availability status;
- egress policy and structured denial artifacts;
- redacted configuration provenance.

Persisted envelopes contain `schemaVersion: 1` and a stable `zeus.*@1` contract reference.
Descriptors also carry an independently stable `descriptorVersion`. Unknown top-level fields are
tolerated only as inert additive input and are not projected into normalized registry records.
Unknown major versions, enum values, or required classifications are rejected.

Requests identify the provider, model where applicable, correlation ID, payload classification, and
pre-existing evidence references. Responses retain the same identity and references, carry bounded
JSON-compatible output, and may include deterministic non-negative usage counts. Every response is
marked `advisory: true` and `sourceOfTruth: false`. A provider cannot invent evidence references or
turn its output into canonical evidence.

Request contract v1 deliberately models exactly one homogeneous content part as
`input: { classification, content }`. The input classification must equal the envelope
classification. The wrapper accepts no other content fields, and nested `classification` markers
are rejected. Content that requires different classifications must be split into separate requests
and independently pass policy. This conservative v1 decision prevents an envelope classification
from hiding mixed-class parts without introducing a second per-part policy system. It is an initial
contract decision, not a compatibility change to a previously released provider API.

### Registry and lifecycle

`providers.createRegistry()` creates an empty registry. Registration is an explicit call from
already imported, operator-trusted in-process code. Zeus performs no package scanning, dynamic
import, startup configuration lookup, provider selection, fallback, health probe, or network call.

One global provider-ID namespace covers `model`, `embedding`, and `vector-store`. A registration is
fully validated before the registry performs its single map mutation. Duplicate IDs, unsupported
descriptor versions, and malformed provenance reject the whole registration. Listing is stable by
kind and ID. `seal()` prevents late registration; version 1 has no unregister, replacement, or hot
reload.

Descriptors, status, and provenance are immutable defensive projections. Handlers and raw
configuration remain private. Public status begins as `registered`, `unknown` health, and `unknown`
availability with `NOT_PROBED`; this is truthful passive state, not a connectivity claim.
The public lifecycle vocabulary follows ADR-006: `declared`, `validating`, `registered`, and
`rejected`. Version 1 stores the completed `registered` state; the other values support compatible
validation artifacts without implying hot reload or runtime probing.

The singleton API owns one empty provider registry. Every `createZeus()` call creates a distinct
empty provider namespace and registry so trusted registrations cannot leak between composed hosts.

Provider calls require an explicit provider ID. Failures, invalid responses, timeouts, and
cancellation are isolated behind fixed bounded errors. Raw exceptions never enter errors or
reports. The invocation context contains only immutable provider identity/trust-zone metadata and
an abort signal—not environment variables, the Zeus service object, policy, or configuration.
Invocation options are an accessor-free allowlisted envelope. Cancellation accepts only a genuine
`AbortSignal`; malformed timeouts, fake signals, decorated signal methods, and accessors are rejected
before a handler runs.

### Private-by-default policy

Trust zones are `local`, `private-network`, and `external`. Payload classifications are:

- `public-metadata`
- `project-metadata`
- `source-code`
- `database-metadata`
- `runtime-evidence`
- `personal-data`
- `secret`

All processing, including local processing, requires an exact classification/trust-zone allow rule.
There are no wildcards. Missing classification, unknown classification, missing or malformed policy,
and a missing exact rule are denial. The registry always uses the immutable trust zone declared by
the registered provider; request or configuration fields cannot override it.

`secret` is denied before policy validation in every trust zone and cannot be enabled by a rule.
Source code, database metadata, runtime evidence, and personal data require their own exact rule;
provider configuration never implies egress permission.

Denial artifacts contain provider/correlation identity, a fixed reason code, and a static message.
When available, they also project only a recognized payload classification and the actual registered
target trust zone. Missing or unknown classifications are omitted rather than echoed. Denials never
repeat payloads, snippets, hashes, configuration, raw errors, paths, URLs, user names, or customer
data. Configuration provenance records only a source kind, safe reference name, configured-key
names, and `values-omitted`; it accepts no values or endpoints.

### Untrusted data and offline doubles

Descriptor, request, response, policy, provenance, and structured output boundaries reject
dangerous prototype keys, accessors, exotic prototypes, cycles, symbols, functions, bigints,
non-finite numbers, and excessive depth, keys, array items, strings, or total output size.

The `providers.testing` namespace contains a deterministic mock model plus fixed-dimension in-memory
embedding and bounded vector-store doubles. They use no clock, randomness, filesystem, process
environment, child process, network, or background polling. They are exclusively for offline
contract and integration tests, not real model integration or production storage.

## Compatibility and ownership

This change is additive to the public `./api` export. Existing CLI, MCP, Capability Registry,
`registerPlugin`, and `knowledgeProviders` behavior is unchanged. Providers remain optional adapters
above canonical evidence; the default registry is empty.

All contracts, policy primitives, registry behavior, redaction, and offline doubles are Community
functionality under Apache-2.0. No commercial provider management, central organization policy,
Fleet Health, audit/team workflow, generation assurance, repair, model comparison, Db2 Test
Intelligence, entitlement, deployment, telemetry, or hidden premium implementation is included.

## Non-goals

- no Ollama, vLLM, OpenAI-compatible, cloud, or internet adapter;
- no model discovery, download, automatic selection, fallback, or polling;
- no required embedding or vector retrieval path;
- no AI-generated code change or repair loop;
- no executable general module registrar, marketplace, license check, or entitlement system.
