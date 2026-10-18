
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
import java.io.BufferedReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public class Db2TestDataExtractor {
    private static final int BATCH_TARGET_CHARACTERS = 16 * 1024 * 1024;
    private static final int MAX_TABLE_JSON_CHARACTERS = 64 * 1024 * 1024;

    private static class TableRequest {
        String schema;
        String table;
        List<String> orderByColumns = new ArrayList<>();
    }

    private static String escape(String value) {
        if (value == null)
            return "";
        StringBuilder escaped = new StringBuilder();
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\b':
                    escaped.append("\\b");
                    break;
                case '\f':
                    escaped.append("\\f");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    if (character < 0x20 || Character.isSurrogate(character)) {
                        String hex = Integer.toHexString(character);
                        escaped.append("\\u");
                        for (int padding = hex.length(); padding < 4; padding += 1) {
                            escaped.append('0');
                        }
                        escaped.append(hex);
                    } else {
                        escaped.append(character);
                    }
                    break;
            }
        }
        return escaped.toString();
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

    private static String decodeBatchField(String field) {
        byte[] decoded = Base64.getUrlDecoder().decode(field);
        return new String(decoded, StandardCharsets.UTF_8);
    }

    private static List<TableRequest> readBatchRequests(String filePath) throws Exception {
        List<TableRequest> requests = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(Paths.get(filePath), StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.trim().isEmpty()) {
                    continue;
                }
                String[] fields = line.split("\\t", -1);
                if (fields.length < 2) {
                    throw new IllegalArgumentException("Batch request must contain a schema and table.");
                }
                TableRequest request = new TableRequest();
                request.schema = normalizeIdentifier(decodeBatchField(fields[0]));
                request.table = normalizeIdentifier(decodeBatchField(fields[1]));
                if (request.schema.isEmpty() || request.table.isEmpty()) {
                    throw new IllegalArgumentException("Batch request schema and table are required.");
                }
                for (int index = 2; index < fields.length; index += 1) {
                    request.orderByColumns.add(normalizeIdentifier(decodeBatchField(fields[index])));
                }
                requests.add(request);
            }
        }
        return requests;
    }

    private static String quoteIdentifier(String value) {
        return "\"" + String.valueOf(value).replace("\"", "\"\"") + "\"";
    }

    private static String resolveQualifiedTableName(String jdbcUrl, String schema, String table) {
        boolean systemNaming = String.valueOf(jdbcUrl).toLowerCase().contains("naming=system");
        String delimiter = systemNaming ? "/" : ".";
        return quoteIdentifier(schema) + delimiter + quoteIdentifier(table);
    }

    private static String buildSql(String jdbcUrl, String schema, String table, int limit,
            List<String> orderByColumns) {
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

    private static String extractTableJson(Connection connection, String jdbcUrl, String schema, String table,
            int limit, List<String> orderByColumns, int maxCharacters) throws SQLException {
        String sql = buildSql(jdbcUrl, schema, table, limit, orderByColumns);
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
                checkTableJsonSize(json, maxCharacters);
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
                    checkTableJsonSize(json, maxCharacters);
                }
                json.append("}");
                rowCount += 1;
            }

            json.append("],\"rowCount\":").append(rowCount).append("}");
            checkTableJsonSize(json, maxCharacters);
            return json.toString();
        }
    }

    private static void checkTableJsonSize(StringBuilder json, int maxCharacters) throws SQLException {
        if (json.length() > maxCharacters) {
            throw new SQLException("Test data JSON exceeds the per-table output budget; reduce the row limit.",
                    "54000");
        }
    }

    private static void runBatch(String jdbcUrl, String user, String password, String requestPath, int limit) {
        List<TableRequest> requests;
        try {
            requests = readBatchRequests(requestPath);
        } catch (Exception error) {
            System.err.println("DB2 test data extraction failed: cannot read batch requests: " + error.getMessage());
            System.exit(1);
            return;
        }

        if (requests.isEmpty()) {
            System.out.println("{\"results\":[],\"hasMore\":false}");
            return;
        }

        try {
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
        } catch (ClassNotFoundException error) {
            System.err.println("DB2 test data extraction failed: jt400 driver not found on classpath.");
            System.exit(2);
            return;
        }

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);
            StringBuilder json = new StringBuilder("{\"results\":[");
            int index = 0;
            for (; index < requests.size(); index += 1) {
                if (index > 0 && json.length() >= BATCH_TARGET_CHARACTERS) {
                    break;
                }
                if (index > 0) {
                    json.append(",");
                }
                TableRequest request = requests.get(index);
                try {
                    String tableJson = extractTableJson(connection, jdbcUrl, request.schema, request.table, limit,
                            request.orderByColumns, MAX_TABLE_JSON_CHARACTERS);
                    json.append("{\"status\":\"exported\",\"data\":")
                            .append(tableJson)
                            .append("}");
                } catch (SQLException error) {
                    json.append("{\"status\":\"error\",\"schema\":\"")
                            .append(escape(request.schema))
                            .append("\",\"table\":\"")
                            .append(escape(request.table))
                            .append("\",\"error\":\"")
                            .append(escape("DB2 test data extraction failed: " + boundedErrorMessage(error)))
                            .append("\"}");
                }
            }
            json.append("],\"hasMore\":").append(index < requests.size()).append("}");
            System.out.println(json.toString());
        } catch (SQLException error) {
            System.err.println("DB2 test data extraction failed: " + error.getMessage());
            System.exit(2);
        }
    }

    private static String boundedErrorMessage(SQLException error) {
        String message = String.valueOf(error.getMessage());
        return message.length() > 4096 ? message.substring(0, 4096) : message;
    }

    public static void main(String[] args) {
        if (args.length < 6) {
            System.err.println(
                    "Usage: java Db2TestDataExtractor <jdbcUrl> <user> <password> <schema> <table> <limit> [orderByColumn1,orderByColumn2,...] | <jdbcUrl> <user> <password> --batch-file <path> <limit>");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        if ("--batch-file".equals(args[3])) {
            int batchLimit = parseLimit(args[5]);
            if (batchLimit <= 0) {
                System.err.println("DB2 test data extraction failed: a positive row limit is required.");
                System.exit(1);
                return;
            }
            runBatch(jdbcUrl, user, password, args[4], batchLimit);
            return;
        }

        String schema = normalizeIdentifier(args[3]);
        String table = normalizeIdentifier(args[4]);
        int limit = parseLimit(args[5]);
        List<String> orderByColumns = parseCsv(args.length >= 7 ? args[6] : "");

        if (schema.isEmpty() || table.isEmpty() || limit <= 0) {
            System.err.println("DB2 test data extraction failed: schema, table, and positive row limit are required.");
            System.exit(1);
            return;
        }

        try {
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
        } catch (ClassNotFoundException error) {
            System.err.println("DB2 test data extraction failed: jt400 driver not found on classpath.");
            System.exit(2);
            return;
        }

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);
            System.out.println(extractTableJson(connection, jdbcUrl, schema, table, limit, orderByColumns,
                    MAX_TABLE_JSON_CHARACTERS));
        } catch (SQLException error) {
            System.err.println("DB2 test data extraction failed: " + error.getMessage());
            System.exit(2);
        }
    }
}
