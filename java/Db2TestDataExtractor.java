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

public class Db2TestDataExtractor {
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

    private static int parseLimit(String value) {
        try {
            int parsed = Integer.parseInt(String.valueOf(value).trim());
            return parsed > 0 ? parsed : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static List<String> parseCsv(String csv) {
        List<String> values = new ArrayList<>();
        if (csv == null || csv.trim().isEmpty()) {
            return values;
        }
        String[] parts = csv.split(",");
        for (String part : parts) {
            String normalized = normalizeIdentifier(part);
            if (!normalized.isEmpty()) {
                values.add(normalized);
            }
        }
        return values;
    }

    private static String quoteIdentifier(String value) {
        return "\"" + String.valueOf(value).replace("\"", "\"\"") + "\"";
    }

    private static String resolveQualifiedTableName(String jdbcUrl, String schema, String table) {
        boolean systemNaming = String.valueOf(jdbcUrl).toLowerCase().contains("naming=system");
        String delimiter = systemNaming ? "/" : ".";
        return quoteIdentifier(schema) + delimiter + quoteIdentifier(table);
    }

    private static String buildSql(String jdbcUrl, String schema, String table, int limit, List<String> orderByColumns) {
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT * FROM ").append(resolveQualifiedTableName(jdbcUrl, schema, table));
        if (!orderByColumns.isEmpty()) {
            sql.append(" ORDER BY ");
            for (int i = 0; i < orderByColumns.size(); i += 1) {
                if (i > 0) {
                    sql.append(", ");
                }
                sql.append(quoteIdentifier(orderByColumns.get(i)));
            }
        }
        sql.append(" FETCH FIRST ").append(limit).append(" ROWS ONLY");
        return sql.toString();
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
        if (args.length < 6) {
            System.err.println("Usage: java Db2TestDataExtractor <jdbcUrl> <user> <password> <schema> <table> <limit> [orderByColumn1,orderByColumn2,...]");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        String schema = normalizeIdentifier(args[3]);
        String table = normalizeIdentifier(args[4]);
        int limit = parseLimit(args[5]);
        List<String> orderByColumns = parseCsv(args.length >= 7 ? args[6] : "");

        if (schema.isEmpty() || table.isEmpty() || limit <= 0) {
            System.err.println("DB2 test data extraction failed: schema, table, and positive row limit are required.");
            System.exit(1);
        }

        String sql = buildSql(jdbcUrl, schema, table, limit, orderByColumns);

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);

            try (Statement statement = connection.createStatement();
                 ResultSet rs = statement.executeQuery(sql)) {
                ResultSetMetaData metaData = rs.getMetaData();
                int columnCount = metaData.getColumnCount();
                List<String> columns = new ArrayList<>();

                for (int i = 1; i <= columnCount; i += 1) {
                    columns.add(metaData.getColumnLabel(i));
                }

                StringBuilder json = new StringBuilder();
                json.append("{")
                    .append("\"schema\":\"").append(escape(schema)).append("\",")
                    .append("\"table\":\"").append(escape(table)).append("\",")
                    .append("\"columns\":[");

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
        } catch (SQLException e) {
            System.err.println("DB2 test data extraction failed: " + e.getMessage());
            System.exit(2);
        }
    }
}
