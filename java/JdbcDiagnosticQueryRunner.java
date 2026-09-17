/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
*/
import java.util.Arrays;

/** Loads one operator-approved driver and delegates to the bounded JDBC runner. */
public final class JdbcDiagnosticQueryRunner {
    private JdbcDiagnosticQueryRunner() {
    }

    public static void main(String[] args) {
        if (args.length < 5) {
            System.err.println("Usage: java JdbcDiagnosticQueryRunner <driverClass> <jdbcUrl> <user> <password> <query>|--statements-file <path> [maxRows]");
            System.exit(1);
        }
        ReadOnlyJdbcQueryRunner.run(args[0], Arrays.copyOfRange(args, 1, args.length), "JDBC diagnostic query");
    }
}
