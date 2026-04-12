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
import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;

public class Db2DiagnosticQueryRunner {
    private static String escape(String value) {
        if (value == null) return "";
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private static int parseMaxRows(String value) {
        try {
            int parsed = Integer.parseInt(String.valueOf(value).trim());
            return parsed > 0 ? parsed : 50;
        } catch (NumberFormatException e) {
            return 50;
        }
    }

    private static String encodeValue(Object value) {
        if (value == null) {
            return "null";
        }
        if (value instanceof Number) {
            if (value instanceof BigDecimal) {
                return ((BigDecimal) value).toPlainString();
            }
            return String.valueOf(value);
        }
        if (value instanceof Boolean) {
            return String.valueOf(value);
        }
        if (value instanceof byte[]) {
            return "\"<binary>\"";
        }
        return "\"" + escape(String.valueOf(value)) + "\"";
    }

    private static Object readValue(ResultSet rs, int columnIndex, int sqlType) throws SQLException {
        switch (sqlType) {
            case Types.DATE:
            case Types.TIME:
            case Types.TIMESTAMP:
            case Types.TIMESTAMP_WITH_TIMEZONE:
                return rs.getString(columnIndex);
            case Types.BINARY:
            case Types.VARBINARY:
            case Types.LONGVARBINARY:
            case Types.BLOB:
                return rs.getBytes(columnIndex);
            default:
                return rs.getObject(columnIndex);
        }
    }

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java Db2DiagnosticQueryRunner <jdbcUrl> <user> <password> <query> [maxRows]");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        String query = args[3];
        int maxRows = parseMaxRows(args.length >= 5 ? args[4] : "50");

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);

            try (Statement statement = connection.createStatement()) {
                statement.setMaxRows(maxRows);
                try (ResultSet rs = statement.executeQuery(query)) {
                    ResultSetMetaData metaData = rs.getMetaData();
                    int columnCount = metaData.getColumnCount();
                    List<String> columns = new ArrayList<>();

                    for (int i = 1; i <= columnCount; i += 1) {
                        columns.add(metaData.getColumnLabel(i));
                    }

                    StringBuilder json = new StringBuilder();
                    json.append("{\"columns\":[");
                    for (int i = 0; i < columns.size(); i += 1) {
                        if (i > 0) {
                            json.append(",");
                        }
                        json.append("\"").append(escape(columns.get(i))).append("\"");
                    }

                    json.append("],\"rows\":[");
                    int rowCount = 0;
                    while (rs.next()) {
                        if (rowCount > 0) {
                            json.append(",");
                        }
                        json.append("{");
                        for (int i = 1; i <= columnCount; i += 1) {
                            if (i > 1) {
                                json.append(",");
                            }
                            Object value = readValue(rs, i, metaData.getColumnType(i));
                            json.append("\"").append(escape(columns.get(i - 1))).append("\":")
                                .append(encodeValue(value));
                        }
                        json.append("}");
                        rowCount += 1;
                    }
                    json.append("],\"rowCount\":").append(rowCount).append("}");
                    System.out.println(json.toString());
                }
            }
        } catch (SQLException e) {
            System.err.println("DB2 diagnostic query failed: " + e.getMessage());
            System.exit(2);
        }
    }
}
