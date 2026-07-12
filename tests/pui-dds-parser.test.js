const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDds, findJsonSegmentGroup, parseJsonFromGroup } = require('../src/pui/puiDdsParser');

test('findJsonSegmentGroup keeps collecting when a JSON chunk starts with Q', () => {
  const lines = [
    '     A                                  1  2HTML(\'{"items":[{"value":"\')',
    "     A                                  1  2HTML('QSTART\"}]}')",
    "     A                                  1  2HTML('QPUISFLTEST')",
  ];

  const parsed = parseDds(lines.join('\n'));
  const group = findJsonSegmentGroup(parsed);
  assert.ok(group);
  assert.equal(group.segments.length, 2);
  const json = parseJsonFromGroup(group);
  assert.ok(json);
  assert.equal(json.items[0].value, 'QSTART');
});

test('parseJsonFromGroup recovers legacy control characters in JSON strings', () => {
  const ctrlChar = '\u001A';
  const lines = [
    `     A                                  1  2HTML('{"items":[{"tooltip":"A${ctrlChar}B"}]}')`,
  ];
  const parsed = parseDds(lines.join('\n'));
  const group = findJsonSegmentGroup(parsed);
  assert.ok(group);
  const json = parseJsonFromGroup(group);
  assert.ok(json);
  assert.equal(json.items[0].tooltip, 'AB');
});
