
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
import com.ibm.as400.access.AS400;
import com.ibm.as400.access.IFSFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;

public class IbmiSourceMemberExporter {
    private static String escape(String value) {
        if (value == null)
            return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String normalizeIdentifier(String value) {
        return value == null ? "" : value.trim().toUpperCase();
    }

    private static String buildJdbcUrl(String host) {
        return "jdbc:as400://" + host + ";naming=system;translate binary=true;errors=full";
    }

    private static String buildAliasName(String member) {
        String normalized = normalizeIdentifier(member).replaceAll("[^A-Z0-9_]", "");
        if (normalized.isEmpty()) {
            normalized = "ZEUSMBR";
        }
        if (normalized.length() > 8) {
            normalized = normalized.substring(0, 8);
        }
        return "QTEMP." + normalized;
    }

    private static void ensureParentDirectory(AS400 system, String targetPath) throws Exception {
        int slash = targetPath.lastIndexOf('/');
        if (slash <= 0) {
            return;
        }

        String parentPath = targetPath.substring(0, slash);
        IFSFile directory = new IFSFile(system, parentPath);
        if (!directory.exists()) {
            directory.mkdirs();
        }
    }

    private static int writeToLocalFile(Statement statement, String aliasName, String targetPath) throws Exception {
        File localFile = new File(targetPath);
        File parent = localFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        int linesWritten = 0;
        try (FileOutputStream out = new FileOutputStream(localFile);
                OutputStreamWriter writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
                ResultSet rs = statement.executeQuery("SELECT SRCDTA FROM " + aliasName + " ORDER BY SRCSEQ")) {
            while (rs.next()) {
                String line = rs.getString(1);
                writer.write(line == null ? "" : line.replaceFirst("\\s+$", ""));
                writer.write('\n');
                linesWritten += 1;
            }
            writer.flush();
        }
        return linesWritten;
    }

    private static int writeToIfsFile(AS400 system, Statement statement, String aliasName, String targetPath,
            int streamFileCcsid) throws Exception {
        ensureParentDirectory(system, targetPath);

        IFSFile outputFile = new IFSFile(system, targetPath);
        if (outputFile.exists()) {
            outputFile.delete();
        }
        outputFile.createNewFile();
        outputFile.setCCSID(streamFileCcsid);

        int linesWritten = 0;
        try (com.ibm.as400.access.IFSFileOutputStream out = new com.ibm.as400.access.IFSFileOutputStream(system,
                targetPath);
                OutputStreamWriter writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
                ResultSet rs = statement.executeQuery("SELECT SRCDTA FROM " + aliasName + " ORDER BY SRCSEQ")) {
            while (rs.next()) {
                String line = rs.getString(1);
                writer.write(line == null ? "" : line.replaceFirst("\\s+$", ""));
                writer.write('\n');
                linesWritten += 1;
            }
            writer.flush();
        }
        return linesWritten;
    }

    private static String toJson(boolean ok, int linesWritten, String[] messages) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"ok\":").append(ok ? "true" : "false").append(",");
        json.append("\"usedFallback\":true,");
        json.append("\"linesWritten\":").append(linesWritten).append(",");
        json.append("\"messages\":[");
        for (int i = 0; i < messages.length; i++) {
            if (i > 0)
                json.append(",");
            json.append("\"").append(escape(messages[i])).append("\"");
        }
        json.append("],");
        json.append("\"timestamp\":\"").append(escape(Instant.now().toString())).append("\"");
        json.append("}");
        return json.toString();
    }

    public static void main(String[] args) {
        if (args.length < 8) {
            System.err.println(
                    "Usage: java IbmiSourceMemberExporter <host> <user> <password> <sourceLib> <sourceFile> <member> <targetPath> <streamFileCcsid> [writeMode:ifs|local]");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        String sourceLib = normalizeIdentifier(args[3]);
        String sourceFile = normalizeIdentifier(args[4]);
        String member = normalizeIdentifier(args[5]);
        String targetPath = args[6];
        int streamFileCcsid = Integer.parseInt(args[7]);
        // Optional 9th argument selects the output target. Default "ifs" keeps
        // backward compatibility with the bulk IFS export pipeline; "local"
        // writes the JDBC-fetched source directly to the local filesystem.
        String writeMode = args.length > 8 ? normalizeIdentifier(args[8]) : "IFS";
        boolean localWrite = "LOCAL".equals(writeMode);

        AS400 system = null;
        Connection connection = null;
        Statement statement = null;

        try {
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
            connection = DriverManager.getConnection(buildJdbcUrl(host), user, password);
            statement = connection.createStatement();

            String aliasName = buildAliasName(member);
            try {
                statement.executeUpdate("DROP ALIAS " + aliasName);
            } catch (SQLException ignored) {
                // no-op
            }
            statement.executeUpdate(
                    "CREATE ALIAS " + aliasName + " FOR " + sourceLib + "/" + sourceFile + "(" + member + ")");

            int linesWritten;
            String successMessage;
            if (localWrite) {
                linesWritten = writeToLocalFile(statement, aliasName, targetPath);
                successMessage = "Source member was exported via JDBC to the local filesystem with translate binary=true.";
            } else {
                system = new AS400(host, user, password);
                linesWritten = writeToIfsFile(system, statement, aliasName, targetPath, streamFileCcsid);
                successMessage = "Source member was exported via JDBC fallback with translate binary=true.";
            }

            System.out.println(toJson(true, linesWritten, new String[] { successMessage }));
            System.exit(0);
        } catch (Exception ex) {
            System.out.println(
                    toJson(false, 0, new String[] { ex.getMessage() == null ? ex.toString() : ex.getMessage() }));
            System.exit(3);
        } finally {
            if (statement != null) {
                try {
                    statement.close();
                } catch (SQLException ignored) {
                    // no-op
                }
            }
            if (connection != null) {
                try {
                    connection.close();
                } catch (SQLException ignored) {
                    // no-op
                }
            }
            if (system != null) {
                try {
                    system.disconnectAllServices();
                } catch (Exception ignored) {
                    // no-op
                }
            }
        }
    }
}
