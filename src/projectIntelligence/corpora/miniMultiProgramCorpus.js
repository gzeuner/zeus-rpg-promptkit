'use strict';

/**
 * Multi-program RPG corpus fixture for PI depth tests and benchmarks (Track C).
 * Synthetic offline corpus — no live IBM i, no customer source.
 */

const CORPUS_ID = 'mini-multi-program-rpg';
const CORPUS_VERSION = '1.0.0';

/**
 * @typedef {{ relativePath: string, body: string }} CorpusFile
 */

/** @type {readonly CorpusFile[]} */
const FILES = Object.freeze([
  Object.freeze({
    relativePath: 'QRPGLESRC/ORDERPGM.rpgle',
    body: [
      '**free',
      '// ORDERPGM — root order entry',
      'dcl-s orderId packed(7:0);',
      'dcl-s customerId packed(7:0);',
      'orderId = 1001;',
      'customerId = 42;',
      'callp ValidateOrder(orderId);',
      'callp WriteOrder(orderId:customerId);',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    relativePath: 'QRPGLESRC/VALIDATE.rpgle',
    body: [
      '**free',
      '// VALIDATE — order validation helper',
      'dcl-proc ValidateOrder;',
      '  dcl-pi *n;',
      '    orderId packed(7:0) const;',
      '  end-pi;',
      '  if orderId <= 0;',
      '    // invalid',
      '  endif;',
      'end-proc;',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    relativePath: 'QRPGLESRC/WRITEORD.rpgle',
    body: [
      '**free',
      '// WRITEORD — persist order header',
      'dcl-proc WriteOrder;',
      '  dcl-pi *n;',
      '    orderId packed(7:0) const;',
      '    customerId packed(7:0) const;',
      '  end-pi;',
      '  // insert into ORDERHDR',
      'end-proc;',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    relativePath: 'QRPGLESRC/CUSTINQ.rpgle',
    body: [
      '**free',
      '// CUSTINQ — customer inquiry',
      'dcl-s customerId packed(7:0);',
      'customerId = 42;',
      'callp LoadCustomer(customerId);',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    relativePath: 'QRPGLESRC/LOADCUST.rpgle',
    body: [
      '**free',
      '// LOADCUST — load customer master',
      'dcl-proc LoadCustomer;',
      '  dcl-pi *n;',
      '    customerId packed(7:0) const;',
      '  end-pi;',
      '  // select from CUSTMAST',
      'end-proc;',
      '',
    ].join('\n'),
  }),
  Object.freeze({
    relativePath: 'QSQLSRC/ORDERHDR.sql',
    body: [
      'CREATE TABLE ORDERHDR (',
      '  ORDER_ID INTEGER NOT NULL,',
      '  CUSTOMER_ID INTEGER NOT NULL,',
      '  STATUS CHAR(1)',
      ');',
      '',
    ].join('\n'),
  }),
]);

function listFiles() {
  return FILES.map(f => ({
    relativePath: f.relativePath,
    bytes: Buffer.byteLength(f.body, 'utf8'),
  }));
}

/**
 * Materialize corpus files under targetDir (creates directories).
 * @param {string} targetDir absolute or relative path
 * @param {{ fs?: typeof import('fs'), path?: typeof import('path') }} [deps]
 * @returns {{ corpusId: string, version: string, root: string, files: string[] }}
 */
function materializeCorpus(targetDir, deps = {}) {
  const fs = deps.fs || require('fs');
  const path = deps.path || require('path');
  if (typeof targetDir !== 'string' || !targetDir.trim()) {
    throw new Error('targetDir is required');
  }
  const root = path.resolve(targetDir);
  const written = [];
  for (const file of FILES) {
    const abs = path.join(root, file.relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.body, 'utf8');
    written.push(file.relativePath);
  }
  return {
    corpusId: CORPUS_ID,
    version: CORPUS_VERSION,
    root,
    files: written,
    fileCount: written.length,
  };
}

module.exports = {
  CORPUS_ID,
  CORPUS_VERSION,
  FILES,
  listFiles,
  materializeCorpus,
};
