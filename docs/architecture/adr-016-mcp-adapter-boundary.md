---
Title: ADR-016 MCP Adapter Boundary
Description: Keep MCP optional and thin while centralizing policy-gated tool execution
Status: Accepted
Last Updated: 2026-08-21
---

# ADR-016: MCP Adapter Boundary

## Context

The CLI, capability registry, and core services are the canonical Zeus product
surface for people, automation, and CI. MCP is a local, optional stdio adapter
for AI clients. It must make the current, policy-approved capabilities easy to
discover without creating a second business implementation.

The MCP server previously combined JSON-RPC handling, tool policy, timeouts,
redaction, response-size limits, audit events, and tool execution in one module.
That made the adapter harder to test and encouraged protocol concerns to grow
alongside domain handlers.

## Decision

The MCP surface is an adapter, not a competing product architecture:

- CLI commands, the capability registry, and shared services remain the source
  of truth for business behavior and contracts.
- `mcpServer` owns MCP JSON-RPC methods and local stdio transport only.
- `mcpToolGateway` owns allowlist policy, execution timeout, response-size
  enforcement, redacted result normalization, and tool-call audit events.
- Existing MCP domain handlers remain behind the gateway during incremental
  migration; new business behavior must be implemented in reusable core/API
  services first and then exposed through adapters.
- MCP remains local-first and read-oriented by default. Default packs and
  explicit allowlists continue to bound the exposed surface.

The gateway is deliberately small and dependency-free. It receives the
existing execution function and runtime context rather than reimplementing
tool behavior. This preserves current CLI/MCP behavior while establishing a
testable seam for later extraction of individual domain services.

## Consequences

- AI clients retain live discovery through `tools/list`, bootstrap, resources,
  prompts, and the existing context/evidence workflow.
- Humans and CI can use the CLI without starting an MCP server.
- Security controls and audit behavior have one reusable execution boundary.
- The large legacy MCP handler module remains technical debt for later,
  capability-by-capability extraction; this ADR does not duplicate it.
- MCP protocol changes do not need to change the CLI, and CLI contract changes
  remain independently testable.

## Non-goals

- Removing MCP or introducing a network MCP server.
- Making MCP the canonical command surface.
- Changing the default allowlist, safety levels, or write authorization model.
- Introducing Neo4j or another second knowledge architecture.
