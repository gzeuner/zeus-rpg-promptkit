# Zeus Domain Schemas

This directory is the home for versioned domain contract schemas.

**Status (package 02):** Initial metadata-only shells have been registered in code
(`src/core/contracts/schemas.js`). Full structural definitions and producers/consumers
will be migrated in subsequent packages.

## Contract IDs (stable)

- `zeus.evidence-model`
- `zeus.run-manifest`
- `zeus.artifact-reference`
- `zeus.investigation-session`
- `zeus.safety-policy`

## Usage (via registry)

```js
const { createSchemaRegistry } = require('./src/core/contracts');
const { INITIAL_SCHEMAS } = require('./src/core/contracts/schemas');

const registry = createSchemaRegistry();
for (const [id, { version, schema }] of Object.entries(INITIAL_SCHEMAS)) {
  registry.register({ id, version, schema });
}

const result = registry.validate('zeus.run-manifest', 1, manifestData);
```

See `src/core/contracts/schemaRegistry.js` and the package 02 ADR baseline for policy.
