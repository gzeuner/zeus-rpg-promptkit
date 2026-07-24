'use strict';

/**
 * Project Intelligence Knowledge Store (ZPI-03).
 *
 * Community SPI + SQLite metadata provider.
 * No Lucene, no content-addressed blob store, no CLI/MCP.
 */

const constants = require('./constants');
const errors = require('./errors');
const layout = require('./layout');
const writerLock = require('./writerLock');
const migrations = require('./migrations');
const sqliteDriver = require('./sqliteDriver');
const { createSqliteKnowledgeStore } = require('./sqliteKnowledgeStore');
const { createProjectKnowledgeStore, openProjectKnowledgeStore } = require('./createStore');

module.exports = {
  // lifecycle factory (preferred SPI entry)
  createProjectKnowledgeStore,
  openProjectKnowledgeStore,

  // lower-level building blocks
  createSqliteKnowledgeStore,
  probeNodeSqlite: sqliteDriver.probeNodeSqlite,
  DRIVER_ID: sqliteDriver.DRIVER_ID,

  // layout / locks / migrations
  ...constants,
  knowledgePaths: layout.knowledgePaths,
  resolveKnowledgeRoot: layout.resolveKnowledgeRoot,
  ensureLayoutDirs: layout.ensureLayoutDirs,
  acquireWriterLock: writerLock.acquireWriterLock,
  inspectWriterLock: writerLock.inspectWriterLock,
  isLockStale: writerLock.isLockStale,
  MIGRATIONS: migrations.MIGRATIONS,
  assertCompatibleSchemaVersion: migrations.assertCompatibleSchemaVersion,

  // errors
  KnowledgeStoreError: errors.KnowledgeStoreError,
};
