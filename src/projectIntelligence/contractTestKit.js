'use strict';

/**
 * Public Project Intelligence Contract Test Kit (ZPI-02).
 * External and internal consumers can require this kit to assert Community
 * contract behavior without depending on persistence implementations.
 *
 * Usage:
 *   const { runProjectIntelligenceContractTests } =
 *     require('zeus-rpg-promptkit/project-intelligence-contracts');
 */

const assert = require('node:assert/strict');
const { createSchemaRegistry } = require('../core/contracts/schemaRegistry');
const { INITIAL_SCHEMAS } = require('../core/contracts/schemas');
const CORE_IDS = require('../core/contracts/contractIds');
const {
  CONTRACT_IDS,
  PROJECT_INTELLIGENCE_SCHEMAS,
  projectSchema,
  symbolSchema,
  summarySchema,
  contextPackageSchema,
  diagnosticSchema,
} = require('./contracts');
const {
  DERIVATION_CLASSES,
  REASON_CODES,
  REASON_CODE_MESSAGES,
  SNAPSHOT_STATUSES,
} = require('./constants');
const fixtures = require('./fixtures');
const {
  createProjectIntelligenceRegistry,
  validateProjectIntelligenceContract,
  registerProjectIntelligenceSchemas,
} = require('./validate');
const { isSafeRelativePath } = require('./helpers');

async function runProjectIntelligenceContractTests() {
  const results = [];

  function check(name, fn) {
    try {
      const out = fn();
      if (out && typeof out.then === 'function') {
        return out
          .then(() => results.push({ name, ok: true }))
          .catch(err => {
            results.push({ name, ok: false, error: String(err && err.message) });
            throw err;
          });
      }
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String(err && err.message) });
      throw err;
    }
  }

  await check('all ZPI schemas are registered with version 1', () => {
    const registry = createProjectIntelligenceRegistry();
    for (const id of Object.keys(PROJECT_INTELLIGENCE_SCHEMAS)) {
      assert.equal(registry.hasContract(id, 1), true, `missing ${id}@1`);
    }
  });

  await check('minimal fixtures validate for every entity', () => {
    const cases = [
      [CONTRACT_IDS.PROJECT, fixtures.project()],
      [CONTRACT_IDS.SNAPSHOT, fixtures.snapshot()],
      [CONTRACT_IDS.SOURCE_UNIT, fixtures.sourceUnit()],
      [CONTRACT_IDS.SOURCE_SPAN, fixtures.sourceSpan()],
      [CONTRACT_IDS.SYMBOL, fixtures.symbol()],
      [CONTRACT_IDS.RELATIONSHIP, fixtures.relationship()],
      [CONTRACT_IDS.ANALYZER_RUN, fixtures.analyzerRun()],
      [CONTRACT_IDS.EVIDENCE, fixtures.evidence()],
      [CONTRACT_IDS.SUMMARY, fixtures.summary()],
      [CONTRACT_IDS.DIAGNOSTIC, fixtures.diagnostic()],
      [CONTRACT_IDS.CONTEXT_PACKAGE, fixtures.contextPackage()],
      [CONTRACT_IDS.OPERATION_RESULT, fixtures.operationResultOk()],
      [CONTRACT_IDS.OPERATION_RESULT, fixtures.operationResultFail()],
    ];
    for (const [id, value] of cases) {
      const result = validateProjectIntelligenceContract(id, value);
      assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.errors)}`);
    }
  });

  await check('unknown schema version fails closed', () => {
    const result = validateProjectIntelligenceContract(
      CONTRACT_IDS.PROJECT,
      fixtures.project({ schemaVersion: 99 })
    );
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, REASON_CODES.SCHEMA_VERSION_UNSUPPORTED);
    assert.ok(result.errors.some(e => e.path === '/schemaVersion'));
  });

  await check('unknown derivation class fails closed', () => {
    const errors = symbolSchema(
      fixtures.symbol({
        provenance: fixtures.provenance({ derivationClass: 'GUESSED' }),
        evidenceReferences: [{ id: 'ev-1' }],
      })
    );
    assert.ok(errors.some(e => e.path === '/provenance/derivationClass'));
  });

  await check('unknown reason code fails closed', () => {
    const errors = diagnosticSchema(fixtures.diagnostic({ reasonCode: 'NOT_A_REAL_CODE' }));
    assert.ok(errors.some(e => e.path === '/reasonCode'));
  });

  await check('VERIFIED without evidence fails closed', () => {
    const errors = symbolSchema(
      fixtures.symbol({
        provenance: fixtures.provenance({ derivationClass: DERIVATION_CLASSES.VERIFIED }),
        evidenceReferences: [],
      })
    );
    assert.ok(errors.some(e => e.path === '/evidenceReferences'));
  });

  await check('summary and context package cannot claim sourceOfTruth', () => {
    assert.ok(
      summarySchema(fixtures.summary({ sourceOfTruth: true })).some(
        e => e.path === '/sourceOfTruth'
      )
    );
    assert.ok(
      contextPackageSchema(fixtures.contextPackage({ sourceOfTruth: true })).some(
        e => e.path === '/sourceOfTruth'
      )
    );
  });

  await check('summary cannot be VERIFIED', () => {
    const errors = summarySchema(
      fixtures.summary({ derivationClass: DERIVATION_CLASSES.VERIFIED })
    );
    assert.ok(errors.some(e => e.path === '/derivationClass'));
  });

  await check('relative path safety rejects traversal and absolute forms', () => {
    assert.equal(isSafeRelativePath('../escape.rpgle'), false);
    assert.equal(isSafeRelativePath('/etc/passwd'), false);
    assert.equal(isSafeRelativePath('C:\\Windows\\a.rpgle'), false);
    assert.equal(isSafeRelativePath('\\\\server\\share\\a.rpgle'), false);
    assert.equal(isSafeRelativePath('QRPGLESRC/ORDERPGM.rpgle'), true);

    const bad = projectSchema(
      fixtures.project({
        trustedRoots: [{ rootId: 'r1', relativeLabel: '../escape' }],
      })
    );
    assert.ok(bad.some(e => e.path.includes('relativeLabel')));
  });

  await check('reason code catalog has messages for every code', () => {
    for (const code of Object.values(REASON_CODES)) {
      assert.equal(typeof REASON_CODE_MESSAGES[code], 'string');
      assert.ok(REASON_CODE_MESSAGES[code].length > 0);
      assert.ok(code.startsWith('ZPI.'));
    }
  });

  await check('snapshot statuses are closed', () => {
    const errors = require('./contracts').snapshotSchema(fixtures.snapshot({ status: 'maybe' }));
    assert.ok(errors.some(e => e.path === '/status'));
    assert.ok(Object.values(SNAPSHOT_STATUSES).includes('published'));
  });

  await check('ZPI contracts integrate with core INITIAL_SCHEMAS registry', () => {
    const registry = createSchemaRegistry();
    for (const [id, { version, schema }] of Object.entries(INITIAL_SCHEMAS)) {
      registry.register({ id, version, schema });
    }
    for (const id of Object.keys(PROJECT_INTELLIGENCE_SCHEMAS)) {
      assert.equal(registry.hasContract(id, 1), true, `INITIAL_SCHEMAS missing ${id}`);
    }
    // Core IDs mirror ZPI contract ids for discovery
    assert.equal(CORE_IDS.PROJECT_KNOWLEDGE_PROJECT, CONTRACT_IDS.PROJECT);
    assert.equal(CORE_IDS.PROJECT_KNOWLEDGE_CONTEXT_PACKAGE, CONTRACT_IDS.CONTEXT_PACKAGE);

    const ok = registry.validate(CONTRACT_IDS.PROJECT, 1, fixtures.project());
    assert.equal(ok.ok, true);
  });

  await check('registerProjectIntelligenceSchemas is idempotent only once per registry', () => {
    const registry = createSchemaRegistry();
    registerProjectIntelligenceSchemas(registry);
    assert.throws(() => registerProjectIntelligenceSchemas(registry), /Duplicate registration/);
  });

  return { ok: true, results };
}

module.exports = {
  runProjectIntelligenceContractTests,
  fixtures,
  CONTRACT_IDS,
};
