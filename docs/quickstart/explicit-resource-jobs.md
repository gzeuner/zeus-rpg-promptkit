---
Title: Explicit Resource Jobs
Description: Exact profiles, env layers and bounded multi-system resource selection without connection guessing.
---

# Explicit Resource Jobs

Use this CLI path when an analysis needs precisely selected resources from one or
several systems. It extends the existing profile loader and `resources` command;
it does not replace legacy single-system commands. API/MCP resource inspection
remains local and does not execute jobs.

## Configuration

Three inputs have distinct responsibilities:

1. An exact profile JSON file defines named `systems` and `jdbcConnections`.
2. Its profile's `resourceCatalog` grants named scopes, not implicit defaults.
3. A job JSON selects catalog references and explicitly narrows files, members,
   libraries, objects, schemas, tables, columns and row limits.

The public templates are [profiles](../../config/profiles.example.json)
(`resource-analysis-example`) and [job](../../config/resource-job.example.json).
Private equivalents belong in `config/local-only/`. Do not commit hostnames,
credentials, JDBC URLs, real source code or results.

### Profile Defaults And Names

`analysis-defaults` in the public template contains connection-free analysis
options. Inherit it plus a private connection-registry profile for new resource
profiles. `default-shared` remains a compatibility base: it inherits those options
and adds legacy environment-routed DB roles, optional commercial configuration and
bridge defaults. Inheritance is useful; inheriting unrelated connections is not.

Name an operator profile after its logical target and resource scope, for example
`ibmi-test-orders-sources`, `ibmi-prod-metadata` or `jdbc-reporting-metadata`.
An aggregate name should state its selected systems. Keep previous names as
documented compatibility aliases when scripts depend on them. Neither a `ro`
suffix nor a profile name enforces read-only access; the guarded executor does.

Profiles live in the explicitly selected JSON file, not in an env file. With
legacy directory discovery, `config/local-only/profiles.json` wins over
`config/profiles.json` and then `config/profiles.example.json`; named
`config/profiles.<name>.json` files can be merged as legacy overlays. The resource
job route uses only its exact files and never discovers overlays.

The common loader also accepts an absolute `--base-config <file>` for legacy
profile-based commands. The selected profile overrides that explicitly named
base; files next to the base are not discovered. Legacy directory overlays and
DB/fetch env overrides otherwise retain their compatibility behavior. For fixed
resource scopes, use `resources --job`, not a legacy profile's misleading name.

Every catalog entry has exactly one `system` or `connection`, plus a `kind`:

| Kind         | Catalog Scope                                                          | Required Job Selection                                            |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `sourceCode` | One `library`, allowed `sourceFiles`, optional allowed `members`       | `sourceFiles`, exact `members`, workspace-relative `outputRoot`   |
| `objects`    | `libraries`, `objectTypes`                                             | Exact `libraries`, `objectTypes`, `objects`                       |
| `metadata`   | `schemas`, optional allowed `tables`                                   | Exact `schemas`, `tables`                                         |
| `data`       | `schemas`, allowed `tables`, allowed `columns`, explicit `maskColumns` | Exact `schemas`, `tables`, `columns`; job `dataAccess: "samples"` |

Catalog names are case-sensitive. SQL identifiers preserve case for JDBC. Use
uppercase IBM-i library/file/member names. Source files belong to one library,
not a guessed library/file Cartesian product. Metadata reads column definitions,
not table rows or program execution. External metadata currently supports
`INFORMATION_SCHEMA.COLUMNS` (including SQL Server/JTDS); other driver dialects
are not assumed compatible.

`maxRows` is at most 500; the default is 50. `maxMembers` and `maxRequests` are at
most 50. A job has at most 20 resource selections and 100 bounded requests.
Wildcards, arbitrary SQL, program calls and unsupported fields are rejected.
`enabled: false` disables an entry. A catalog is an operator-maintained allowlist,
not proof that the remote library/file/table exists or is authorized.

## Local Discovery And Guided Selection

Start with `node cli/zeus.js resources --discover --json` to list local file
candidates. It does not choose or load them automatically. Then pass exact
absolute `--config`, optional `--base-config`, and ordered `--env-files` paths:

```powershell
$root = (Get-Location).Path
$profiles = Join-Path $root 'config/local-only/profiles.json'
$base = Join-Path $root 'config/profiles.example.json'
$envFiles = Join-Path $root 'config/local-only/.env.local'
node cli/zeus.js resources --discover --config $profiles --base-config $base --env-files $envFiles --json
```

Omit `--json` for the human table. Both views use the same discovery service.
The result contains profile modes, named targets, allowlisted scopes, limits,
required and missing env references, target fingerprints and structured next
command `argv` arrays. Values and credentials are masked. `legacy` profiles
remain compatible; `local-only` profiles do not supply remote scopes. Prefer
fixed `resource-catalog` profiles. A locally configured connection is neither a
live check nor a permission grant: `live: not-checked`, `approval: not-granted`.
Full selector/limit validation happens only when preparing a concrete job.

In an interactive terminal, choose the resources and exact identifiers:

```powershell
node cli/zeus.js resources --wizard --config $profiles --base-config $base --env-files $envFiles --out config/local-only/my-resource-job.json
```

The dialog selects one profile, resource references, bounded selectors and a new
source output directory when applicable. It never asks for passwords or executes
the plan. Use `--profile` and optional `--kind` to narrow the choices. `--out` is
workspace-relative, optional and create-new only. Without it, the preview is not
saved. Cancellation or invalid input creates no job. Wildcards and selectors
outside the catalog still fail in the existing planner.

Noninteractive agents must supply `--selection <absolute-json-file> --profile
<name> --json` instead of answering prompts. That file has the existing job
schema, including `goal` and exact `resources`; this is not a second job format.
The service validates it before optionally creating `--out`. Missing input blocks
with `RESOURCE_WIZARD_INPUT_REQUIRED`. Discovery and wizard reject `--execute`,
`--approve-plan` or `--job`; approval belongs to the separate execution route.

`agent preflight` and `agent prompt` accept the same explicit configuration flags
and expose `resourceDiscovery` plus structured resource next commands. They do
not load resource profiles through ambient legacy env bootstraps. Without these
flags, preflight still provides local orientation and reports the missing file
selection. Never use a masked plan as a control input; retain the original job,
rebuild with the same exact files and review the freshly computed hash.

## Plan And Approve

Resolve absolute file paths explicitly. An optional `--base-config` is the only
way to include an additional profile file; filename overlays are not discovered.

```powershell
$root = (Get-Location).Path
$profiles = Join-Path $root 'config/local-only/profiles.json'
$base = Join-Path $root 'config/profiles.example.json'
$job = Join-Path $root 'config/local-only/my-resource-job.json'
$envFiles = (Join-Path $root 'config/local-only/.env.local')
node cli/zeus.js resources --config $profiles --base-config $base --profile resource-analysis --job $job --env-files $envFiles --json
```

This command only builds a local, credential-free plan. Review its exact resource
references, scopes, output, limits, configuration sources and target fingerprints.
The fingerprint hides connection values but changes when the effective target,
database, host or naming context changes. It is not authenticated remote identity.
The goal, scopes, paths and limits are also bound to `planHash`.

Remote access runs only for an explicitly approved job. Execution automatically
checks that its target and scope are unchanged.

For a human workflow, repeat the command in an interactive terminal with
`--execute` and omit `--json`. The CLI shows the exact resource references, named
targets and fingerprints, scopes, limits, data policy, configuration sources and
local outputs. Only `yes` or `ja` approves that job; empty input, other answers or
aborting do not authorize a read. The hash is passed internally, not typed by the
operator. After confirmation the inputs are loaded again; changes to the effective
target, purpose, scope, policy, limits or outputs block the job before remote reads.

For noninteractive agents and automation, retain
`--execute --approve-plan <reviewed-planHash>`. The hash must come from an actual
operator-approved plan, not automatic acceptance of a newly generated preview.
JSON mode never prompts or supplies missing approval. A serialized plan cannot
itself authorize execution. Do not execute the example job's placeholder objects.
This path creates no persistent or time-limited approval grant. Existing remote
write prohibitions remain unchanged.

## Bounded SELECT Investigations

For several sample reads within the same approved scope, keep the existing
catalog/job and add `--investigation <absolute-selection-file>`. Start from
[the neutral selection example](../../config/resource-investigation.example.json)
and replace its selectors with the exact references and columns in your job.
The job must already use `dataAccess: "samples"`; metadata-only/source jobs cannot
be promoted by this option. Only structured SELECTs are supported, not arbitrary
SQL text, joins, functions or wildcard columns.

```powershell
$selection = Join-Path $root 'config/local-only/my-investigation.json'
node cli/zeus.js resources --config $profiles --profile resource-analysis --job $job --env-files $envFiles --investigation $selection --json
node cli/zeus.js resources --config $profiles --profile resource-analysis --job $job --env-files $envFiles --investigation $selection --execute
```

The first command is a local preview. The second shows the scope, purpose,
operator/session labels, masking/output policy, expiry and cumulative limits;
one explicit `yes`/`ja` covers its permitted requests, including different equality
filters. `operatorId` is an audit label, not authentication. The CLI completes the
selection file's requests sequentially and closes the session. The shared service
also supports additional permitted requests inside the same live session.
GUI/agent discovery exposes support and `not-granted`, not a remote executor.

Scope/session approval is separate from exact-job approval. `--approve-plan`,
noninteractive execution and `--json --execute` cannot authorize this mode.
Review JSON and its hash are not transferable grants; another CLI invocation
requires its own approval. An invalid selection is rejected before starting its
CLI batch. The service independently checks each request, so later permitted
requests need no new approval while limits and inputs remain unchanged.

`limits` requires `queries` (1-100), reserved `rows` (1-5000), masked result `bytes`
(1-33554432) and `durationMs` (1-900000). Each request's `maxRows` must fit the job
limit and remaining row budget. Result bytes are checked after the bounded read;
overflow discards the result and revokes the session. Query/row reservations are
not refunded after failure. Timeout/expiry checks also apply before native
connection probes and query transport. Unexpected results, audit failure,
revocation, expiry or config/credential/target changes revoke or block the session.
No broader retry, unmasked output, file destination or write follows from approval.

Audit events go to stderr without SQL literals, credentials or row values.
Evidence retains origin fingerprints, exact selected scope, capture time,
truncation and masked rows. No read is authenticated remote identity, compile
proof or production performance evidence. Live acceptance requires separate
operator-approved IBM-i/JDBC execution.

## Env And Loader Behavior

`--env-files` is a comma-separated list of absolute files, applied left to right.
Later files win over earlier files and inherited shell variables for keys they
declare. Unlisted shell keys remain available, and every selected connection's
env reference must resolve. To avoid ambient selection, declare all referenced
target/credential keys in the explicitly listed files. The plan records only
file paths and variable names, never values.

The job path uses Node's `util.parseEnv` and requires Node 20.12+ (Node 22 is
recommended). Quoted hashes, multiline quoted values and `export KEY=value`
are parsed without shell evaluation or interpolation. Loading is isolated to
that operation; it does not modify the parent shell or global process env.
There is no fallback to another config directory, environment or package root.

Existing `load-env.ps1`, `load-env.sh` and automatic legacy loading remain
compatibility bootstraps. They support their existing unquoted `KEY=value`
format and different shell precedence; they are not used by this strict route.
No dotenv dependency, dynamic module loader or remote discovery is needed.

## Evidence And Safety

Execution uses existing guarded read-only DB2/JDBC services and the direct
JT400 member reader. Local source export uses `READ_ONLY`, no remote SQL aliases,
DDL or IFS writes; existing bulk IFS workflows are separate and unchanged.
Source copies are separated by resource/library/file, SHA-256 fingerprinted,
and never overwritten. Symlinked output ancestors and workspace escapes block
the job before remote reads. Local path checks do not defend against a malicious
process concurrently replacing paths after checks.

Results retain resource reference, system/connection, target fingerprint, exact
scope, capture time and truncation status. Sample masking occurs before results
are returned. Guard or authority failure stops the job; there is no broader
retry scope. Already completed remote reads or local files are not rolled back.
Partial files after a failed source read must be reviewed locally before retry.
Real IBM-i/JDBC acceptance still requires separately approved remote execution.
