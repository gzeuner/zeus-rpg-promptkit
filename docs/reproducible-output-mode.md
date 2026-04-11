# Reproducible Output Mode

Use `--reproducible` when you want Zeus to emit stable artifacts for regression testing, bundle verification, or repository-local comparisons.

## Commands

`--reproducible` is supported on:

- `zeus analyze`
- `zeus workflow`
- `zeus bundle`
- `zeus impact`

## Behavior

When reproducible mode is enabled:

- generated timestamps use the stable value `2000-01-01T00:00:00.000Z`
- analyze stage timing is normalized to deterministic values
- analyze comparison metadata is suppressed so repeated runs do not drift based on prior local history
- analyze, bundle, workflow, and impact manifests include a `reproducibility` block with a content fingerprint
- bundle ZIP entries keep deterministic timestamps

## Scope

Reproducible mode is intended for identical repository-local inputs and command settings.

It stabilizes runtime metadata and bundle packaging behavior, but it does not claim semantic equivalence across changed source content, different selected artifacts, or different command options.

## Recommended Usage

Analyze and bundle reproducibly:

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --optimize-context --reproducible
zeus bundle --program ORDERPGM --source-output-root ./output --reproducible
```

Run a workflow reproducibly:

```bash
zeus workflow --preset modernization-review --source ./rpg_sources --program ORDERPGM --reproducible
```

Impact analysis already avoids live timestamps in its Markdown output. In reproducible mode, its JSON output also records an explicit reproducibility fingerprint.
