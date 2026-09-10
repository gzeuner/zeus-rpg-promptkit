'use strict';

const contracts = require('./contracts');
const discovery = require('./discovery');
const description = require('./description');
const retrieval = require('./retrieval');
const vocabulary = require('./vocabulary');
const freshness = require('./freshness');
const views = require('./views');
const evaluation = require('./evaluation');

module.exports = {
  ...contracts,
  ...discovery,
  ...description,
  ...retrieval,
  ...vocabulary,
  ...freshness,
  ...views,
  ...evaluation,
};
