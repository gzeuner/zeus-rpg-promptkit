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
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class Db2MetadataExporter {
    private static class ColumnInfo {
        String name;
        String type;
        int length;
        Integer precision;
        Integer scale;
        boolean nullable;
        boolean primaryKey;
        int ordinalPosition;
    }

    private static class ForeignKeyInfo {
        String column;
        String referencesSchema;
        String referencesTable;
        String referencesColumn;
        String constraintName;
        String updateRule;
        String deleteRule;
    }

    private static class TriggerInfo {
        String schema;
        String name;
        String systemSchema;
        String systemName;
        String eventManipulation;
        String actionTiming;
        String actionOrientation;
        String programName;
        String programLibrary;
    }

    private static class DerivedObjectInfo {
        String schema;
        String name;
        String systemSchema;
        String systemName;
        String objectType;
        String textDescription;
    }

    private static class TableInfo {
        String schema;
        String table;
        String systemSchema;
        String systemName;
        String objectType;
        String textDescription;
        Long estimatedRowCount;
        String lookupStrategy;
        List<ColumnInfo> columns = new ArrayList<>();
        List<ForeignKeyInfo> foreignKeys = new ArrayList<>();
        List<TriggerInfo> triggers = new ArrayList<>();
        List<DerivedObjectInfo> derivedObjects = new ArrayList<>();
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private static String normalizeIdentifier(String value) {
        return value == null ? "" : value.trim().toUpperCase();
    }

    private static String normalizeSchemaArg(String value) {
        String normalized = normalizeIdentifier(value);
        return normalized.isEmpty() ? null : normalized;
    }

    private static List<String> parseTables(String csv) {
        List<String> tables = new ArrayList<>();
        if (csv == null || csv.trim().isEmpty()) {
            return tables;
        }
        String[] parts = csv.split(",");
        for (String p : parts) {
            String trimmed = p.trim();
            if (!trimmed.isEmpty()) {
                tables.add(trimmed);
            }
        }
        return tables;
    }

    private static String encodeValue(String value) {
        return value == null ? "null" : "\"" + escape(value) + "\"";
    }

    private static String encodeNumber(Integer value) {
        return value == null ? "null" : String.valueOf(value);
    }

    private static String encodeLong(Long value) {
        return value == null ? "null" : String.valueOf(value);
    }

    private static boolean hasColumn(ResultSetMetaData metaData, String columnName) throws SQLException {
        int columnCount = metaData.getColumnCount();
        String normalized = normalizeIdentifier(columnName);
        for (int index = 1; index <= columnCount; index += 1) {
            if (normalizeIdentifier(metaData.getColumnLabel(index)).equals(normalized)
                || normalizeIdentifier(metaData.getColumnName(index)).equals(normalized)) {
                return true;
            }
        }
        return false;
    }

    private static String getString(ResultSet rs, String columnName) throws SQLException {
        ResultSetMetaData metaData = rs.getMetaData();
        if (!hasColumn(metaData, columnName)) {
            return null;
        }
        return rs.getString(columnName);
    }

    private static Long getLong(ResultSet rs, String columnName) throws SQLException {
        ResultSetMetaData metaData = rs.getMetaData();
        if (!hasColumn(metaData, columnName)) {
            return null;
        }
        long value = rs.getLong(columnName);
        return rs.wasNull() ? null : Long.valueOf(value);
    }

    private static String mapImportedRule(short value) {
        switch (value) {
            case DatabaseMetaData.importedKeyCascade:
                return "CASCADE";
            case DatabaseMetaData.importedKeyRestrict:
                return "RESTRICT";
            case DatabaseMetaData.importedKeySetNull:
                return "SET NULL";
            case DatabaseMetaData.importedKeySetDefault:
                return "SET DEFAULT";
            case DatabaseMetaData.importedKeyNoAction:
                return "NO ACTION";
            default:
                return null;
        }
    }

    private static String inferObjectType(String sqlObjectType, String attribute, String jdbcType) {
        String normalizedSqlType = normalizeIdentifier(sqlObjectType);
        String normalizedAttribute = normalizeIdentifier(attribute);
        String normalizedJdbcType = normalizeIdentifier(jdbcType);

        if ("LF".equals(normalizedAttribute)) {
            return "LOGICAL_FILE";
        }
        if ("PF".equals(normalizedAttribute) && normalizedSqlType.isEmpty()) {
            return "TABLE";
        }
        if (!normalizedSqlType.isEmpty()) {
            return normalizedSqlType;
        }
        if (!normalizedJdbcType.isEmpty()) {
            return normalizedJdbcType;
        }
        return "TABLE";
    }

    private static Set<String> loadPrimaryKeys(DatabaseMetaData metaData, String schema, String table) throws SQLException {
        Set<String> primaryKeys = new HashSet<>();
        try (ResultSet rs = metaData.getPrimaryKeys(null, schema, table)) {
            while (rs.next()) {
                String column = normalizeIdentifier(rs.getString("COLUMN_NAME"));
                if (!column.isEmpty()) {
                    primaryKeys.add(column);
                }
            }
        }
        return primaryKeys;
    }

    private static List<ColumnInfo> loadColumns(DatabaseMetaData metaData, String schema, String table, Set<String> primaryKeys) throws SQLException {
        List<ColumnInfo> columns = new ArrayList<>();
        try (ResultSet cols = metaData.getColumns(null, schema, table, "%")) {
            while (cols.next()) {
                ColumnInfo column = new ColumnInfo();
                column.name = normalizeIdentifier(cols.getString("COLUMN_NAME"));
                column.type = normalizeIdentifier(cols.getString("TYPE_NAME"));
                column.length = cols.getInt("COLUMN_SIZE");

                int decimalDigits = cols.getInt("DECIMAL_DIGITS");
                column.scale = cols.wasNull() ? null : Integer.valueOf(decimalDigits);
                column.precision = column.length > 0 ? Integer.valueOf(column.length) : null;
                column.nullable = cols.getInt("NULLABLE") == DatabaseMetaData.columnNullable;
                column.primaryKey = primaryKeys.contains(column.name);
                column.ordinalPosition = cols.getInt("ORDINAL_POSITION");
                columns.add(column);
            }
        }

        Collections.sort(columns, Comparator.comparingInt(column -> column.ordinalPosition));
        return columns;
    }

    private static List<ForeignKeyInfo> loadForeignKeys(DatabaseMetaData metaData, String schema, String table) throws SQLException {
        Map<String, ForeignKeyInfo> byKey = new LinkedHashMap<>();
        try (ResultSet rs = metaData.getImportedKeys(null, schema, table)) {
            while (rs.next()) {
                ForeignKeyInfo foreignKey = new ForeignKeyInfo();
                foreignKey.column = normalizeIdentifier(rs.getString("FKCOLUMN_NAME"));
                foreignKey.referencesSchema = normalizeIdentifier(rs.getString("PKTABLE_SCHEM"));
                foreignKey.referencesTable = normalizeIdentifier(rs.getString("PKTABLE_NAME"));
                foreignKey.referencesColumn = normalizeIdentifier(rs.getString("PKCOLUMN_NAME"));
                foreignKey.constraintName = normalizeIdentifier(rs.getString("FK_NAME"));
                foreignKey.updateRule = mapImportedRule(rs.getShort("UPDATE_RULE"));
                foreignKey.deleteRule = mapImportedRule(rs.getShort("DELETE_RULE"));

                String key = foreignKey.column + "|" + foreignKey.referencesSchema + "|" + foreignKey.referencesTable + "|" + foreignKey.referencesColumn;
                if (!byKey.containsKey(key)) {
                    byKey.put(key, foreignKey);
                }
            }
        }

        List<ForeignKeyInfo> foreignKeys = new ArrayList<>(byKey.values());
        Collections.sort(foreignKeys, Comparator
            .comparing((ForeignKeyInfo fk) -> fk.column)
            .thenComparing(fk -> fk.referencesSchema)
            .thenComparing(fk -> fk.referencesTable)
            .thenComparing(fk -> fk.referencesColumn));
        return foreignKeys;
    }

    private static Long loadEstimatedRowCount(Connection connection, TableInfo tableInfo) {
        String sql = "SELECT SUM(NUMBER_ROWS) AS ESTIMATED_ROW_COUNT FROM QSYS2.SYSPARTITIONSTAT WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, tableInfo.schema);
            statement.setString(2, tableInfo.table);
            try (ResultSet rs = statement.executeQuery()) {
                if (rs.next()) {
                    return getLong(rs, "ESTIMATED_ROW_COUNT");
                }
            }
        } catch (SQLException ignored) {
            return null;
        }
        return null;
    }

    private static List<TriggerInfo> loadTriggers(Connection connection, TableInfo tableInfo) {
        List<TriggerInfo> triggers = new ArrayList<>();
        String sql = ""
            + "SELECT TRIGGER_SCHEMA, TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, ACTION_ORIENTATION "
            + "FROM QSYS2.SYSTRIGGERS "
            + "WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?";

        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, tableInfo.schema);
            statement.setString(2, tableInfo.table);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    TriggerInfo trigger = new TriggerInfo();
                    trigger.schema = normalizeIdentifier(getString(rs, "TRIGGER_SCHEMA"));
                    trigger.name = normalizeIdentifier(getString(rs, "TRIGGER_NAME"));
                    trigger.eventManipulation = normalizeIdentifier(getString(rs, "EVENT_MANIPULATION"));
                    trigger.actionTiming = normalizeIdentifier(getString(rs, "ACTION_TIMING"));
                    trigger.actionOrientation = normalizeIdentifier(getString(rs, "ACTION_ORIENTATION"));
                    triggers.add(trigger);
                }
            }
        } catch (SQLException ignored) {
            return triggers;
        }

        Collections.sort(triggers, Comparator
            .comparing((TriggerInfo trigger) -> trigger.schema)
            .thenComparing(trigger -> trigger.name));
        return triggers;
    }

    private static List<DerivedObjectInfo> loadDerivedObjects(Connection connection, TableInfo tableInfo) {
        List<DerivedObjectInfo> derivedObjects = new ArrayList<>();
        String sql = ""
            + "SELECT VIEW_SCHEMA, VIEW_NAME, SYSTEM_VIEW_SCHEMA, SYSTEM_VIEW_NAME, TABLE_TYPE "
            + "FROM QSYS2.SYSVIEWDEP "
            + "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";

        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, tableInfo.schema);
            statement.setString(2, tableInfo.table);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    DerivedObjectInfo derivedObject = new DerivedObjectInfo();
                    derivedObject.schema = normalizeIdentifier(getString(rs, "VIEW_SCHEMA"));
                    derivedObject.name = normalizeIdentifier(getString(rs, "VIEW_NAME"));
                    derivedObject.systemSchema = normalizeIdentifier(getString(rs, "SYSTEM_VIEW_SCHEMA"));
                    derivedObject.systemName = normalizeIdentifier(getString(rs, "SYSTEM_VIEW_NAME"));
                    derivedObject.objectType = inferObjectType(getString(rs, "OBJECT_TYPE"), getString(rs, "TABLE_TYPE"), "VIEW");
                    derivedObjects.add(derivedObject);
                }
            }
        } catch (SQLException ignored) {
            return derivedObjects;
        }

        Collections.sort(derivedObjects, Comparator
            .comparing((DerivedObjectInfo derivedObject) -> derivedObject.schema)
            .thenComparing(derivedObject -> derivedObject.name));
        return derivedObjects;
    }

    private static TableInfo copyTableInfo(TableInfo source) {
        TableInfo target = new TableInfo();
        target.schema = source.schema;
        target.table = source.table;
        target.systemSchema = source.systemSchema;
        target.systemName = source.systemName;
        target.objectType = source.objectType;
        target.textDescription = source.textDescription;
        target.lookupStrategy = source.lookupStrategy;
        return target;
    }

    private static List<TableInfo> findTablesViaCatalog(Connection connection, String requestedTable, String defaultSchema) {
        List<TableInfo> matches = new ArrayList<>();
        String normalizedRequested = normalizeIdentifier(requestedTable);
        String[] schemaCandidates = defaultSchema == null || defaultSchema.isEmpty()
            ? new String[]{"*ALLUSR"}
            : new String[]{defaultSchema, "*ALLUSR"};

        String sql = ""
            + "SELECT OBJLONGSCHEMA, OBJLONGNAME, OBJLIB, OBJNAME, SQL_OBJECT_TYPE, OBJATTRIBUTE, OBJTEXT "
            + "FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => ?, OBJTYPELIST => '*FILE', OBJECT_NAME => ?)) "
            + "WHERE UPPER(COALESCE(OBJLONGNAME, OBJNAME)) = ? OR UPPER(OBJNAME) = ?";

        for (String schemaCandidate : schemaCandidates) {
            try (PreparedStatement statement = connection.prepareStatement(sql)) {
                statement.setString(1, schemaCandidate);
                statement.setString(2, requestedTable);
                statement.setString(3, normalizedRequested);
                statement.setString(4, normalizedRequested);
                try (ResultSet rs = statement.executeQuery()) {
                    while (rs.next()) {
                        TableInfo tableInfo = new TableInfo();
                        tableInfo.schema = normalizeIdentifier(getString(rs, "OBJLONGSCHEMA"));
                        tableInfo.table = normalizeIdentifier(getString(rs, "OBJLONGNAME"));
                        tableInfo.systemSchema = normalizeIdentifier(getString(rs, "OBJLIB"));
                        tableInfo.systemName = normalizeIdentifier(getString(rs, "OBJNAME"));
                        tableInfo.objectType = inferObjectType(getString(rs, "SQL_OBJECT_TYPE"), getString(rs, "OBJATTRIBUTE"), "");
                        tableInfo.textDescription = getString(rs, "OBJTEXT");
                        tableInfo.lookupStrategy = "IBM_I_CATALOG";
                        if (tableInfo.table.isEmpty()) {
                            tableInfo.table = tableInfo.systemName;
                        }
                        if (tableInfo.schema.isEmpty()) {
                            tableInfo.schema = tableInfo.systemSchema;
                        }
                        matches.add(tableInfo);
                    }
                }
            } catch (SQLException ignored) {
                return new ArrayList<>();
            }

            if (!matches.isEmpty()) {
                return matches;
            }
        }

        return matches;
    }

    private static List<TableInfo> findTablesViaJdbc(DatabaseMetaData metaData, String requestedTable, String defaultSchema) throws SQLException {
        List<TableInfo> matches = new ArrayList<>();
        String schemaPattern = defaultSchema;
        String normalizedTable = normalizeIdentifier(requestedTable);

        if (requestedTable.contains(".")) {
            String[] parts = requestedTable.split("\\.", 2);
            schemaPattern = normalizeSchemaArg(parts[0]);
            normalizedTable = normalizeIdentifier(parts[1]);
        } else if (requestedTable.contains("/")) {
            String[] parts = requestedTable.split("/", 2);
            schemaPattern = normalizeSchemaArg(parts[0]);
            normalizedTable = normalizeIdentifier(parts[1]);
        }

        try (ResultSet rs = metaData.getTables(null, schemaPattern, normalizedTable, new String[]{"TABLE", "VIEW", "ALIAS"})) {
            while (rs.next()) {
                TableInfo tableInfo = new TableInfo();
                tableInfo.schema = normalizeIdentifier(rs.getString("TABLE_SCHEM"));
                tableInfo.table = normalizeIdentifier(rs.getString("TABLE_NAME"));
                tableInfo.systemSchema = tableInfo.schema;
                tableInfo.systemName = tableInfo.table;
                tableInfo.objectType = inferObjectType(null, null, rs.getString("TABLE_TYPE"));
                tableInfo.lookupStrategy = "JDBC_METADATA";
                matches.add(tableInfo);
            }
        }

        return matches;
    }

    private static TableInfo enrichTableInfo(Connection connection, DatabaseMetaData metaData, TableInfo seed) throws SQLException {
        TableInfo tableInfo = copyTableInfo(seed);
        Set<String> primaryKeys = loadPrimaryKeys(metaData, tableInfo.schema, tableInfo.table);
        tableInfo.columns = loadColumns(metaData, tableInfo.schema, tableInfo.table, primaryKeys);
        tableInfo.foreignKeys = loadForeignKeys(metaData, tableInfo.schema, tableInfo.table);
        tableInfo.estimatedRowCount = loadEstimatedRowCount(connection, tableInfo);
        tableInfo.triggers = loadTriggers(connection, tableInfo);
        tableInfo.derivedObjects = loadDerivedObjects(connection, tableInfo);
        return tableInfo;
    }

    private static void appendColumnJson(StringBuilder json, ColumnInfo column) {
        json.append("{")
            .append("\"name\":").append(encodeValue(column.name)).append(",")
            .append("\"type\":").append(encodeValue(column.type)).append(",")
            .append("\"length\":").append(column.length).append(",")
            .append("\"precision\":").append(encodeNumber(column.precision)).append(",")
            .append("\"scale\":").append(encodeNumber(column.scale)).append(",")
            .append("\"nullable\":").append(column.nullable).append(",")
            .append("\"primaryKey\":").append(column.primaryKey)
            .append("}");
    }

    private static void appendForeignKeyJson(StringBuilder json, ForeignKeyInfo foreignKey) {
        json.append("{")
            .append("\"column\":").append(encodeValue(foreignKey.column)).append(",")
            .append("\"referencesSchema\":").append(encodeValue(foreignKey.referencesSchema)).append(",")
            .append("\"referencesTable\":").append(encodeValue(foreignKey.referencesTable)).append(",")
            .append("\"referencesColumn\":").append(encodeValue(foreignKey.referencesColumn)).append(",")
            .append("\"constraintName\":").append(encodeValue(foreignKey.constraintName)).append(",")
            .append("\"updateRule\":").append(encodeValue(foreignKey.updateRule)).append(",")
            .append("\"deleteRule\":").append(encodeValue(foreignKey.deleteRule))
            .append("}");
    }

    private static void appendTriggerJson(StringBuilder json, TriggerInfo trigger) {
        json.append("{")
            .append("\"schema\":").append(encodeValue(trigger.schema)).append(",")
            .append("\"name\":").append(encodeValue(trigger.name)).append(",")
            .append("\"systemSchema\":").append(encodeValue(trigger.systemSchema)).append(",")
            .append("\"systemName\":").append(encodeValue(trigger.systemName)).append(",")
            .append("\"eventManipulation\":").append(encodeValue(trigger.eventManipulation)).append(",")
            .append("\"actionTiming\":").append(encodeValue(trigger.actionTiming)).append(",")
            .append("\"actionOrientation\":").append(encodeValue(trigger.actionOrientation)).append(",")
            .append("\"programName\":").append(encodeValue(trigger.programName)).append(",")
            .append("\"programLibrary\":").append(encodeValue(trigger.programLibrary))
            .append("}");
    }

    private static void appendDerivedObjectJson(StringBuilder json, DerivedObjectInfo derivedObject) {
        json.append("{")
            .append("\"schema\":").append(encodeValue(derivedObject.schema)).append(",")
            .append("\"name\":").append(encodeValue(derivedObject.name)).append(",")
            .append("\"systemSchema\":").append(encodeValue(derivedObject.systemSchema)).append(",")
            .append("\"systemName\":").append(encodeValue(derivedObject.systemName)).append(",")
            .append("\"objectType\":").append(encodeValue(derivedObject.objectType)).append(",")
            .append("\"textDescription\":").append(encodeValue(derivedObject.textDescription))
            .append("}");
    }

    private static void appendTableJson(StringBuilder json, TableInfo table) {
        json.append("{")
            .append("\"schema\":").append(encodeValue(table.schema)).append(",")
            .append("\"table\":").append(encodeValue(table.table)).append(",")
            .append("\"systemSchema\":").append(encodeValue(table.systemSchema)).append(",")
            .append("\"systemName\":").append(encodeValue(table.systemName)).append(",")
            .append("\"objectType\":").append(encodeValue(table.objectType)).append(",")
            .append("\"textDescription\":").append(encodeValue(table.textDescription)).append(",")
            .append("\"estimatedRowCount\":").append(encodeLong(table.estimatedRowCount)).append(",")
            .append("\"lookupStrategy\":").append(encodeValue(table.lookupStrategy)).append(",")
            .append("\"columns\":[");

        for (int i = 0; i < table.columns.size(); i += 1) {
            if (i > 0) {
                json.append(",");
            }
            appendColumnJson(json, table.columns.get(i));
        }

        json.append("],\"foreignKeys\":[");
        for (int i = 0; i < table.foreignKeys.size(); i += 1) {
            if (i > 0) {
                json.append(",");
            }
            appendForeignKeyJson(json, table.foreignKeys.get(i));
        }

        json.append("],\"triggers\":[");
        for (int i = 0; i < table.triggers.size(); i += 1) {
            if (i > 0) {
                json.append(",");
            }
            appendTriggerJson(json, table.triggers.get(i));
        }

        json.append("],\"derivedObjects\":[");
        for (int i = 0; i < table.derivedObjects.size(); i += 1) {
            if (i > 0) {
                json.append(",");
            }
            appendDerivedObjectJson(json, table.derivedObjects.get(i));
        }
        json.append("]}");
    }

    public static void main(String[] args) {
        if (args.length < 3) {
            System.err.println("Usage: java Db2MetadataExporter <jdbcUrl> <user> <password> [defaultSchema] [table1,table2,...]");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        String defaultSchema = normalizeSchemaArg(args.length >= 4 ? args[3] : null);
        List<String> requestedTables = parseTables(args.length >= 5 ? args[4] : "");

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            DatabaseMetaData metaData = connection.getMetaData();
            List<TableInfo> tableInfos = new ArrayList<>();

            if (requestedTables.isEmpty()) {
                List<TableInfo> jdbcTables = findTablesViaJdbc(metaData, "%", defaultSchema);
                for (TableInfo seed : jdbcTables) {
                    tableInfos.add(enrichTableInfo(connection, metaData, seed));
                }
            } else {
                for (String requestedTable : requestedTables) {
                    List<TableInfo> seeds = findTablesViaCatalog(connection, requestedTable, defaultSchema);
                    if (seeds.isEmpty()) {
                        seeds = findTablesViaJdbc(metaData, requestedTable, defaultSchema);
                    }

                    for (TableInfo seed : seeds) {
                        tableInfos.add(enrichTableInfo(connection, metaData, seed));
                    }
                }
            }

            Collections.sort(tableInfos, Comparator
                .comparing((TableInfo table) -> table.table)
                .thenComparing(table -> table.schema)
                .thenComparing(table -> table.systemName));

            StringBuilder json = new StringBuilder();
            json.append("{\"tables\":[");
            for (int i = 0; i < tableInfos.size(); i += 1) {
                if (i > 0) {
                    json.append(",");
                }
                appendTableJson(json, tableInfos.get(i));
            }
            json.append("]}");
            System.out.println(json.toString());
        } catch (SQLException e) {
            System.err.println("DB2 metadata export failed: " + e.getMessage());
            System.exit(2);
        }
    }
}
