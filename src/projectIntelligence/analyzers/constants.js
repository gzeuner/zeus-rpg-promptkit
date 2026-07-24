'use strict';

const ANALYZER_ID = 'zeus.rpg-ibmi-baseline';
const ANALYZER_VERSION = '1.0.0';

/** Language families handled by the RPG/IBM i baseline analyzer. */
const LANGUAGE_FAMILIES = Object.freeze({
  RPG: 'rpg',
  CL: 'cl',
  SQL: 'sql',
  BND: 'binder',
  OTHER: 'other',
});

module.exports = {
  ANALYZER_ID,
  ANALYZER_VERSION,
  LANGUAGE_FAMILIES,
};
