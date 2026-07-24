# Zeus Domain Schemas

This directory is the home for versioned domain contract documentation.

**Status:**

- Package 02 baseline contracts live in code (`src/core/contracts/schemas.js`).
- Generation Validation contracts: `src/generationValidation/contracts.js`.
- Module descriptor contracts: `src/modules/`.
- **Project Intelligence contracts (ZPI-02):** `src/projectIntelligence/`.

Full structural definitions and producers/consumers for later ZPI packages
(store, search, analyzers) will land in subsequent work packages.

## Contract IDs (stable)

### Core baseline

- `zeus.evidence-model`
- `zeus.run-manifest`
- `zeus.artifact-reference`
- `zeus.investigation-session`
- `zeus.safety-policy`

### Project Intelligence (ZPI-02)

- `zeus.project-knowledge-project`
- `zeus.project-knowledge-snapshot`
- `zeus.project-knowledge-source-unit`
- `zeus.project-knowledge-source-span`
- `zeus.project-knowledge-symbol`
- `zeus.project-knowledge-relationship`
- `zeus.project-knowledge-analyzer-run`
- `zeus.project-knowledge-evidence`
- `zeus.project-knowledge-summary`
- `zeus.project-knowledge-diagnostic`
- `zeus.project-knowledge-context-package`
- `zeus.project-knowledge-operation-result`

## Usage (via registry)

```js
const { createSchemaRegistry } = require('./src/core/contracts');
const { INITIAL_SCHEMAS } = require('./src/core/contracts/schemas');

const registry = createSchemaRegistry();
for (const [id, { version, schema }] of Object.entries(INITIAL_SCHEMAS)) {
  registry.register({ id, version, schema });
}

const result = registry.validate('zeus.project-knowledge-project', 1, projectData);
```

## Package export

```js
const zpi = require('zeus-rpg-promptkit/project-intelligence-contracts');
// or: require('./src/projectIntelligence')

const result = zpi.validateProjectIntelligenceContract(zpi.CONTRACT_IDS.SNAPSHOT, snapshotValue);
```

See:

- `src/projectIntelligence/` — validators, reason codes, fixtures, contract test kit
- `docs/architecture/adr-009-project-intelligence-ownership.md` and following ZPI ADRs
- `docs/knowledgebase/zpi-test-strategy.md`
