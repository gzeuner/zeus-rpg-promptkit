const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PUI_DDDL_KIND,
  PUI_DDDL_VERSION,
  buildPuiDddlPayloadV1,
  parsePuiDddlPayload,
  validatePuiDddlV1,
} = require('../src/pui/puiDddl');

test('validatePuiDddlV1 accepts strict valid payload', () => {
  const payload = {
    kind: PUI_DDDL_KIND,
    version: PUI_DDDL_VERSION,
    exportedAt: '2026-05-23T00:00:00.000Z',
    source: {
      file: 'DISPLAY.MBR',
      path: '/tmp/DISPLAY.MBR',
    },
    ddsJsonGroup: {
      segmentCount: 2,
      compactSourceLength: 1234,
    },
    puiJson: {
      items: [],
    },
  };
  const result = validatePuiDddlV1(payload, { strict: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validatePuiDddlV1 rejects unknown keys in strict mode', () => {
  const payload = {
    kind: PUI_DDDL_KIND,
    version: PUI_DDDL_VERSION,
    puiJson: {},
    extraField: true,
  };
  const result = validatePuiDddlV1(payload, { strict: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.includes('unknown key')));
});

test('parsePuiDddlPayload migrates legacy v0 payload with json field', () => {
  const legacyPayload = {
    kind: 'zeus-pui-dddl-v0',
    version: 0,
    json: {
      items: [{ id: 'x' }],
    },
    source: {
      file: 'DISPLAY.MBR',
      path: '/tmp/DISPLAY.MBR',
    },
    ddsJsonGroup: {
      segmentCount: 1,
      compactSourceLength: 1,
    },
  };

  const parsed = parsePuiDddlPayload(legacyPayload, {
    strict: true,
    allowMigration: true,
  });

  assert.equal(parsed.recognized, true);
  assert.equal(parsed.validation.valid, true);
  assert.equal(parsed.payload.kind, PUI_DDDL_KIND);
  assert.equal(parsed.payload.version, PUI_DDDL_VERSION);
  assert.ok(parsed.payload.puiJson);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.payload, 'json'), false);
  assert.ok(parsed.migrations.includes('legacy_kind_v0_to_v1_kind'));
  assert.ok(parsed.migrations.includes('version_0_upgraded_to_v1'));
  assert.ok(parsed.migrations.includes('json_field_renamed_to_puiJson'));
});

test('buildPuiDddlPayloadV1 creates valid payload', () => {
  const payload = buildPuiDddlPayloadV1({
    filePath: '/tmp/DISPLAY.MBR',
    group: {
      segments: [{}, {}],
    },
    compactSource: '{"items":[]}',
    puiJson: {
      items: [],
    },
  });
  assert.equal(payload.kind, PUI_DDDL_KIND);
  assert.equal(payload.version, PUI_DDDL_VERSION);
  assert.equal(payload.ddsJsonGroup.segmentCount, 2);
  assert.equal(payload.ddsJsonGroup.compactSourceLength, 12);
});
