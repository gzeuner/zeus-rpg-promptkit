/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import java.math.BigDecimal;
import java.nio.charset.Charset;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * Compares before/after row images from QSYS2.DISPLAY_JOURNAL.
 *
 * The tool is deliberately aggregate-only: raw journal bytes and decoded row
 * values never leave the JVM. The caller supplies a layout derived from an
 * authoritative source definition and an independent read-only audit query.
 * A failed cross-check is reported as VALIDATION_FAILED instead of producing
 * numbers that look trustworthy.
 */
public final class JournalRowDiffAnalyzer {
    private static final int MIN_VALIDATION_SAMPLE = 20;
    private static final double MIN_VALIDATION_MATCH_RATE = 0.90;
    private static final int MAX_VALIDATION_SAMPLES = 5000;
    private static final int MAX_REPORTED_WARNINGS = 20;

    private static final class ColumnDef {
        final String name;
        final char type;
        final int length;
        final int scale;

        ColumnDef(String name, char type, int length, int scale) {
            this.name = name;
            this.type = type;
            this.length = length;
            this.scale = scale;
        }
    }

    private static final class PendingEntry {
        final Map<String, Object> decoded;

        PendingEntry(Map<String, Object> decoded) {
            this.decoded = decoded;
        }
    }

    private static List<ColumnDef> parseLayout(String spec) {
        List<ColumnDef> columns = new ArrayList<>();
        if (spec == null || spec.trim().isEmpty()) {
            throw new IllegalArgumentException("layout must not be empty");
        }
        int totalLength = 0;
        for (String part : spec.split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String[] fields = trimmed.split(":", -1);
            if (fields.length < 3 || fields.length > 4) {
                throw new IllegalArgumentException("invalid layout column specification");
            }
            String name = fields[0].trim().toUpperCase(Locale.ROOT);
            if (!name.matches("[A-Z0-9_$#@]{1,128}")) {
                throw new IllegalArgumentException("invalid layout column name");
            }
            if (columns.stream().anyMatch(column -> column.name.equals(name))) {
                throw new IllegalArgumentException("duplicate layout column");
            }
            String typeValue = fields[1].trim().toUpperCase(Locale.ROOT);
            if (typeValue.length() != 1 || !"PCB".contains(typeValue)) {
                throw new IllegalArgumentException("unsupported layout column type");
            }
            char type = typeValue.charAt(0);
            int length = Integer.parseInt(fields[2].trim());
            int scale = fields.length == 4 ? Integer.parseInt(fields[3].trim()) : 0;
            if (length <= 0 || length > 65535 || scale < 0 || scale > 38) {
                throw new IllegalArgumentException("invalid layout column dimensions");
            }
            if (type == 'B' && length != 4) {
                throw new IllegalArgumentException("binary integer columns must be four bytes");
            }
            totalLength += length;
            if (totalLength > 1024 * 1024) {
                throw new IllegalArgumentException("layout is too large");
            }
            columns.add(new ColumnDef(name, type, length, scale));
        }
        if (columns.isEmpty()) {
            throw new IllegalArgumentException("layout must contain at least one column");
        }
        return columns;
    }

    private static List<String> parseCsvUpper(String csv, String label) {
        List<String> values = new ArrayList<>();
        if (csv == null || csv.trim().isEmpty()) {
            return values;
        }
        for (String part : csv.split(",")) {
            String value = part.trim().toUpperCase(Locale.ROOT);
            if (!value.matches("[A-Z0-9_$#@]{1,128}")) {
                throw new IllegalArgumentException("invalid " + label + " column name");
            }
            if (!values.contains(value)) {
                values.add(value);
            }
        }
        return values;
    }

    private static void validateColumnReferences(
            List<ColumnDef> layout, List<String> keyColumns, List<String> ignoreColumns) {
        List<String> available = new ArrayList<>();
        for (ColumnDef column : layout) {
            available.add(column.name);
        }
        if (keyColumns.isEmpty()) {
            throw new IllegalArgumentException("at least one key column is required");
        }
        for (String column : keyColumns) {
            if (!available.contains(column)) {
                throw new IllegalArgumentException("key column is not present in layout");
            }
        }
        for (String column : ignoreColumns) {
            if (!available.contains(column)) {
                throw new IllegalArgumentException("ignored column is not present in layout");
            }
        }
    }

    private static BigDecimal decodePacked(byte[] data, int offset, int length, int scale) {
        StringBuilder digits = new StringBuilder();
        boolean negative = false;
        for (int i = 0; i < length; i++) {
            int value = data[offset + i] & 0xFF;
            int high = (value >> 4) & 0x0F;
            int low = value & 0x0F;
            if (i < length - 1) {
                if (high > 9 || low > 9) {
                    throw new IllegalStateException("invalid packed decimal digit");
                }
                digits.append((char) ('0' + high)).append((char) ('0' + low));
            } else {
                if (high > 9 || (low != 0x0C && low != 0x0D && low != 0x0F && low != 0x0B)) {
                    throw new IllegalStateException("invalid packed decimal sign");
                }
                digits.append((char) ('0' + high));
                negative = low == 0x0D || low == 0x0B;
            }
        }
        BigDecimal value = new BigDecimal(digits.toString());
        return negative ? value.movePointLeft(scale).negate() : value.movePointLeft(scale);
    }

    private static long decodeBinaryInt(byte[] data, int offset) {
        return ((long) (data[offset] & 0xFF) << 24)
                | ((long) (data[offset + 1] & 0xFF) << 16)
                | ((long) (data[offset + 2] & 0xFF) << 8)
                | (data[offset + 3] & 0xFFL);
    }

    private static Map<String, Object> decodeRecord(
            byte[] data, List<ColumnDef> layout, Charset charset, List<String> warnings) {
        int requiredLength = layout.stream().mapToInt(column -> column.length).sum();
        if (data == null || data.length < requiredLength) {
            warnings.add("record shorter than supplied layout");
            return null;
        }
        Map<String, Object> decoded = new LinkedHashMap<>();
        int offset = 0;
        for (ColumnDef column : layout) {
            try {
                if (column.type == 'P') {
                    decoded.put(column.name, decodePacked(data, offset, column.length, column.scale));
                } else if (column.type == 'B') {
                    decoded.put(column.name, decodeBinaryInt(data, offset));
                } else {
                    decoded.put(column.name, new String(data, offset, column.length, charset).trim());
                }
            } catch (RuntimeException error) {
                warnings.add("could not decode supplied layout column " + column.name);
                decoded.put(column.name, null);
            }
            offset += column.length;
        }
        return decoded;
    }

    private static String keyPart(Object value) {
        if (value == null) {
            return "<NULL>";
        }
        if (value instanceof BigDecimal) {
            return ((BigDecimal) value).stripTrailingZeros().toPlainString();
        }
        return String.valueOf(value).trim();
    }

    private static String compositeKey(List<Object> values) {
        StringBuilder key = new StringBuilder();
        for (Object value : values) {
            if (key.length() > 0) {
                key.append('\u001F');
            }
            key.append(keyPart(value));
        }
        return key.toString();
    }

    private static String compositeKey(Map<String, Object> decoded, List<String> keyColumns) {
        List<Object> values = new ArrayList<>();
        for (String keyColumn : keyColumns) {
            values.add(decoded.get(keyColumn));
        }
        return compositeKey(values);
    }

    private static long percentile(List<Long> sortedValues, double fraction) {
        if (sortedValues.isEmpty()) {
            return 0;
        }
        int index = (int) Math.ceil(fraction * sortedValues.size()) - 1;
        return sortedValues.get(Math.max(0, Math.min(index, sortedValues.size() - 1)));
    }

    private static String jsonString(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder result = new StringBuilder("\"");
        for (char character : value.toCharArray()) {
            if (character == '"') result.append("\\\"");
            else if (character == '\\') result.append("\\\\");
            else if (character == '\n') result.append("\\n");
            else if (character == '\r') result.append("\\r");
            else if (character == '\t') result.append("\\t");
            else if (character < 0x20) result.append(String.format("\\u%04x", (int) character));
            else result.append(character);
        }
        return result.append('"').toString();
    }

    private static String charsetName(int ccsid) {
        switch (ccsid) {
            case 37: return "Cp037";
            case 273: return "Cp273";
            case 500: return "Cp500";
            case 1140: return "Cp1140";
            case 1141: return "Cp1141";
            default: return "Cp" + ccsid;
        }
    }

    public static void main(String[] args) {
        if (args.length < 10) {
            System.err.println("Journal row diff analyzer requires ten arguments");
            System.exit(1);
            return;
        }
        String jdbcUrl = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        String journalQuery = args[3];
        String auditQuery = args[4];
        List<ColumnDef> layout;
        List<String> keyColumns;
        List<String> ignoreColumns;
        int ccsid;
        int toleranceSeconds;
        try {
            layout = parseLayout(args[5]);
            keyColumns = parseCsvUpper(args[6], "key");
            ignoreColumns = parseCsvUpper(args[7], "ignored");
            validateColumnReferences(layout, keyColumns, ignoreColumns);
            ccsid = Integer.parseInt(args[8].trim());
            toleranceSeconds = Integer.parseInt(args[9].trim());
            if (toleranceSeconds < 0 || toleranceSeconds > 86400) throw new IllegalArgumentException("invalid tolerance");
        } catch (RuntimeException error) {
            System.err.println("Journal row diff failed: invalid arguments");
            System.exit(1);
            return;
        }

        Charset charset;
        try {
            charset = Charset.forName(charsetName(ccsid));
            Class.forName("com.ibm.as400.access.AS400JDBCDriver");
        } catch (Exception error) {
            System.err.println("Journal row diff failed: runtime dependency unavailable");
            System.exit(2);
            return;
        }

        List<String> warnings = new ArrayList<>();
        try (Connection connection = DriverManager.getConnection(jdbcUrl, user, password)) {
            connection.setReadOnly(true);
            Map<String, List<Long>> auditIndex = new TreeMap<>();
            try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(auditQuery)) {
                ResultSetMetaData metadata = result.getMetaData();
                if (metadata.getColumnCount() != keyColumns.size() + 1) {
                    throw new SQLException("audit query must return one column per key plus a timestamp");
                }
                while (result.next()) {
                    List<Object> values = new ArrayList<>();
                    for (int index = 1; index <= keyColumns.size(); index++) values.add(result.getObject(index));
                    Timestamp timestamp = result.getTimestamp(keyColumns.size() + 1);
                    if (timestamp != null) auditIndex.computeIfAbsent(compositeKey(values), key -> new ArrayList<>()).add(timestamp.getTime());
                }
            }

            Map<String, Deque<PendingEntry>> pendingByJob = new LinkedHashMap<>();
            long entriesRead = 0, pairsFormed = 0, unpaired = 0, decodeErrors = 0;
            long noOpCount = 0, contentChangeCount = 0, validationSampled = 0, validationMatched = 0, noAuditCandidateCount = 0;
            Map<String, Long> changedColumnCounts = new TreeMap<>();
            List<Long> lagMillisSamples = new ArrayList<>();

            try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(journalQuery)) {
                statement.setFetchSize(1000);
                while (result.next()) {
                    entriesRead++;
                    String entryType = String.valueOf(result.getString("JOURNAL_ENTRY_TYPE")).trim().toUpperCase(Locale.ROOT);
                    String jobKey = String.valueOf(result.getString("JOB_NUMBER")).trim() + "/" + String.valueOf(result.getString("JOB_NAME")).trim();
                    Timestamp entryTimestamp = result.getTimestamp("ENTRY_TIMESTAMP");
                    Map<String, Object> decoded = decodeRecord(result.getBytes("ENTRY_DATA"), layout, charset, warnings);
                    if (decoded == null) { decodeErrors++; continue; }
                    if ("UB".equals(entryType)) {
                        pendingByJob.computeIfAbsent(jobKey, key -> new ArrayDeque<>()).addLast(new PendingEntry(decoded));
                        continue;
                    }
                    if (!"UP".equals(entryType)) continue;
                    Deque<PendingEntry> pending = pendingByJob.get(jobKey);
                    if (pending == null || pending.isEmpty()) { unpaired++; continue; }
                    Map<String, Object> before = pending.removeFirst().decoded;
                    if (!Objects.equals(compositeKey(before, keyColumns), compositeKey(decoded, keyColumns))) { unpaired++; continue; }
                    pairsFormed++;
                    boolean changed = false;
                    for (ColumnDef column : layout) {
                        if (ignoreColumns.contains(column.name) || keyColumns.contains(column.name)) continue;
                        if (!Objects.equals(before.get(column.name), decoded.get(column.name))) {
                            changed = true;
                            changedColumnCounts.merge(column.name, 1L, Long::sum);
                        }
                    }
                    if (changed) contentChangeCount++; else noOpCount++;
                    if (validationSampled < MAX_VALIDATION_SAMPLES) {
                        validationSampled++;
                        List<Long> candidates = auditIndex.get(compositeKey(decoded, keyColumns));
                        if (candidates == null || candidates.isEmpty()) noAuditCandidateCount++;
                        else if (entryTimestamp != null) {
                            long minimumDelta = Long.MAX_VALUE;
                            for (Long candidate : candidates) minimumDelta = Math.min(minimumDelta, Math.abs(candidate - entryTimestamp.getTime()));
                            lagMillisSamples.add(minimumDelta);
                            if (minimumDelta <= toleranceSeconds * 1000L) validationMatched++;
                        }
                    }
                }
            }
            for (Deque<PendingEntry> pending : pendingByJob.values()) unpaired += pending.size();
            Collections.sort(lagMillisSamples);
            double matchRate = validationSampled == 0 ? 0.0 : (double) validationMatched / validationSampled;
            String status = validationSampled >= MIN_VALIDATION_SAMPLE && matchRate < MIN_VALIDATION_MATCH_RATE ? "VALIDATION_FAILED" : "OK";

            StringBuilder json = new StringBuilder("{");
            json.append("\"status\":").append(jsonString(status));
            json.append(",\"entriesRead\":").append(entriesRead);
            json.append(",\"pairsFormed\":").append(pairsFormed);
            json.append(",\"unpairedCount\":").append(unpaired);
            json.append(",\"decodeErrors\":").append(decodeErrors);
            json.append(",\"keyValidation\":{\"sampled\":").append(validationSampled);
            json.append(",\"matched\":").append(validationMatched);
            json.append(",\"noAuditCandidateCount\":").append(noAuditCandidateCount);
            json.append(",\"lagStatsMs\":{\"count\":").append(lagMillisSamples.size());
            json.append(",\"min\":").append(lagMillisSamples.isEmpty() ? 0 : lagMillisSamples.get(0));
            json.append(",\"p50\":").append(percentile(lagMillisSamples, 0.50));
            json.append(",\"p90\":").append(percentile(lagMillisSamples, 0.90));
            json.append(",\"p99\":").append(percentile(lagMillisSamples, 0.99));
            json.append(",\"max\":").append(lagMillisSamples.isEmpty() ? 0 : lagMillisSamples.get(lagMillisSamples.size() - 1)).append("}");
            json.append(",\"matchRate\":").append(String.format(Locale.ROOT, "%.4f", matchRate)).append("}");
            json.append(",\"diff\":{\"noOpCount\":").append(noOpCount);
            json.append(",\"contentChangeCount\":").append(contentChangeCount).append(",\"changedColumnCounts\":{");
            boolean first = true;
            for (Map.Entry<String, Long> entry : changedColumnCounts.entrySet()) {
                if (!first) json.append(',');
                first = false;
                json.append(jsonString(entry.getKey())).append(':').append(entry.getValue());
            }
            json.append("}}");
            json.append(",\"warnings\":");
            if (warnings.isEmpty()) json.append("[]");
            else {
                json.append('[');
                for (int index = 0; index < warnings.size() && index < MAX_REPORTED_WARNINGS; index++) {
                    if (index > 0) json.append(',');
                    json.append(jsonString(warnings.get(index)));
                }
                json.append(']');
            }
            json.append('}');
            System.out.println(json);
            if ("VALIDATION_FAILED".equals(status)) System.exit(3);
        } catch (SQLException error) {
            System.err.println("Journal row diff failed: database query failed");
            System.exit(2);
        }
    }
}
