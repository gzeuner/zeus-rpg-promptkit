function aggregateUnique(scanResults, key) {
  const set = new Set();
  for (const result of scanResults) {
    for (const value of result[key] || []) {
      set.add(value);
    }
  }
  return Array.from(set).sort();
}

function aggregateDependencies(scanResults) {
  return {
    tables: aggregateUnique(scanResults, 'tables'),
    calls: aggregateUnique(scanResults, 'calls'),
    copyMembers: aggregateUnique(scanResults, 'copyMembers'),
    sqlStatements: aggregateUnique(scanResults, 'sqlStatements'),
  };
}

module.exports = {
  aggregateDependencies,
};