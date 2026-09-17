---
Title: External read-only JDBC
Description: Configure a named, profile-owned JDBC connection for bounded SELECT/WITH queries.
---

# External read-only JDBC

Zeus can query an explicitly named external JDBC connection in addition to the
existing IBM-i/Db2 path. The caller selects only the connection name; driver,
URL, user, and password stay in the local profile/environment configuration.

External JDBC access is intentionally separate from IBM-i catalog features:
`query-table`, `resolve-object`, and QSYS2 metadata remain Db2-for-i commands.

## Configuration

Copy the public profile and environment templates into `config/local-only/`,
then replace the placeholders locally:

```powershell
Copy-Item config/profiles.example.json config/local-only/profiles.json
Copy-Item config/.env.external-readonly.example config/local-only/.env.external-readonly.local
. .\config\load-env.ps1 -Environment external-readonly
```

The profile uses a named entry such as `reporting` under
`jdbcConnections`. Required fields are `driver`, `url`, `user`, and
`password`; `probeSql` is optional and must itself be read-only. Install the
approved vendor driver JAR under `java/lib/`. Arbitrary classpaths and JAR
paths are never accepted as CLI options.

## Safe queries

```powershell
node .\cli\zeus.js doctor --profile external-readonly --connection reporting
node .\cli\zeus.js query-sql --profile external-readonly --connection reporting --sql "SELECT 1 AS HEALTHCHECK" --max-rows 1
node .\cli\zeus.js describe-table --profile external-readonly --connection reporting --table APPDATA.ORDERS
```

Only `SELECT` and `WITH` statements are accepted. Zeus validates every
statement before Java starts, uses a bounded row limit, sets JDBC read-only
mode, and passes the password through `ZEUS_JV_PASSWORD` rather than the
process argument list. `--include-row-count` performs an exact `COUNT(*)` and
should be used deliberately on large tables.

The local runtime inventory can be refreshed after driver changes:

```powershell
npm run sbom:jdbc-runtime
```

The generated SBOM contains local JAR names, manifest metadata, and hashes,
but no URL, username, password, absolute path, or driver binary.
