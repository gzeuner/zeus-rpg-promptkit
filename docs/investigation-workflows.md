# Investigation Workflows

Zeus now includes three opt-in investigation features that extend the existing analyze pipeline without introducing a second workflow framework:

- IFS path scanning
- full-text search
- structured read-only diagnostic query packs

These features reuse the same manifests, bundle contract, safe-sharing flow, and AI knowledge projection that the core analyze pipeline already uses.

## CLI Surface

Analyze options:

- `--scan-ifs-paths`
- `--search-terms <csv>`
- `--search-ignore <csv>`
- `--search-max-results <n>`
- `--diagnostic-packs <csv>`
- `--diagnostic-params <k=v,...>`
- `--list-diagnostic-packs`

Optional IBM i host credentials for command-based diagnostic steps:

- `--host <hostname>`
- `--user <username>`
- `--password <password>`

## Artifacts

IFS path scanning writes:

- `ifs-paths.json`
- `ifs-paths.md`

Full-text search writes:

- `search-results.json`
- `search-results.md`

Diagnostic query packs write:

- `diagnostic-query-packs.json`
- `diagnostic-query-packs.md`
- `diagnostic-query-pack-manifest.json`

These artifacts are also recorded in:

- `analyze-run-manifest.json`
- `bundle-manifest.json` when bundled
- `safe-sharing/` when safe-sharing is enabled

## Read-Only Diagnostic Packs

Pack format characteristics:

- ordered named steps
- step kinds: `sql`, `catalog`, `command`
- parameter substitution through `${name}` placeholders
- read-only validation before execution

Current starter packs:

- `table-investigation`
- `program-investigation`
- `object-investigation`

Read-only enforcement:

- SQL steps must start with `SELECT` or `WITH`
- SQL steps reject mutation-oriented keywords
- command steps are restricted to a read-only allowlist such as `DSPOBJD`, `DSPFD`, `DSPPGMREF`, `DSPSRVPGM`, and `DSPDBR`

Credentials are consumed only at runtime. They are not written into output files or manifests.

## Prompt Packs

Prompt-pack coverage now includes:

- `documentation`
- `architecture-review`
- `modernization`
- `refactoring-plan`
- `test-generation`

New prompt-oriented modes:

- `refactoring`
- `test-generation`

New workflow presets:

- `refactoring-review`
- `test-generation-review`

## Examples

```bash
zeus analyze --source ./rpg_sources --program ORDERPGM --scan-ifs-paths
zeus analyze --source ./rpg_sources --program ORDERPGM --search-terms ORDERS,INVPGM --search-ignore archive/,old/
zeus analyze --source ./rpg_sources --program ORDERPGM --diagnostic-packs table-investigation --diagnostic-params table=ORDERS
zeus workflow --preset refactoring-review --source ./rpg_sources --program ORDERPGM
zeus workflow --preset test-generation-review --source ./rpg_sources --program ORDERPGM
```
