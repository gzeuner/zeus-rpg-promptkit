
/*
Copyright 2026 Zeus PromptKit Contributors

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
import com.ibm.as400.access.IFSFileInputStream;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * IbmiSourceSearcher — remote full-text search over IBM i source members via
 * IFS.
 *
 * Usage:
 * java IbmiSourceSearcher <host> <user> <password> <sourceLib> <sourceFile>
 * <searchTerm> [maxResults]
 *
 * Searches all members of /QSYS.LIB/<sourceLib>.LIB/<sourceFile>.FILE/*.MBR
 * for the given search term (case-insensitive). Returns JSON with matches
 * including file path, line number, and context line.
 *
 * Optional second search term via pipe: "TERM1|TERM2" (OR logic, both reported
 * separately).
 */
public class IbmiSourceSearcher {

    private static String escape(String value) {
        if (value == null)
            return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static class Match {
        String memberPath;
        String memberName;
        int lineNumber;
        String lineText;
        String term;
    }

    public static void main(String[] args) {
        if (args.length < 6) {
            System.err.println(
                    "Usage: java IbmiSourceSearcher <host> <user> <password> <sourceLib> <sourceFile> <searchTerm> [maxResults]");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = args[2];
        String sourceLib = args[3].toUpperCase();
        String sourceFile = args[4].toUpperCase();
        String searchTerm = args[5];
        int maxResults = args.length > 6 ? parseIntSafe(args[6], 500) : 500;

        // Support multiple terms separated by |
        String[] terms = searchTerm.split("\\|");
        String[] lowerTerms = new String[terms.length];
        for (int i = 0; i < terms.length; i++) {
            lowerTerms[i] = terms[i].trim().toLowerCase();
        }

        AS400 system = null;
        List<Match> matches = new ArrayList<>();
        String errorMessage = null;
        int memberCount = 0;
        int errorCount = 0;

        try {
            system = new AS400(host, user, password);

            String sourceFilePath = "/QSYS.LIB/" + sourceLib + ".LIB/" + sourceFile + ".FILE";
            IFSFile sourceFileDir = new IFSFile(system, sourceFilePath);

            if (!sourceFileDir.exists()) {
                errorMessage = "Source file not found: " + sourceFilePath;
            } else {
                IFSFile[] members = sourceFileDir.listFiles("*.MBR");
                if (members == null) {
                    members = new IFSFile[0];
                }

                for (IFSFile member : members) {
                    if (matches.size() >= maxResults) {
                        break;
                    }
                    memberCount++;
                    try {
                        searchMember(system, member, lowerTerms, terms, matches, maxResults);
                    } catch (Exception ex) {
                        errorCount++;
                    }
                }
            }
        } catch (Exception ex) {
            errorMessage = ex.getMessage();
        } finally {
            if (system != null) {
                try {
                    system.disconnectAllServices();
                } catch (Exception ignored) {
                }
            }
        }

        // Build JSON output
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"ok\":").append(errorMessage == null ? "true" : "false").append(",");
        json.append("\"sourceLib\":\"").append(escape(sourceLib)).append("\",");
        json.append("\"sourceFile\":\"").append(escape(sourceFile)).append("\",");
        json.append("\"terms\":[");
        for (int i = 0; i < terms.length; i++) {
            if (i > 0)
                json.append(",");
            json.append("\"").append(escape(terms[i].trim())).append("\"");
        }
        json.append("],");
        json.append("\"memberCount\":").append(memberCount).append(",");
        json.append("\"errorCount\":").append(errorCount).append(",");
        json.append("\"matchCount\":").append(matches.size()).append(",");
        json.append("\"truncated\":").append(matches.size() >= maxResults ? "true" : "false").append(",");

        if (errorMessage != null) {
            json.append("\"error\":\"").append(escape(errorMessage)).append("\",");
        }

        json.append("\"matches\":[");
        for (int i = 0; i < matches.size(); i++) {
            if (i > 0)
                json.append(",");
            Match m = matches.get(i);
            json.append("{");
            json.append("\"member\":\"").append(escape(m.memberName)).append("\",");
            json.append("\"path\":\"").append(escape(m.memberPath)).append("\",");
            json.append("\"line\":").append(m.lineNumber).append(",");
            json.append("\"term\":\"").append(escape(m.term)).append("\",");
            json.append("\"text\":\"").append(escape(m.lineText.trim())).append("\"");
            json.append("}");
        }
        json.append("],");
        json.append("\"timestamp\":\"").append(escape(now())).append("\"");
        json.append("}");

        System.out.println(json.toString());
        System.exit(errorMessage == null ? 0 : 1);
    }

    private static void searchMember(AS400 system, IFSFile member, String[] lowerTerms, String[] originalTerms,
            List<Match> matches, int maxResults) throws Exception {
        String memberPath = member.getPath();
        String memberName = member.getName();
        if (memberName.endsWith(".MBR")) {
            memberName = memberName.substring(0, memberName.length() - 4);
        }

        IFSFileInputStream stream = new IFSFileInputStream(system, memberPath);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            int lineNumber = 0;
            while ((line = reader.readLine()) != null && matches.size() < maxResults) {
                lineNumber++;
                String lowerLine = line.toLowerCase();
                for (int t = 0; t < lowerTerms.length; t++) {
                    if (!lowerTerms[t].isEmpty() && lowerLine.contains(lowerTerms[t])) {
                        Match m = new Match();
                        m.memberPath = memberPath;
                        m.memberName = memberName;
                        m.lineNumber = lineNumber;
                        m.lineText = line;
                        m.term = originalTerms[t].trim();
                        matches.add(m);
                        if (matches.size() >= maxResults) {
                            break;
                        }
                    }
                }
            }
        }
    }

    private static int parseIntSafe(String value, int defaultValue) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
