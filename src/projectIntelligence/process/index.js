'use strict';

const contracts = require('./contracts');
const discovery = require('./discovery');
const description = require('./description');
const retrieval = require('./retrieval');
const vocabulary = require('./vocabulary');

module.exports = {
  ...contracts,
  ...discovery,
  ...description,
  ...retrieval,
  ...vocabulary,
};
