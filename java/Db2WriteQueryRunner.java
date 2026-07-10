
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
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * Executes a single DML statement (INSERT, UPDATE, DELETE) on IBM i DB2 via
 * JDBC.
 * Unlike Db2DiagnosticQueryRunner this class does NOT set readOnly=true and
 * calls executeUpdate() instead of executeQuery().
 *
 * Output (stdout, JSON):
 * {"rowsAffected": <n>}
 *
 * Exit codes:
 * 0 — success
 * 1 — usage error
 * 2 — driver not found
 * 3 — SQL error
 */
public class Db2WriteQueryRunner {
    private static final String STATEMENT_DELIMITER = "--ZEUS-SQL-STATEMENT--";

    private static String escape(String value) {
        if (value == null)
            return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static List<String> readStatementsFile(String filePath) throws Exception {
        String content = new String(Files.readAllBytes(Paths.get(filePath)), Charset.forName("UTF-8"));
        String[] parts = content.split("(?m)^" + java.util.regex.Pattern.quote(STATEMENT_DELIMITER) + "\\s*$");
        List<String> statements = new ArrayList<>();
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                statements.add(trimmed);
            }
        }
        return statements;
    }

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java Db2WriteQueryRunner <jdbcUrl> <user> <password> <sql>|--statements-file <path>");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        List<String> statements = new ArrayList<>();
        if ("--statements-file".equals(args[3])) {
            if (args.length < 5) {
                System.err.println("Db2WriteQueryRunner: --statements-file requires a path.");
                System.exit(1);
            }
            try {
                statements.addAll(readStatementsFile(args[4]));
            } catch (Exception e) {
                System.err.println("Db2WriteQueryRunner: cannot read statements file: " + e.getMessage());
                System.exit(1);
            }
        } else {
            statements.add(args[3]);
        }

        if (statements.isEmpty()) {
            System.err.println("Db2WriteQueryRunner: no SQL statements supplied.");
            System.exit(1);
        }

        try {
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
        } catch (ClassNotFoundException e) {
            System.err.println("Db2WriteQueryRunner: jt400 driver not found on classpath.");
            System.exit(2);
        }

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            // Explicit auto-commit ON — caller is responsible for transactional safety.
            connection.setAutoCommit(true);

            try (Statement statement = connection.createStatement()) {
                if (statements.size() == 1) {
                    int rowsAffected = statement.executeUpdate(statements.get(0));
                    System.out.println("{\"rowsAffected\":" + rowsAffected + "}");
                } else {
                    int totalRowsAffected = 0;
                    StringBuilder json = new StringBuilder();
                    json.append("{\"statementCount\":").append(statements.size()).append(",\"results\":[");
                    for (int i = 0; i < statements.size(); i++) {
                        if (i > 0) {
                            json.append(",");
                        }
                        String sql = statements.get(i);
                        int rowsAffected = statement.executeUpdate(sql);
                        totalRowsAffected += rowsAffected;
                        json.append("{\"sql\":\"").append(escape(sql)).append("\",\"rowsAffected\":").append(rowsAffected).append("}");
                    }
                    json.append("],\"rowsAffected\":").append(totalRowsAffected).append("}");
                    System.out.println(json.toString());
                }
            }

        } catch (SQLException e) {
            System.err.println("SQL error: " + e.getMessage()
                    + " [SQLState=" + e.getSQLState()
                    + ", errorCode=" + e.getErrorCode() + "]");
            System.exit(3);
        }
    }
}
