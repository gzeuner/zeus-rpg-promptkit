'use strict';

const path = require('path');
const { scanRpgFile } = require('../../scanner/rpgScanner');
const { scanClFile } = require('../../scanner/clScanner');
const { LANGUAGE_FAMILIES } = require('./constants');

function classifyUnitLanguage(unit) {
  const lang = String(unit.language || '').toLowerCase();
  const ext = path.extname(unit.relativePath || '').toLowerCase();
  if (lang === 'clle' || lang === 'clp' || ext === '.clle' || ext === '.clp') {
    return LANGUAGE_FAMILIES.CL;
  }
  if (lang === 'sql' || ext === '.sql') {
    return LANGUAGE_FAMILIES.SQL;
  }
  if (ext === '.bnd' || ext === '.binder' || ext === '.bndsrc' || lang === 'bnd') {
    return LANGUAGE_FAMILIES.BND;
  }
  if (
    lang === 'rpgle' ||
    lang === 'sqlrpgle' ||
    lang === 'rpg' ||
    ext === '.rpgle' ||
    ext === '.sqlrpgle' ||
    ext === '.rpg'
  ) {
    return LANGUAGE_FAMILIES.RPG;
  }
  return LANGUAGE_FAMILIES.OTHER;
}

/**
 * Parse a source unit with the appropriate Community scanner adapter.
 * Uses in-memory content only (no disk re-read required).
 */
function parseSourceUnit(unit, body) {
  const family = classifyUnitLanguage(unit);
  // Virtual path for scanner identity (basename matters for program name)
  const virtualPath = unit.relativePath || `${unit.sourceUnitId}.rpgle`;
  const content = body == null ? '' : String(body);

  if (family === LANGUAGE_FAMILIES.CL) {
    const result = scanClFile(virtualPath, { content });
    return { family, scan: result };
  }

  // RPG, SQLRPGLE, binder, and unknown source-like files go through RPG pipeline
  // (binder detection is internal to scanContent).
  const result = scanRpgFile(virtualPath, {
    content,
    sourceType: family === LANGUAGE_FAMILIES.SQL ? 'SQL' : undefined,
  });
  return { family, scan: result };
}

module.exports = {
  classifyUnitLanguage,
  parseSourceUnit,
  LANGUAGE_FAMILIES,
};
