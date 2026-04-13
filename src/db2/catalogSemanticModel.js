/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const {
  dedupeEvidence,
  normalizeCatalogTable,
  parseQualifiedIdentifier,
} = require('./db2EvidenceLinker');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toUpperCase();
}

function uniqueSortedStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function createEntityId(type, name) {
  return `${normalizeIdentifier(type)}:${String(name || '').trim()}`;
}

function createRelationId(type, from, to) {
  return `${normalizeIdentifier(type)}:${String(from || '')}->${String(to || '')}`;
}

function normalizeRule(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return null;
  }
  if (normalized === 'IMPORT_RULE_NO_ACTION' || normalized === 'NOACTION') {
    return 'NO ACTION';
  }
  if (normalized === 'IMPORT_RULE_RESTRICT') {
    return 'RESTRICT';
  }
  if (normalized === 'IMPORT_RULE_CASCADE') {
    return 'CASCADE';
  }
  if (normalized === 'IMPORT_RULE_SET_NULL' || normalized === 'SETNULL') {
    return 'SET NULL';
  }
  if (normalized === 'IMPORT_RULE_SET_DEFAULT' || normalized === 'SETDEFAULT') {
    return 'SET DEFAULT';
  }
  return normalized.replace(/_/g, ' ');
}

function mergeEntityEvidence(existing, additional) {
  return dedupeEvidence([
    ...(existing && existing.evidence ? existing.evidence : []),
    ...asArray(additional),
  ]);
}

function buildTableEntityIndex(canonicalAnalysis) {
  return new Map(asArray(canonicalAnalysis && canonicalAnalysis.entities && canonicalAnalysis.entities.tables)
    .map((entry) => [normalizeIdentifier(entry && entry.name), entry]));
}

function buildGeneralEntityIndex(canonicalAnalysis) {
  const index = new Map();
  const entities = canonicalAnalysis && canonicalAnalysis.entities ? canonicalAnalysis.entities : {};
  for (const collection of Object.values(entities)) {
    if (!Array.isArray(collection)) continue;
    for (const entity of collection) {
      if (entity && entity.id) {
        index.set(entity.id, entity);
      }
    }
  }
  return index;
}

function buildDb2Identity(link, table) {
  const primaryMatch = asArray(link && link.matches)[0] || {};
  const normalizedTable = normalizeCatalogTable(table);
  return {
    requestedName: normalizeIdentifier(link && link.requestedName),
    matchStatus: String(link && link.matchStatus || 'unresolved'),
    matchedBy: primaryMatch.matchType || null,
    primaryDisplayName: normalizedTable.table || normalizedTable.systemName || normalizeIdentifier(link && link.requestedName),
    schema: normalizedTable.schema,
    sqlName: normalizedTable.table,
    systemSchema: normalizedTable.systemSchema,
    systemName: normalizedTable.systemName,
    objectType: normalizedTable.objectType,
    textDescription: String(normalizedTable.textDescription || '').trim() || null,
    estimatedRowCount: Number.isFinite(Number(normalizedTable.estimatedRowCount)) ? Number(normalizedTable.estimatedRowCount) : null,
    lookupStrategy: normalizedTable.lookupStrategy || primaryMatch.lookupStrategy || 'JDBC_METADATA',
    triggerCount: asArray(normalizedTable.triggers).length,
    derivedObjectCount: asArray(normalizedTable.derivedObjects).length,
    foreignKeyCount: asArray(normalizedTable.foreignKeys).length,
  };
}

function chooseCanonicalTableName(link, table, tableEntitiesByName) {
  const candidates = uniqueSortedStrings([
    link && link.requestedName,
    table && table.table,
    table && table.systemName,
  ]);
  for (const candidate of candidates) {
    if (tableEntitiesByName.has(candidate)) {
      return candidate;
    }
  }
  return normalizeIdentifier((table && (table.table || table.systemName)) || (link && link.requestedName));
}

function normalizeTrigger(trigger) {
  return {
    schema: normalizeIdentifier(trigger && trigger.schema),
    name: normalizeIdentifier(trigger && trigger.name),
    systemSchema: normalizeIdentifier(trigger && trigger.systemSchema),
    systemName: normalizeIdentifier(trigger && trigger.systemName),
    eventManipulation: normalizeIdentifier(trigger && trigger.eventManipulation),
    actionTiming: normalizeIdentifier(trigger && trigger.actionTiming),
    actionOrientation: normalizeIdentifier(trigger && trigger.actionOrientation),
    programName: normalizeIdentifier(trigger && trigger.programName),
    programLibrary: normalizeIdentifier(trigger && trigger.programLibrary),
  };
}

function normalizeDerivedObject(derivedObject) {
  return {
    schema: normalizeIdentifier(derivedObject && derivedObject.schema),
    name: normalizeIdentifier(derivedObject && (derivedObject.name || derivedObject.table)),
    systemSchema: normalizeIdentifier(derivedObject && derivedObject.systemSchema),
    systemName: normalizeIdentifier(derivedObject && derivedObject.systemName),
    objectType: normalizeIdentifier(derivedObject && derivedObject.objectType) || 'VIEW',
    textDescription: String(derivedObject && derivedObject.textDescription || '').trim() || null,
  };
}

function ensureTableEntity(entityMap, relationUpdates, name, patch = {}) {
  const normalizedName = normalizeIdentifier(name);
  if (!normalizedName) {
    return null;
  }

  const id = createEntityId('TABLE', normalizedName);
  if (!entityMap.has(id)) {
    entityMap.set(id, {
      id,
      name: normalizedName,
      kind: 'TABLE',
      evidenceCount: 0,
      evidence: [],
      ...patch,
    });
  } else if (patch && Object.keys(patch).length > 0) {
    entityMap.set(id, {
      ...entityMap.get(id),
      ...patch,
    });
  }

  return entityMap.get(id);
}

function normalizeExternalObject(entry) {
  return {
    requestedName: normalizeIdentifier(entry && entry.requestedName),
    schema: normalizeIdentifier(entry && (entry.schema || entry.sqlSchema || entry.library)),
    library: normalizeIdentifier(entry && (entry.library || entry.systemSchema)),
    sqlName: normalizeIdentifier(entry && (entry.sqlName || entry.longName)),
    systemName: normalizeIdentifier(entry && (entry.systemName || entry.name)),
    objectType: normalizeIdentifier(entry && entry.objectType),
    sqlObjectType: normalizeIdentifier(entry && entry.sqlObjectType),
    textDescription: String(entry && entry.textDescription || entry && entry.text || '').trim() || null,
    evidenceSource: String(entry && entry.evidenceSource || 'OBJECT_STATISTICS').trim() || 'OBJECT_STATISTICS',
    matchedBy: normalizeIdentifier(entry && entry.matchedBy) || 'SYSTEM_NAME',
  };
}

function buildExternalCallRequests(canonicalAnalysis) {
  const entities = canonicalAnalysis && canonicalAnalysis.entities ? canonicalAnalysis.entities : {};
  const requests = [];

  for (const program of asArray(entities.programs)) {
    if (program.role !== 'CALLED') continue;
    requests.push({
      entityId: program.id,
      entityType: 'PROGRAM',
      requestedName: normalizeIdentifier(program.name),
    });
  }

  for (const prototype of asArray(entities.prototypes)) {
    if (!prototype.imported) continue;
    requests.push({
      entityId: prototype.id,
      entityType: 'PROTOTYPE',
      requestedName: normalizeIdentifier(prototype.externalName || prototype.name),
    });
  }

  for (const reference of asArray(entities.procedureReferences)) {
    requests.push({
      entityId: reference.id,
      entityType: 'PROCEDURE_REFERENCE',
      requestedName: normalizeIdentifier(reference.name),
    });
  }

  return requests
    .filter((entry) => entry.requestedName)
    .sort((a, b) => {
      if (a.requestedName !== b.requestedName) return a.requestedName.localeCompare(b.requestedName);
      if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
      return a.entityId.localeCompare(b.entityId);
    });
}

function isExternalObjectMatch(requestedName, externalObject) {
  const requested = parseQualifiedIdentifier(requestedName);
  const external = normalizeExternalObject(externalObject);
  const aliases = uniqueSortedStrings([
    external.requestedName,
    external.sqlName,
    external.systemName,
    external.schema && external.sqlName ? `${external.schema}.${external.sqlName}` : '',
    external.library && external.systemName ? `${external.library}/${external.systemName}` : '',
  ]);

  return aliases.includes(requested && requested.qualified)
    || aliases.includes(requested && requested.name)
    || aliases.includes(requested && requested.systemName);
}

function buildDb2CatalogSemanticUpdates({ canonicalAnalysis, tableLinks, exportedTables, externalObjects }) {
  const tableEntitiesByName = buildTableEntityIndex(canonicalAnalysis);
  const existingEntitiesById = buildGeneralEntityIndex(canonicalAnalysis);
  const entityUpdates = {
    tables: new Map(),
    db2Triggers: new Map(),
    externalObjects: new Map(),
    programs: new Map(),
    prototypes: new Map(),
    procedureReferences: new Map(),
  };
  const relationUpdates = new Map();

  const normalizedTables = asArray(exportedTables).map(normalizeCatalogTable);
  const normalizedExternalObjects = asArray(externalObjects).map(normalizeExternalObject);

  for (const link of asArray(tableLinks)) {
    const match = asArray(link.matches)[0];
    if (!match) {
      const existing = tableEntitiesByName.get(normalizeIdentifier(link.requestedName));
      if (existing) {
        entityUpdates.tables.set(existing.id, {
          ...existing,
          db2Identity: {
            requestedName: normalizeIdentifier(link.requestedName),
            matchStatus: link.matchStatus,
            matchedBy: null,
            primaryDisplayName: normalizeIdentifier(link.requestedName),
            schema: '',
            sqlName: '',
            systemSchema: '',
            systemName: '',
            objectType: null,
            textDescription: null,
            estimatedRowCount: null,
            lookupStrategy: null,
            triggerCount: 0,
            derivedObjectCount: 0,
            foreignKeyCount: 0,
          },
          evidence: mergeEntityEvidence(existing, link.sourceEvidence),
          evidenceCount: mergeEntityEvidence(existing, link.sourceEvidence).length,
        });
      }
      continue;
    }

    const matchedTable = normalizedTables.find((table) => (
      table.schema === match.schema
      && table.table === match.table
      && table.systemSchema === match.systemSchema
      && table.systemName === match.systemName
    ));
    if (!matchedTable) {
      continue;
    }

    const canonicalTableName = chooseCanonicalTableName(link, matchedTable, tableEntitiesByName);
    const existingTable = tableEntitiesByName.get(canonicalTableName) || existingEntitiesById.get(createEntityId('TABLE', canonicalTableName));
    const tableEntityId = createEntityId('TABLE', canonicalTableName);
    const mergedEvidence = mergeEntityEvidence(existingTable, [
      ...asArray(link.sourceEvidence),
      ...asArray(existingTable && existingTable.evidence),
    ]);
    entityUpdates.tables.set(tableEntityId, {
      ...(existingTable || {
        id: tableEntityId,
        name: canonicalTableName,
        kind: 'TABLE',
      }),
      evidence: mergedEvidence,
      evidenceCount: mergedEvidence.length,
      db2Identity: buildDb2Identity(link, matchedTable),
    });

    for (const trigger of asArray(matchedTable.triggers).map(normalizeTrigger)) {
      const triggerName = uniqueSortedStrings([
        trigger.name,
        trigger.systemName,
      ])[0];
      if (!triggerName) continue;
      const triggerEntityId = createEntityId('TRIGGER', `${trigger.schema || trigger.systemSchema}:${triggerName}`);
      entityUpdates.db2Triggers.set(triggerEntityId, {
        id: triggerEntityId,
        name: triggerName,
        schema: trigger.schema,
        systemSchema: trigger.systemSchema,
        systemName: trigger.systemName,
        eventManipulation: trigger.eventManipulation,
        actionTiming: trigger.actionTiming,
        actionOrientation: trigger.actionOrientation,
        programName: trigger.programName,
        programLibrary: trigger.programLibrary,
        evidenceCount: mergedEvidence.length,
        evidence: mergedEvidence,
      });
      const relationId = createRelationId('HAS_TRIGGER', tableEntityId, triggerEntityId);
      relationUpdates.set(relationId, {
        id: relationId,
        type: 'HAS_TRIGGER',
        from: tableEntityId,
        to: triggerEntityId,
        evidence: mergedEvidence,
        attributes: {
          eventManipulation: trigger.eventManipulation,
          actionTiming: trigger.actionTiming,
          actionOrientation: trigger.actionOrientation,
        },
      });
    }

    for (const derivedObject of asArray(matchedTable.derivedObjects).map(normalizeDerivedObject)) {
      const derivedTableName = normalizeIdentifier(derivedObject.name || derivedObject.systemName);
      if (!derivedTableName) continue;
      const derivedTable = ensureTableEntity(entityUpdates.tables, relationUpdates, derivedTableName, {
        db2Identity: {
          requestedName: derivedTableName,
          matchStatus: 'derived',
          matchedBy: 'CATALOG_RELATION',
          primaryDisplayName: derivedObject.name || derivedObject.systemName,
          schema: derivedObject.schema,
          sqlName: derivedObject.name,
          systemSchema: derivedObject.systemSchema,
          systemName: derivedObject.systemName,
          objectType: derivedObject.objectType,
          textDescription: derivedObject.textDescription,
          estimatedRowCount: null,
          lookupStrategy: 'IBM_I_CATALOG',
          triggerCount: 0,
          derivedObjectCount: 0,
          foreignKeyCount: 0,
        },
      });
      if (!derivedTable) continue;
      const relationId = createRelationId('DERIVES_OBJECT', tableEntityId, derivedTable.id);
      relationUpdates.set(relationId, {
        id: relationId,
        type: 'DERIVES_OBJECT',
        from: tableEntityId,
        to: derivedTable.id,
        evidence: mergedEvidence,
        attributes: {
          objectType: derivedObject.objectType,
          resolutionSource: 'CATALOG',
        },
      });
    }

    for (const foreignKey of asArray(matchedTable.foreignKeys)) {
      const referencedName = normalizeIdentifier(foreignKey && foreignKey.referencesTable);
      if (!referencedName) continue;
      const referencedEntity = ensureTableEntity(entityUpdates.tables, relationUpdates, referencedName, {
        db2Identity: {
          requestedName: referencedName,
          matchStatus: 'referenced',
          matchedBy: 'CATALOG_RELATION',
          primaryDisplayName: referencedName,
          schema: normalizeIdentifier(foreignKey.referencesSchema),
          sqlName: referencedName,
          systemSchema: '',
          systemName: '',
          objectType: 'TABLE',
          textDescription: null,
          estimatedRowCount: null,
          lookupStrategy: 'IBM_I_CATALOG',
          triggerCount: 0,
          derivedObjectCount: 0,
          foreignKeyCount: 0,
        },
      });
      if (!referencedEntity) continue;
      const relationId = `${createRelationId('REFERENCES_TABLE', tableEntityId, referencedEntity.id)}:${normalizeIdentifier(foreignKey.column)}:${normalizeIdentifier(foreignKey.referencesColumn)}`;
      relationUpdates.set(relationId, {
        id: relationId,
        type: 'REFERENCES_TABLE',
        from: tableEntityId,
        to: referencedEntity.id,
        evidence: mergedEvidence,
        attributes: {
          column: normalizeIdentifier(foreignKey.column),
          referencesColumn: normalizeIdentifier(foreignKey.referencesColumn),
          constraintName: normalizeIdentifier(foreignKey.constraintName),
          updateRule: normalizeRule(foreignKey.updateRule),
          deleteRule: normalizeRule(foreignKey.deleteRule),
          resolutionSource: 'CATALOG',
        },
      });
    }
  }

  const externalCallRequests = buildExternalCallRequests(canonicalAnalysis);
  for (const request of externalCallRequests) {
    const matches = normalizedExternalObjects.filter((entry) => isExternalObjectMatch(request.requestedName, entry));
    if (matches.length !== 1) {
      continue;
    }

    const match = matches[0];
    const externalName = normalizeIdentifier(match.sqlName || match.systemName || request.requestedName);
    const externalEntityId = createEntityId('EXTERNAL_OBJECT', `${match.library || match.schema}:${externalName}:${match.objectType || 'OBJECT'}`);
    entityUpdates.externalObjects.set(externalEntityId, {
      id: externalEntityId,
      name: externalName,
      requestedName: request.requestedName,
      schema: match.schema,
      library: match.library,
      sqlName: match.sqlName,
      systemName: match.systemName,
      objectType: match.objectType,
      sqlObjectType: match.sqlObjectType,
      textDescription: match.textDescription,
      evidenceSource: match.evidenceSource,
      matchedBy: match.matchedBy,
    });

    const existingEntity = existingEntitiesById.get(request.entityId);
    if (!existingEntity) {
      continue;
    }

    const enrichedEntity = {
      ...existingEntity,
      resolutionSource: 'CATALOG',
      catalogObjectType: match.objectType,
      catalogLibrary: match.library,
      catalogSchema: match.schema,
      catalogSystemName: match.systemName,
      catalogSqlName: match.sqlName,
      catalogEvidenceSource: match.evidenceSource,
      catalogMatchedBy: match.matchedBy,
      catalogExternalObjectId: externalEntityId,
    };

    if (request.entityType === 'PROGRAM') {
      entityUpdates.programs.set(request.entityId, enrichedEntity);
    } else if (request.entityType === 'PROTOTYPE') {
      entityUpdates.prototypes.set(request.entityId, enrichedEntity);
    } else if (request.entityType === 'PROCEDURE_REFERENCE') {
      entityUpdates.procedureReferences.set(request.entityId, enrichedEntity);
    }

    const relationId = createRelationId('RESOLVES_TO_EXTERNAL_OBJECT', request.entityId, externalEntityId);
    relationUpdates.set(relationId, {
      id: relationId,
      type: 'RESOLVES_TO_EXTERNAL_OBJECT',
      from: request.entityId,
      to: externalEntityId,
      evidence: asArray(existingEntity.evidence),
      attributes: {
        resolutionSource: 'CATALOG',
        objectType: match.objectType,
        matchedBy: match.matchedBy,
        evidenceSource: match.evidenceSource,
      },
    });
  }

  return {
    entities: Object.fromEntries(
      Object.entries(entityUpdates)
        .map(([key, value]) => [key, Array.from(value.values()).sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))])
        .filter(([, value]) => value.length > 0),
    ),
    relations: Array.from(relationUpdates.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

module.exports = {
  buildDb2CatalogSemanticUpdates,
  buildExternalCallRequests,
  normalizeExternalObject,
};
