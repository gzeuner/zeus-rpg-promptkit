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
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.HashSet;
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
    }

    private static class TableInfo {
        String schema;
        String table;
        List<ColumnInfo> columns = new ArrayList<>();
        List<ForeignKeyInfo> foreignKeys = new ArrayList<>();
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

    private static TableInfo loadTableInfo(DatabaseMetaData metaData, String schema, String table) throws SQLException {
        TableInfo tableInfo = new TableInfo();
        tableInfo.schema = normalizeIdentifier(schema);
        tableInfo.table = normalizeIdentifier(table);
        Set<String> primaryKeys = loadPrimaryKeys(metaData, schema, table);
        tableInfo.columns = loadColumns(metaData, schema, table, primaryKeys);
        tableInfo.foreignKeys = loadForeignKeys(metaData, schema, table);
        return tableInfo;
    }

    private static String encodeValue(String value) {
        return value == null ? "null" : "\"" + escape(value) + "\"";
    }

    private static String encodeNumber(Integer value) {
        return value == null ? "null" : String.valueOf(value);
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
            .append("\"referencesColumn\":").append(encodeValue(foreignKey.referencesColumn))
            .append("}");
    }

    private static void appendTableJson(StringBuilder json, TableInfo table) {
        json.append("{")
            .append("\"schema\":").append(encodeValue(table.schema)).append(",")
            .append("\"table\":").append(encodeValue(table.table)).append(",")
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
                try (ResultSet rs = metaData.getTables(null, defaultSchema, "%", new String[]{"TABLE"})) {
                    while (rs.next()) {
                        tableInfos.add(loadTableInfo(
                            metaData,
                            normalizeSchemaArg(rs.getString("TABLE_SCHEM")),
                            normalizeIdentifier(rs.getString("TABLE_NAME"))
                        ));
                    }
                }
            } else {
                for (String requestedTable : requestedTables) {
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

                    try (ResultSet rs = metaData.getTables(null, schemaPattern, normalizedTable, new String[]{"TABLE"})) {
                        while (rs.next()) {
                            tableInfos.add(loadTableInfo(
                                metaData,
                                normalizeSchemaArg(rs.getString("TABLE_SCHEM")),
                                normalizeIdentifier(rs.getString("TABLE_NAME"))
                            ));
                        }
                    }
                }
            }

            Collections.sort(tableInfos, Comparator
                .comparing((TableInfo table) -> table.schema)
                .thenComparing(table -> table.table));

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
