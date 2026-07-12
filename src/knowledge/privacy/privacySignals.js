'use strict';

const LEGACY_REMOVED_REFERENCES = [
  'puiDddlKnowledgeBase',
  'aiKnowledgePatternLibrary',
  'knowledgeBaseService',
  'puiPatternRegistry',
  'puiPatternImport',
  'build-pui-knowledgebase',
  'build-pui-catalog',
  'promote-pui-dddl-kb',
];

const SIGNAL_DEFINITIONS = [
  {
    code: 'SUSPICIOUS_IDENTIFIER',
    message: 'Catalog contains an identifier-like value that may reveal source structure.',
    test: value => /\b[A-Z][A-Z0-9_]{5,}\b/.test(value),
  },
  {
    code: 'LIBRARY_MEMBER_PATTERN',
    message: 'Catalog contains library/member-style naming.',
    test: value => /\b[A-Z0-9_]{1,10}\/[A-Z0-9_]{1,10}\b/.test(value),
  },
  {
    code: 'FILE_PATH',
    message: 'Catalog contains a file-system path-like value.',
    test: value => /(^|[\s"'`(])(?:\.{1,2}\/|\/home\/|\/tmp\/|\/usr\/|[A-Za-z]:\\)/.test(value),
  },
  {
    code: 'URL_OR_HOST',
    message: 'Catalog contains a URL or hostname-like value.',
    test: value => {
      if (/https?:\/\/|ftp:\/\//i.test(value)) {
        return true;
      }
      const hostLike = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/i.test(value);
      if (!hostLike) {
        return false;
      }
      const normalized = String(value || '')
        .trim()
        .toLowerCase();
      if (/^(ui|program|data|workflow)\.[a-z0-9-]+$/.test(normalized)) {
        return false;
      }
      return true;
    },
  },
  {
    code: 'IP_ADDRESS',
    message: 'Catalog contains an IP address-like value.',
    test: value => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value),
  },
  {
    code: 'EMAIL',
    message: 'Catalog contains an email-like value.',
    test: value => /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value),
  },
  {
    code: 'TOKEN_OR_SECRET',
    message: 'Catalog contains token/credential-like text.',
    test: value => /\b(api[_-]?key|token|secret|password|passwd|authorization)\b/i.test(value),
  },
  {
    code: 'SQL_OBJECT_NAME',
    message: 'Catalog contains SQL object naming that may be project-specific.',
    test: value => /\b[A-Z][A-Z0-9_]{1,29}\.[A-Z][A-Z0-9_]{1,29}\b/.test(value),
  },
  {
    code: 'SOURCE_FRAGMENT',
    message: 'Catalog contains source-like DDS/RPG/CL/SQL syntax.',
    test: value =>
      /(\*\*FREE\b|\bDCL-(F|S|DS|PR|PI)\b|\bEXFMT\b|\bCHAIN\b|\bREADC\b|\bSFL(CLR|RRN|PAG|SIZ)\b|\bPGM\b|\bENDPGM\b|\bMONMSG\b|\bEXEC\s+SQL\b|\bSELECT\b.+\bFROM\b)/i.test(
        value
      ),
  },
  {
    code: 'LONG_BUSINESS_LABEL',
    message: 'Catalog contains a long free-text label that may reveal business context.',
    test: value => {
      const trimmed = value.trim();
      return trimmed.length >= 60 && /\s/.test(trimmed);
    },
  },
  {
    code: 'LEGACY_KNOWLEDGE_PATH_REFERENCE',
    message: 'Catalog contains a removed legacy path or local risk reference.',
    test: value =>
      /\.zeus\/knowledge|\.local\/mcp\/audit|session-notes\/2026-05-22-pui-pattern-import/i.test(
        value
      ),
  },
  {
    code: 'LEGACY_MODULE_REFERENCE',
    message: 'Catalog contains a removed unsafe module/tool name.',
    test: value => LEGACY_REMOVED_REFERENCES.some(token => value.includes(token)),
  },
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectStringValues(value, path = '$', bucket = []) {
  if (typeof value === 'string') {
    bucket.push({ path, value });
    return bucket;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringValues(entry, `${path}[${index}]`, bucket));
    return bucket;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, entry]) => {
      collectStringValues(entry, `${path}.${key}`, bucket);
    });
  }
  return bucket;
}

function truncate(value, length = 80) {
  const text = String(value || '');
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length)}...`;
}

function collectPrivacySignals(value) {
  const strings = collectStringValues(value);
  const findings = [];

  strings.forEach(entry => {
    SIGNAL_DEFINITIONS.forEach(signal => {
      if (!signal.test(entry.value)) {
        return;
      }
      findings.push({
        code: signal.code,
        message: signal.message,
        path: entry.path,
        sample: truncate(entry.value),
      });
    });
  });

  return findings;
}

module.exports = {
  LEGACY_REMOVED_REFERENCES,
  collectPrivacySignals,
};
