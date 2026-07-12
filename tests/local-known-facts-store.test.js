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

test('local known facts store flags expired payloads and rejects secret-like values', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-known-facts-expired-'));

  try {
    writeKnownFactsStore(
      'qa',
      {
        versionMarker: {
          updatedAt: '2026-06-01T00:00:00.000Z',
          ttlDays: 1,
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
        now: '2026-06-01T00:00:00.000Z',
      }
    );

    const expired = readKnownFactsStore('qa', {
      cwd: tempRoot,
      now: '2026-06-16T00:00:00.000Z',
    });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.expired, true);

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
