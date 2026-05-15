const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../src/cli/commands/puiEditCommand');
const {
  buildHtmlLines,
  findJsonSegmentGroup,
  parseDds,
  parseJsonFromGroup,
} = require('../src/pui/puiDdsParser');

function writeSyntheticDisplay(filePath) {
  const uiJson = {
    items: [
      {
        id: 'gridMain',
        'field type': 'grid',
        'record format name': 'SFLMAIN',
        'number of columns': '1',
        'column widths': '120',
        'column headings': 'Name',
        width: '121px',
      },
      {
        id: 'fieldA',
        'field type': 'output field',
        grid: 'gridMain',
        column: '0',
        value: {
          fieldName: 'FIELD_A',
          dataType: 'char',
          dataLength: '10',
        },
      },
    ],
  };

  const lines = [
    '     A          R HEADER',
    ...buildHtmlLines(JSON.stringify(uiJson)),
    '     A          R SFLMAIN',
    '     A            FIELD_A        10A  O  1  1',
    '     A          R SFLALT',
    '     A            FIELD_B        10A  O  2  1',
    '     A          R FOOTER',
  ];

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function readDisplayJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseDds(content);
  const group = findJsonSegmentGroup(parsed);
  assert.ok(group, 'expected JSON segment group');
  const json = parseJsonFromGroup(group);
  assert.ok(json, 'expected parsed JSON');
  return json;
}

test('pui-edit apply updates JSON via synthetic change set', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-pui-edit-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');
  const changeSetPath = path.join(tempDir, 'changes.json');

  try {
    writeSyntheticDisplay(filePath);

    fs.writeFileSync(changeSetPath, JSON.stringify({
      description: 'Hide an item',
      operations: [
        {
          type: 'hide-item',
          where: { id: 'fieldA' },
        },
      ],
    }, null, 2), 'utf8');

    await run({
      file: filePath,
      action: 'apply',
      'changes-file': changeSetPath,
      confirm: true,
    });

    const json = readDisplayJson(filePath);
    const field = json.items.find((item) => item.id === 'fieldA');

    assert.equal(field.visibility, 'hidden');
    assert.ok(fs.existsSync(`${filePath}.bak`));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pui-edit grid-add-column appends a column on synthetic display data', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-pui-grid-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');

  try {
    writeSyntheticDisplay(filePath);

    await run({
      file: filePath,
      action: 'grid-add-column',
      'grid-id': 'gridMain',
      'col-position': '1',
      'col-heading': 'Amount',
      'col-width': '90',
      'field-id': 'fieldAmount',
      'field-name': 'FIELD_AMT',
      'field-type': 'output field',
      'field-data-type': 'zoned',
      'field-length': '7',
      'field-width': '80px',
      'no-auto-adjust': true,
      confirm: true,
    });

    const json = readDisplayJson(filePath);
    const grid = json.items.find((item) => item.id === 'gridMain');
    const insertedField = json.items.find((item) => item.id === 'fieldAmount');

    assert.equal(grid['number of columns'], '2');
    assert.match(grid['column headings'], /Amount/);
    assert.ok(insertedField);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pui-edit inserts DDS lines into requested --sfl-record', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-pui-sfl-'));
  const filePath = path.join(tempDir, 'DISPLAY_SAMPLE.MBR');

  try {
    writeSyntheticDisplay(filePath);

    await run({
      file: filePath,
      action: 'grid-add-column',
      'grid-id': 'gridMain',
      'col-position': '1',
      'col-heading': 'Status',
      'col-width': '90',
      'field-id': 'fieldStatus',
      'field-name': 'FIELD_STATUS',
      'field-type': 'output field',
      'field-data-type': 'char',
      'field-length': '10',
      'field-width': '90px',
      'sfl-record': 'SFLALT',
      'sfl-field': [
        'FIELD_STATUS     10A  O  3  1',
      ],
      'no-auto-adjust': true,
      confirm: true,
    });

    const content = fs.readFileSync(filePath, 'utf8');
    const sflAltIndex = content.indexOf('R SFLALT');
    const footerIndex = content.indexOf('R FOOTER');
    const insertedIndex = content.indexOf('FIELD_STATUS     10A  O  3  1');

    assert.ok(sflAltIndex >= 0, 'SFLALT record should exist');
    assert.ok(insertedIndex > sflAltIndex, 'new DDS line should be after SFLALT record');
    assert.ok(insertedIndex < footerIndex, 'new DDS line should be before FOOTER record');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
