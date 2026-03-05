const fs = require('fs');

function uniquePush(target, value) {
  if (!value) return;
  if (!target.includes(value)) {
    target.push(value);
  }
}

function scanRpgFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const tables = [];
  const calls = [];
  const copyMembers = [];
  const sqlStatements = [];

  let inSqlBlock = false;
  let sqlBuffer = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const fixedFSpec = rawLine.match(/^\s*F([A-Z0-9_#$@]+)/i);
    if (fixedFSpec) {
      uniquePush(tables, fixedFSpec[1].toUpperCase());
    }

    const freeFSpec = rawLine.match(/^\s*dcl-f\s+([A-Z0-9_#$@]+)/i);
    if (freeFSpec) {
      uniquePush(tables, freeFSpec[1].toUpperCase());
    }

    const copyMatch = rawLine.match(/^\s*\/(?:COPY|INCLUDE)\s+(.+)$/i);
    if (copyMatch) {
      uniquePush(copyMembers, copyMatch[1].trim());
    }

    const copyKeywordMatch = rawLine.match(/^\s*COPY\s+(.+)$/i);
    if (copyKeywordMatch) {
      uniquePush(copyMembers, copyKeywordMatch[1].trim());
    }

    const callPatterns = [
      /\bCALL\s+['"]?([A-Z0-9_#$@]+)['"]?/i,
      /\bCALLP\s+([A-Z0-9_#$@]+)\b/i,
      /\bCALLP\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i,
      /\bCALLB\s+['"]?([A-Z0-9_#$@]+)['"]?/i,
      /\bCALLPRC\s*\(\s*['"]?([A-Z0-9_#$@]+)['"]?\s*\)/i,
      /\bCALLPRC\s+['"]?([A-Z0-9_#$@]+)['"]?/i,
    ];

    for (const pattern of callPatterns) {
      const match = rawLine.match(pattern);
      if (match) {
        uniquePush(calls, match[1].toUpperCase());
      }
    }

    const startsExecSql = /\bEXEC\s+SQL\b/i.test(rawLine);
    if (startsExecSql) {
      inSqlBlock = true;
      sqlBuffer.push(line);
      if (line.includes(';')) {
        uniquePush(sqlStatements, sqlBuffer.join(' ').trim());
        sqlBuffer = [];
        inSqlBlock = false;
      }
      continue;
    }

    if (inSqlBlock) {
      sqlBuffer.push(line);
      if (line.includes(';')) {
        uniquePush(sqlStatements, sqlBuffer.join(' ').trim());
        sqlBuffer = [];
        inSqlBlock = false;
      }
      continue;
    }

    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(rawLine) && !inSqlBlock) {
      uniquePush(sqlStatements, line);
    }
  }

  if (sqlBuffer.length > 0) {
    uniquePush(sqlStatements, sqlBuffer.join(' ').trim());
  }

  return {
    filePath,
    tables,
    calls,
    copyMembers,
    sqlStatements,
  };
}

module.exports = {
  scanRpgFile,
};