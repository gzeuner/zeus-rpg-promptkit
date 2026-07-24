'use strict';

const { REASON_CODES, REASON_CODE_MESSAGES } = require('../constants');

class KnowledgeStoreError extends Error {
  /**
   * @param {string} reasonCode closed ZPI reason code
   * @param {string} [message]
   * @param {object} [details]
   */
  constructor(reasonCode, message, details = undefined) {
    const code = REASON_CODES[reasonCode] ? REASON_CODES[reasonCode] : reasonCode;
    const safeMessage =
      typeof message === 'string' && message.trim()
        ? message
        : REASON_CODE_MESSAGES[code] || REASON_CODE_MESSAGES[REASON_CODES.STORE_UNAVAILABLE];
    super(safeMessage);
    this.name = 'KnowledgeStoreError';
    this.reasonCode = code;
    this.details = details && typeof details === 'object' ? details : undefined;
  }
}

function fail(reasonCode, message, details) {
  throw new KnowledgeStoreError(reasonCode, message, details);
}

module.exports = {
  KnowledgeStoreError,
  fail,
  REASON_CODES,
};
