'use strict';

const { createFinalKnowledgeCatalog } = require('../final/finalKnowledgeCatalog');
const { persistFinalKnowledgeCatalog } = require('../knowledgePipeline');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBoundColumns(grid) {
  return asArray(grid && grid.columns).filter(column => column && column.boundField).length;
}

function countHeadings(grid) {
  return asArray(grid && grid.columns).filter(column => column && column.heading).length;
}

function buildNeutralGridPattern(grid, index) {
  const columns = asArray(grid && grid.columns);
  const columnCount = Number(grid && grid.numberOfColumns) || columns.length;
  const boundColumnCount = countBoundColumns(grid);
  const headingCount = countHeadings(grid);
  const features = ['tabular-layout'];

  if (columnCount > 1) features.push('multi-column-layout');
  if (boundColumnCount > 0) features.push('data-binding-shape');
  if (headingCount > 0) features.push('column-label-shape');

  return {
    id: `ui-grid-${index + 1}`,
    kind: 'ui.grid',
    domain: 'ui',
    technology: ['pui-structural'],
    features,
    elements: [
      {
        role: 'grid',
        intent: 'display-records',
        layoutHints: [`columns:${columnCount}`],
        behaviorHints: [
          ...(boundColumnCount > 0 ? ['supports-data-binding'] : []),
          ...(headingCount > 0 ? ['supports-column-labels'] : []),
        ],
      },
    ],
    confidence: {
      level: 'medium',
      score: Math.min(1, 0.6 + (columnCount > 0 ? 0.1 : 0) + (boundColumnCount > 0 ? 0.1 : 0)),
    },
    evidenceSummary: {
      recordFormatCount: 1,
      gridCount: 1,
      columnCount,
      boundColumnCount,
      headingCount,
    },
    privacyAssessment: {
      status: 'passed',
      notes: ['Counts only.'],
    },
    limitations: ['Structural UI signals only.', 'Source values omitted.'],
  };
}

function buildNeutralPuiKnowledgeCatalog(projection, options = {}) {
  if (!projection || typeof projection !== 'object') {
    throw new Error('PUI projection is required');
  }

  const recordFormats = asArray(projection.recordFormats);
  const grids = recordFormats.flatMap(recordFormat => asArray(recordFormat && recordFormat.grids));
  const patterns = grids.map((grid, index) => buildNeutralGridPattern(grid, index));

  return createFinalKnowledgeCatalog({
    generatedAt: options.generatedAt,
    generatorName: 'zeus-pui-neutral-extractor',
    generatorVersion: options.generatorVersion || '0.2.0',
    privacyMode: 'strict',
    taxonomyVersion: 'draft-1',
    patterns,
  });
}

function extractAndPersistNeutralPuiKnowledge({ projection, outputRoot, runId, ...options }) {
  const catalog = buildNeutralPuiKnowledgeCatalog(projection, options);
  return persistFinalKnowledgeCatalog({ outputRoot, runId, catalog });
}

module.exports = {
  buildNeutralPuiKnowledgeCatalog,
  extractAndPersistNeutralPuiKnowledge,
};
