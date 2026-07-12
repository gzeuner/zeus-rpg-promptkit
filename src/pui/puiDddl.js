'use strict';

const path = require('path');

// Local raw interchange format only. This payload must not become toolkit knowledge
// and must never be exposed as a project-neutral catalog or MCP-safe artifact.
const PUI_DDDL_KIND = 'zeus-pui-dddl';
const PUI_DDDL_VERSION = 1;
const LEGACY_KINDS = new Set(['zeus-pui-dddl-v0']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectUnknownKeys(payload, allowedKeys) {
  return Object.keys(payload).filter(key => !allowedKeys.has(key));
}

function validatePuiDddlV1(payload, { strict = true } = {}) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push('payload must be an object');
    return { valid: false, errors };
  }

  if (String(payload.kind || '') !== PUI_DDDL_KIND) {
    errors.push(`kind must be "${PUI_DDDL_KIND}"`);
  }

  if (!Number.isInteger(payload.version) || payload.version !== PUI_DDDL_VERSION) {
    errors.push(`version must be integer ${PUI_DDDL_VERSION}`);
  }

  if (payload.exportedAt !== undefined && typeof payload.exportedAt !== 'string') {
    errors.push('exportedAt must be a string when provided');
  }

  if (payload.source !== undefined) {
    if (!isPlainObject(payload.source)) {
      errors.push('source must be an object when provided');
    } else {
      if (payload.source.file !== undefined && typeof payload.source.file !== 'string') {
        errors.push('source.file must be a string when provided');
      }
      if (payload.source.path !== undefined && typeof payload.source.path !== 'string') {
        errors.push('source.path must be a string when provided');
      }
      if (strict) {
        const sourceUnknown = collectUnknownKeys(payload.source, new Set(['file', 'path']));
        for (const key of sourceUnknown) {
          errors.push(`source contains unknown key: ${key}`);
        }
      }
    }
  }

  if (payload.ddsJsonGroup !== undefined) {
    if (!isPlainObject(payload.ddsJsonGroup)) {
      errors.push('ddsJsonGroup must be an object when provided');
    } else {
      if (
        !Number.isInteger(payload.ddsJsonGroup.segmentCount) ||
        payload.ddsJsonGroup.segmentCount < 1
      ) {
        errors.push('ddsJsonGroup.segmentCount must be an integer >= 1');
      }
      if (
        !Number.isInteger(payload.ddsJsonGroup.compactSourceLength) ||
        payload.ddsJsonGroup.compactSourceLength < 0
      ) {
        errors.push('ddsJsonGroup.compactSourceLength must be an integer >= 0');
      }
      if (strict) {
        const groupUnknown = collectUnknownKeys(
          payload.ddsJsonGroup,
          new Set(['segmentCount', 'compactSourceLength'])
        );
        for (const key of groupUnknown) {
          errors.push(`ddsJsonGroup contains unknown key: ${key}`);
        }
      }
    }
  }

  if (!isPlainObject(payload.puiJson)) {
    errors.push('puiJson must be an object');
  }

  if (strict) {
    const allowedTopLevel = new Set([
      'kind',
      'version',
      'exportedAt',
      'source',
      'ddsJsonGroup',
      'puiJson',
    ]);
    const unknown = collectUnknownKeys(payload, allowedTopLevel);
    for (const key of unknown) {
      errors.push(`payload contains unknown key: ${key}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function migrateLegacyPuiDddl(payload) {
  const migrated = cloneObject(payload);
  const migrations = [];

  if (String(migrated.kind || '') === 'zeus-pui-dddl-v0') {
    migrated.kind = PUI_DDDL_KIND;
    migrations.push('legacy_kind_v0_to_v1_kind');
  }

  const version = migrated.version;
  if (version === undefined || version === null) {
    migrated.version = PUI_DDDL_VERSION;
    migrations.push('missing_version_defaulted_to_v1');
  } else if (Number(version) === 0) {
    migrated.version = PUI_DDDL_VERSION;
    migrations.push('version_0_upgraded_to_v1');
  }

  if (!migrated.puiJson && isPlainObject(migrated.json)) {
    migrated.puiJson = migrated.json;
    migrations.push('json_field_renamed_to_puiJson');
  }
  if (Object.prototype.hasOwnProperty.call(migrated, 'json')) {
    delete migrated.json;
  }

  return {
    payload: migrated,
    migrations,
  };
}

function parsePuiDddlPayload(payload, { strict = true, allowMigration = true } = {}) {
  if (!isPlainObject(payload)) {
    return {
      recognized: false,
      payload: null,
      migrations: [],
      validation: {
        valid: false,
        errors: ['payload is not an object'],
      },
    };
  }

  const kind = String(payload.kind || '');
  const recognized = kind === PUI_DDDL_KIND || LEGACY_KINDS.has(kind);
  if (!recognized) {
    return {
      recognized: false,
      payload: null,
      migrations: [],
      validation: {
        valid: false,
        errors: ['payload kind is not a recognized DDDL kind'],
      },
    };
  }

  const migration = allowMigration
    ? migrateLegacyPuiDddl(payload)
    : { payload: cloneObject(payload), migrations: [] };
  const validation = validatePuiDddlV1(migration.payload, { strict });

  return {
    recognized: true,
    payload: migration.payload,
    migrations: migration.migrations,
    validation,
  };
}

function assertValidPuiDddlPayload(payload, options = {}) {
  const parsed = parsePuiDddlPayload(payload, options);
  if (!parsed.recognized) {
    throw new Error('Payload is not a recognized zeus-pui-dddl object.');
  }
  if (!parsed.validation.valid) {
    throw new Error(`Invalid zeus-pui-dddl payload: ${parsed.validation.errors.join('; ')}`);
  }
  return parsed;
}

function buildPuiDddlPayloadV1({ filePath, group, puiJson, compactSource }) {
  const payload = {
    kind: PUI_DDDL_KIND,
    version: PUI_DDDL_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      file: path.basename(String(filePath || '')),
      path: String(filePath || ''),
    },
    ddsJsonGroup: {
      segmentCount: Array.isArray(group && group.segments) ? group.segments.length : 0,
      compactSourceLength: String(compactSource || '').length,
    },
    puiJson,
  };

  const validation = validatePuiDddlV1(payload, { strict: true });
  if (!validation.valid) {
    throw new Error(`Could not build zeus-pui-dddl payload: ${validation.errors.join('; ')}`);
  }

  return payload;
}

module.exports = {
  PUI_DDDL_KIND,
  PUI_DDDL_VERSION,
  assertValidPuiDddlPayload,
  buildPuiDddlPayloadV1,
  parsePuiDddlPayload,
  validatePuiDddlV1,
};
