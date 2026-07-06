/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPuiProjection, traceFieldBinding } = require('../src/pui/puiProjection');
const { buildHtmlLines } = require('../src/pui/puiDdsParser');

const DDS_PREFIX_FIRST = '     A                                  1  2HTML(\'';

// Synthetic PUI record formats (no customer data).
const GRID_FORMAT_JSON = JSON.stringify({
  'record format name': 'GRIDFMT',
  items: [
    {
      id: 'grid1',
      'field type': 'grid',
      'record format name': 'GRIDFMT',
      'number of columns': '3',
      'column headings': 'Code,Text,Extra',
    },
    {
      id: 'c1', grid: 'grid1', column: '1', 'field type': 'output field',
      'field name': 'STATUSCODE', tooltip: 'I=Import Z=Category',
    },
    {
      id: 'c2', grid: 'grid1', column: '2', 'field type': 'output field',
      'field name': 'STATUSTEXT',
    },
    { id: 'c3', grid: 'grid1', column: '3', 'field type': 'button' },
    {
      id: 'w1', 'field type': 'output field',
      'field name': 'HEADERINFO', tooltip: 'Header',
    },
  ],
});

const MISMATCH_FORMAT_JSON = JSON.stringify({
  'record format name': 'MISMATCH',
  items: [
    {
      id: 'grid2', 'field type': 'grid', 'record format name': 'MISMATCH',
      'number of columns': '2', 'column headings': 'OnlyOne',
    },
    {
      id: 'm1', grid: 'grid2', column: '1', 'field type': 'output field',
      'field name': 'FIELDA',
    },
  ],
});

function singleLineHtmlBlock(json) {
  return `${DDS_PREFIX_FIRST}${json}')`;
}

function buildMember() {
  const lines = [
    '     A          R GRIDFMT',
    singleLineHtmlBlock(GRID_FORMAT_JSON),
    '     A          R MISMATCH',
    singleLineHtmlBlock(MISMATCH_FORMAT_JSON),
  ];
  return lines.join('\n');
}

test('buildPuiProjection decodes multiple record formats deterministically', () => {
  const projection = buildPuiProjection(buildMember(), { file: 'DEMOFMT.dds' });

  assert.equal(projection.kind, 'zeus-pui-projection');
  assert.equal(projection.recordFormatCount, 2);
  assert.deepEqual(
    projection.recordFormats.map((rf) => rf.recordFormat),
    ['GRIDFMT', 'MISMATCH'],
  );
});

test('grid columns expose heading, field binding and tooltip', () => {
  const projection = buildPuiProjection(buildMember(), { file: 'DEMOFMT.dds' });
  const gridFmt = projection.recordFormats.find((rf) => rf.recordFormat === 'GRIDFMT');
  const grid = gridFmt.grids.find((g) => g.id === 'grid1');

  assert.equal(grid.numberOfColumns, 3);
  assert.equal(grid.columns.length, 3);

  const col1 = grid.columns[0];
  assert.equal(col1.heading, 'Code');
  assert.equal(col1.boundField, 'STATUSCODE');
  assert.equal(col1.tooltip, 'I=Import Z=Category');
  assert.equal(col1.boundFieldType, 'output field');

  const col2 = grid.columns[1];
  assert.equal(col2.boundField, 'STATUSTEXT');
  assert.equal(col2.tooltip, null);

  const col3 = grid.columns[2];
  assert.equal(col3.boundField, null);
  assert.equal(col3.staticValue, null);
});

test('unbound columns and heading/column mismatches surface as signals', () => {
  const projection = buildPuiProjection(buildMember(), { file: 'DEMOFMT.dds' });

  const unbound = projection.signals.find((s) => s.type === 'UNBOUND_COLUMN');
  assert.ok(unbound, 'expected UNBOUND_COLUMN signal');
  assert.equal(unbound.recordFormat, 'GRIDFMT');
  assert.equal(unbound.column, 3);

  const mismatch = projection.signals.find((s) => s.type === 'HEADING_COLUMN_MISMATCH');
  assert.ok(mismatch, 'expected HEADING_COLUMN_MISMATCH signal');
  assert.equal(mismatch.recordFormat, 'MISMATCH');
});

test('standalone bound widgets are projected', () => {
  const projection = buildPuiProjection(buildMember(), { file: 'DEMOFMT.dds' });
  const gridFmt = projection.recordFormats.find((rf) => rf.recordFormat === 'GRIDFMT');
  const widget = gridFmt.widgets.find((w) => w.id === 'w1');

  assert.ok(widget, 'expected widget w1');
  assert.equal(widget.boundField, 'HEADERINFO');
  assert.equal(widget.tooltip, 'Header');
});

test('traceFieldBinding locates a grid-column binding case-insensitively', () => {
  const projection = buildPuiProjection(buildMember(), { file: 'DEMOFMT.dds' });
  const hits = traceFieldBinding(projection, 'statuscode');

  assert.equal(hits.length, 1);
  assert.equal(hits[0].location, 'grid-column');
  assert.equal(hits[0].grid, 'grid1');
  assert.equal(hits[0].column, 1);
  assert.equal(hits[0].heading, 'Code');
  assert.equal(hits[0].tooltip, 'I=Import Z=Category');

  assert.equal(traceFieldBinding(projection, 'NOSUCHFIELD').length, 0);
});

test('column-72 continuation lines are reassembled before decoding', () => {
  // Split the JSON exactly like the ProfoundUI Designer would (multi-line block).
  const splitLines = buildHtmlLines(GRID_FORMAT_JSON);
  assert.ok(splitLines.length > 1, 'fixture should span multiple continuation lines');

  const member = ['     A          R GRIDFMT', ...splitLines].join('\n');
  const projection = buildPuiProjection(member, { file: 'SPLIT.dds' });

  assert.equal(projection.recordFormatCount, 1);
  const grid = projection.recordFormats[0].grids.find((g) => g.id === 'grid1');
  assert.equal(grid.columns[0].boundField, 'STATUSCODE');
  assert.equal(grid.columns[0].tooltip, 'I=Import Z=Category');
});

// Real ProfoundUI binds grid columns/widgets through an object-valued "value"
// property carrying "fieldName" (not a top-level "field name" key). A string
// "value" is a static literal instead.
const VALUE_BINDING_JSON = JSON.stringify({
  'record format name': 'VALFMT',
  items: [
    {
      id: 'grid3', 'field type': 'grid', 'record format name': 'VALFMT',
      'number of columns': '2', 'column headings': 'Menge,Info',
    },
    {
      id: 'v1', grid: 'grid3', column: '1', 'field type': 'output field',
      value: { fieldName: 'S10PlanMng', dataLength: '7', dataType: 'zoned', designValue: '[S10PlanMng]' },
    },
    {
      id: 'v2', grid: 'grid3', column: '2', 'field type': 'output field',
      value: 'STATIC TEXT',
    },
    {
      id: 'vw1', 'field type': 'output field',
      value: { fieldName: 'S10Header', dataLength: '20', dataType: 'char' },
    },
  ],
});

function buildValueBindingMember() {
  return [
    '     A          R VALFMT',
    singleLineHtmlBlock(VALUE_BINDING_JSON),
  ].join('\n');
}

test('object-valued "value" binds a grid column to its fieldName (real ProfoundUI)', () => {
  const projection = buildPuiProjection(buildValueBindingMember(), { file: 'VALFMT.dds' });
  const grid = projection.recordFormats[0].grids.find((g) => g.id === 'grid3');

  const col1 = grid.columns[0];
  assert.equal(col1.boundField, 'S10PLANMNG');
  assert.equal(col1.staticValue, null);

  const col2 = grid.columns[1];
  assert.equal(col2.boundField, null);
  assert.equal(col2.staticValue, 'STATIC TEXT');

  // A bound column via object-value must not raise a false UNBOUND_COLUMN signal.
  const falseUnbound = projection.signals.find(
    (s) => s.type === 'UNBOUND_COLUMN' && s.column === 1,
  );
  assert.equal(falseUnbound, undefined);
});

test('object-valued "value" binds a standalone widget and is traceable', () => {
  const projection = buildPuiProjection(buildValueBindingMember(), { file: 'VALFMT.dds' });
  const widget = projection.recordFormats[0].widgets.find((w) => w.id === 'vw1');

  assert.ok(widget, 'expected widget vw1');
  assert.equal(widget.boundField, 'S10HEADER');

  const hits = traceFieldBinding(projection, 's10planmng');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].location, 'grid-column');
  assert.equal(hits[0].column, 1);
});

// Real ProfoundUI input widgets (image / checkbox / radio) bind their DDS field
// through an object-valued "response" property carrying "fieldName" — they have
// no display "value" binding but are genuinely bound columns/widgets.
const RESPONSE_BINDING_JSON = JSON.stringify({
  'record format name': 'RSPFMT',
  items: [
    {
      id: 'grid4', 'field type': 'grid', 'record format name': 'RSPFMT',
      'number of columns': '1', 'column headings': 'Status',
    },
    {
      id: 'r1', grid: 'grid4', column: '1', 'field type': 'image',
      'image source': 'images/status.png',
      response: { fieldName: 'S10Flag', dataType: 'char', customTrue: 'Y', customFalse: 'N' },
    },
    {
      id: 'rw1', 'field type': 'checkbox',
      response: { fieldName: 'S10Sel', dataType: 'char', customTrue: '1', customFalse: '0' },
    },
  ],
});

function buildResponseBindingMember() {
  return [
    '     A          R RSPFMT',
    singleLineHtmlBlock(RESPONSE_BINDING_JSON),
  ].join('\n');
}

test('object-valued "response" binds a grid image column (real ProfoundUI)', () => {
  const projection = buildPuiProjection(buildResponseBindingMember(), { file: 'RSPFMT.dds' });
  const grid = projection.recordFormats[0].grids.find((g) => g.id === 'grid4');

  const col1 = grid.columns[0];
  assert.equal(col1.boundField, 'S10FLAG');
  assert.equal(col1.staticValue, null);

  // A response-bound image column must not raise a false UNBOUND_COLUMN signal.
  const falseUnbound = projection.signals.find(
    (s) => s.type === 'UNBOUND_COLUMN' && s.grid === 'grid4',
  );
  assert.equal(falseUnbound, undefined);
});

test('object-valued "response" binds a standalone widget and is traceable', () => {
  const projection = buildPuiProjection(buildResponseBindingMember(), { file: 'RSPFMT.dds' });
  const widget = projection.recordFormats[0].widgets.find((w) => w.id === 'rw1');

  assert.ok(widget, 'expected widget rw1');
  assert.equal(widget.boundField, 'S10SEL');

  const hits = traceFieldBinding(projection, 's10flag');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].location, 'grid-column');
});

