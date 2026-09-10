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

function boundedCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function buildNeutralGridPattern(grid, index, recordFormatCount) {
  const columns = asArray(grid && grid.columns);
  const columnCount = boundedCount(grid && grid.numberOfColumns) || columns.length;
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
      recordFormatCount: boundedCount(recordFormatCount) || 1,
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

const WIDGET_TAXONOMY = Object.freeze([
  {
    kind: 'ui.selection',
    feature: 'selection-control-layout',
    role: 'selection-control',
    intent: 'select-options',
    pattern: /checkbox|radio|select|dropdown|combobox|choice|list/i,
  },
  {
    kind: 'ui.validation',
    feature: 'validation-feedback',
    role: 'validation-feedback',
    intent: 'communicate-validation',
    pattern: /valid|error|warning|message|feedback|alert/i,
  },
  {
    kind: 'ui.dialog',
    feature: 'dialog-surface',
    role: 'dialog-surface',
    intent: 'present-focused-interaction',
    pattern: /dialog|modal|popup|overlay/i,
  },
  {
    kind: 'ui.navigation',
    feature: 'navigation-control-layout',
    role: 'navigation-control',
    intent: 'navigate-between-views',
    pattern: /tab|link|menu|nav|navigation/i,
  },
  {
    kind: 'ui.toolbar',
    feature: 'action-control-layout',
    role: 'action-control',
    intent: 'trigger-action',
    pattern: /button|action|command|toolbar|submit|cancel|icon/i,
  },
]);

function classifyWidget(widget) {
  const fieldType = String((widget && widget.fieldType) || '');
  return (
    WIDGET_TAXONOMY.find(category => category.pattern.test(fieldType)) || {
      kind: 'ui.form',
      feature: 'form-control-layout',
      role: 'form-control',
      intent: 'capture-input',
    }
  );
}

function buildNeutralWidgetPattern(widget, index, recordFormatCount) {
  const category = classifyWidget(widget);
  const hasBinding = Boolean(widget && widget.boundField);
  const hasStaticValue = Boolean(
    widget && typeof widget.staticValue === 'string' && widget.staticValue.trim()
  );
  const features = [category.feature];
  if (hasBinding) features.push('data-binding-shape');
  if (hasStaticValue) features.push('static-value-shape');

  return {
    id: `${category.kind}-${index + 1}`,
    kind: category.kind,
    domain: 'ui',
    technology: ['pui-structural'],
    features,
    elements: [
      {
        role: category.role,
        intent: category.intent,
        layoutHints: ['widget-control'],
        behaviorHints: [
          ...(hasBinding ? ['supports-data-binding'] : []),
          ...(hasStaticValue ? ['supports-static-value'] : []),
        ],
      },
    ],
    confidence: {
      level: 'low',
      score: Math.min(1, 0.55 + (hasBinding ? 0.1 : 0) + (hasStaticValue ? 0.05 : 0)),
    },
    evidenceSummary: {
      recordFormatCount: boundedCount(recordFormatCount) || 1,
      widgetCount: 1,
      boundWidgetCount: hasBinding ? 1 : 0,
      staticValueCount: hasStaticValue ? 1 : 0,
      classification: category.kind.slice(3),
    },
    privacyAssessment: {
      status: 'passed',
      notes: ['Controlled taxonomy and counts only.'],
    },
    limitations: ['Heuristic widget classification.', 'Source values omitted.'],
  };
}

function buildNeutralPuiKnowledgeCatalog(projection, options = {}) {
  if (!projection || typeof projection !== 'object') {
    throw new Error('PUI projection is required');
  }

  const recordFormats = asArray(projection.recordFormats);
  const grids = recordFormats.flatMap(recordFormat => asArray(recordFormat && recordFormat.grids));
  const widgets = recordFormats.flatMap(recordFormat =>
    asArray(recordFormat && recordFormat.widgets)
  );
  const patterns = [
    ...grids.map((grid, index) => buildNeutralGridPattern(grid, index, recordFormats.length)),
    ...widgets.map((widget, index) =>
      buildNeutralWidgetPattern(widget, index, recordFormats.length)
    ),
  ];

  return createFinalKnowledgeCatalog({
    generatedAt: options.generatedAt,
    generatorName: 'zeus-pui-neutral-extractor',
    generatorVersion: options.generatorVersion || '0.2.0',
    privacyMode: 'strict',
    taxonomyVersion: 'draft-2',
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
