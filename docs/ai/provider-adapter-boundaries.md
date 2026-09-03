# Provider Adapter Boundaries

## Purpose

Zeus RPG PromptKit prepares evidence, routing context, and prompts. It does not
silently send source code, database content, credentials, or local configuration
to a model provider. This boundary applies equally to hosted providers, local
LLM tools, and CLI agents such as Grok.

## Safe integration contract

An optional provider adapter may be added only when all of the following are
true:

1. The operator explicitly selects the provider and starts the transfer.
2. The input is a selected prompt/evidence package, not an implicit workspace
   dump.
3. `.env`, local-only profiles, key material, credentials, customer data, and
   private repository metadata are denied by default.
4. Every outbound file is listed with path, classification, byte size, and
   checksum before transfer.
5. The adapter cannot write to the workspace, alter the Working Context, or
   execute remote actions as a side effect of model output.
6. The provider response is treated as a proposal. Canonical evidence and
   operator-controlled files remain authoritative.
7. Provider credentials are read only by the provider's own CLI or credential
   store. Zeus must never display, copy, or persist them.

The current implementation deliberately stops before provider invocation. The
local UI can generate and preview the session prompt, while CLI/MCP remain the
authoritative execution surfaces.

## Grok status

The optional local `grok` CLI was detected during the 2026-08-22 development
iteration. It reported no authenticated session and could not read its local
credential store. No credential-store access was expanded and no project data
was sent to Grok.

This is an intentional safe state. A future Grok adapter should first expose a
local readiness check with only:

- CLI availability and version;
- selected model name, if available;
- authentication state as a boolean or redacted status;
- the exact outbound manifest after operator approval.

It must not expose authentication files, tokens, authorization headers, or
unredacted provider diagnostics in the GUI or repository artifacts.

## Recommended future shape

The provider-neutral interface should operate on a reviewed package:

```text
prepare -> classify -> preview manifest -> operator approval -> invoke ->
store redacted response -> compare claims with canonical evidence
```

The first implementation should support prompt-only transfer. Source snippets,
metadata, and data samples should require separate explicit capabilities and
independent redaction checks. Remote writes and code changes remain outside the
adapter contract.

See also:

- `docs/ai/session-prompt.md`
- `docs/safety/safe-sharing.md`
- `docs/safety/local-workspace-policy.md`
- `docs/architecture/gui-ai-workbench-roadmap.md`
