const fs = require('fs');

function writeJsonReport(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

module.exports = {
  writeJsonReport,
};