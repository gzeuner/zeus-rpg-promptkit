'use strict';

const path = require('path');

// Local raw interchange format only. This payload must not become toolkit knowledge
// and must never be exposed as a project-neutral catalog or MCP-safe artifact.
const DISPLAY_UI_DDDL_KIND = 'zeus-display-ui-dddl';
const DISPLAY_UI_DDDL_VERSION = 1;
const LEGACY_KINDS = new Set(['zeus-display-ui-dddl-v0']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectUnknownKeys(payload, allowedKeys) {
  return Object.keys(payload).filter(key => !allowedKeys.has(key));
}

function validateDisplayUiDddlV1(payload, { strict = true } = {}) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push('payload must be an object');
    return { valid: false, errors };
  }

  if (String(payload.kind || '') !== DISPLAY_UI_DDDL_KIND) {
    errors.push(`kind must be "${DISPLAY_UI_DDDL_KIND}"`);
  }

  if (!Number.isInteger(payload.version) || payload.version !== DISPLAY_UI_DDDL_VERSION) {
    errors.push(`version must be integer ${DISPLAY_UI_DDDL_VERSION}`);
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

  if (!isPlainObject(payload.displayUiJson)) {
    errors.push('displayUiJson must be an object');
  }

  if (strict) {
    const allowedTopLevel = new Set([
      'kind',
      'version',
      'exportedAt',
      'source',
      'ddsJsonGroup',
      'displayUiJson',
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

function migrateLegacyDisplayUiDddl(payload) {
  const migrated = cloneObject(payload);
  const migrations = [];

  if (String(migrated.kind || '') === 'zeus-display-ui-dddl-v0') {
    migrated.kind = DISPLAY_UI_DDDL_KIND;
    migrations.push('legacy_kind_v0_to_v1_kind');
  }

  const version = migrated.version;
  if (version === undefined || version === null) {
    migrated.version = DISPLAY_UI_DDDL_VERSION;
    migrations.push('missing_version_defaulted_to_v1');
  } else if (Number(version) === 0) {
    migrated.version = DISPLAY_UI_DDDL_VERSION;
    migrations.push('version_0_upgraded_to_v1');
  }

  if (!migrated.displayUiJson && isPlainObject(migrated.json)) {
    migrated.displayUiJson = migrated.json;
    migrations.push('json_field_renamed_to_displayUiJson');
  }
  if (Object.prototype.hasOwnProperty.call(migrated, 'json')) {
    delete migrated.json;
  }

  return {
    payload: migrated,
    migrations,
  };
}

function parseDisplayUiDddlPayload(payload, { strict = true, allowMigration = true } = {}) {
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
  const recognized = kind === DISPLAY_UI_DDDL_KIND || LEGACY_KINDS.has(kind);
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
    ? migrateLegacyDisplayUiDddl(payload)
    : { payload: cloneObject(payload), migrations: [] };
  const validation = validateDisplayUiDddlV1(migration.payload, { strict });

  return {
    recognized: true,
    payload: migration.payload,
    migrations: migration.migrations,
    validation,
  };
}

function assertValidDisplayUiDddlPayload(payload, options = {}) {
  const parsed = parseDisplayUiDddlPayload(payload, options);
  if (!parsed.recognized) {
    throw new Error('Payload is not a recognized zeus-display-ui-dddl object.');
  }
  if (!parsed.validation.valid) {
    throw new Error(`Invalid zeus-display-ui-dddl payload: ${parsed.validation.errors.join('; ')}`);
  }
  return parsed;
}

function buildDisplayUiDddlPayloadV1({ filePath, group, displayUiJson, compactSource }) {
  const payload = {
    kind: DISPLAY_UI_DDDL_KIND,
    version: DISPLAY_UI_DDDL_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      file: path.basename(String(filePath || '')),
      path: String(filePath || ''),
    },
    ddsJsonGroup: {
      segmentCount: Array.isArray(group && group.segments) ? group.segments.length : 0,
      compactSourceLength: String(compactSource || '').length,
    },
    displayUiJson,
  };

  const validation = validateDisplayUiDddlV1(payload, { strict: true });
  if (!validation.valid) {
    throw new Error(
      `Could not build zeus-display-ui-dddl payload: ${validation.errors.join('; ')}`
    );
  }

  return payload;
}

module.exports = {
  DISPLAY_UI_DDDL_KIND,
  DISPLAY_UI_DDDL_VERSION,
  assertValidDisplayUiDddlPayload,
  buildDisplayUiDddlPayloadV1,
  parseDisplayUiDddlPayload,
  validateDisplayUiDddlV1,
};
