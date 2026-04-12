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

const DIAGNOSTIC_PACK_REGISTRY = Object.freeze({
  'table-investigation': Object.freeze({
    name: 'table-investigation',
    title: 'Table Investigation',
    description: 'Inspect table identity, schema shape, and related object statistics with read-only queries.',
    parameters: Object.freeze([
      Object.freeze({ name: 'table', required: true, description: 'Table or file name to inspect.' }),
      Object.freeze({ name: 'schema', required: false, description: 'Optional schema or library filter.' }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        id: 'catalog-table',
        title: 'Catalog table record',
        kind: 'catalog',
        maxRows: 20,
        query: [
          'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, SYSTEM_TABLE_SCHEMA, SYSTEM_TABLE_NAME',
          'FROM QSYS2.SYSTABLES',
          'WHERE TABLE_NAME = UPPER(\'${table}\')',
          '  AND (\'${schema}\' = \'\' OR TABLE_SCHEMA = UPPER(\'${schema}\') OR SYSTEM_TABLE_SCHEMA = UPPER(\'${schema}\'))',
          'ORDER BY TABLE_SCHEMA, TABLE_NAME',
        ].join(' '),
      }),
      Object.freeze({
        id: 'catalog-columns',
        title: 'Catalog column overview',
        kind: 'catalog',
        maxRows: 50,
        query: [
          'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE',
          'FROM QSYS2.SYSCOLUMNS',
          'WHERE TABLE_NAME = UPPER(\'${table}\')',
          '  AND (\'${schema}\' = \'\' OR TABLE_SCHEMA = UPPER(\'${schema}\'))',
          'ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION',
        ].join(' '),
      }),
    ]),
  }),
  'program-investigation': Object.freeze({
    name: 'program-investigation',
    title: 'Program Investigation',
    description: 'Inspect program object identity and related object statistics through safe read-only steps.',
    parameters: Object.freeze([
      Object.freeze({ name: 'program', required: true, description: 'Program name to inspect.' }),
      Object.freeze({ name: 'library', required: false, description: 'Optional library filter.' }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        id: 'object-statistics',
        title: 'Program object statistics',
        kind: 'catalog',
        maxRows: 20,
        query: [
          'SELECT OBJNAME, OBJLONGNAME, OBJTYPE, OBJATTRIBUTE, OBJOWNER, OBJLIB',
          'FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => CASE WHEN \'${library}\' = \'\' THEN \'*ALL\' ELSE UPPER(\'${library}\') END,',
          'OBJECT_NAME => UPPER(\'${program}\'), OBJECT_TYPE_LIST => \'*PGM\'))',
          'ORDER BY OBJLIB, OBJNAME',
        ].join(' '),
      }),
      Object.freeze({
        id: 'display-object-description',
        title: 'Program object description command',
        kind: 'command',
        command: 'DSPOBJD OBJ(${library}/${program}) OBJTYPE(*PGM) DETAIL(*BASIC)',
      }),
    ]),
  }),
  'object-investigation': Object.freeze({
    name: 'object-investigation',
    title: 'Object Investigation',
    description: 'Inspect a generic IBM i object through catalog and read-only CL steps.',
    parameters: Object.freeze([
      Object.freeze({ name: 'object', required: true, description: 'Object name to inspect.' }),
      Object.freeze({ name: 'library', required: false, description: 'Optional object library.' }),
      Object.freeze({ name: 'objectType', required: false, description: 'Optional IBM i object type, for example *FILE or *PGM.' }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        id: 'object-statistics',
        title: 'Generic object statistics',
        kind: 'catalog',
        maxRows: 20,
        query: [
          'SELECT OBJNAME, OBJLONGNAME, OBJTYPE, OBJATTRIBUTE, OBJTEXT, OBJOWNER, OBJLIB',
          'FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => CASE WHEN \'${library}\' = \'\' THEN \'*ALL\' ELSE UPPER(\'${library}\') END,',
          'OBJECT_NAME => UPPER(\'${object}\'), OBJECT_TYPE_LIST => CASE WHEN \'${objectType}\' = \'\' THEN \'*ALL\' ELSE UPPER(\'${objectType}\') END))',
          'ORDER BY OBJLIB, OBJTYPE, OBJNAME',
        ].join(' '),
      }),
      Object.freeze({
        id: 'display-object-description',
        title: 'Object description command',
        kind: 'command',
        command: 'DSPOBJD OBJ(${library}/${object}) OBJTYPE(${objectType}) DETAIL(*SERVICE)',
      }),
    ]),
  }),
});

function normalizeDiagnosticPackName(value) {
  return String(value || '').trim().toLowerCase();
}

function listDiagnosticPacks() {
  return Object.values(DIAGNOSTIC_PACK_REGISTRY);
}

function getDiagnosticPack(packName) {
  const normalized = normalizeDiagnosticPackName(packName);
  const pack = DIAGNOSTIC_PACK_REGISTRY[normalized];
  if (!pack) {
    throw new Error(`Unknown diagnostic pack: ${packName}`);
  }
  return pack;
}

module.exports = {
  DIAGNOSTIC_PACK_REGISTRY,
  getDiagnosticPack,
  listDiagnosticPacks,
  normalizeDiagnosticPackName,
};
