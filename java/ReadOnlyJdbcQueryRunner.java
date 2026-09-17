/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0
*/
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
import java.util.List;

/** Shared, bounded read-only runner for explicitly configured vendor JDBC drivers. */
final class ReadOnlyJdbcQueryRunner {
    private static final String STATEMENT_DELIMITER = "--ZEUS-SQL-STATEMENT--";

    private ReadOnlyJdbcQueryRunner() {
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static int parseMaxRows(String value) {
        try {
            int parsed = Integer.parseInt(String.valueOf(value).trim());
            return parsed > 0 ? parsed : 50;
        } catch (NumberFormatException error) {
            return 50;
        }
    }

    private static String encodeValue(Object value) {
        if (value == null) return "null";
        if (value instanceof Number) {
            return value instanceof BigDecimal ? ((BigDecimal) value).toPlainString() : String.valueOf(value);
        }
        if (value instanceof Boolean) return String.valueOf(value);
        if (value instanceof byte[]) return "\"<binary>\"";
        return "\"" + escape(String.valueOf(value)) + "\"";
    }

    private static Object readValue(ResultSet resultSet, int columnIndex, int sqlType) throws SQLException {
        switch (sqlType) {
            case Types.DATE:
            case Types.TIME:
            case Types.TIMESTAMP:
            case Types.TIMESTAMP_WITH_TIMEZONE:
                return resultSet.getString(columnIndex);
            case Types.BINARY:
            case Types.VARBINARY:
            case Types.LONGVARBINARY:
            case Types.BLOB:
                return resultSet.getBytes(columnIndex);
            default:
                return resultSet.getObject(columnIndex);
        }
    }

    private static List<String> readStatementsFile(String filePath) throws Exception {
        String content = new String(Files.readAllBytes(Paths.get(filePath)), StandardCharsets.UTF_8);
        String[] parts = content.split("(?m)^" + java.util.regex.Pattern.quote(STATEMENT_DELIMITER) + "\\s*$");
        List<String> statements = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) statements.add(trimmed);
        }
        return statements;
    }

    private static String runQueryJson(Statement statement, String query, int maxRows) throws SQLException {
        statement.setMaxRows(maxRows);
        try (ResultSet resultSet = statement.executeQuery(query)) {
            ResultSetMetaData metadata = resultSet.getMetaData();
            int columnCount = metadata.getColumnCount();
            List<String> columns = new ArrayList<>();
            for (int index = 1; index <= columnCount; index += 1) columns.add(metadata.getColumnLabel(index));

            StringBuilder json = new StringBuilder();
            json.append("{\"sql\":\"").append(escape(query)).append("\",\"columns\":[");
            for (int index = 0; index < columns.size(); index += 1) {
                if (index > 0) json.append(",");
                json.append("\"").append(escape(columns.get(index))).append("\"");
            }
            json.append("],\"rows\":[");
            int rowCount = 0;
            while (resultSet.next()) {
                if (rowCount > 0) json.append(",");
                json.append("{");
                for (int index = 1; index <= columnCount; index += 1) {
                    if (index > 1) json.append(",");
                    Object value = readValue(resultSet, index, metadata.getColumnType(index));
                    json.append("\"").append(escape(columns.get(index - 1))).append("\":").append(encodeValue(value));
                }
                json.append("}");
                rowCount += 1;
            }
            json.append("],\"rowCount\":").append(rowCount).append("}");
            return json.toString();
        }
    }

    static void run(String driverClassName, String[] args, String label) {
        if (args.length < 4) {
            System.err.println("Usage: java " + label + " <jdbcUrl> <user> <password> <query>|--statements-file <path> [maxRows]");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        List<String> queries = new ArrayList<>();
        int argumentIndex = 3;
        if ("--statements-file".equals(args[argumentIndex])) {
            if (args.length <= argumentIndex + 1) {
                System.err.println(label + " failed: --statements-file requires a path.");
                System.exit(1);
            }
            try {
                queries.addAll(readStatementsFile(args[argumentIndex + 1]));
            } catch (Exception error) {
                System.err.println(label + " failed: cannot read statements file: " + error.getMessage());
                System.exit(1);
            }
            argumentIndex += 2;
        } else {
            queries.add(args[argumentIndex]);
            argumentIndex += 1;
        }
        int maxRows = parseMaxRows(args.length > argumentIndex ? args[argumentIndex] : "50");
        if (queries.isEmpty()) {
            System.err.println(label + " failed: no SQL statements supplied.");
            System.exit(1);
        }

        try {
            Class.forName(driverClassName);
        } catch (ClassNotFoundException error) {
            System.err.println(label + " failed: JDBC driver not found on classpath: " + driverClassName);
            System.exit(2);
        }

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);
            try (Statement statement = connection.createStatement()) {
                if (queries.size() == 1) {
                    System.out.println(runQueryJson(statement, queries.get(0), maxRows));
                } else {
                    StringBuilder json = new StringBuilder();
                    json.append("{\"statementCount\":").append(queries.size()).append(",\"statements\":[");
                    for (int index = 0; index < queries.size(); index += 1) {
                        if (index > 0) json.append(",");
                        json.append(runQueryJson(statement, queries.get(index), maxRows));
                    }
                    json.append("]}");
                    System.out.println(json.toString());
                }
            }
        } catch (SQLException error) {
            System.err.println(label + " failed: " + error.getMessage());
            System.exit(2);
        }
    }
}
