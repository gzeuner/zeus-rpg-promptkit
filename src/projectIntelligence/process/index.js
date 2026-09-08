'use strict';

const contracts = require('./contracts');
const discovery = require('./discovery');
const description = require('./description');

module.exports = {
  ...contracts,
  ...discovery,
  ...description,
};
