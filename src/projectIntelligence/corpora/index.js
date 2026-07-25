'use strict';

/**
 * Project Intelligence offline corpora registry (Track C).
 * Fixtures for tests/benchmarks — not customer source.
 */

const mini = require('./miniMultiProgramCorpus');

const CORPORA = Object.freeze({
  [mini.CORPUS_ID]: Object.freeze({
    id: mini.CORPUS_ID,
    version: mini.CORPUS_VERSION,
    title: 'Mini multi-program RPG corpus',
    description:
      'Synthetic multi-program RPG/SQL corpus for indexing, retrieval, and portable export tests.',
    materialize: mini.materializeCorpus,
    listFiles: mini.listFiles,
  }),
});

function listCorpora() {
  return Object.values(CORPORA).map(c => ({
    id: c.id,
    version: c.version,
    title: c.title,
    description: c.description,
    fileCount: c.listFiles().length,
  }));
}

function getCorpus(corpusId) {
  const id = String(corpusId || '').trim();
  return CORPORA[id] || null;
}

function materializeCorpus(corpusId, targetDir, deps) {
  const corpus = getCorpus(corpusId);
  if (!corpus) {
    const err = new Error(`Unknown project-intelligence corpus: ${corpusId}`);
    err.code = 'UNKNOWN_PI_CORPUS';
    throw err;
  }
  return corpus.materialize(targetDir, deps);
}

module.exports = {
  CORPORA,
  listCorpora,
  getCorpus,
  materializeCorpus,
  miniMultiProgramCorpus: mini,
};
