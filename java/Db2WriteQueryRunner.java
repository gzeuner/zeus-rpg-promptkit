
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
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

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

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java Db2WriteQueryRunner <jdbcUrl> <user> <password> <sql>");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        String sql = args[3];

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
                int rowsAffected = statement.executeUpdate(sql);
                System.out.println("{\"rowsAffected\":" + rowsAffected + "}");
            }

        } catch (SQLException e) {
            System.err.println("SQL error: " + e.getMessage()
                    + " [SQLState=" + e.getSQLState()
                    + ", errorCode=" + e.getErrorCode() + "]");
            System.exit(3);
        }
    }
}
