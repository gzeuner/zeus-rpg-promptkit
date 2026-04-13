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
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class Db2ExternalObjectResolver {
    private static class ExternalObjectInfo {
        String requestedName;
        String schema;
        String library;
        String sqlName;
        String systemName;
        String objectType;
        String sqlObjectType;
        String textDescription;
        String evidenceSource;
        String matchedBy;
    }

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

    private static List<String> parseNames(String csv) {
        List<String> names = new ArrayList<>();
        if (csv == null || csv.trim().isEmpty()) {
            return names;
        }
        String[] parts = csv.split(",");
        for (String part : parts) {
            String trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                names.add(trimmed);
            }
        }
        return names;
    }

    private static String encodeValue(String value) {
        return value == null ? "null" : "\"" + escape(value) + "\"";
    }

    private static List<ExternalObjectInfo> resolveExternalObjects(Connection connection, String requestedName) throws SQLException {
        List<ExternalObjectInfo> objects = new ArrayList<>();
        String normalizedRequested = normalizeIdentifier(requestedName);
        String sql = ""
            + "SELECT OBJLONGSCHEMA, OBJLONGNAME, OBJLIB, OBJNAME, OBJTYPE, SQL_OBJECT_TYPE, OBJTEXT "
            + "FROM TABLE(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => '*ALLUSR', OBJTYPELIST => 'PGM,SRVPGM,MODULE', OBJECT_NAME => ?)) "
            + "WHERE UPPER(OBJNAME) = ? OR UPPER(COALESCE(OBJLONGNAME, OBJNAME)) = ?";

        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, requestedName);
            statement.setString(2, normalizedRequested);
            statement.setString(3, normalizedRequested);
            try (ResultSet rs = statement.executeQuery()) {
                while (rs.next()) {
                    ExternalObjectInfo object = new ExternalObjectInfo();
                    object.requestedName = normalizedRequested;
                    object.schema = normalizeIdentifier(rs.getString("OBJLONGSCHEMA"));
                    object.library = normalizeIdentifier(rs.getString("OBJLIB"));
                    object.sqlName = normalizeIdentifier(rs.getString("OBJLONGNAME"));
                    object.systemName = normalizeIdentifier(rs.getString("OBJNAME"));
                    object.objectType = normalizeIdentifier(rs.getString("OBJTYPE"));
                    object.sqlObjectType = normalizeIdentifier(rs.getString("SQL_OBJECT_TYPE"));
                    object.textDescription = rs.getString("OBJTEXT");
                    object.evidenceSource = "OBJECT_STATISTICS";
                    object.matchedBy = normalizedRequested.equals(object.systemName) ? "SYSTEM_NAME" : "SQL_NAME";
                    objects.add(object);
                }
            }
        }

        Collections.sort(objects, Comparator
            .comparing((ExternalObjectInfo object) -> object.requestedName)
            .thenComparing(object -> object.library)
            .thenComparing(object -> object.systemName));
        return objects;
    }

    private static void appendObjectJson(StringBuilder json, ExternalObjectInfo object) {
        json.append("{")
            .append("\"requestedName\":").append(encodeValue(object.requestedName)).append(",")
            .append("\"schema\":").append(encodeValue(object.schema)).append(",")
            .append("\"library\":").append(encodeValue(object.library)).append(",")
            .append("\"sqlName\":").append(encodeValue(object.sqlName)).append(",")
            .append("\"systemName\":").append(encodeValue(object.systemName)).append(",")
            .append("\"objectType\":").append(encodeValue(object.objectType)).append(",")
            .append("\"sqlObjectType\":").append(encodeValue(object.sqlObjectType)).append(",")
            .append("\"textDescription\":").append(encodeValue(object.textDescription)).append(",")
            .append("\"evidenceSource\":").append(encodeValue(object.evidenceSource)).append(",")
            .append("\"matchedBy\":").append(encodeValue(object.matchedBy))
            .append("}");
    }

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java Db2ExternalObjectResolver <jdbcUrl> <user> <password> <name1,name2,...>");
            System.exit(1);
        }

        String jdbcUrl = args[0];
        String user = args[1];
        String password = args[2];
        List<String> requestedNames = parseNames(args[3]);

        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            List<ExternalObjectInfo> resolvedObjects = new ArrayList<>();
            for (String requestedName : requestedNames) {
                resolvedObjects.addAll(resolveExternalObjects(connection, requestedName));
            }

            StringBuilder json = new StringBuilder();
            json.append("{\"objects\":[");
            for (int i = 0; i < resolvedObjects.size(); i += 1) {
                if (i > 0) {
                    json.append(",");
                }
                appendObjectJson(json, resolvedObjects.get(i));
            }
            json.append("]}");
            System.out.println(json.toString());
        } catch (SQLException e) {
            System.err.println("DB2 external object resolution failed: " + e.getMessage());
            System.exit(2);
        }
    }
}
