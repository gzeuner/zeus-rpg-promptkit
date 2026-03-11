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
import java.util.List;

public class Db2MetadataExporter {
    private static class ColumnInfo {
        String name;
        String type;
        int size;
        int nullable;
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
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

    public static void main(String[] args) {
        if (args.length < 3) {
            System.err.println("Usage: java Db2MetadataExporter <jdbcUrl> <user> <password> [table1,table2,...]");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        List<String> requestedTables = parseTables(args.length >= 4 ? args[3] : "");

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            DatabaseMetaData metaData = connection.getMetaData();
            StringBuilder json = new StringBuilder();
            json.append("{\"tables\":[");

            List<String> tablesToRead = new ArrayList<>();
            if (requestedTables.isEmpty()) {
                try (ResultSet rs = metaData.getTables(null, null, "%", new String[]{"TABLE"})) {
                    while (rs.next()) {
                        String tableName = rs.getString("TABLE_NAME");
                        if (tableName != null) {
                            tablesToRead.add(tableName);
                        }
                    }
                }
            } else {
                tablesToRead.addAll(requestedTables);
            }

            boolean firstTable = true;
            for (String table : tablesToRead) {
                if (!firstTable) {
                    json.append(",");
                }
                firstTable = false;

                json.append("{\"table\":\"").append(escape(table)).append("\",\"columns\":[");

                boolean firstColumn = true;
                try (ResultSet cols = metaData.getColumns(null, null, table, "%")) {
                    while (cols.next()) {
                        if (!firstColumn) {
                            json.append(",");
                        }
                        firstColumn = false;

                        String colName = cols.getString("COLUMN_NAME");
                        String typeName = cols.getString("TYPE_NAME");
                        int size = cols.getInt("COLUMN_SIZE");
                        int nullable = cols.getInt("NULLABLE");

                        json.append("{\"name\":\"").append(escape(colName)).append("\",")
                            .append("\"type\":\"").append(escape(typeName)).append("\",")
                            .append("\"size\":").append(size).append(",")
                            .append("\"nullable\":").append(nullable)
                            .append("}");
                    }
                }

                json.append("]}");
            }

            json.append("]}");
            System.out.println(json.toString());
        } catch (SQLException e) {
            System.err.println("DB2 metadata export failed: " + e.getMessage());
            System.exit(2);
        }
    }
}