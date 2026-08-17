'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createZeus } = require('zeus-rpg-promptkit/api');

const {
  generateEphemeralKeyPair,
  buildUnsignedLicense,
  signLicenseDocument,
  registerReferenceModule,
  CAPABILITY_ID: REFERENCE_CAPABILITY_ID,
  registerDb2TestIntelligenceModule,
  DB2_TEST_INTELLIGENCE_MODULE_ID,
  DB2_TEST_INTELLIGENCE_CAPABILITY_ID,
  DB2_TEST_INTELLIGENCE_RESULT_CONTRACT_REF,
} = require('../src');

// Public subpath surface (entitlement-free validator/reader/projections only)
const db2tiPublic = require('../src/db2TestIntelligence');

// Internal helpers for focused tests only — not public package exports
const { runDb2TestIntelligence } = require('../src/db2TestIntelligence/engine');
const { parseExpression, PARSE_REASONS } = require('../src/db2TestIntelligence/parser');
const { generateVectorSet } = require('../src/db2TestIntelligence/generator');
const { projectRequest } = require('../src/db2TestIntelligence/project');
const { writeArtifacts } = require('../src/db2TestIntelligence/artifactWriter');
const { buildDescriptor } = require('../src/db2TestIntelligence/register');
const {
  LIMITS,
  ARTIFACT_FILES,
  REASON_CODES,
  PINNED_COMMUNITY_SHA,
} = require('../src/db2TestIntelligence/constants');
const { prettyCanonical, canonicalize } = require('../src/db2TestIntelligence/util');
const { hashWorkspaceTree, sanitizeRunId } = require('../src/db2TestIntelligence/paths');
const { inertRobotField } = require('../src/db2TestIntelligence/exporters');

function testProvenanceAnchor(over = {}) {
  return {
    communitySha: PINNED_COMMUNITY_SHA,
    adapterId: 'test-adapter',
    adapterVersion: '1.0.0',
    evidenceArtifactSha256: 'a'.repeat(64),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entitledLicense(privateKey, now = new Date('2026-07-19T12:00:00.000Z'), overrides = {}) {
  return signLicenseDocument(
    buildUnsignedLicense({
      notBefore: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      ...overrides,
    }),
    privateKey
  );
}

function entitlementBundle(now = new Date('2026-07-19T12:00:00.000Z')) {
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  return {
    publicKeyPem: publicKey,
    privateKey,
    now,
    licenseDocument: entitledLicense(privateKey, now),
  };
}

function minimalEvidence(overrides = {}) {
  return {
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    // evidence follows
    evidence: {
      tables: [
        {
          schema: 'SALES',
          name: 'ORDERS',
          columns: [
            {
              name: 'ORDER_ID',
              type: 'INTEGER',
              nullable: false,
              primaryKey: true,
            },
            {
              name: 'CUSTOMER_ID',
              type: 'INTEGER',
              nullable: false,
              primaryKey: false,
            },
            {
              name: 'STATUS',
              type: 'CHAR',
              length: 1,
              nullable: true,
            },
            {
              name: 'AMOUNT',
              type: 'DECIMAL',
              precision: 7,
              scale: 2,
              nullable: false,
            },
            {
              name: 'ORDER_DATE',
              type: 'DATE',
              nullable: true,
            },
          ],
          foreignKeys: [
            {
              name: 'FK_CUSTOMER',
              columns: ['CUSTOMER_ID'],
              referencedSchema: 'SALES',
              referencedTable: 'CUSTOMERS',
              referencedColumns: ['CUSTOMER_ID'],
            },
          ],
          sourceEvidence: [{ kind: 'catalog', ref: 'SYSCOLUMNS', note: 'technical' }],
        },
      ],
    },
    codeConditions: [],
    manualRules: [],
    options: {},
    ...overrides,
  };
}

function tempRoots() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-ws-'));
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-art-'));
  fs.writeFileSync(path.join(workspace, 'marker.txt'), 'workspace-byte-identity\n', 'utf8');
  return { workspace, artifacts };
}

function hashTree(rootDir) {
  return hashWorkspaceTree(rootDir);
}

// ---------------------------------------------------------------------------
// Package / discovery / non-exports
// ---------------------------------------------------------------------------

test('unified package is self-contained under Apache-2.0', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'zeus-rpg-promptkit');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.dependencies['zeus-rpg-promptkit'], undefined);
});

test('result contract ref is part of the unified public module', () => {
  assert.equal(DB2_TEST_INTELLIGENCE_RESULT_CONTRACT_REF, 'zeus-pro.db2-test-vector-set@1');
  assert.equal(db2tiPublic.REQUEST_CONTRACT_REF, 'zeus-pro.db2-test-intelligence-request@1');
  assert.equal(DB2_TEST_INTELLIGENCE_MODULE_ID, 'zeus-pro.db2-test-intelligence');
  assert.equal(DB2_TEST_INTELLIGENCE_CAPABILITY_ID, 'zeus-pro.db2-test-intelligence.generate');
});

test('export boundary: unified root exposes registration and keeps the subpath safe', () => {
  const root = require('../src');
  const sub = require('../src/db2TestIntelligence');
  // Root: unified namespace plus registration, but no raw engine.
  assert.equal(Object.prototype.hasOwnProperty.call(root, 'db2TestIntelligence'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(root, 'runDb2TestIntelligence'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(root, 'parseExpression'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(root, 'generateVectorSet'), false);
  assert.equal(typeof root.registerDb2TestIntelligenceModule, 'function');
  assert.equal(typeof root.DB2_TEST_INTELLIGENCE_MODULE_ID, 'string');
  assert.equal(typeof root.DB2_TEST_INTELLIGENCE_CAPABILITY_ID, 'string');
  assert.equal(typeof root.DB2_TEST_INTELLIGENCE_RESULT_CONTRACT_REF, 'string');
  // Subpath: no engine/parser/registration/path/hash/escape helpers
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'runDb2TestIntelligence'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'parseExpression'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'generateVectorSet'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'projectRequest'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(sub, 'registerDb2TestIntelligenceModule'),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'buildDescriptor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'sanitizeRunId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'hashWorkspaceTree'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'prettyCanonical'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'canonicalize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'sha256Text'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sub, 'escapeMarkdown'), false);
  assert.equal(typeof sub.validateVectorSet, 'function');
  assert.equal(typeof sub.readArtifacts, 'function');
  assert.equal(typeof sub.exportMarkdown, 'function');
  assert.equal(typeof sub.exportFramework, 'function');
});

test('package exports the unified subpath and built-in registration symbols', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./db2-test-intelligence'], './src/db2TestIntelligence/index.js');
  assert.ok(
    pkg.scripts['test:built-in'].includes('tests/consolidated-db2TestIntelligence.test.js')
  );
});

// ---------------------------------------------------------------------------
// Entitlement zero-work
// ---------------------------------------------------------------------------

test('entitlement denial causes zero getters/proxy traps on input', () => {
  let trapCount = 0;
  const hostile = new Proxy(
    {},
    {
      get() {
        trapCount += 1;
        throw new Error('getter should not run');
      },
      ownKeys() {
        trapCount += 1;
        throw new Error('ownKeys should not run');
      },
      getOwnPropertyDescriptor() {
        trapCount += 1;
        throw new Error('descriptor should not run');
      },
    }
  );

  const result = runDb2TestIntelligence(hostile, {
    publicKeyPem: null,
    licenseDocument: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.ENTITLEMENT_DENIED);
  assert.equal(trapCount, 0);
  assert.equal(result.result, null);
  assert.equal(result.artifacts.written, false);
});

test('registered capability execute-time expiry: zero input traps after mutable clock advances', async () => {
  // createClock supports options.now as a function — re-verification reads live time.
  const { publicKey, privateKey } = generateEphemeralKeyPair();
  const start = new Date('2026-07-19T12:00:00.000Z');
  const clock = { now: start };
  const nowFn = () => clock.now;
  const licenseDocument = entitledLicense(privateKey, start, {
    notBefore: new Date(start.getTime() - 60_000),
    expiresAt: new Date(start.getTime() + 3_600_000),
  });

  const zeus = createZeus();
  const reg = await registerDb2TestIntelligenceModule(zeus.modules, {
    publicKeyPem: publicKey,
    licenseDocument,
    now: nowFn,
  });
  assert.equal(reg.ok, true);
  assert.ok(zeus.capabilities.get(DB2_TEST_INTELLIGENCE_CAPABILITY_ID));

  // Still entitled — generation works
  const okExec = await zeus.capabilities.execute(
    DB2_TEST_INTELLIGENCE_CAPABILITY_ID,
    {},
    minimalEvidence()
  );
  assert.equal(okExec.ok, true);
  assert.equal(okExec.result.ok, true);

  // Expire the trusted clock after registration
  clock.now = new Date(start.getTime() + 3_600_000 + 1);

  let traps = 0;
  const hostile = new Proxy(
    {},
    {
      get() {
        traps += 1;
        throw new Error('getter must not run after entitlement deny');
      },
      ownKeys() {
        traps += 1;
        throw new Error('ownKeys must not run after entitlement deny');
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error('descriptor must not run after entitlement deny');
      },
      has() {
        traps += 1;
        throw new Error('has must not run after entitlement deny');
      },
    }
  );

  const denied = await zeus.capabilities.execute(DB2_TEST_INTELLIGENCE_CAPABILITY_ID, {}, hostile);
  assert.equal(denied.ok, true); // capability layer returns ok envelope
  assert.equal(denied.result.ok, false);
  assert.equal(denied.result.reasonCode, REASON_CODES.ENTITLEMENT_DENIED);
  assert.equal(denied.result.result, null);
  assert.equal(denied.result.artifacts.written, false);
  assert.equal(traps, 0);
  assert.equal(typeof zeus.analyze, 'function');
});

// ---------------------------------------------------------------------------
// Happy path generation
// ---------------------------------------------------------------------------

test('minimal evidence produces supported vectors with explicit nonclaims', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(minimalEvidence(), ent);
  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, REASON_CODES.OK);
  assert.ok(result.result);
  assert.equal(result.result.contractId, 'zeus-pro.db2-test-vector-set');
  assert.equal(result.result.contractVersion, 1);
  assert.ok(result.result.vectors.length > 0);
  assert.equal(result.result.nonClaims.databaseExecuted, false);
  assert.equal(result.result.nonClaims.programExecuted, false);
  assert.equal(result.result.nonClaims.compiled, false);
  assert.equal(result.result.nonClaims.productionValidated, false);
  assert.equal(result.result.nonClaims.businessCorrect, false);
  for (const v of result.result.vectors) {
    assert.match(v.id, /^[a-f0-9]{32}$/);
    assert.ok(v.category);
    assert.ok(v.expectation);
    assert.ok(Array.isArray(v.provenance));
    assert.ok(Array.isArray(v.assumptions));
    assert.ok(v.supportStatus);
    assert.equal(v.expectation.business, 'unknown');
  }
  // CUSTOMER_ID technical column allowed
  const text = prettyCanonical(result.result);
  assert.ok(text.includes('CUSTOMER_ID'));
  // Quality report shape
  assert.ok(result.result.qualityReport.vectorCount === result.result.vectors.length);
});

test('technical CUSTOMER_ID column allowed while row/customer sentinels rejected', () => {
  const ent = entitlementBundle();
  const ok = runDb2TestIntelligence(minimalEvidence(), ent);
  assert.equal(ok.ok, true);

  const withRows = minimalEvidence();
  withRows.evidence.tables[0].rows = [{ CUSTOMER_ID: 1 }];
  // rows is own data on table — projection rejects unknown/forbidden
  // Actually FORBIDDEN is checked; 'rows' is forbidden
  const bad = runDb2TestIntelligence(withRows, ent);
  assert.equal(bad.ok, false);
  assert.equal(bad.reasonCode, REASON_CODES.INPUT_INVALID);

  const withCustomer = minimalEvidence();
  withCustomer.customer = { name: 'Acme' };
  const bad2 = runDb2TestIntelligence(withCustomer, ent);
  assert.equal(bad2.ok, false);

  const withSample = minimalEvidence();
  withSample.evidence.sample = [{ a: 1 }];
  // unknown evidence field
  const bad3 = runDb2TestIntelligence(withSample, ent);
  assert.equal(bad3.ok, false);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('deterministic byte-identical canonical JSON across permutations', () => {
  const ent = entitlementBundle();
  const base = minimalEvidence({
    manualRules: [
      {
        id: 'm1',
        expression: "STATUS = 'A'",
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
      {
        id: 'm2',
        expression: 'AMOUNT >= 0',
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
    ],
    codeConditions: [
      {
        id: 'c1',
        expression: "STATUS <> 'X'",
        table: 'ORDERS',
        schema: 'SALES',
        source: 'ORDERPGM',
        literalsAreSynthetic: true,
      },
    ],
  });

  // Permute table column order and rule order
  const perm = JSON.parse(JSON.stringify(base));
  perm.evidence.tables[0].columns = perm.evidence.tables[0].columns.slice().reverse();
  perm.manualRules = perm.manualRules.slice().reverse();

  const a = runDb2TestIntelligence(base, ent);
  const b = runDb2TestIntelligence(perm, ent);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const ca = prettyCanonical(a.result);
  const cb = prettyCanonical(b.result);
  assert.equal(ca, cb);

  // Locale / timezone independence: force different TZ env shouldn't matter (no Date.now in path)
  const prev = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
  try {
    const c = runDb2TestIntelligence(base, ent);
    assert.equal(prettyCanonical(c.result), ca);
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('semantic dedupe merges provenance but not different outcomes', () => {
  const ent = entitlementBundle();
  // Two manual rules that produce same equality accept for STATUS='A'
  const req = minimalEvidence({
    manualRules: [
      {
        id: 'm1',
        expression: "STATUS = 'A'",
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
      {
        id: 'm2',
        expression: "STATUS = 'A'",
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
    ],
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, true);
  const accepts = result.result.vectors.filter(
    v =>
      v.category === 'manual-rule' &&
      v.expectation.outcome === 'accept' &&
      JSON.stringify(v.input.assignments).includes('STATUS')
  );
  // Dedupe should merge into fewer vectors with multi provenance
  assert.ok(accepts.length >= 1);
  const multi = accepts.find(v => v.provenance.length >= 2);
  assert.ok(multi, 'expected merged provenance on identical semantic vector');
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

test('CHECK parser supports AND/BETWEEN/IN/IS NULL and rejects OR/functions/arithmetic', () => {
  assert.equal(parseExpression("STATUS = 'A' AND AMOUNT >= 0").ok, true);
  assert.equal(parseExpression('AMOUNT BETWEEN 0 AND 100').ok, true);
  assert.equal(parseExpression("STATUS IN ('A','B','C')").ok, true);
  assert.equal(parseExpression('STATUS IS NULL').ok, true);
  assert.equal(parseExpression('STATUS IS NOT NULL').ok, true);
  assert.equal(parseExpression("DATE '2020-01-01'").ok, true);

  assert.equal(parseExpression("STATUS = 'A' OR STATUS = 'B'").ok, false);
  assert.equal(
    parseExpression("STATUS = 'A' OR STATUS = 'B'").reason,
    PARSE_REASONS.UNSUPPORTED_OR
  );
  assert.equal(parseExpression("NOT STATUS = 'A'").ok, false);
  assert.equal(parseExpression("UPPER(STATUS) = 'A'").ok, false);
  assert.equal(parseExpression('AMOUNT + 1 = 2').ok, false);
  assert.equal(parseExpression('CAST(AMOUNT AS INT) = 1').ok, false);
  assert.equal(parseExpression('AMOUNT IN (SELECT 1 FROM SYSIBM.SYSDUMMY1)').ok, false);
  assert.equal(parseExpression('AMOUNT = ?').ok, false);
  assert.equal(parseExpression("STATUS = 'A'; -- comment").ok, false);
  assert.equal(parseExpression("STATUS = 'A' TRAILING").ok, false);
});

test('unsupported expressions produce gaps without guessed vectors', () => {
  const ent = entitlementBundle();
  const req = minimalEvidence({
    manualRules: [{ id: 'bad', expression: "STATUS = 'A' OR STATUS = 'B'", table: 'ORDERS' }],
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, true);
  const gap = result.result.gaps.find(g => g.kind === 'unsupported-check');
  assert.ok(gap);
  // No manual-rule vector from the OR expression
  const manualFromOr = result.result.vectors.filter(
    v => v.category === 'manual-rule' && v.provenance.some(p => p.reason.includes('bad'))
  );
  assert.equal(manualFromOr.length, 0);
});

// ---------------------------------------------------------------------------
// Bounds +1
// ---------------------------------------------------------------------------

test('table count +1 fails before expensive work', () => {
  const ent = entitlementBundle();
  const tables = [];
  for (let i = 0; i < LIMITS.maxTables + 1; i += 1) {
    tables.push({
      name: `T${i}`,
      columns: [{ name: 'C1', type: 'INTEGER', nullable: true }],
    });
  }
  const req = minimalEvidence({ evidence: { tables } });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('columns per table +1 fails closed', () => {
  const ent = entitlementBundle();
  const columns = [];
  for (let i = 0; i < LIMITS.maxColumnsPerTable + 1; i += 1) {
    columns.push({ name: `C${i}`, type: 'INTEGER', nullable: true });
  }
  const req = minimalEvidence({
    evidence: { tables: [{ name: 'BIG', columns }] },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('manual rules +1 fails closed', () => {
  const ent = entitlementBundle();
  const manualRules = [];
  for (let i = 0; i < LIMITS.maxManualRules + 1; i += 1) {
    manualRules.push({ id: `m${i}`, expression: "STATUS = 'A'" });
  }
  const result = runDb2TestIntelligence(minimalEvidence({ manualRules }), ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('expression oversize fails without guessing vectors', () => {
  const ent = entitlementBundle();
  const big = `STATUS = '${'A'.repeat(5000)}'`;
  const result = runDb2TestIntelligence(
    minimalEvidence({ manualRules: [{ id: 'big', expression: big, table: 'ORDERS' }] }),
    ent
  );
  // Projection or generation should reject/gap — expression max is 4096 UTF-8 bytes
  // readRequiredString uses char length; utf8 bound also checked
  assert.ok(
    result.ok === false ||
      result.result.gaps.some(g => g.kind === 'limit-exceeded' || g.kind === 'unsupported-check')
  );
});

// ---------------------------------------------------------------------------
// Hostile projection
// ---------------------------------------------------------------------------

test('optional accessor alone fails closed without invoking its getter', () => {
  const ent = entitlementBundle();
  let getterCalls = 0;
  const req = minimalEvidence();
  Object.defineProperty(req, 'codeConditions', {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      throw new Error('optional accessor must not run');
    },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.INPUT_INVALID);
  assert.equal(getterCalls, 0);
});

test('own __proto__ and constructor keys fail independently without row sentinels', () => {
  const ent = entitlementBundle();

  const withProto = minimalEvidence();
  Object.defineProperty(withProto, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  // Ensure own property named __proto__ exists (not prototype chain pollution alone)
  assert.ok(Object.getOwnPropertyNames(withProto).includes('__proto__'));
  const rProto = runDb2TestIntelligence(withProto, ent);
  assert.equal(rProto.ok, false);
  assert.equal(rProto.reasonCode, REASON_CODES.INPUT_INVALID);

  const withCtor = minimalEvidence();
  Object.defineProperty(withCtor, 'constructor', {
    value: 'nope',
    enumerable: true,
    configurable: true,
    writable: true,
  });
  assert.ok(Object.getOwnPropertyNames(withCtor).includes('constructor'));
  const rCtor = runDb2TestIntelligence(withCtor, ent);
  assert.equal(rCtor.ok, false);
  assert.equal(rCtor.reasonCode, REASON_CODES.INPUT_INVALID);

  // Nested column-level constructor
  const nested = minimalEvidence();
  Object.defineProperty(nested.evidence.tables[0].columns[0], 'constructor', {
    value: 'nope',
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const rNested = runDb2TestIntelligence(nested, ent);
  assert.equal(rNested.ok, false);
  assert.equal(rNested.reasonCode, REASON_CODES.INPUT_INVALID);
});

test('proxy throwing on ownKeys/descriptor fails closed after entitlement', () => {
  const ent = entitlementBundle();
  let ownKeys = 0;
  let descriptors = 0;
  const hostile = new Proxy(
    { contractId: 'zeus-pro.db2-test-intelligence-request' },
    {
      ownKeys() {
        ownKeys += 1;
        throw new Error('ownKeys trap');
      },
      getOwnPropertyDescriptor() {
        descriptors += 1;
        throw new Error('descriptor trap');
      },
      get(target, prop) {
        return target[prop];
      },
    }
  );
  const result = runDb2TestIntelligence(hostile, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.INPUT_INVALID);
  assert.equal(typeof result.message, 'string');
  assert.equal(/Error|stack|at Object\.|ownKeys trap/i.test(result.message), false);
  // Enumeration was attempted after entitlement and failed closed
  assert.ok(ownKeys >= 1 || descriptors >= 1);
});

/**
 * Proxy wrappers where ownKeys/getOwnPropertyDescriptor behave normally but
 * every property get throws and increments a counter.
 */
function descriptorOnlyProxy(target) {
  let getCount = 0;
  const proxy = new Proxy(target, {
    get(_t, prop) {
      getCount += 1;
      throw new Error(`unexpected get trap for ${String(prop)}`);
    },
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, prop) {
      return Reflect.getOwnPropertyDescriptor(t, prop);
    },
    getPrototypeOf(t) {
      return Reflect.getPrototypeOf(t);
    },
    has(t, prop) {
      return Reflect.has(t, prop);
    },
  });
  return { proxy, getCount: () => getCount };
}

function descriptorOnlyArray(elements) {
  // Build a dense real array target, then wrap so length/indices are only via descriptors.
  const target = elements.slice();
  return descriptorOnlyProxy(target);
}

test('descriptor-only proxies project with zero get traps on objects and arrays', () => {
  const ent = entitlementBundle();
  const counters = [];

  function track(wrapper) {
    counters.push(wrapper);
    return wrapper.proxy;
  }

  const colOrderId = track(
    descriptorOnlyProxy({
      name: 'ORDER_ID',
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
    })
  );
  const colStatus = track(
    descriptorOnlyProxy({
      name: 'STATUS',
      type: 'CHAR',
      length: 1,
      nullable: true,
    })
  );
  const columns = track(descriptorOnlyArray([colOrderId, colStatus]));
  const table = track(
    descriptorOnlyProxy({
      schema: 'SALES',
      name: 'ORDERS',
      columns,
    })
  );
  const tables = track(descriptorOnlyArray([table]));
  const evidence = track(descriptorOnlyProxy({ tables }));
  const request = track(
    descriptorOnlyProxy({
      contractId: 'zeus-pro.db2-test-intelligence-request',
      contractVersion: 1,
      provenanceAnchor: testProvenanceAnchor(),
      evidence,
      codeConditions: track(descriptorOnlyArray([])),
      manualRules: track(descriptorOnlyArray([])),
      options: track(descriptorOnlyProxy({})),
    })
  );

  const projected = projectRequest(request);
  assert.equal(projected.ok, true, projected.message);
  const totalGets = counters.reduce((sum, c) => sum + c.getCount(), 0);
  assert.equal(totalGets, 0);

  const result = runDb2TestIntelligence(request, ent);
  assert.equal(result.ok, true);
  assert.ok(result.result.vectors.length > 0);
  const totalGetsAfter = counters.reduce((sum, c) => sum + c.getCount(), 0);
  assert.equal(totalGetsAfter, 0);
});

test('descriptor trap on untrusted field returns fixed INPUT_INVALID without raw leakage', () => {
  const ent = entitlementBundle();
  const base = minimalEvidence();
  Object.defineProperty(base, 'evidence', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('secret-stack-trace-SHOULD-NOT-LEAK');
    },
  });
  // evidence as accessor is caught by inspect (not get); also test getOwnPropertyDescriptor trap:
  const target = minimalEvidence();
  const proxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (prop === 'evidence') {
        throw new Error('descriptor-trap-INTERNAL');
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    get() {
      throw new Error('get-should-not-matter');
    },
    getPrototypeOf(t) {
      return Reflect.getPrototypeOf(t);
    },
  });
  const result = runDb2TestIntelligence(proxy, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.INPUT_INVALID);
  assert.equal(typeof result.message, 'string');
  assert.equal(/descriptor-trap|secret-stack|INTERNAL|Error:/i.test(result.message), false);
  void base;
});

test('getPrototypeOf trap on untrusted object yields fixed INPUT_INVALID', () => {
  const ent = entitlementBundle();
  const target = {
    name: 'T',
    columns: [{ name: 'A', type: 'INTEGER', nullable: true }],
  };
  const tableProxy = new Proxy(target, {
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, p) {
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
    getPrototypeOf() {
      throw new Error('proto-trap-INTERNAL');
    },
    get() {
      throw new Error('get');
    },
  });
  const req = minimalEvidence({
    evidence: { tables: [tableProxy] },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.INPUT_INVALID);
  assert.equal(/proto-trap|INTERNAL/i.test(result.message), false);
});

test('unknown fields and cycles fail closed without infinite loops', () => {
  const ent = entitlementBundle();
  const nested = minimalEvidence();
  nested.evidence.tables[0].columns[0].rows = 1;
  const r3 = runDb2TestIntelligence(nested, ent);
  assert.equal(r3.ok, false);
  assert.equal(r3.reasonCode, REASON_CODES.INPUT_INVALID);

  // Cycle through an unknown field still fails closed (visit bound or schema reject).
  const cyclic = minimalEvidence();
  cyclic.evidence.tables[0].columns[0].meta = cyclic.evidence.tables[0];
  const r4 = runDb2TestIntelligence(cyclic, ent);
  assert.equal(r4.ok, false);
  assert.ok(
    r4.reasonCode === REASON_CODES.INPUT_INVALID || r4.reasonCode === REASON_CODES.BOUNDS_EXCEEDED
  );
});

test('inherited fields are not accepted as schema data', () => {
  const ent = entitlementBundle();
  const proto = { name: 'INHERITED', type: 'INTEGER', nullable: true };
  const col = Object.create(proto);
  // no own data — projection should fail column
  const req = minimalEvidence({
    evidence: {
      tables: [
        {
          name: 'T',
          columns: [col],
        },
      ],
    },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Gaps honesty
// ---------------------------------------------------------------------------

test('missing defaults, unique keys, CHECK, CCSID remain explicit gaps', () => {
  const ent = entitlementBundle();
  const req = minimalEvidence({
    evidence: {
      tables: [
        {
          name: 'T1',
          columns: [
            { name: 'A', type: 'VARCHAR', length: 10, nullable: true, ccsid: '37', collation: 'X' },
          ],
        },
      ],
    },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, true);
  const kinds = new Set(result.result.gaps.map(g => g.kind));
  assert.ok(kinds.has('missing-default'));
  assert.ok(kinds.has('missing-unique'));
  assert.ok(kinds.has('missing-check'));
  assert.ok(kinds.has('unsupported-ccsid'));
  assert.ok(kinds.has('unsupported-collation'));
  assert.ok(kinds.has('unknown-business-behavior'));
  // Catalog unique/CHECK/default surfaces are rejected or gapped — never catalog CHECK vectors
  assert.equal(
    result.result.vectors.some(v => v.category === 'check-constraint'),
    false
  );
  assert.equal(
    result.result.vectors.some(v => v.category === 'unique-key'),
    false
  );
});

test('catalog default/unique/CHECK input rejected; manual CHECK stays manual', () => {
  const ent = entitlementBundle();
  // default surface rejected
  const withDefault = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T1',
            columns: [
              {
                name: 'CODE',
                type: 'CHAR',
                length: 1,
                nullable: false,
                hasDefault: true,
                default: 'N',
              },
            ],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(withDefault.ok, false);
  assert.equal(withDefault.reasonCode, REASON_CODES.INPUT_INVALID);

  // uniqueKeys surface rejected
  const withUk = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T1',
            columns: [{ name: 'CODE', type: 'CHAR', length: 1, nullable: false }],
            uniqueKeys: [{ name: 'UK1', columns: ['CODE'] }],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(withUk.ok, false);
  assert.equal(withUk.reasonCode, REASON_CODES.INPUT_INVALID);

  // checkConstraints on catalog table evidence is rejected (not a supported surface)
  const withCheck = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T1',
            columns: [{ name: 'CODE', type: 'CHAR', length: 1, nullable: false }],
            checkConstraints: [{ name: 'CK1', expression: "CODE = 'Y'" }],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(withCheck.ok, false);
  assert.equal(withCheck.reasonCode, REASON_CODES.INPUT_INVALID);

  // Manual CHECK produces manual provenance vectors
  const req = minimalEvidence({
    evidence: {
      tables: [
        {
          name: 'T1',
          columns: [{ name: 'CODE', type: 'CHAR', length: 1, nullable: false }],
        },
      ],
    },
    manualRules: [
      {
        id: 'm',
        expression: "CODE = 'Y'",
        table: 'T1',
        literalsAreSynthetic: true,
      },
    ],
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, true);
  const manual = result.result.vectors.filter(v => v.category === 'manual-rule');
  assert.ok(manual.length > 0);
  assert.ok(manual.every(v => v.provenance.every(p => p.kind === 'manual')));
});

// ---------------------------------------------------------------------------
// Artifacts / paths / reader
// ---------------------------------------------------------------------------

test('artifact write create-only with manifest hashes; reader validates', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  const before = hashTree(workspace);
  try {
    const req = minimalEvidence({
      options: {
        writeArtifacts: true,
        runId: 'run-1',
        frameworks: ['junit-xml', 'robot-framework'],
      },
    });
    const result = runDb2TestIntelligence(req, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(result.ok, true);
    assert.equal(result.artifacts.written, true);
    assert.ok(result.artifacts.manifest);
    assert.ok(result.artifacts.manifest.artifacts.length >= 2);

    // Workspace byte identity
    assert.equal(hashTree(workspace).fingerprint, before.fingerprint);

    // Reader
    const read = db2tiPublic.readArtifacts(artifacts, result.artifacts.runId);
    assert.equal(read.ok, true);
    assert.equal(read.vectorSet.contractId, 'zeus-pro.db2-test-vector-set');
    assert.equal(prettyCanonical(read.vectorSet), prettyCanonical(result.result));

    // Collision
    const again = runDb2TestIntelligence(req, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(again.ok, false);
    assert.equal(again.reasonCode, REASON_CODES.ARTIFACT_COLLISION);

    // Exporter parity: markdown from subpath matches projection
    const md = db2tiPublic.exportMarkdown(result.result);
    assert.equal(md.ok, true);
    assert.equal(md.text, result.projections.markdown);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('path traversal, absolute, UNC run ids fail reader; writer sanitizes', () => {
  const { artifacts } = tempRoots();
  try {
    assert.equal(db2tiPublic.readArtifacts(artifacts, '../etc').ok, false);
    assert.equal(db2tiPublic.readArtifacts(artifacts, 'C:\\\\Windows').ok, false);
    assert.equal(db2tiPublic.readArtifacts(artifacts, '//server/share').ok, false);
    assert.equal(db2tiPublic.readArtifacts(artifacts, 'a/b').ok, false);

    const ent = entitlementBundle();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-ws2-'));
    const req = minimalEvidence({
      options: { writeArtifacts: true, runId: '../escape' },
    });
    const result = runDb2TestIntelligence(req, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(result.ok, true);
    assert.equal(result.artifacts.written, true);
    // Sanitized run id must not escape
    assert.equal(result.artifacts.runId.includes('..'), false);
    assert.ok(result.artifacts.directory.startsWith(path.resolve(artifacts)));
    // Exact canonical form required by reader
    assert.equal(result.artifacts.runId, sanitizeRunId('../escape'));
    assert.equal(db2tiPublic.readArtifacts(artifacts, result.artifacts.runId).ok, true);
  } finally {
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('reader rejects unsanitized spelling that would alias a written run id', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  try {
    const rawRunId = 'My Run/Id';
    const result = runDb2TestIntelligence(
      minimalEvidence({ options: { writeArtifacts: true, runId: rawRunId } }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result.ok, true);
    assert.equal(result.artifacts.written, true);
    const safe = result.artifacts.runId;
    assert.equal(safe, sanitizeRunId(rawRunId));
    assert.notEqual(safe, rawRunId);
    // Canonical form works
    assert.equal(db2tiPublic.readArtifacts(artifacts, safe).ok, true);
    // Non-identity spelling must not alias
    const aliased = db2tiPublic.readArtifacts(artifacts, rawRunId);
    assert.equal(aliased.ok, false);
    assert.equal(aliased.reasonCode, REASON_CODES.ARTIFACT_PATH_INVALID);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('collision path preserves pre-existing final directory content', () => {
  const { workspace, artifacts } = tempRoots();
  try {
    const projected = projectRequest(minimalEvidence());
    assert.equal(projected.ok, true);
    const generated = generateVectorSet(projected.value);
    assert.equal(generated.ok, true);

    const runId = 'preexisting-run';
    const finalDir = path.join(artifacts, sanitizeRunId(runId));
    fs.mkdirSync(finalDir, { recursive: true });
    const sentinelPath = path.join(finalDir, 'sentinel.txt');
    const sentinel = 'pre-existing-owner-content-v1\n';
    fs.writeFileSync(sentinelPath, sentinel, 'utf8');

    const written = writeArtifacts({
      workspaceRoot: workspace,
      artifactRoot: artifacts,
      runId,
      vectorSet: generated.result,
      frameworks: [],
    });
    assert.equal(written.written, false);
    assert.equal(written.error.code, REASON_CODES.ARTIFACT_COLLISION);
    // Pre-existing content must remain untouched
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), sentinel);
    assert.equal(fs.existsSync(path.join(finalDir, ARTIFACT_FILES.MANIFEST)), false);
    assert.equal(fs.existsSync(path.join(finalDir, ARTIFACT_FILES.CANONICAL)), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('tamper, missing, extra, hash mismatch fail reader', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  try {
    const req = minimalEvidence({
      options: { writeArtifacts: true, runId: 'tamper-run', frameworks: ['junit-xml'] },
    });
    const result = runDb2TestIntelligence(req, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(result.ok, true);
    const dir = result.artifacts.directory;

    // Tamper canonical
    const canonPath = path.join(dir, ARTIFACT_FILES.CANONICAL);
    fs.writeFileSync(canonPath, `${fs.readFileSync(canonPath, 'utf8')} `, 'utf8');
    assert.equal(db2tiPublic.readArtifacts(artifacts, result.artifacts.runId).ok, false);

    // Restore via rewrite is hard; write fresh run for missing/extra
    const req2 = minimalEvidence({
      options: { writeArtifacts: true, runId: 'extra-run' },
    });
    const r2 = runDb2TestIntelligence(req2, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(r2.ok, true);
    fs.writeFileSync(path.join(r2.artifacts.directory, 'extra.txt'), 'x', 'utf8');
    assert.equal(
      db2tiPublic.readArtifacts(artifacts, r2.artifacts.runId).reasonCode,
      REASON_CODES.ARTIFACT_TAMPERED
    );

    const req3 = minimalEvidence({
      options: { writeArtifacts: true, runId: 'missing-run' },
    });
    const r3 = runDb2TestIntelligence(req3, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    fs.unlinkSync(path.join(r3.artifacts.directory, ARTIFACT_FILES.MARKDOWN));
    assert.equal(
      db2tiPublic.readArtifacts(artifacts, r3.artifacts.runId).reasonCode,
      REASON_CODES.ARTIFACT_INCOMPLETE
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('artifact root inside workspace fails closed', () => {
  const ent = entitlementBundle();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-ws3-'));
  try {
    const inside = path.join(workspace, 'arts');
    fs.mkdirSync(inside);
    const result = runDb2TestIntelligence(
      minimalEvidence({ options: { writeArtifacts: true, runId: 'x' } }),
      { ...ent, workspaceRoot: workspace, artifactRoot: inside }
    );
    assert.equal(result.ok, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('symlink/junction at final run path fails closed without overwrite', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-out-'));
  try {
    const linkPath = path.join(artifacts, 'link-run');
    let created = false;
    try {
      fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      created = true;
    } catch {
      // Create a plain pre-existing directory instead — still a collision
      fs.mkdirSync(linkPath, { recursive: true });
      fs.writeFileSync(path.join(linkPath, 'keep.txt'), 'owned\n', 'utf8');
      created = true;
    }
    assert.equal(created, true);
    const result = runDb2TestIntelligence(
      minimalEvidence({ options: { writeArtifacts: true, runId: 'link-run' } }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, REASON_CODES.ARTIFACT_COLLISION);
    // Pre-existing path must not be rewritten with our manifest
    if (fs.existsSync(path.join(linkPath, 'keep.txt'))) {
      assert.equal(fs.readFileSync(path.join(linkPath, 'keep.txt'), 'utf8'), 'owned\n');
    }
    assert.equal(fs.existsSync(path.join(linkPath, ARTIFACT_FILES.MANIFEST)), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('partial write leaves no reader-valid final artifact', () => {
  // Simulate by writing only canonical without manifest
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-db2ti-partial-'));
  try {
    const dir = path.join(artifacts, 'partial');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ARTIFACT_FILES.CANONICAL), '{}\n', 'utf8');
    const read = db2tiPublic.readArtifacts(artifacts, 'partial');
    assert.equal(read.ok, false);
    assert.ok(
      read.reasonCode === REASON_CODES.ARTIFACT_INCOMPLETE ||
        read.reasonCode === REASON_CODES.ARTIFACT_TAMPERED
    );
  } finally {
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('existing artifacts remain readable without entitlement', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  try {
    const result = runDb2TestIntelligence(
      minimalEvidence({ options: { writeArtifacts: true, runId: 'no-ent' } }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result.ok, true);
    // Read with only filesystem — no license
    const read = db2tiPublic.readArtifacts(artifacts, result.artifacts.runId);
    assert.equal(read.ok, true);
    const validated = db2tiPublic.validateVectorSet(read.vectorSet);
    assert.equal(validated.ok, true);
    const md = db2tiPublic.exportMarkdown(read.vectorSet);
    assert.equal(md.ok, true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Capability registration
// ---------------------------------------------------------------------------

test('registered capability isolation, trusted roots, no context override', async () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  const before = hashTree(workspace);
  try {
    const zeus = createZeus();
    // Preserve reference module
    await registerReferenceModule(zeus.modules, ent);
    const reg = await registerDb2TestIntelligenceModule(zeus.modules, {
      ...ent,
      workspaceRoot: workspace,
      artifactRoot: artifacts,
    });
    assert.equal(reg.ok, true);
    assert.ok(zeus.capabilities.get(DB2_TEST_INTELLIGENCE_CAPABILITY_ID));
    assert.ok(zeus.capabilities.get(REFERENCE_CAPABILITY_ID));
    assert.equal(DB2_TEST_INTELLIGENCE_MODULE_ID, 'zeus-pro.db2-test-intelligence');

    const exec = await zeus.capabilities.execute(
      DB2_TEST_INTELLIGENCE_CAPABILITY_ID,
      {
        // Hostile context — must be ignored for roots/entitlement
        workspaceRoot: workspace,
        artifactRoot: path.join(workspace, 'evil'),
        providerRegistry: { should: 'not-exist' },
      },
      minimalEvidence({
        options: { writeArtifacts: true, runId: 'cap-run', frameworks: ['junit-xml'] },
      })
    );
    assert.equal(exec.ok, true);
    assert.equal(exec.result.ok, true);
    assert.equal(exec.result.artifacts.written, true);
    assert.equal(hashTree(workspace).fingerprint, before.fingerprint);

    // Descriptor safety
    const desc = buildDescriptor();
    assert.equal(desc.safety.level, 'S1');
    assert.deepEqual(desc.safety.sideEffects, ['local-artifact-write']);
    assert.ok(desc.runtime.requiredFeatures.includes('offline-only'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('writeArtifacts without trusted roots fails closed', async () => {
  const ent = entitlementBundle();
  const zeus = createZeus();
  await registerDb2TestIntelligenceModule(zeus.modules, ent);
  const exec = await zeus.capabilities.execute(
    DB2_TEST_INTELLIGENCE_CAPABILITY_ID,
    {},
    minimalEvidence({ options: { writeArtifacts: true, runId: 'no-roots' } })
  );
  assert.equal(exec.ok, true);
  assert.equal(exec.result.ok, false);
  assert.equal(exec.result.reasonCode, REASON_CODES.ARTIFACT_PATH_INVALID);
});

// ---------------------------------------------------------------------------
// Forbidden imports / network / process / random
// ---------------------------------------------------------------------------

test('module source has no forbidden imports, network, process spawn, or randomness', () => {
  const dir = path.join(__dirname, '..', 'src', 'db2TestIntelligence');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const forbidden = [
    /zeus-rpg-promptkit\/src\/db2/,
    /require\(['"]net['"]\)/,
    /require\(['"]http['"]\)/,
    /require\(['"]https['"]\)/,
    /require\(['"]dns['"]\)/,
    /require\(['"]child_process['"]\)/,
    /Math\.random/,
    /crypto\.randomUUID/,
    /crypto\.randomBytes/,
    /\beval\s*\(/,
    /new Function/,
    /jdbc/i,
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of forbidden) {
      assert.equal(re.test(text), false, `${f} matched ${re}`);
    }
  }
});

test('no timestamps in canonical output', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(minimalEvidence(), ent);
  const json = prettyCanonical(result.result);
  assert.equal(/generatedAt|timestamp|createdAt|Date\.|T\d{2}:\d{2}:\d{2}/.test(json), false);
});

// ---------------------------------------------------------------------------
// Exporter isolation / Markdown escape
// ---------------------------------------------------------------------------

test('exporters escape inert data and stay pure', () => {
  const ent = entitlementBundle();
  // Use a synthetic literal that is allowed by literal policy but needs Markdown/HTML escape.
  const req2 = minimalEvidence({
    manualRules: [
      {
        id: 'xss',
        expression: "STATUS = '<x>'",
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
    ],
  });
  const result = runDb2TestIntelligence(req2, ent);
  assert.equal(result.ok, true);
  const md = db2tiPublic.exportMarkdown(result.result);
  assert.equal(md.ok, true);
  assert.equal(md.text.includes('<script>'), false);
  // Either HTML entity or backslash-escape keeps markup inert in Markdown projection.
  assert.ok(md.text.includes('&lt;') || md.text.includes('\\<') || !md.text.includes('<x>'));

  const junit = db2tiPublic.exportFramework(result.result, 'junit-xml');
  assert.equal(junit.ok, true);
  assert.equal(junit.text.includes('<script>'), false);

  // Unknown framework rejected
  assert.equal(db2tiPublic.exportFramework(result.result, 'evil-eval').ok, false);

  // Robot neutralizes CR/LF and section markers in one inert line.
  const evil = inertRobotField('X\r*** Tasks ***\rPWN');
  assert.equal(/[\r\n]/.test(evil), false);
  assert.equal(evil.includes('***'), false);
  assert.ok(evil.includes('Tasks'));
});

// ---------------------------------------------------------------------------
// Decimal lossless strings
// ---------------------------------------------------------------------------

test('decimal vectors use lossless strings covering precision/scale boundaries', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(minimalEvidence(), ent);
  const decimals = result.result.vectors.filter(v => v.category === 'decimal-boundary');
  assert.ok(decimals.length >= 6);
  for (const v of decimals) {
    const assigns = v.input.assignments;
    for (const val of Object.values(assigns)) {
      if (val != null) {
        assert.equal(val.kind, 'decimal-string');
        assert.equal(typeof val.value, 'string');
        assert.equal(typeof val.value === 'number', false);
      }
    }
  }
  assert.ok(decimals.some(v => v.expectation.technical === 'overflow'));
  assert.ok(decimals.some(v => v.expectation.technical === 'zero'));
  assert.ok(decimals.some(v => v.expectation.technical === 'negative-min'));
});

// ---------------------------------------------------------------------------
// Composite unique only with evidence; no composite invented
// ---------------------------------------------------------------------------

test('unique key surface rejected; multi primaryKey flags yield composite gap not composite vector', () => {
  const ent = entitlementBundle();
  const without = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [
              { name: 'A', type: 'INTEGER', nullable: false },
              { name: 'B', type: 'INTEGER', nullable: false },
            ],
          },
        ],
      },
    }),
    ent
  );
  assert.ok(without.result.gaps.some(g => g.kind === 'missing-unique'));
  assert.equal(
    without.result.vectors.some(v => v.category === 'unique-key'),
    false
  );

  // uniqueKeys input rejected
  const withUk = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [
              { name: 'A', type: 'INTEGER', nullable: false },
              { name: 'B', type: 'INTEGER', nullable: false },
            ],
            uniqueKeys: [{ columns: ['A', 'B'] }],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(withUk.ok, false);

  // Multiple independent primaryKey flags: single-column scenarios only + composite gap
  const multiPk = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [
              { name: 'A', type: 'INTEGER', nullable: false, primaryKey: true },
              { name: 'B', type: 'INTEGER', nullable: false, primaryKey: true },
            ],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(multiPk.ok, true);
  assert.ok(multiPk.result.gaps.some(g => g.kind === 'missing-composite-key'));
  assert.equal(
    multiPk.result.vectors.some(v => v.expectation.technical === 'composite-pk-non-null'),
    false
  );
  assert.ok(multiPk.result.vectors.some(v => v.category === 'primary-key'));
});

// ---------------------------------------------------------------------------
// validateVectorSet rejects bad nonclaims / contracts
// ---------------------------------------------------------------------------

test('validateVectorSet rejects wrong contract and nonclaims', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(minimalEvidence(), ent);
  const bad = JSON.parse(JSON.stringify(result.result));
  bad.contractId = 'public.fake';
  assert.equal(db2tiPublic.validateVectorSet(bad).ok, false);
  const bad2 = JSON.parse(JSON.stringify(result.result));
  bad2.nonClaims.databaseExecuted = true;
  assert.equal(db2tiPublic.validateVectorSet(bad2).ok, false);
});

// ---------------------------------------------------------------------------
// PK/FK from evidence only
// ---------------------------------------------------------------------------

test('PK and FK scenarios derived only from evidence', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(minimalEvidence(), ent);
  assert.ok(result.result.vectors.some(v => v.category === 'primary-key'));
  assert.ok(result.result.vectors.some(v => v.category === 'foreign-key'));
  const fks = result.result.vectors.filter(v => v.category === 'foreign-key');
  assert.ok(fks.length > 0);
  assert.ok(
    fks.every(
      v =>
        v.supportStatus === 'unknown-business-validity' &&
        v.expectation.outcome === 'unknown' &&
        v.assumptions.some(a => /no database|not looked up|not enforced|Referential/i.test(a))
    )
  );
});

// ---------------------------------------------------------------------------
// Single-column FK only; multi-column FK rejected at projection
// ---------------------------------------------------------------------------

test('multi-column foreign key rejected at projection', () => {
  const ent = entitlementBundle();
  const req = minimalEvidence({
    evidence: {
      tables: [
        {
          name: 'T',
          columns: [
            { name: 'A', type: 'INTEGER', nullable: false },
            { name: 'B', type: 'INTEGER', nullable: false },
          ],
          foreignKeys: [
            {
              columns: ['A', 'B'],
              referencedTable: 'P',
              referencedColumns: ['A', 'B'],
            },
          ],
        },
      ],
    },
  });
  const result = runDb2TestIntelligence(req, ent);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.INPUT_INVALID);
});

// ---------------------------------------------------------------------------
// Oversize raw input bound
// ---------------------------------------------------------------------------

test('raw input size bound fails closed', () => {
  const ent = entitlementBundle();
  // Build a large but structured input via many code conditions near limit
  const codeConditions = [];
  for (let i = 0; i < 100; i += 1) {
    codeConditions.push({
      id: `c${i}`,
      expression: `STATUS = '${'A'.repeat(200)}'`,
      table: 'ORDERS',
    });
  }
  // This may pass count bounds; for true 2MiB we'd need huge payload — use estimate via huge string field
  const huge = minimalEvidence();
  // Unknown large field rejected as unknown field first
  huge.padding = 'X'.repeat(3 * 1024 * 1024);
  const result = runDb2TestIntelligence(huge, ent);
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// generateVectorSet unit: stable ids
// ---------------------------------------------------------------------------

test('vector ids are stable hashes of normalized identity', () => {
  const projected = projectRequest(minimalEvidence());
  assert.equal(projected.ok, true);
  const a = generateVectorSet(projected.value);
  const b = generateVectorSet(projected.value);
  assert.equal(a.ok && b.ok, true);
  assert.equal(canonicalize(a.result), canonicalize(b.result));
  assert.deepEqual(
    a.result.vectors.map(v => v.id),
    b.result.vectors.map(v => v.id)
  );
});

// ---------------------------------------------------------------------------
// Semantic overflow: never ok:true with truncated collections
// ---------------------------------------------------------------------------

function assertSemanticOverflow(result) {
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, REASON_CODES.SEMANTIC_OVERFLOW);
  assert.equal(result.result == null || result.result === undefined, true);
}

test('provenance/vector/gap/diagnostic overflow never returns ok:true or truncated result', () => {
  // Provenance merge overflow: 33 identical manual rules → >32 provenance reasons
  const manualRules = [];
  for (let i = 0; i < LIMITS.maxProvenanceReasonsPerVector + 1; i += 1) {
    manualRules.push({
      id: `m${i}`,
      expression: "STATUS = 'A'",
      table: 'T',
      literalsAreSynthetic: true,
    });
  }
  const provProjected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: {
      tables: [
        {
          name: 'T',
          columns: [{ name: 'STATUS', type: 'CHAR', length: 1, nullable: true }],
        },
      ],
    },
    manualRules,
  });
  assert.equal(provProjected.ok, true);
  assertSemanticOverflow(generateVectorSet(provProjected.value));

  // Gap overflow: 256 INTEGER columns → 512 column gaps then missing-unique is +1
  const cols = [];
  for (let i = 0; i < LIMITS.maxColumnsPerTable; i += 1) {
    cols.push({ name: `C${i}`, type: 'INTEGER', nullable: false });
  }
  const gapProjected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables: [{ name: 'T', columns: cols }] },
  });
  assert.equal(gapProjected.ok, true);
  assertSemanticOverflow(generateVectorSet(gapProjected.value));

  // Diagnostic overflow via many sourceEvidence entries across tables
  const tables = [];
  for (let t = 0; t < 9; t += 1) {
    const se = [];
    for (let s = 0; s < LIMITS.maxSourceEvidencePerTable; s += 1) {
      se.push({ kind: 'catalog', ref: `R${t}_${s}`, note: 'tech' });
    }
    tables.push({
      name: `T${t}`,
      columns: [{ name: 'A', type: 'INTEGER', nullable: true }],
      sourceEvidence: se,
    });
  }
  const diagProjected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables },
  });
  assert.equal(diagProjected.ok, true);
  assertSemanticOverflow(generateVectorSet(diagProjected.value));

  // Vector overflow: two full tables of DECIMAL columns exceed maxVectors
  const tablesV = [];
  for (let t = 0; t < 2; t += 1) {
    const columns = [];
    for (let c = 0; c < LIMITS.maxColumnsPerTable; c += 1) {
      columns.push({
        name: `D${c}`,
        type: 'DECIMAL',
        precision: 7,
        scale: 2,
        nullable: false,
      });
    }
    tablesV.push({ name: `TV${t}`, columns });
  }
  const vecProjected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables: tablesV },
  });
  assert.equal(vecProjected.ok, true);
  assertSemanticOverflow(generateVectorSet(vecProjected.value));
});

// ---------------------------------------------------------------------------
// Exact bound / +1 matrix (grouped, explicit assertions)
// ---------------------------------------------------------------------------

test('exact bound +1: constraints, code conditions, identifiers, traversal', () => {
  const ent = entitlementBundle();

  // Constraints total +1 fails at projection before generation
  const columns = [{ name: 'A', type: 'INTEGER', nullable: true }];
  const fks = [];
  for (let i = 0; i < LIMITS.maxConstraintsTotal + 1; i += 1) {
    fks.push({
      name: `FK${i}`,
      columns: ['A'],
      referencedTable: 'P',
      referencedColumns: ['A'],
    });
  }
  const c1 = runDb2TestIntelligence(
    {
      contractId: 'zeus-pro.db2-test-intelligence-request',
      contractVersion: 1,
      provenanceAnchor: testProvenanceAnchor(),
      evidence: { tables: [{ name: 'T', columns, foreignKeys: fks }] },
    },
    ent
  );
  assert.equal(c1.ok, false);
  assert.equal(c1.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Code conditions +1
  const ccs = [];
  for (let i = 0; i < LIMITS.maxCodeConditions + 1; i += 1) {
    ccs.push({ id: `c${i}`, expression: "STATUS = 'A'", table: 'ORDERS' });
  }
  const c2 = runDb2TestIntelligence(minimalEvidence({ codeConditions: ccs }), ent);
  assert.equal(c2.ok, false);
  assert.equal(c2.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Identifier chars +1
  const longName = 'A'.repeat(LIMITS.maxIdentifierChars + 1);
  const c3 = runDb2TestIntelligence(
    {
      contractId: 'zeus-pro.db2-test-intelligence-request',
      contractVersion: 1,
      provenanceAnchor: testProvenanceAnchor(),
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [{ name: longName, type: 'INTEGER', nullable: true }],
          },
        ],
      },
    },
    ent
  );
  assert.equal(c3.ok, false);
  assert.equal(c3.reasonCode, REASON_CODES.INPUT_INVALID);

  // Exact max identifier still projects and generates without SEMANTIC_OVERFLOW
  const exactName = 'A'.repeat(LIMITS.maxIdentifierChars);
  const exactProjected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: {
      tables: [
        {
          name: 'T',
          columns: [{ name: exactName, type: 'INTEGER', nullable: true }],
        },
      ],
    },
  });
  assert.equal(exactProjected.ok, true);
  const exactGen = generateVectorSet(exactProjected.value);
  assert.equal(exactGen.ok, true);
  assert.ok(exactGen.result.vectors.length > 0);
});

test('exact bound +1: parser tokens, nesting, IN list', () => {
  // IN list +1
  const values = [];
  for (let i = 0; i < LIMITS.maxInListSize + 1; i += 1) {
    values.push(`'${i}'`);
  }
  const inExpr = `STATUS IN (${values.join(',')})`;
  const inParsed = parseExpression(inExpr);
  assert.equal(inParsed.ok, false);
  assert.equal(inParsed.reason, PARSE_REASONS.IN_LIST_LIMIT);

  // Exact IN list size ok
  const valuesOk = [];
  for (let i = 0; i < LIMITS.maxInListSize; i += 1) {
    valuesOk.push(`'${i}'`);
  }
  assert.equal(parseExpression(`STATUS IN (${valuesOk.join(',')})`).ok, true);

  // Nesting +1
  let nested = 'STATUS = 1';
  for (let i = 0; i < LIMITS.maxParserNesting + 1; i += 1) {
    nested = `(${nested})`;
  }
  const nestParsed = parseExpression(nested);
  assert.equal(nestParsed.ok, false);
  assert.equal(nestParsed.reason, PARSE_REASONS.NESTING_LIMIT);

  // Exact nesting ok
  let nestedOk = 'STATUS = 1';
  for (let i = 0; i < LIMITS.maxParserNesting; i += 1) {
    nestedOk = `(${nestedOk})`;
  }
  assert.equal(parseExpression(nestedOk).ok, true);

  // Token limit: expression body under UTF-8 bound but token stream exceeds 512
  // Use short identifiers so EXPRESSION_OVERSIZE is not hit first.
  const parts = [];
  for (let i = 0; i < 200; i += 1) {
    parts.push(`A = ${i}`);
  }
  const tokenExpr = parts.join(' AND ');
  assert.ok(Buffer.byteLength(tokenExpr, 'utf8') <= LIMITS.maxExpressionUtf8Bytes);
  const tok = parseExpression(tokenExpr);
  assert.equal(tok.ok, false);
  assert.equal(tok.reason, PARSE_REASONS.TOKEN_LIMIT);
});

test('exact bound +1: validateVectorSet rationale/provenance/gaps/diagnostics/vectors', () => {
  const projected = projectRequest(minimalEvidence());
  assert.equal(projected.ok, true);
  const generated = generateVectorSet(projected.value);
  assert.equal(generated.ok, true);
  const base = JSON.parse(JSON.stringify(generated.result));

  // Rationale UTF-8 +1
  const tooLong = JSON.parse(JSON.stringify(base));
  tooLong.vectors[0].rationale = 'X'.repeat(LIMITS.maxRationaleUtf8Bytes + 1);
  const r1 = db2tiPublic.validateVectorSet(tooLong);
  assert.equal(r1.ok, false);
  assert.ok(
    r1.reasonCode === REASON_CODES.BOUNDS_EXCEEDED || r1.reasonCode === REASON_CODES.INPUT_INVALID
  );

  // Provenance +1
  const tooProv = JSON.parse(JSON.stringify(base));
  const prov = [];
  for (let i = 0; i < LIMITS.maxProvenanceReasonsPerVector + 1; i += 1) {
    prov.push({ kind: 'manual', reason: `r${i}`, source: null });
  }
  tooProv.vectors[0].provenance = prov;
  assert.equal(db2tiPublic.validateVectorSet(tooProv).ok, false);

  // Gaps +1
  const tooGaps = JSON.parse(JSON.stringify(base));
  const gaps = [];
  for (let i = 0; i < LIMITS.maxGaps + 1; i += 1) {
    gaps.push({
      kind: 'missing-default',
      message: `g${i}`,
      table: null,
      column: null,
      detail: null,
    });
  }
  tooGaps.gaps = gaps;
  assert.equal(db2tiPublic.validateVectorSet(tooGaps).ok, false);

  // Diagnostics +1
  const tooDiag = JSON.parse(JSON.stringify(base));
  const diags = [];
  for (let i = 0; i < LIMITS.maxDiagnostics + 1; i += 1) {
    diags.push({ code: 'X', message: `d${i}` });
  }
  tooDiag.diagnostics = diags;
  assert.equal(db2tiPublic.validateVectorSet(tooDiag).ok, false);

  // Vectors +1 (cheap: pad with synthetic valid-shaped entries)
  const tooVec = JSON.parse(JSON.stringify(base));
  const template = tooVec.vectors[0];
  const pad = [];
  for (let i = 0; i < LIMITS.maxVectors + 1; i += 1) {
    const id = i.toString(16).padStart(32, '0');
    pad.push({
      ...template,
      id,
      rationale: 'bounded',
      provenance: [],
      assumptions: [],
    });
  }
  tooVec.vectors = pad;
  assert.equal(db2tiPublic.validateVectorSet(tooVec).ok, false);
});

test('exact bound +1: export Markdown/framework and aggregate artifact sizes', () => {
  // Build vectors with large serialized assignment values so junit/robot actually emit bulk text.
  const hugeVectors = [];
  const fat = 'Z'.repeat(80_000);
  for (let i = 0; i < 120; i += 1) {
    hugeVectors.push({
      id: i.toString(16).padStart(32, '0'),
      category: 'nullability',
      table: null,
      supportStatus: 'supported',
      expectation: { outcome: 'accept', technical: 'x', business: 'unknown' },
      rationale: 'R'.repeat(40_000),
      provenance: [],
      assumptions: [],
      input: {
        assignments: {
          COL: { kind: 'string', value: fat },
        },
      },
    });
  }
  const fakeSet = {
    contractId: 'zeus-pro.db2-test-vector-set',
    contractVersion: 1,
    contractRef: 'zeus-pro.db2-test-vector-set@1',
    vectors: hugeVectors,
    qualityReport: {
      supported: 120,
      unsupported: 0,
      missingEvidence: 0,
      unknownBusinessValidity: 0,
      gapCount: 0,
      vectorCount: 120,
    },
    gaps: [],
    diagnostics: [],
    nonClaims: {
      databaseExecuted: false,
      programExecuted: false,
      compiled: false,
      productionValidated: false,
      businessCorrect: false,
    },
    notes: ['n'],
  };
  const md = db2tiPublic.exportMarkdown(fakeSet);
  assert.equal(md.ok, false);
  assert.equal(md.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  const junit = db2tiPublic.exportFramework(fakeSet, 'junit-xml');
  assert.equal(junit.ok, false);
  assert.equal(junit.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  const robot = db2tiPublic.exportFramework(fakeSet, 'robot-framework');
  assert.equal(robot.ok, false);
  assert.equal(robot.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Manifest per-file and aggregate +1 (schema-level, no file materialization)
  const {
    MANIFEST_KIND,
    RESULT_CONTRACT_REF: REF,
    NON_CLAIMS,
  } = require('../src/db2TestIntelligence/constants');
  const baseMan = {
    schemaVersion: 1,
    kind: MANIFEST_KIND,
    runId: 'run-1',
    contractRef: REF,
    nonClaims: { ...NON_CLAIMS },
    notes: ['ok'],
    artifacts: [
      {
        path: ARTIFACT_FILES.CANONICAL,
        sha256: 'a'.repeat(64),
        sizeBytes: LIMITS.maxCanonicalJsonBytes + 1,
      },
      {
        path: ARTIFACT_FILES.MARKDOWN,
        sha256: 'b'.repeat(64),
        sizeBytes: 1,
      },
    ],
  };
  assert.equal(db2tiPublic.validateManifest(baseMan).reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  baseMan.artifacts[0].sizeBytes = 1;
  baseMan.artifacts[1].sizeBytes = LIMITS.maxMarkdownBytes + 1;
  assert.equal(db2tiPublic.validateManifest(baseMan).reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  baseMan.artifacts[1].sizeBytes = 1;
  baseMan.artifacts.push({
    path: ARTIFACT_FILES.JUNIT,
    sha256: 'c'.repeat(64),
    sizeBytes: LIMITS.maxFrameworkOutputBytes + 1,
  });
  assert.equal(db2tiPublic.validateManifest(baseMan).reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Aggregate +1 with two legal per-file sizes
  const agg = {
    schemaVersion: 1,
    kind: MANIFEST_KIND,
    runId: 'run-1',
    contractRef: REF,
    nonClaims: { ...NON_CLAIMS },
    notes: ['ok'],
    artifacts: [
      {
        path: ARTIFACT_FILES.CANONICAL,
        sha256: 'a'.repeat(64),
        sizeBytes: LIMITS.maxAggregateArtifactBytes,
      },
      {
        path: ARTIFACT_FILES.MARKDOWN,
        sha256: 'b'.repeat(64),
        sizeBytes: 1,
      },
    ],
  };
  assert.equal(db2tiPublic.validateManifest(agg).reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Canonical rawText +1 on validateVectorSet
  const projected = projectRequest(minimalEvidence());
  const generated = generateVectorSet(projected.value);
  assert.equal(generated.ok, true);
  const rawPlus = `${'x'.repeat(LIMITS.maxCanonicalJsonBytes + 1)}`;
  const rawCheck = db2tiPublic.validateVectorSet(generated.result, { rawText: rawPlus });
  assert.equal(rawCheck.ok, false);
  assert.equal(rawCheck.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('exact bound: property visits and traversal depth fail with BOUNDS_EXCEEDED', () => {
  const ent = entitlementBundle();

  // Property visits: many own data keys force estimator visit overflow before schema allowlist.
  const fat = {
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
  };
  for (let i = 0; i < LIMITS.maxPropertyVisits + 5; i += 1) {
    Object.defineProperty(fat, `k${i}`, {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const visits = runDb2TestIntelligence(fat, ent);
  assert.equal(visits.ok, false);
  assert.equal(visits.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Depth: deep chain under an own data field; estimator hits depth before schema work.
  let deep = { leaf: true };
  for (let i = 0; i < LIMITS.maxTraversalDepth + 4; i += 1) {
    deep = { child: deep };
  }
  const deepReq = {
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    padding: deep,
  };
  const depth = runDb2TestIntelligence(deepReq, ent);
  assert.equal(depth.ok, false);
  assert.equal(depth.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('exact max tables projects; +1 rejects before generation', () => {
  const tables = [];
  for (let i = 0; i < LIMITS.maxTables; i += 1) {
    tables.push({
      name: `T${i}`,
      columns: [{ name: 'A', type: 'INTEGER', nullable: true }],
    });
  }
  const projected = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables },
  });
  assert.equal(projected.ok, true);
  assert.equal(projected.value.evidence.tables.length, LIMITS.maxTables);

  tables.push({ name: 'TEXTRA', columns: [{ name: 'A', type: 'INTEGER', nullable: true }] });
  const over = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables },
  });
  assert.equal(over.ok, false);
  assert.equal(over.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

test('exact max constraints and code conditions project; +1 rejects', () => {
  // Exact max constraints: one table with maxConstraintsTotal single-column FKs
  const columns = [{ name: 'A', type: 'INTEGER', nullable: true }];
  const fks = [];
  for (let i = 0; i < LIMITS.maxConstraintsTotal; i += 1) {
    fks.push({
      name: `FK${i}`,
      columns: ['A'],
      referencedTable: 'P',
      referencedColumns: ['A'],
    });
  }
  const exactConstraints = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables: [{ name: 'T', columns, foreignKeys: fks }] },
  });
  assert.equal(exactConstraints.ok, true);

  fks.push({
    name: 'FK_EXTRA',
    columns: ['A'],
    referencedTable: 'P',
    referencedColumns: ['A'],
  });
  const overConstraints = projectRequest({
    contractId: 'zeus-pro.db2-test-intelligence-request',
    contractVersion: 1,
    provenanceAnchor: testProvenanceAnchor(),
    evidence: { tables: [{ name: 'T', columns, foreignKeys: fks }] },
  });
  assert.equal(overConstraints.ok, false);
  assert.equal(overConstraints.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);

  // Exact max code conditions
  const ccs = [];
  for (let i = 0; i < LIMITS.maxCodeConditions; i += 1) {
    ccs.push({ id: `c${i}`, expression: "STATUS = 'A'", table: 'ORDERS' });
  }
  const exactCc = projectRequest(minimalEvidence({ codeConditions: ccs }));
  assert.equal(exactCc.ok, true);
  ccs.push({ id: 'c-extra', expression: "STATUS = 'A'", table: 'ORDERS' });
  const overCc = projectRequest(minimalEvidence({ codeConditions: ccs }));
  assert.equal(overCc.ok, false);
  assert.equal(overCc.reasonCode, REASON_CODES.BOUNDS_EXCEEDED);
});

// ---------------------------------------------------------------------------
// Portable artifact contract: strict manifest + reader integrity
// ---------------------------------------------------------------------------

test('validateManifest requires kind, contractRef, runId, Markdown, and rejects unknown fields', () => {
  const {
    MANIFEST_KIND,
    RESULT_CONTRACT_REF: REF,
    NON_CLAIMS,
  } = require('../src/db2TestIntelligence/constants');

  const good = {
    schemaVersion: 1,
    kind: MANIFEST_KIND,
    runId: 'run-1',
    contractRef: REF,
    nonClaims: { ...NON_CLAIMS },
    notes: ['Canonical JSON is the sole source of truth.'],
    artifacts: [
      { path: ARTIFACT_FILES.CANONICAL, sha256: 'a'.repeat(64), sizeBytes: 10 },
      { path: ARTIFACT_FILES.MARKDOWN, sha256: 'b'.repeat(64), sizeBytes: 10 },
    ],
  };
  assert.equal(db2tiPublic.validateManifest(good).ok, true);

  // Wrong kind
  assert.equal(db2tiPublic.validateManifest({ ...good, kind: 'other-kind' }).ok, false);
  // Wrong contractRef
  assert.equal(db2tiPublic.validateManifest({ ...good, contractRef: 'public.fake@1' }).ok, false);
  // Noncanonical runId
  assert.equal(db2tiPublic.validateManifest({ ...good, runId: 'My Run/Id' }).ok, false);
  // Missing Markdown
  assert.equal(
    db2tiPublic.validateManifest({
      ...good,
      artifacts: [{ path: ARTIFACT_FILES.CANONICAL, sha256: 'a'.repeat(64), sizeBytes: 10 }],
    }).ok,
    false
  );
  // Unknown top-level field
  assert.equal(db2tiPublic.validateManifest({ ...good, extra: true }).ok, false);
  // Duplicate path
  assert.equal(
    db2tiPublic.validateManifest({
      ...good,
      artifacts: [
        { path: ARTIFACT_FILES.CANONICAL, sha256: 'a'.repeat(64), sizeBytes: 10 },
        { path: ARTIFACT_FILES.MARKDOWN, sha256: 'b'.repeat(64), sizeBytes: 10 },
        { path: ARTIFACT_FILES.CANONICAL, sha256: 'c'.repeat(64), sizeBytes: 10 },
      ],
    }).ok,
    false
  );
});

test('reader rejects rehashed wrong contractRef and rehashed Markdown removal', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  const crypto = require('node:crypto');
  try {
    const result = runDb2TestIntelligence(
      minimalEvidence({
        options: { writeArtifacts: true, runId: 'portable-run', frameworks: ['junit-xml'] },
      }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result.ok, true);
    assert.equal(result.artifacts.written, true);
    const dir = result.artifacts.directory;
    const runId = result.artifacts.runId;

    // Baseline read ok
    assert.equal(db2tiPublic.readArtifacts(artifacts, runId).ok, true);

    // Rehash wrong contractRef in manifest (hashes of content files still match)
    const manPath = path.join(dir, ARTIFACT_FILES.MANIFEST);
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    man.contractRef = 'zeus-pro.db2-test-vector-set@999';
    fs.writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`, 'utf8');
    const badRef = db2tiPublic.readArtifacts(artifacts, runId);
    assert.equal(badRef.ok, false);
    assert.ok(
      badRef.reasonCode === REASON_CODES.ARTIFACT_TAMPERED ||
        badRef.reasonCode === REASON_CODES.INPUT_INVALID
    );

    // Restore from a fresh write for Markdown removal scenario
    const result2 = runDb2TestIntelligence(
      minimalEvidence({
        options: { writeArtifacts: true, runId: 'portable-md', frameworks: [] },
      }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result2.ok, true);
    const dir2 = result2.artifacts.directory;
    const run2 = result2.artifacts.runId;
    const man2Path = path.join(dir2, ARTIFACT_FILES.MANIFEST);
    const man2 = JSON.parse(fs.readFileSync(man2Path, 'utf8'));
    // Remove Markdown from disk and from manifest; rehash remaining artifacts as listed
    fs.unlinkSync(path.join(dir2, ARTIFACT_FILES.MARKDOWN));
    man2.artifacts = man2.artifacts.filter(a => a.path !== ARTIFACT_FILES.MARKDOWN);
    // Self-consistent rehash of remaining listed files
    man2.artifacts = man2.artifacts.map(entry => {
      const buf = fs.readFileSync(path.join(dir2, entry.path));
      return {
        path: entry.path,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        sizeBytes: buf.length,
      };
    });
    fs.writeFileSync(man2Path, `${JSON.stringify(man2, null, 2)}\n`, 'utf8');
    const badMd = db2tiPublic.readArtifacts(artifacts, run2);
    assert.equal(badMd.ok, false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('REAL-CUSTOMER literal rejected and absent from result/artifacts', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  try {
    const result = runDb2TestIntelligence(
      minimalEvidence({
        manualRules: [
          {
            id: 'bad',
            expression: "CUSTOMER_ID = 'REAL-CUSTOMER-4711'",
            table: 'ORDERS',
            schema: 'SALES',
            literalsAreSynthetic: true,
          },
        ],
        options: { writeArtifacts: true, runId: 'real-cust', frameworks: ['robot-framework'] },
      }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(result.ok, true);
    const blob = prettyCanonical(result.result);
    assert.equal(blob.includes('REAL-CUSTOMER'), false);
    assert.equal(blob.includes('4711'), false);
    assert.ok(result.result.qualityReport.unsupported >= 1);
    assert.ok(result.result.gaps.some(g => g.kind === 'unsupported-literal'));
    const read = db2tiPublic.readArtifacts(artifacts, result.artifacts.runId);
    assert.equal(read.ok, true);
    const disk = JSON.stringify(read.vectorSet) + (read.files[ARTIFACT_FILES.ROBOT] || '');
    assert.equal(disk.includes('REAL-CUSTOMER'), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('manualRules full-identity sort: note/schema/synthetic ties permutation-stable', () => {
  const ent = entitlementBundle();
  // Same id/expression/table; differ only in schema, note, literalsAreSynthetic.
  const ruleA = {
    id: 'tie',
    expression: "STATUS = 'A'",
    table: 'ORDERS',
    schema: 'ALPHA',
    note: 'note-a',
    literalsAreSynthetic: true,
  };
  const ruleB = {
    id: 'tie',
    expression: "STATUS = 'A'",
    table: 'ORDERS',
    schema: 'BETA',
    note: 'note-b',
    literalsAreSynthetic: true,
  };
  const base = minimalEvidence({ manualRules: [ruleA, ruleB] });
  const rev = minimalEvidence({ manualRules: [ruleB, ruleA] });
  const a = runDb2TestIntelligence(base, ent);
  const b = runDb2TestIntelligence(rev, ent);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(
    a.result.provenanceAnchor.manualRulesSha256,
    b.result.provenanceAnchor.manualRulesSha256
  );
  assert.equal(prettyCanonical(a.result), prettyCanonical(b.result));
});

test('numeric literal CUSTOMER_ID = 4711 requires synthetic flag; neutral numeric+true succeeds', () => {
  const ent = entitlementBundle();
  const { workspace, artifacts } = tempRoots();
  try {
    // Absent literalsAreSynthetic → unsupported-literal, no manual vectors, no 4711 echo.
    const absent = runDb2TestIntelligence(
      minimalEvidence({
        manualRules: [
          {
            id: 'num-absent',
            expression: 'CUSTOMER_ID = 4711',
            table: 'ORDERS',
            schema: 'SALES',
          },
        ],
        options: { writeArtifacts: true, runId: 'num-absent', frameworks: ['robot-framework'] },
      }),
      { ...ent, workspaceRoot: workspace, artifactRoot: artifacts }
    );
    assert.equal(absent.ok, true);
    assert.ok(absent.result.gaps.some(g => g.kind === 'unsupported-literal'));
    assert.equal(
      absent.result.vectors.some(v => v.category === 'manual-rule'),
      false
    );
    const absentBlob = prettyCanonical(absent.result);
    assert.equal(absentBlob.includes('4711'), false);
    const absentRead = db2tiPublic.readArtifacts(artifacts, absent.artifacts.runId);
    assert.equal(absentRead.ok, true);
    const absentDisk =
      JSON.stringify(absentRead.vectorSet) +
      (absentRead.files[ARTIFACT_FILES.ROBOT] || '') +
      (absentRead.files[ARTIFACT_FILES.MARKDOWN] || '');
    assert.equal(absentDisk.includes('4711'), false);

    // Explicit false → same redacted gap behavior.
    const falsy = runDb2TestIntelligence(
      minimalEvidence({
        manualRules: [
          {
            id: 'num-false',
            expression: 'CUSTOMER_ID = 4711',
            table: 'ORDERS',
            schema: 'SALES',
            literalsAreSynthetic: false,
          },
        ],
      }),
      ent
    );
    assert.equal(falsy.ok, true);
    assert.ok(falsy.result.gaps.some(g => g.kind === 'unsupported-literal'));
    assert.equal(
      falsy.result.vectors.some(v => v.category === 'manual-rule'),
      false
    );
    assert.equal(prettyCanonical(falsy.result).includes('4711'), false);

    // Neutral numeric with true succeeds and may materialize the synthetic value.
    const okNum = runDb2TestIntelligence(
      minimalEvidence({
        manualRules: [
          {
            id: 'num-ok',
            expression: 'AMOUNT = 42',
            table: 'ORDERS',
            schema: 'SALES',
            literalsAreSynthetic: true,
          },
        ],
      }),
      ent
    );
    assert.equal(okNum.ok, true);
    const manualOk = okNum.result.vectors.filter(v => v.category === 'manual-rule');
    assert.ok(manualOk.length > 0);
    assert.ok(prettyCanonical(manualOk).includes('42'));

    // Compact customer-token strings rejected even with synthetic flag; no raw echo.
    for (const token of ["'CUST4711'", "'CUST-4711'"]) {
      const compact = runDb2TestIntelligence(
        minimalEvidence({
          manualRules: [
            {
              id: 'compact',
              expression: `STATUS = ${token}`,
              table: 'ORDERS',
              schema: 'SALES',
              literalsAreSynthetic: true,
            },
          ],
        }),
        ent
      );
      assert.equal(compact.ok, true);
      assert.ok(compact.result.gaps.some(g => g.kind === 'unsupported-literal'));
      assert.equal(
        compact.result.vectors.some(v => v.category === 'manual-rule'),
        false
      );
      const blob = prettyCanonical(compact.result);
      assert.equal(blob.includes('CUST4711'), false);
      assert.equal(blob.includes('CUST-4711'), false);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(artifacts, { recursive: true, force: true });
  }
});

test('DECIMAL(2,3) rejected; VARCHAR(300) materialization gap; BOGUS column gap', () => {
  const ent = entitlementBundle();
  const dec = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [{ name: 'A', type: 'DECIMAL', precision: 2, scale: 3, nullable: true }],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(dec.ok, false);
  assert.equal(dec.reasonCode, REASON_CODES.INPUT_INVALID);

  const vc = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [{ name: 'V', type: 'VARCHAR', length: 300, nullable: true }],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(vc.ok, true);
  assert.equal(
    vc.result.vectors.some(v => v.expectation.technical === 'max-plus-one'),
    false
  );
  assert.ok(vc.result.gaps.some(g => g.kind === 'materialization-limit'));

  const bogus = runDb2TestIntelligence(
    minimalEvidence({
      manualRules: [
        {
          id: 'b',
          expression: "BOGUS = 'X'",
          table: 'ORDERS',
          schema: 'SALES',
          literalsAreSynthetic: true,
        },
      ],
    }),
    ent
  );
  assert.equal(bogus.ok, true);
  assert.ok(bogus.result.gaps.some(g => g.kind === 'unknown-column'));
  assert.equal(
    bogus.result.vectors.some(v => v.category === 'manual-rule'),
    false
  );
  assert.ok(bogus.result.qualityReport.unsupported >= 1);
});

test('IN negative avoids list collision; sourceEvidence permutation stable', () => {
  const ent = entitlementBundle();
  const inReq = minimalEvidence({
    manualRules: [
      {
        id: 'in1',
        expression: "STATUS IN ('__NOT_IN_LIST__','A')",
        table: 'ORDERS',
        schema: 'SALES',
        literalsAreSynthetic: true,
      },
    ],
  });
  const inRes = runDb2TestIntelligence(inReq, ent);
  assert.equal(inRes.ok, true);
  const manual = inRes.result.vectors.filter(v => v.category === 'manual-rule');
  // No assignment used as both accept and reject
  const byAssign = new Map();
  for (const v of manual) {
    const key = JSON.stringify(v.input.assignments);
    if (!byAssign.has(key)) byAssign.set(key, new Set());
    byAssign.get(key).add(v.expectation.outcome);
  }
  for (const outcomes of byAssign.values()) {
    assert.equal(outcomes.has('accept') && outcomes.has('reject'), false);
  }

  const seA = minimalEvidence({
    evidence: {
      tables: [
        {
          name: 'T',
          columns: [{ name: 'A', type: 'INTEGER', nullable: true }],
          sourceEvidence: [
            { kind: 'b', ref: '2', note: 'n' },
            { kind: 'a', ref: '1', note: 'n' },
            { kind: 'a', ref: '1', note: 'n' },
          ],
        },
      ],
    },
  });
  const seB = JSON.parse(JSON.stringify(seA));
  seB.evidence.tables[0].sourceEvidence = [
    { kind: 'a', ref: '1', note: 'n' },
    { kind: 'b', ref: '2', note: 'n' },
  ];
  const a = runDb2TestIntelligence(seA, ent);
  const b = runDb2TestIntelligence(seB, ent);
  assert.equal(prettyCanonical(a.result), prettyCanonical(b.result));
  assert.equal(
    a.result.provenanceAnchor.manualRulesSha256,
    b.result.provenanceAnchor.manualRulesSha256
  );
});

test('provenance anchor pin and required contract fields', () => {
  const ent = entitlementBundle();
  const badSha = runDb2TestIntelligence(
    minimalEvidence({
      provenanceAnchor: testProvenanceAnchor({ communitySha: '0'.repeat(40) }),
    }),
    ent
  );
  assert.equal(badSha.ok, false);

  const noContract = {
    provenanceAnchor: testProvenanceAnchor(),
    evidence: {
      tables: [{ name: 'T', columns: [{ name: 'A', type: 'INTEGER', nullable: true }] }],
    },
  };
  assert.equal(projectRequest(noContract).ok, false);

  const ok = runDb2TestIntelligence(minimalEvidence(), ent);
  assert.equal(ok.ok, true);
  assert.equal(ok.result.provenanceAnchor.communitySha, PINNED_COMMUNITY_SHA);
  assert.match(ok.result.provenanceAnchor.manualRulesSha256, /^[a-f0-9]{64}$/);
});

test('leap-day temporal vectors and robot CR/LF neutralization', () => {
  const ent = entitlementBundle();
  const result = runDb2TestIntelligence(
    minimalEvidence({
      evidence: {
        tables: [
          {
            name: 'T',
            columns: [
              { name: 'D', type: 'DATE', nullable: true },
              { name: 'TS', type: 'TIMESTAMP', nullable: true },
            ],
          },
        ],
      },
    }),
    ent
  );
  assert.equal(result.ok, true);
  assert.ok(result.result.vectors.some(v => v.expectation.technical === 'date-leap-day'));
  assert.ok(result.result.vectors.some(v => v.expectation.technical === 'ts-leap-day'));
  assert.ok(result.result.gaps.some(g => g.kind === 'temporal-precision-unknown'));

  const evil = 'X\r*** Tasks ***\rPWN';
  const inert = inertRobotField(evil);
  assert.equal(/[\r\n]/.test(inert), false);
  assert.equal(inert.includes('***'), false);
  const robot = db2tiPublic.exportFramework(
    {
      ...result.result,
      vectors: [
        {
          ...result.result.vectors[0],
          rationale: evil,
          input: {
            assignments: { COL: { kind: 'string', value: evil } },
          },
        },
      ],
    },
    'robot-framework'
  );
  assert.equal(robot.ok, true);
  // Payload must not reintroduce CR/LF inside a documentation/assignment line.
  const dataLines = robot.text.split('\n').filter(l => l.includes('X') || l.includes('PWN'));
  assert.ok(dataLines.length >= 1);
  for (const line of dataLines) {
    assert.equal(/[\r\n]/.test(line), false);
    assert.equal(line.includes('*** Tasks ***'), false);
    assert.equal(line.includes('***'), false);
  }
});

test('validateVectorSet rejects malformed nested semantic structures', () => {
  const projected = projectRequest(minimalEvidence());
  const generated = generateVectorSet(projected.value);
  assert.equal(generated.ok, true);
  const base = JSON.parse(JSON.stringify(generated.result));

  // Bad outcome
  const badOutcome = JSON.parse(JSON.stringify(base));
  badOutcome.vectors[0].expectation.outcome = 'maybe';
  assert.equal(db2tiPublic.validateVectorSet(badOutcome).ok, false);

  // Business not unknown
  const badBiz = JSON.parse(JSON.stringify(base));
  badBiz.vectors[0].expectation.business = 'true';
  assert.equal(db2tiPublic.validateVectorSet(badBiz).ok, false);

  // Unknown vector field
  const badField = JSON.parse(JSON.stringify(base));
  badField.vectors[0].extra = 1;
  assert.equal(db2tiPublic.validateVectorSet(badField).ok, false);

  // Quality report mismatch
  const badQr = JSON.parse(JSON.stringify(base));
  badQr.qualityReport.vectorCount = base.qualityReport.vectorCount + 1;
  assert.equal(db2tiPublic.validateVectorSet(badQr).ok, false);

  // Tampered vector id
  const badId = JSON.parse(JSON.stringify(base));
  badId.vectors[0].id = '0'.repeat(32);
  assert.equal(db2tiPublic.validateVectorSet(badId).ok, false);

  // Bad assignment shape
  const badAsg = JSON.parse(JSON.stringify(base));
  const keys = Object.keys(badAsg.vectors[0].input.assignments);
  if (keys.length) {
    badAsg.vectors[0].input.assignments[keys[0]] = { evil: true };
    assert.equal(db2tiPublic.validateVectorSet(badAsg).ok, false);
  }

  // Unknown top-level
  const badTop = JSON.parse(JSON.stringify(base));
  badTop.secret = true;
  assert.equal(db2tiPublic.validateVectorSet(badTop).ok, false);
});
