'use strict';

const constants = require('./constants');
const parserAdapters = require('./parserAdapters');
const spans = require('./spans');
const { createRpgAnalyzer, ANALYZER_ID, ANALYZER_VERSION } = require('./rpgAnalyzer');

module.exports = {
  ...constants,
  createRpgAnalyzer,
  ANALYZER_ID,
  ANALYZER_VERSION,
  parseSourceUnit: parserAdapters.parseSourceUnit,
  classifyUnitLanguage: parserAdapters.classifyUnitLanguage,
  evidenceToSpan: spans.evidenceToSpan,
  collectSpansFromEvidenceList: spans.collectSpansFromEvidenceList,
};
