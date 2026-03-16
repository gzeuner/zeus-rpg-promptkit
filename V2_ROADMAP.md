# V2 Roadmap

## Purpose

Zeus V2 will extend the current CLI-based RPG analysis tooling into a more maintainable and reusable platform for IBM i analysis workflows.

The goal is to keep the existing deterministic artifact model while improving extensibility, operational visibility, and reuse across CLI, bundle, and future UI-oriented workflows.

## Guiding Principles

- preserve deterministic outputs and stable artifact contracts
- keep the CLI useful as the primary automation surface
- add structure and reuse before adding large new feature areas
- improve analysis depth without forcing brittle all-at-once parser rewrites
- make outputs easier to consume by automation and future interactive tooling

## Current V2 Focus Areas

### 1. Analysis Pipeline and Extensibility

Strengthen the internal stage pipeline so analysis steps are easier to compose, evolve, and debug.

Focus:

- clearer stage contracts
- structured stage metadata and diagnostics
- easier addition of new analysis and enrichment steps

### 2. Output Contracts and Run Metadata

Make generated artifacts more useful for automation, debugging, and downstream tools.

Focus:

- versioned manifests
- richer artifact inventories
- stable machine-readable diagnostics
- stronger alignment between `analyze` and `bundle`

### 3. Configuration and Runtime Hardening

Improve configuration handling so larger workflows remain predictable and easier to operate.

Focus:

- stronger validation
- clearer profile behavior
- safer environment override handling

### 4. Test Infrastructure

Expand beyond smoke coverage to protect output contracts and future analysis work.

Focus:

- contract tests for generated outputs
- broader regression coverage for analysis logic
- clearer test tiers for unit, contract, and smoke validation

### 5. Workflow and Prompt Evolution

Prepare the project for more guided review modes without fragmenting the core artifact model.

Focus:

- reusable workflow-oriented bundles
- clearer prompt packaging and metadata
- stronger separation between core analysis data and workflow-specific presentation

### 6. Foundation for Local UI and Automation Clients

Keep future interactive usage in mind while preserving the CLI-first model.

Focus:

- stable internal data contracts
- reusable manifest-driven artifact discovery
- outputs that can be consumed without duplicating parsing logic

## Near-Term Direction

The next V2 steps are expected to continue in this order:

1. strengthen shared analysis and bundle contracts
2. improve diagnostics and runtime observability
3. harden configuration and validation behavior
4. expand test coverage around contracts and regression safety
5. build toward guided workflows and a local UI/API layer

## Public Backlog Themes

The public backlog currently groups work around:

- analysis depth improvements
- architecture and pipeline improvements
- workflow and prompt improvements
- local UI and usability improvements

Issue details can continue to evolve over time, but the main direction remains:

- more extensible analysis
- more repeatable outputs
- better workflow support
- a stronger foundation for future product surfaces
