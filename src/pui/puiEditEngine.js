'use strict';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeChangeSet(changeSet) {
  if (Array.isArray(changeSet)) {
    return { operations: changeSet };
  }

  if (!changeSet || typeof changeSet !== 'object') {
    throw new Error('Change set must be an object or an array of operations');
  }

  if (changeSet.type && !Array.isArray(changeSet.operations)) {
    return {
      ...changeSet,
      operations: [changeSet],
    };
  }

  if (!Array.isArray(changeSet.operations)) {
    throw new Error('Change set requires an operations array');
  }

  return changeSet;
}

function formatValue(value) {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  return JSON.stringify(value);
}

function parseCriterionKey(rawKey) {
  const match = String(rawKey || '').match(/^(.*?)(?:\$(contains|matches|in|exists))?$/);
  if (!match) {
    return { path: String(rawKey || ''), operator: 'equals' };
  }
  return {
    path: match[1],
    operator: match[2] || 'equals',
  };
}

function getValueAtPath(target, rawPath) {
  if (!rawPath) {
    return target;
  }

  const segments = String(rawPath).split('.');
  let current = target;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function setValueAtPath(target, rawPath, value) {
  const segments = String(rawPath).split('.');
  let current = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (current[segment] === null || typeof current[segment] !== 'object') {
      current[segment] = {};
    }
    current = current[segment];
  }

  current[segments[segments.length - 1]] = value;
}

function deleteValueAtPath(target, rawPath) {
  const segments = String(rawPath).split('.');
  let current = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    current = current[segment];
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    return false;
  }

  const lastSegment = segments[segments.length - 1];
  const hadValue = Object.prototype.hasOwnProperty.call(current, lastSegment);
  delete current[lastSegment];
  return hadValue;
}

function compareValues(actual, expected) {
  if (actual === expected) {
    return true;
  }
  if (typeof actual === 'object' || typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return String(actual) === String(expected);
}

function matchesCriterion(actual, expected, operator) {
  switch (operator) {
    case 'exists':
      return Boolean(actual !== undefined) === Boolean(expected);
    case 'contains':
      return actual !== undefined && actual !== null && String(actual).includes(String(expected));
    case 'matches': {
      const pattern = expected instanceof RegExp ? expected : new RegExp(String(expected));
      return pattern.test(String(actual ?? ''));
    }
    case 'in':
      return (
        Array.isArray(expected) && expected.map(entry => String(entry)).includes(String(actual))
      );
    default:
      return compareValues(actual, expected);
  }
}

function matchesWhere(item, where) {
  if (!where || Object.keys(where).length === 0) {
    return true;
  }

  for (const [rawKey, expected] of Object.entries(where)) {
    const { path, operator } = parseCriterionKey(rawKey);
    const actual = getValueAtPath(item, path);
    if (!matchesCriterion(actual, expected, operator)) {
      return false;
    }
  }

  return true;
}

function selectItems(items, where) {
  return (items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesWhere(item, where));
}

function describeItem(item) {
  return String(
    (item && (item.id || item['record format name'] || item['field type'] || item.name)) ||
      'unnamed item'
  );
}

function ensureItemsArray(json) {
  if (!Array.isArray(json.items)) {
    json.items = [];
  }
  return json.items;
}

function applyUpdateItem(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const matches = selectItems(items, operation.where || operation.target || {});
  if (matches.length === 0) {
    throw new Error(
      `update-item matched no items for selector: ${JSON.stringify(operation.where || operation.target || {})}`
    );
  }
  if (matches.length > 1 && !operation.allowMultiple) {
    throw new Error(
      `update-item matched multiple items (${matches.length}); set allowMultiple=true to update all matches`
    );
  }

  const changedItems = matches.length > 0 ? matches : [];
  for (const match of changedItems) {
    const item = match.item;
    const before = cloneJson(item);
    const updates = operation.set || operation.patch || {};
    const removals = Array.isArray(operation.unset) ? operation.unset : [];
    const changeNotes = [];

    for (const [path, value] of Object.entries(updates)) {
      const beforeValue = getValueAtPath(before, path);
      setValueAtPath(item, path, value);
      const afterValue = getValueAtPath(item, path);
      if (!compareValues(beforeValue, afterValue)) {
        changeNotes.push(`${path}: ${formatValue(beforeValue)} -> ${formatValue(afterValue)}`);
      }
    }

    for (const path of removals) {
      const beforeValue = getValueAtPath(before, path);
      const removed = deleteValueAtPath(item, path);
      if (removed) {
        changeNotes.push(`${path}: removed (${formatValue(beforeValue)})`);
      }
    }

    summaryLines.push(
      `update-item -> ${describeItem(item)}: ${changeNotes.length > 0 ? changeNotes.join(', ') : 'no effective change'}`
    );
  }
}

function applyRemoveItem(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const matches = selectItems(items, operation.where || operation.target || {});
  if (matches.length === 0) {
    throw new Error(
      `remove-item matched no items for selector: ${JSON.stringify(operation.where || operation.target || {})}`
    );
  }
  if (matches.length > 1 && !operation.allowMultiple) {
    throw new Error(
      `remove-item matched multiple items (${matches.length}); set allowMultiple=true to remove all matches`
    );
  }

  const removedLabels = [];
  for (const match of [...matches].sort((a, b) => b.index - a.index)) {
    removedLabels.push(describeItem(match.item));
    items.splice(match.index, 1);
  }

  summaryLines.push(
    `remove-item -> removed ${removedLabels.length} item(s): ${removedLabels.join(', ')}`
  );
}

function applyInsertItemAfter(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const anchorMatches = selectItems(
    items,
    operation.after || operation.where || operation.target || {}
  );
  if (anchorMatches.length === 0) {
    throw new Error(
      `insert-item-after matched no anchor items for selector: ${JSON.stringify(operation.after || operation.where || operation.target || {})}`
    );
  }
  if (anchorMatches.length > 1 && !operation.allowMultiple) {
    throw new Error(
      `insert-item-after matched multiple anchors (${anchorMatches.length}); set allowMultiple=true to use the last match`
    );
  }

  const anchor = anchorMatches[anchorMatches.length - 1];
  const newItem = operation.item || operation.template;
  if (!newItem || typeof newItem !== 'object') {
    throw new Error('insert-item-after requires an item object');
  }

  items.splice(anchor.index + 1, 0, cloneJson(newItem));
  summaryLines.push(
    `insert-item-after -> inserted ${describeItem(newItem)} after ${describeItem(anchor.item)}`
  );
}

function applyAddColumn(json, operation, summaryLines) {
  const items = ensureItemsArray(json);

  // Find the grid by record format name or id
  const gridName = operation.grid;
  if (!gridName) {
    throw new Error('add-column requires a grid name (e.g., "grid": "gridMain")');
  }

  const gridMatches = selectItems(items, { 'field type': 'grid' }).filter(({ item }) => {
    return item['record format name'] === gridName || item.id === gridName;
  });

  if (gridMatches.length === 0) {
    throw new Error(
      `add-column: grid "${gridName}" not found (searched by record format name and id)`
    );
  }

  const grid = gridMatches[0].item;
  const columnCount = parseInt(grid['number of columns'] || '0', 10);
  const newColumnNum = columnCount + 1;

  // Update grid column count
  const oldColumnCount = grid['number of columns'];
  grid['number of columns'] = String(newColumnNum);

  // Update column widths if provided
  if (operation.columnWidth) {
    const widthsStr = grid['column widths'] || '';
    const widths = widthsStr ? widthsStr.split(',').map(w => w.trim()) : [];
    widths.push(String(operation.columnWidth));
    grid['column widths'] = widths.join(',');
  }

  // Update column headings if provided
  if (operation.columnHeading) {
    const headingsStr = grid['column headings'] || '';
    const headings = headingsStr ? headingsStr.split(',').map(h => h.trim()) : [];
    headings.push(operation.columnHeading);
    grid['column headings'] = headings.join(',');
  }

  // Create new column item
  const newColumnItem = operation.columnItem || {
    id: operation.columnId || `${gridName}_col${newColumnNum}`,
    'field type': operation.fieldType || 'output field',
    grid: grid.id || gridName,
    column: String(newColumnNum),
  };

  if (operation.set && typeof operation.set === 'object') {
    Object.assign(newColumnItem, operation.set);
  }

  items.push(newColumnItem);
  summaryLines.push(
    `add-column -> added column ${newColumnNum} to grid "${gridName}"; column count: ${oldColumnCount} -> ${newColumnNum}`
  );
}

function applyDeleteColumn(json, operation, summaryLines) {
  const items = ensureItemsArray(json);

  const gridName = operation.grid;
  if (!gridName) {
    throw new Error('delete-column requires a grid name');
  }

  const columnNum = parseInt(operation.column || '0', 10);
  if (columnNum <= 0) {
    throw new Error(`delete-column: column must be a positive number, got ${operation.column}`);
  }

  // Find grid by record format name or id
  const gridMatches = selectItems(items, { 'field type': 'grid' }).filter(({ item }) => {
    return item['record format name'] === gridName || item.id === gridName;
  });

  if (gridMatches.length === 0) {
    throw new Error(`delete-column: grid "${gridName}" not found`);
  }

  const grid = gridMatches[0].item;
  const gridId = grid.id || gridName;
  const columnCount = parseInt(grid['number of columns'] || '0', 10);

  if (columnNum > columnCount) {
    throw new Error(
      `delete-column: column ${columnNum} does not exist (grid has ${columnCount} columns)`
    );
  }

  // Find and remove column items for this column
  const columnMatches = selectItems(items, { grid: gridId, column: String(columnNum) });
  const removedItems = [];
  for (const match of [...columnMatches].sort((a, b) => b.index - a.index)) {
    removedItems.push(describeItem(match.item));
    items.splice(match.index, 1);
  }

  // Renumber columns > columnNum
  const affectedMatches = selectItems(items, { grid: gridId });
  for (const match of affectedMatches) {
    const col = parseInt(match.item.column || '0', 10);
    if (col > columnNum) {
      match.item.column = String(col - 1);
    }
  }

  // Update grid column count
  const oldColumnCount = grid['number of columns'];
  grid['number of columns'] = String(columnCount - 1);

  // Update column widths if present
  if (grid['column widths']) {
    const widths = grid['column widths'].split(',').map(w => w.trim());
    if (widths.length > columnNum - 1) {
      widths.splice(columnNum - 1, 1);
      grid['column widths'] = widths.join(',');
    }
  }

  // Update column headings if present
  if (grid['column headings']) {
    const headings = grid['column headings'].split(',').map(h => h.trim());
    if (headings.length > columnNum - 1) {
      headings.splice(columnNum - 1, 1);
      grid['column headings'] = headings.join(',');
    }
  }

  summaryLines.push(
    `delete-column -> removed column ${columnNum} from grid "${gridName}"; column count: ${oldColumnCount} -> ${columnCount - 1}; removed items: ${removedItems.join(', ')}`
  );
}

function applyUpdateColumnWidth(json, operation, summaryLines) {
  const items = ensureItemsArray(json);

  const gridName = operation.grid;
  const columnNum = parseInt(operation.column || '0', 10);
  const newWidth = String(operation.width || operation.newWidth || '');

  if (!gridName) {
    throw new Error('update-column-width requires a grid name');
  }

  if (columnNum <= 0) {
    throw new Error(
      `update-column-width: column must be a positive number, got ${operation.column}`
    );
  }

  if (!newWidth) {
    throw new Error('update-column-width requires a width (e.g., "150px" or "150")');
  }

  const gridMatches = selectItems(items, { 'field type': 'grid' }).filter(({ item }) => {
    return item['record format name'] === gridName || item.id === gridName;
  });

  if (gridMatches.length === 0) {
    throw new Error(`update-column-width: grid "${gridName}" not found`);
  }

  const grid = gridMatches[0].item;
  const columnCount = parseInt(grid['number of columns'] || '0', 10);

  if (columnNum > columnCount) {
    throw new Error(
      `update-column-width: column ${columnNum} does not exist (grid has ${columnCount} columns)`
    );
  }

  if (!grid['column widths']) {
    throw new Error(`update-column-width: grid "${gridName}" has no column widths to update`);
  }

  const widths = grid['column widths'].split(',').map(w => w.trim());
  if (widths.length !== columnCount) {
    throw new Error(
      `update-column-width: width array length (${widths.length}) does not match column count (${columnCount})`
    );
  }

  const oldWidth = widths[columnNum - 1];
  widths[columnNum - 1] = newWidth;
  grid['column widths'] = widths.join(',');

  summaryLines.push(
    `update-column-width -> grid "${gridName}" column ${columnNum}: width: ${oldWidth} -> ${newWidth}`
  );
}

function applyToggleItemVisibility(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const matches = selectItems(items, operation.where || operation.target || {});

  if (matches.length === 0) {
    throw new Error(
      `toggle-item-visibility matched no items for selector: ${JSON.stringify(operation.where || operation.target || {})}`
    );
  }

  if (matches.length > 1 && !operation.allowMultiple) {
    throw new Error(
      `toggle-item-visibility matched multiple items (${matches.length}); set allowMultiple=true to toggle all`
    );
  }

  const mode = (operation.mode || 'toggle').toLowerCase();
  const changedItems = [];

  for (const match of matches) {
    const item = match.item;
    const currentVis = item.visibility || 'visible';
    let newVis;

    if (mode === 'hide') {
      newVis = 'hidden';
    } else if (mode === 'show') {
      newVis = 'visible';
    } else {
      newVis = currentVis === 'visible' ? 'hidden' : 'visible';
    }

    if (currentVis !== newVis) {
      item.visibility = newVis;
      changedItems.push(`${describeItem(item)}: ${currentVis} -> ${newVis}`);
    }
  }

  if (changedItems.length === 0) {
    summaryLines.push(
      `toggle-item-visibility -> ${matches.length} item(s) already had desired visibility`
    );
  } else {
    summaryLines.push(`toggle-item-visibility -> ${changedItems.join('; ')}`);
  }
}

function applyShowFieldSet(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldsetName = operation.fieldset || operation.name;
  if (!fieldsetName) {
    throw new Error('show-fieldset requires a fieldset name (e.g., "fieldset": "addressPanel")');
  }

  const fieldsetMatches = selectItems(items, {
    'record format name': fieldsetName,
    'field type': 'field set panel',
  }).concat(selectItems(items, { id: fieldsetName, 'field type': 'field set panel' }));

  if (fieldsetMatches.length === 0) {
    throw new Error(`show-fieldset: field set "${fieldsetName}" not found`);
  }

  const fieldset = fieldsetMatches[0].item;
  const oldVis = fieldset.visibility || 'visible';
  fieldset.visibility = 'visible';

  summaryLines.push(`show-fieldset -> "${fieldsetName}": ${oldVis} -> visible`);
}

function applyHideFieldSet(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldsetName = operation.fieldset || operation.name;
  if (!fieldsetName) {
    throw new Error('hide-fieldset requires a fieldset name (e.g., "fieldset": "addressPanel")');
  }

  const fieldsetMatches = selectItems(items, {
    'record format name': fieldsetName,
    'field type': 'field set panel',
  }).concat(selectItems(items, { id: fieldsetName, 'field type': 'field set panel' }));

  if (fieldsetMatches.length === 0) {
    throw new Error(`hide-fieldset: field set "${fieldsetName}" not found`);
  }

  const fieldset = fieldsetMatches[0].item;
  const oldVis = fieldset.visibility || 'visible';
  fieldset.visibility = 'hidden';

  summaryLines.push(`hide-fieldset -> "${fieldsetName}": ${oldVis} -> hidden`);
}

function applyAddErrorCondition(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  if (!fieldName) {
    throw new Error('add-error-condition requires a field name (e.g., "field": "emailAddress")');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`add-error-condition: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const message = operation.message || operation.error || 'Validation error';

  if (!Array.isArray(field['error messages'])) {
    field['error messages'] = [];
  }

  field['error messages'].push(message);

  summaryLines.push(
    `add-error-condition -> field "${fieldName}": added error "${message}" (total: ${field['error messages'].length})`
  );
}

function applyRemoveErrorCondition(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  if (!fieldName) {
    throw new Error('remove-error-condition requires a field name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`remove-error-condition: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  if (!Array.isArray(field['error messages']) || field['error messages'].length === 0) {
    throw new Error(`remove-error-condition: field "${fieldName}" has no error messages`);
  }

  const index =
    operation.index !== undefined ? operation.index : field['error messages'].length - 1;
  if (index < 0 || index >= field['error messages'].length) {
    throw new Error(
      `remove-error-condition: index ${index} out of range (field has ${field['error messages'].length} errors)`
    );
  }

  const removed = field['error messages'][index];
  field['error messages'].splice(index, 1);

  summaryLines.push(
    `remove-error-condition -> field "${fieldName}": removed error at index ${index}: "${removed}" (remaining: ${field['error messages'].length})`
  );
}

function applyClearErrorConditions(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  if (!fieldName) {
    throw new Error('clear-error-conditions requires a field name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`clear-error-conditions: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const count = Array.isArray(field['error messages']) ? field['error messages'].length : 0;

  if (count === 0) {
    summaryLines.push(`clear-error-conditions -> field "${fieldName}": no errors to clear`);
    return;
  }

  field['error messages'] = [];

  summaryLines.push(`clear-error-conditions -> field "${fieldName}": cleared ${count} error(s)`);
}

// ===== CSS/THEME MANAGEMENT =====

function applyAddCssClass(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const className = operation.class || operation.className;
  if (!fieldName || !className) {
    throw new Error('add-css-class requires field name and class name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`add-css-class: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const classes = field['css class'] ? String(field['css class']).split(/\s+/) : [];

  if (!classes.includes(className)) {
    classes.push(className);
    field['css class'] = classes.join(' ');
    summaryLines.push(
      `add-css-class -> field "${fieldName}": added class "${className}" (total: ${classes.length})`
    );
  } else {
    summaryLines.push(
      `add-css-class -> field "${fieldName}": class "${className}" already present`
    );
  }
}

function applyRemoveCssClass(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const className = operation.class || operation.className;
  if (!fieldName || !className) {
    throw new Error('remove-css-class requires field name and class name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`remove-css-class: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const classes = field['css class'] ? String(field['css class']).split(/\s+/) : [];
  const index = classes.indexOf(className);

  if (index >= 0) {
    classes.splice(index, 1);
    field['css class'] = classes.length > 0 ? classes.join(' ') : undefined;
    summaryLines.push(
      `remove-css-class -> field "${fieldName}": removed class "${className}" (remaining: ${classes.length})`
    );
  } else {
    summaryLines.push(`remove-css-class -> field "${fieldName}": class "${className}" not found`);
  }
}

function applyUpdateTheme(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const themeName = operation.theme || operation.value;
  if (!fieldName || !themeName) {
    throw new Error('update-theme requires field name and theme name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`update-theme: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const oldTheme = field.theme || 'default';
  field.theme = themeName;

  summaryLines.push(`update-theme -> field "${fieldName}": ${oldTheme} -> ${themeName}`);
}

function applyUpdateBorderRadius(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const radius = operation.radius || operation.value;
  if (!fieldName || !radius) {
    throw new Error('update-border-radius requires field name and radius value');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`update-border-radius: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  const oldRadius = field['border radius'];
  field['border radius'] = String(radius);

  summaryLines.push(
    `update-border-radius -> field "${fieldName}": ${oldRadius || 'none'} -> ${radius}`
  );
}

// ===== DEFAULT VALUE MANAGEMENT =====

function applySetDesignValue(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const value = operation.value || operation.designValue;
  if (!fieldName || value === undefined) {
    throw new Error('set-design-value requires field name and value');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`set-design-value: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  if (!field.value || typeof field.value !== 'object') {
    field.value = {};
  }

  const oldDesignValue = field.value.designValue;
  field.value.designValue = value;

  summaryLines.push(
    `set-design-value -> field "${fieldName}": ${formatValue(oldDesignValue)} -> ${formatValue(value)}`
  );
}

function applySetDefaultValue(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const value = operation.value || operation.defaultValue;
  if (!fieldName || value === undefined) {
    throw new Error('set-default-value requires field name and value');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`set-default-value: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  if (!field.value || typeof field.value !== 'object') {
    field.value = {};
  }

  const oldDefaultValue = field.value.defaultValue;
  field.value.defaultValue = value;

  summaryLines.push(
    `set-default-value -> field "${fieldName}": ${formatValue(oldDefaultValue)} -> ${formatValue(value)}`
  );
}

function applyClearDefaultValue(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  if (!fieldName) {
    throw new Error('clear-default-value requires a field name');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`clear-default-value: field "${fieldName}" not found`);
  }

  const field = fieldMatches[0].item;
  if (field.value && typeof field.value === 'object' && field.value.defaultValue !== undefined) {
    const removed = field.value.defaultValue;
    delete field.value.defaultValue;
    summaryLines.push(
      `clear-default-value -> field "${fieldName}": removed ${formatValue(removed)}`
    );
  } else {
    summaryLines.push(`clear-default-value -> field "${fieldName}": no default value to clear`);
  }
}

// ===== LAYOUT & CONTAINER OPERATIONS =====

function applyMoveToLayoutParent(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const parentId = operation.parent || operation.parentId;
  if (!fieldName || !parentId) {
    throw new Error('move-to-layout-parent requires field name and parent id');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`move-to-layout-parent: field "${fieldName}" not found`);
  }

  const parentMatches = selectItems(items, { id: parentId });
  if (parentMatches.length === 0) {
    throw new Error(`move-to-layout-parent: parent layout "${parentId}" not found`);
  }

  const field = fieldMatches[0].item;
  const oldParent = field.layout || 'none';
  field.layout = parentId;

  summaryLines.push(
    `move-to-layout-parent -> field "${fieldName}": parent ${oldParent} -> ${parentId}`
  );
}

function applyChangeLayoutParent(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const fieldName = operation.field;
  const newParentId = operation.newParent || operation.newParentId;
  if (!fieldName || !newParentId) {
    throw new Error('change-layout-parent requires field name and new parent id');
  }

  const fieldMatches = selectItems(items, { id: fieldName }).concat(
    selectItems(items, { name: fieldName })
  );

  if (fieldMatches.length === 0) {
    throw new Error(`change-layout-parent: field "${fieldName}" not found`);
  }

  const parentMatches = selectItems(items, { id: newParentId });
  if (parentMatches.length === 0) {
    throw new Error(`change-layout-parent: new parent layout "${newParentId}" not found`);
  }

  const field = fieldMatches[0].item;
  const oldParent = field.layout || 'none';
  field.layout = newParentId;

  summaryLines.push(
    `change-layout-parent -> field "${fieldName}": reparented from ${oldParent} to ${newParentId}`
  );
}

function applyCreateLayoutContainer(json, operation, summaryLines) {
  const items = ensureItemsArray(json);
  const containerName = operation.name || operation.id;
  if (!containerName) {
    throw new Error('create-layout-container requires a container name');
  }

  // Check if container already exists
  const existingMatches = selectItems(items, { id: containerName });
  if (existingMatches.length > 0) {
    throw new Error(`create-layout-container: container "${containerName}" already exists`);
  }

  const position = operation.position || 'end';
  const containerItem = {
    id: containerName,
    name: operation.displayName || containerName,
    'field type': 'layout',
    'record format name': containerName,
    ...operation.properties,
  };

  if (position === 'end' || position === 'append') {
    items.push(containerItem);
    summaryLines.push(
      `create-layout-container -> created layout container "${containerName}" at end`
    );
  } else if (position === 'start' || position === 'prepend') {
    items.unshift(containerItem);
    summaryLines.push(
      `create-layout-container -> created layout container "${containerName}" at start`
    );
  } else {
    throw new Error(
      `create-layout-container: invalid position "${position}" (use "start" or "end")`
    );
  }
}

function applyChangeSetToJson(json, changeSet) {
  const normalized = normalizeChangeSet(changeSet);
  const summaryLines = [];
  ensureItemsArray(json);

  for (const operation of normalized.operations) {
    if (!operation || typeof operation !== 'object') {
      throw new Error('Each change operation must be an object');
    }

    switch (operation.type) {
      case 'update-item':
        applyUpdateItem(json, operation, summaryLines);
        break;
      case 'remove-item':
        applyRemoveItem(json, operation, summaryLines);
        break;
      case 'insert-item-after':
        applyInsertItemAfter(json, operation, summaryLines);
        break;
      case 'add-column':
        applyAddColumn(json, operation, summaryLines);
        break;
      case 'delete-column':
        applyDeleteColumn(json, operation, summaryLines);
        break;
      case 'update-column-width':
        applyUpdateColumnWidth(json, operation, summaryLines);
        break;
      case 'toggle-item-visibility':
      case 'hide-item':
      case 'show-item': {
        // Normalize hide/show to toggle-item-visibility with mode parameter
        const normalizedOp = {
          ...operation,
          type: 'toggle-item-visibility',
          mode:
            operation.type === 'hide-item'
              ? 'hide'
              : operation.type === 'show-item'
                ? 'show'
                : operation.mode,
        };
        applyToggleItemVisibility(json, normalizedOp, summaryLines);
        break;
      }
      case 'show-fieldset':
        applyShowFieldSet(json, operation, summaryLines);
        break;
      case 'hide-fieldset':
        applyHideFieldSet(json, operation, summaryLines);
        break;
      case 'add-error-condition':
        applyAddErrorCondition(json, operation, summaryLines);
        break;
      case 'remove-error-condition':
        applyRemoveErrorCondition(json, operation, summaryLines);
        break;
      case 'clear-error-conditions':
        applyClearErrorConditions(json, operation, summaryLines);
        break;
      case 'add-css-class':
        applyAddCssClass(json, operation, summaryLines);
        break;
      case 'remove-css-class':
        applyRemoveCssClass(json, operation, summaryLines);
        break;
      case 'update-theme':
        applyUpdateTheme(json, operation, summaryLines);
        break;
      case 'update-border-radius':
        applyUpdateBorderRadius(json, operation, summaryLines);
        break;
      case 'set-design-value':
        applySetDesignValue(json, operation, summaryLines);
        break;
      case 'set-default-value':
        applySetDefaultValue(json, operation, summaryLines);
        break;
      case 'clear-default-value':
        applyClearDefaultValue(json, operation, summaryLines);
        break;
      case 'move-to-layout-parent':
        applyMoveToLayoutParent(json, operation, summaryLines);
        break;
      case 'change-layout-parent':
        applyChangeLayoutParent(json, operation, summaryLines);
        break;
      case 'create-layout-container':
        applyCreateLayoutContainer(json, operation, summaryLines);
        break;
      default:
        throw new Error(`Unsupported PUI change operation: ${operation.type}`);
    }
  }

  return {
    summaryLines,
    operationCount: normalized.operations.length,
  };
}

module.exports = {
  applyChangeSetToJson,
  cloneJson,
  deleteValueAtPath,
  getValueAtPath,
  matchesWhere,
  normalizeChangeSet,
  selectItems,
  setValueAtPath,
};
