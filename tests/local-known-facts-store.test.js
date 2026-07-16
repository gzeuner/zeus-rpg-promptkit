const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_TTL_DAYS,
  LOCAL_KNOWN_FACTS_KIND,
  buildEmptyKnownFactsStore,
  normalizeKnownFactsStorePath,
  readKnownFactsStore,
  writeKnownFactsStore,
} = require('../src/knowledge/localKnownFactsStore');

test('local known facts store writes profile-scoped local-only facts with ttl metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-known-facts-'));
  const now = '2026-06-16T10:00:00.000Z';
  const storePath = normalizeKnownFactsStorePath('dev', { cwd: tempRoot });

  try {
    assert.equal(
      storePath.endsWith(path.join('config', 'local-only', 'known-facts', 'dev.json')),
      true
    );
    assert.deepEqual(buildEmptyKnownFactsStore('dev'), {
      schemaVersion: 1,
      kind: LOCAL_KNOWN_FACTS_KIND,
      mode: 'local-only',
      profile: 'dev',
      versionMarker: {
        toolVersion: require('../package.json').version,
        updatedAt: null,
        expiresAt: null,
        ttlDays: DEFAULT_TTL_DAYS,
      },
      facts: [],
    });

    const written = writeKnownFactsStore(
      'dev',
      {
        versionMarker: {
          ttlDays: 14,
        },
        facts: [
          {
            subject: 'ORDERS',
            attribute: 'primaryKey',
            value: 'ORDER_ID',
            confidence: 'high',
            source: 'local schema note',
            tags: ['db2', 'v7'],
          },
        ],
      },
      {
        cwd: tempRoot,
        now,
      }
    );

    assert.equal(fs.existsSync(written.path), true);
    assert.equal(written.store.versionMarker.ttlDays, 14);
    assert.equal(written.store.versionMarker.updatedAt, now);
    assert.equal(written.store.versionMarker.expiresAt, '2026-06-30T10:00:00.000Z');
    assert.equal(written.store.facts.length, 1);
    assert.equal(written.store.facts[0].confidence, 'HIGH');

    const loaded = readKnownFactsStore('dev', { cwd: tempRoot, now });
    assert.equal(loaded.status, 'ready');
    assert.equal(loaded.expired, false);
    assert.equal(loaded.store.kind, LOCAL_KNOWN_FACTS_KIND);
    assert.equal(loaded.store.facts[0].subject, 'ORDERS');
    assert.equal(loaded.store.facts[0].attribute, 'primaryKey');
    assert.equal(loaded.store.facts[0].value, 'ORDER_ID');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local known facts store evaluates controlled time before, at, and after expiry', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-known-facts-expired-'));

  try {
    writeKnownFactsStore(
      'qa',
      {
        versionMarker: {
          updatedAt: '2000-01-01T00:00:00.000Z',
          expiresAt: '2000-01-02T00:00:00.000Z',
          ttlDays: 30,
        },
        facts: [
          {
            subject: 'ORDERS',
            attribute: 'ownerProgram',
            value: 'ORDERPGM',
          },
        ],
      },
      {
        cwd: tempRoot,
        now: '2000-01-01T00:00:00.000Z',
      }
    );

    const ready = readKnownFactsStore('qa', {
      cwd: tempRoot,
      now: '2000-01-01T23:59:59.999Z',
    });
    assert.equal(ready.status, 'ready');
    assert.equal(ready.expired, false);

    const atBoundary = readKnownFactsStore('qa', {
      cwd: tempRoot,
      now: '2000-01-02T00:00:00.000Z',
    });
    assert.equal(atBoundary.status, 'expired');
    assert.equal(atBoundary.expired, true);

    const afterBoundary = readKnownFactsStore('qa', {
      cwd: tempRoot,
      now: '2000-01-02T00:00:00.001Z',
    });
    assert.equal(afterBoundary.status, 'expired');
    assert.equal(afterBoundary.expired, true);

    const defaultClock = readKnownFactsStore('qa', { cwd: tempRoot });
    assert.equal(defaultClock.status, 'expired');
    assert.equal(defaultClock.expired, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local known facts store rejects invalid time and preserves missing status', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-known-facts-time-policy-'));

  try {
    const missing = readKnownFactsStore('missing', {
      cwd: tempRoot,
      now: '2000-01-01T00:00:00.000Z',
    });
    assert.equal(missing.status, 'missing');
    assert.equal(missing.expired, false);

    assert.throws(
      () =>
        writeKnownFactsStore(
          'invalid-expiry',
          {
            versionMarker: {
              updatedAt: '2000-01-01T00:00:00.000Z',
              expiresAt: 'not-a-timestamp',
            },
            facts: [],
          },
          { cwd: tempRoot, now: '2000-01-01T00:00:00.000Z' }
        ),
      /Invalid timestamp: not-a-timestamp/
    );

    writeKnownFactsStore(
      'invalid-now',
      {
        versionMarker: {
          updatedAt: '2000-01-01T00:00:00.000Z',
          expiresAt: '2000-01-02T00:00:00.000Z',
        },
        facts: [],
      },
      { cwd: tempRoot, now: '2000-01-01T00:00:00.000Z' }
    );
    assert.throws(
      () => readKnownFactsStore('invalid-now', { cwd: tempRoot, now: 'not-a-timestamp' }),
      /Invalid timestamp: not-a-timestamp/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('local known facts store rejects secret-like values', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-known-facts-secrets-'));

  try {
    assert.throws(
      () =>
        writeKnownFactsStore(
          'qa',
          {
            facts: [
              {
                subject: 'DB2',
                attribute: 'passwordHint',
                value: 'password=secret123',
              },
            ],
          },
          {
            cwd: tempRoot,
            now: '2026-06-16T10:00:00.000Z',
          }
        ),
      /must not store secrets/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
