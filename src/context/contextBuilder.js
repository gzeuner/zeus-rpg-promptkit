function buildContext({ program, sourceFiles, dependencies, notes }) {
  return {
    program,
    scannedAt: new Date().toISOString(),
    sourceFiles,
    tables: dependencies.tables || [],
    calls: dependencies.calls || [],
    copyMembers: dependencies.copyMembers || [],
    sqlStatements: dependencies.sqlStatements || [],
    notes: notes || [],
  };
}

module.exports = {
  buildContext,
};