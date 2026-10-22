---
Title: External JDBC Connections
Description: Configure a named, read-only JDBC data source for CLI and MCP AI queries.
---

# External JDBC Connections

`query-sql` can use a named `jdbcConnections` entry in a profile. The caller selects
only the name with `--connection`; JDBC URL, driver class, user, and password remain
in local profile/environment configuration. `query-table`, `resolve-object`, and IBM i
metadata commands remain DB2 for i-specific.

## Driver Requirements

`jt400.jar` provides the IBM i Db2 JDBC driver and is required for IBM i-specific
JDBC operations. It cannot connect to SQL Server or another external database. Each
external `jdbcConnections` entry requires the approved JDBC driver JAR and driver
class for its target database, for example JTDS for the included SQL Server profile.
Install every required driver in `java/lib/`; the Java runtime loads that directory as
one classpath, and `npm run sbom:jdbc-runtime` inventories both JT400 and all installed
vendor drivers in the local runtime SBOM.

## JTDS SQL Server Example

The included `demo-sqlserver-jtds` profile defines the connection name `rol-evodb` for
the JTDS driver class `net.sourceforge.jtds.jdbc.Driver`.

1. Place an approved JTDS JAR, for example `jtds-1.3.1.jar`, in `java/lib/`. JAR files
   in this directory are loaded automatically and are intentionally not committed.
   Generate a local component inventory after each driver update:

```powershell
npm run sbom:jdbc-runtime
```

This writes `output/jdbc-runtime.sbom.cdx.json` with JAR names, manifest metadata,
and SHA-256 hashes. It contains no JDBC URL, user, password, or absolute path. 2. Copy `config/profiles.example.json` to `config/local-only/profiles.json` if a private
profile file does not yet exist. 3. Copy `config/.env.sqlserver-jtds.example` to
`config/local-only/.env.sqlserver-jtds.local`. 4. Initialize the local key once on Windows:

```powershell
node .\cli\zeus.js secret init-key --windows
```

5. Encrypt user name and password separately. Do not use `--value`, which can expose
   the secret in shell history or the process list. Run the following block once for
   each value, enter it at the protected PowerShell prompt, and copy the resulting
   `enc:v1:...` token manually into the local env file:

```powershell
$secureValue = Read-Host 'Value to encrypt' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
try {
   [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) |
      node .\cli\zeus.js secret encrypt
} finally {
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
```

From `cmd.exe`, use the same protected PowerShell input through a pipe. Run it once
for the user and once for the password:

```cmd
powershell -NoProfile -Command "$s=Read-Host 'Value to encrypt' -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }" | node .\cli\zeus.js secret encrypt
```

6. Replace the URL placeholder and both encrypted tokens in the local env file. Leave
   `ZEUS_JDBC_ONLY=true` in place so the env loader does not require DB2 variables.
7. Load the environment and issue a safe test query:

```powershell
. .\config\load-env.ps1 -Environment sqlserver-jtds
node .\cli\zeus.js query-sql --profile demo-sqlserver-jtds --connection rol-evodb --sql "SELECT TOP (1) name FROM sys.tables ORDER BY name"
```

Use Doctor for a credential-free configuration and connection check. If a required
connection field is absent, Doctor reports the declared environment name and the exact
loader command. `--probe` performs only the configured read-only health query:

```powershell
node .\cli\zeus.js doctor --profile demo-sqlserver-jtds --connection rol-evodb --probe
```

Before writing a query, inspect a JDBC table without manually composing
`INFORMATION_SCHEMA` SQL. The table must be schema-qualified. `--include-row-count`
runs an exact `COUNT(*)`, so omit it for large tables unless the count is needed:

```powershell
node .\cli\zeus.js describe-table --profile demo-sqlserver-jtds --connection rol-evodb --table dbo.ROL_RELEX_ARTIKELDATEN
```

For long values in human-readable query output, use `--wide`; JSON and CSV remain the
machine-readable, lossless output formats:

```powershell
node .\cli\zeus.js query-sql --profile demo-sqlserver-jtds --connection rol-evodb --wide --sql "SELECT TOP (20) name FROM sys.tables ORDER BY name"
```

Java helpers are launched with UTF-8 output encoding. For jTDS character conversion
inside the database connection, keep the server-approved JDBC URL and database
collation; do not add a charset option speculatively.

For a non-SQL-Server JDBC system, create another entry under `jdbcConnections` with its
driver class, JDBC URL, user, password, optional `environment`, and optional `probeSql`.
The driver JAR must be placed in `java/lib/`; arbitrary JAR paths are never accepted as
command arguments.

## MCP / AI Use

The local MCP tool `zeus.profiles` lists configured JDBC connection names without URLs
or credentials. The AI then calls `zeus.query-sql` with `profile`, `connection`, `sql`,
and optionally `maxRows`:

```json
{
  "profile": "demo-sqlserver-jtds",
  "connection": "rol-evodb",
  "sql": "SELECT TOP (20) name FROM sys.tables ORDER BY name",
  "maxRows": 20
}
```

Only `SELECT` and `WITH` statements are accepted. Zeus validates every statement,
sets the JDBC connection read-only, caps rows, and passes the resolved password to Java
via `ZEUS_JV_PASSWORD`, never in the operating-system argument list. Configure the
database account with `SELECT` privileges only; JDBC read-only mode is an additional
client-side safeguard, not a replacement for database permissions.
