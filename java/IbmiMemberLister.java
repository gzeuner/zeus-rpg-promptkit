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
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class IbmiMemberLister {
    private static String escape(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String now() {
        return Instant.now().toString();
    }

    public static void main(String[] args) {
        if (args.length < 5) {
            System.err.println("Usage: java IbmiMemberLister <host> <user> <password> <sourceLib> <sourceFile>");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = args[2];
        String sourceLib = args[3].toUpperCase();
        String sourceFile = args[4].toUpperCase();

        String sql = "SELECT SYSTEM_TABLE_MEMBER FROM QSYS2.SYSPARTITIONSTAT "
                + "WHERE SYSTEM_TABLE_SCHEMA = ? AND SYSTEM_TABLE_NAME = ? "
                + "ORDER BY SYSTEM_TABLE_MEMBER";

        List<String> members = new ArrayList<>();
        try {
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
            String url = "jdbc:as400://" + host + ";naming=system;errors=full";

            try (Connection conn = DriverManager.getConnection(url, user, password);
                 PreparedStatement stmt = conn.prepareStatement(sql)) {
                stmt.setString(1, sourceLib);
                stmt.setString(2, sourceFile);

                try (ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        String member = rs.getString(1);
                        if (member != null && !member.trim().isEmpty()) {
                            members.add(member.trim().toUpperCase());
                        }
                    }
                }
            }

            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":true,");
            json.append("\"members\":[");
            for (int i = 0; i < members.size(); i++) {
                if (i > 0) json.append(",");
                json.append("\"").append(escape(members.get(i))).append("\"");
            }
            json.append("],");
            json.append("\"timestamp\":\"").append(escape(now())).append("\"");
            json.append("}");

            System.out.println(json.toString());
            System.exit(0);
        } catch (Exception ex) {
            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":false,");
            json.append("\"members\":[],");
            json.append("\"messages\":[\"").append(escape(ex.getMessage())).append("\"],");
            json.append("\"timestamp\":\"").append(escape(now())).append("\"");
            json.append("}");

            System.out.println(json.toString());
            System.exit(3);
        }
    }
}

