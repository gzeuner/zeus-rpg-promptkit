/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const SOURCE_FILES_PRIORITY = Object.freeze([
  'QRPGLESRC',
  'QSRVSRC',
  'QCPYSRC',
  'QCLLESRC',
  'QCLSRC',
  'QSQLSRC',
  'SQLTBLSRC',
  'SQLVIEWSRC',
  'SQLIDXSRC',
  'FORMSRC',
  'QDDSSRC',
]);

async function discoverMember(fetchConfig, memberName, runtime = {}) {
  const member = String(memberName || '').trim().toUpperCase();
  if (!member) {
    return null;
  }

  const fetchSingle = runtime.fetchSingle;
  if (typeof fetchSingle !== 'function') {
    return null;
  }

  for (const sourceFile of SOURCE_FILES_PRIORITY) {
    try {
      const result = await fetchSingle(fetchConfig, sourceFile, member);
      if (result && result.success) {
        return {
          file: sourceFile,
          result,
        };
      }
    } catch (_) {
      // Try the next likely source file.
    }
  }

  return null;
}

module.exports = {
  discoverMember,
  SOURCE_FILES_PRIORITY,
};
