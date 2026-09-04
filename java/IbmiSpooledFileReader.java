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

import com.ibm.as400.access.AS400;
import com.ibm.as400.access.PrintObject;
import com.ibm.as400.access.PrintObjectInputStream;
import com.ibm.as400.access.SpooledFile;
import com.ibm.as400.access.SpooledFileList;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;

public class IbmiSpooledFileReader {
    private static final int MAX_MAX_BYTES = 4 * 1024 * 1024;

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder escaped = new StringBuilder();
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '\\':
                    escaped.append("\\\\");
                    break;
                case '"':
                    escaped.append("\\\"");
                    break;
                case '\b':
                    escaped.append("\\b");
                    break;
                case '\f':
                    escaped.append("\\f");
                    break;
                case '\n':
                    escaped.append("\\n");
                    break;
                case '\r':
                    escaped.append("\\r");
                    break;
                case '\t':
                    escaped.append("\\t");
                    break;
                default:
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
            }
        }
        return escaped.toString();
    }

    private static String normalize(String value) {
        return String.valueOf(value == null ? "" : value).trim().toUpperCase();
    }

    private static int parsePositiveInt(String value, String label, int maximum) {
        try {
            int parsed = Integer.parseInt(String.valueOf(value).trim());
            if (parsed <= 0 || parsed > maximum) {
                throw new IllegalArgumentException(label + " must be between 1 and " + maximum);
            }
            return parsed;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(label + " must be a positive integer");
        }
    }

    private static SpoolContent readSpoolContent(SpooledFile spooledFile, Charset charset, int maxBytes)
            throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        boolean truncated = false;

        try (PrintObjectInputStream input = spooledFile.getInputStream()) {
            int read;
            while (output.size() < maxBytes
                    && (read = input.read(buffer, 0, Math.min(buffer.length, maxBytes - output.size()))) > 0) {
                output.write(buffer, 0, read);
            }
            if (output.size() >= maxBytes && input.read(buffer, 0, 1) > 0) {
                truncated = true;
            }
        }

        return new SpoolContent(new String(output.toByteArray(), charset), truncated);
    }

    private static boolean matches(SpooledFile spooledFile, String jobNumber, String jobUser, String jobName,
            String spoolFileName, Integer spoolNumber) {
        if (!normalize(spooledFile.getJobNumber()).equals(normalize(jobNumber))
                || !normalize(spooledFile.getJobUser()).equals(normalize(jobUser))
                || !normalize(spooledFile.getJobName()).equals(normalize(jobName))
                || !normalize(spooledFile.getName()).equals(normalize(spoolFileName))) {
            return false;
        }
        return spoolNumber == null || spooledFile.getNumber() == spoolNumber.intValue();
    }

    private static SpoolMatch readSpoolMatch(SpooledFile spooledFile, Charset charset, int maxBytes)
            throws Exception {
        return new SpoolMatch(
                spooledFile.getJobNumber(),
                spooledFile.getJobUser(),
                spooledFile.getJobName(),
                spooledFile.getName(),
                spooledFile.getNumber(),
                readSpoolContent(spooledFile, charset, maxBytes));
    }

    private static String toJson(boolean ok, List<SpoolMatch> matches, String errorMessage) {
        StringBuilder json = new StringBuilder();
        json.append("{\"ok\":").append(ok ? "true" : "false");
        json.append(",\"found\":").append(matches.isEmpty() ? "false" : "true");
        json.append(",\"matches\":[");
        for (int index = 0; index < matches.size(); index++) {
            if (index > 0) {
                json.append(",");
            }
            SpoolMatch match = matches.get(index);
            json.append("{\"jobNumber\":\"").append(escape(match.jobNumber)).append("\",");
            json.append("\"jobUser\":\"").append(escape(match.jobUser)).append("\",");
            json.append("\"jobName\":\"").append(escape(match.jobName)).append("\",");
            json.append("\"spoolFileName\":\"").append(escape(match.spoolFileName)).append("\",");
            json.append("\"spoolFileNumber\":").append(match.spoolFileNumber).append(",");
            json.append("\"truncated\":").append(match.content.truncated ? "true" : "false").append(",");
            json.append("\"text\":\"").append(escape(match.content.text)).append("\"}");
        }
        json.append("]");
        if (errorMessage != null && !errorMessage.isEmpty()) {
            json.append(",\"error\":\"").append(escape(errorMessage)).append("\"");
        }
        json.append(",\"timestamp\":\"").append(escape(Instant.now().toString())).append("\"}");
        return json.toString();
    }

    public static void main(String[] args) {
        if (args.length != 10) {
            System.err.println(
                    "Usage: java IbmiSpooledFileReader <host> <user> <password> <jobNumber> <jobUser> <jobName> <spoolFileName> <spoolFileNumber|-> <charset> <maxBytes>");
            System.exit(3);
        }

        AS400 system = null;
        SpooledFileList spoolList = null;
        try {
            String host = args[0];
            String user = args[1];
            String password = ZeusSecrets.resolve(args[2]);
            String jobNumber = args[3];
            String jobUser = args[4];
            String jobName = args[5];
            String spoolFileName = args[6];
            Integer spoolFileNumber = "-".equals(args[7])
                    ? null
                    : Integer.valueOf(parsePositiveInt(args[7], "spoolFileNumber", Integer.MAX_VALUE));
            Charset charset = Charset.forName(args[8]);
            int maxBytes = parsePositiveInt(args[9], "maxBytes", MAX_MAX_BYTES);

            if (normalize(jobNumber).isEmpty() || normalize(jobUser).isEmpty() || normalize(jobName).isEmpty()
                    || normalize(spoolFileName).isEmpty()) {
                throw new IllegalArgumentException("jobNumber, jobUser, jobName, and spoolFileName are required");
            }

            system = new AS400(host, user, password);
            List<SpoolMatch> matches = new ArrayList<>();
            if (spoolFileNumber != null) {
                SpooledFile spooledFile = new SpooledFile(
                        system,
                        spoolFileName,
                        spoolFileNumber.intValue(),
                        jobName,
                        jobUser,
                        jobNumber);
                matches.add(readSpoolMatch(spooledFile, charset, maxBytes));
            } else {
                spoolList = new SpooledFileList(system);
                spoolList.setUserFilter(normalize(jobUser));
                spoolList.openSynchronously();

                Enumeration objects = spoolList.getObjects();
                while (objects.hasMoreElements()) {
                    PrintObject printObject = (PrintObject) objects.nextElement();
                    if (!(printObject instanceof SpooledFile)) {
                        continue;
                    }
                    SpooledFile spooledFile = (SpooledFile) printObject;
                    if (!matches(spooledFile, jobNumber, jobUser, jobName, spoolFileName, spoolFileNumber)) {
                        continue;
                    }
                    matches.add(readSpoolMatch(spooledFile, charset, maxBytes));
                }
            }

            matches.sort((left, right) -> Integer.compare(left.spoolFileNumber, right.spoolFileNumber));

            System.out.println(toJson(true, matches, null));
            System.exit(0);
        } catch (Exception ex) {
            System.out.println(toJson(false, new ArrayList<>(), ex.getMessage()));
            System.exit(3);
        } finally {
            if (spoolList != null) {
                spoolList.close();
            }
            if (system != null) {
                try {
                    system.disconnectAllServices();
                } catch (Exception ignored) {
                    // Nothing to do
                }
            }
        }
    }

    private static final class SpoolContent {
        private final String text;
        private final boolean truncated;

        private SpoolContent(String text, boolean truncated) {
            this.text = text;
            this.truncated = truncated;
        }
    }

    private static final class SpoolMatch {
        private final String jobNumber;
        private final String jobUser;
        private final String jobName;
        private final String spoolFileName;
        private final int spoolFileNumber;
        private final SpoolContent content;

        private SpoolMatch(String jobNumber, String jobUser, String jobName, String spoolFileName,
                int spoolFileNumber, SpoolContent content) {
            this.jobNumber = jobNumber;
            this.jobUser = jobUser;
            this.jobName = jobName;
            this.spoolFileName = spoolFileName;
            this.spoolFileNumber = spoolFileNumber;
            this.content = content;
        }
    }
}
