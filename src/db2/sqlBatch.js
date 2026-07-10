/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SQL_FILE_THRESHOLD = 1800;
const SQL_STATEMENT_DELIMITER = '--ZEUS-SQL-STATEMENT--';

function stripSqlComments(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
}

function splitSqlStatements(sqlText) {
  if (!sqlText || typeof sqlText !== 'string') return [];
  const text = stripSqlComments(sqlText).trim();
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inSingle) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i += 1;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i += 1;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += ch;
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

function normalizeSqlStatements({ sql, statements }) {
  if (Array.isArray(statements)) {
    return statements.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (Array.isArray(sql)) {
    return sql.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return splitSqlStatements(String(sql || '').trim());
}

function shouldUseSqlStatementFile(statements, runtime = {}) {
  if (runtime.forceSqlStatementFile) {
    return true;
  }
  return statements.length !== 1 || statements.some((entry) => entry.length > SQL_FILE_THRESHOLD || /[\r\n]/.test(entry));
}

function writeSqlStatementsFile(statements) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-sql-statements-'));
  const filePath = path.join(tempDir, 'statements.sqlbatch');
  const content = statements.map((statement) => statement.trim()).join(`\n${SQL_STATEMENT_DELIMITER}\n`);
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
  return {
    tempDir,
    filePath,
  };
}

function removeSqlStatementsFile(fileRef) {
  if (!fileRef || !fileRef.tempDir) {
    return;
  }
  fs.rmSync(fileRef.tempDir, { recursive: true, force: true });
}

function buildSqlRunnerArgs({ jdbcUrl, user, passwordSentinel, statements, trailingArgs = [], runtime = {} }) {
  const args = [jdbcUrl, String(user), passwordSentinel];
  let statementFile = null;
  if (shouldUseSqlStatementFile(statements, runtime)) {
    statementFile = writeSqlStatementsFile(statements);
    args.push('--statements-file', statementFile.filePath);
  } else {
    args.push(statements[0]);
  }
  args.push(...trailingArgs);
  return {
    args,
    statementFile,
  };
}

module.exports = {
  SQL_STATEMENT_DELIMITER,
  buildSqlRunnerArgs,
  normalizeSqlStatements,
  removeSqlStatementsFile,
  shouldUseSqlStatementFile,
  splitSqlStatements,
  stripSqlComments,
  writeSqlStatementsFile,
};
