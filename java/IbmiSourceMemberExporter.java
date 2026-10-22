
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
import com.ibm.as400.access.AS400File;
import com.ibm.as400.access.AS400FileRecordDescription;
import com.ibm.as400.access.IFSFile;
import com.ibm.as400.access.QSYSObjectPathName;
import com.ibm.as400.access.Record;
import com.ibm.as400.access.SequentialFile;

import java.io.File;
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

    private static int writeToLocalFile(AS400 system, String sourceLib, String sourceFile, String member,
            String targetPath) throws Exception {
        File localFile = new File(targetPath);
        File parent = localFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        int linesWritten = 0;
        String memberPath = new QSYSObjectPathName(sourceLib, sourceFile, member, "MBR").getPath();
        String filePath = new QSYSObjectPathName(sourceLib, sourceFile, "FILE").getPath();
        SequentialFile source = new SequentialFile(system, memberPath);
        try {
            source.setRecordFormat(new AS400FileRecordDescription(system, filePath).retrieveRecordFormat()[0]);
            source.open(AS400File.READ_ONLY, 0, AS400File.COMMIT_LOCK_LEVEL_NONE);
            try (java.io.OutputStream out = java.nio.file.Files.newOutputStream(localFile.toPath(),
                    java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE);
                    OutputStreamWriter writer = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
                Record sourceRecord;
                while ((sourceRecord = source.readNext()) != null) {
                    Object value = sourceRecord.getField("SRCDTA");
                    String line = value == null ? "" : value.toString();
                    int end = line.length();
                    while (end > 0 && Character.isWhitespace(line.charAt(end - 1))) {
                        end--;
                    }
                    writer.write(line, 0, end);
                    writer.write('\n');
                    linesWritten += 1;
                }
                writer.flush();
            }
        } finally {
            source.close();
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
        // reads the member directly and writes only to the local filesystem.
        String writeMode = args.length > 8 ? normalizeIdentifier(args[8]) : "IFS";
        boolean localWrite = "LOCAL".equals(writeMode);

        AS400 system = null;
        Connection connection = null;
        Statement statement = null;

        try {
            if (localWrite) {
                system = new AS400(host, user, password.toCharArray());
                system.setGuiAvailable(false);
                int localLines = writeToLocalFile(system, sourceLib, sourceFile, member, targetPath);
                System.out.println(toJson(true, localLines,
                        new String[] { "Source member was read directly without remote SQL DDL or IFS writes." }));
                return;
            }
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
            system = new AS400(host, user, password);
            linesWritten = writeToIfsFile(system, statement, aliasName, targetPath, streamFileCcsid);
            successMessage = "Source member was exported via JDBC fallback with translate binary=true.";

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
