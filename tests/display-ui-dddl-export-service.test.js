const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildHtmlLines } = require('../src/displayUi/displayUiDdsParser');
const { exportDisplayUiDddlBatch } = require('../src/displayUi/displayUiDddlExportService');

function writeDisplayWithDisplayUiJson(filePath, json) {
  const lines = [
    '     A          R HEADER',
    ...buildHtmlLines(JSON.stringify(json)),
    '     A          R FOOTER',
  ];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

test('exportDisplayUiDddlBatch exports strict-valid dddl files and report', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-display-ui-dddl-export-'));
  const sourceRoot = path.join(tempRoot, 'src');
  const outRoot = path.join(tempRoot, 'out');
  const reportPath = path.join(tempRoot, 'report.json');

  try {
    writeDisplayWithDisplayUiJson(path.join(sourceRoot, 'QDDSSRC', 'DISPLAY_A_DF'), {
      screen: { 'record format name': 'R1' },
      items: [{ id: 'A', 'field type': 'output field' }],
    });
    writeDisplayWithDisplayUiJson(path.join(sourceRoot, 'QDDSSRC', 'DISPLAY_B_DF'), {
      screen: { 'record format name': 'R2' },
      items: [{ id: 'B', 'field type': 'grid' }],
    });
    fs.writeFileSync(path.join(sourceRoot, 'README.txt'), 'no display-ui', 'utf8');

    const report = exportDisplayUiDddlBatch({
      sourceRoot,
      outRoot,
      reportPath,
    });

    assert.equal(report.stats.candidates, 2);
    assert.equal(report.stats.exported, 2);
    assert.equal(report.stats.validationFailed, 0);
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(fs.existsSync(path.join(outRoot, 'QDDSSRC', 'DISPLAY_A_DF.dddl.json')), true);
    assert.equal(fs.existsSync(path.join(outRoot, 'QDDSSRC', 'DISPLAY_B_DF.dddl.json')), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
