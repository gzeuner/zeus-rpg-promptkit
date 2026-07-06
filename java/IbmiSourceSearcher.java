
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
import com.ibm.as400.access.IFSFileReader;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * IbmiSourceSearcher — parallel, read-only full-text search over IBM i source
 * members via IFS.
 *
 * Usage:
 * java IbmiSourceSearcher <host> <user> <password> <sourceLib> <sourceFile>
 * <searchTerm> [maxResults] [progressFile] [threads]
 *
 * Searches all members of /QSYS.LIB/<sourceLib>.LIB/<sourceFile>.FILE/*.MBR
 * for the given search term (case-insensitive). Members are read with
 * IFSFileReader so each member's EBCDIC CCSID is converted to Unicode
 * correctly. Reads only — no objects on IBM i are created or modified.
 *
 * Multiple terms via pipe: "TERM1|TERM2" (OR logic, reported separately).
 *
 * Parallelism: a pool of worker threads, each with its own AS400 connection,
 * pulls members from a shared work index for dynamic load balancing.
 *
 * Intermediate results: when <progressFile> is given, every match and periodic
 * progress lines are appended (and flushed) to that file as the scan runs, so a
 * caller can observe partial results before the final JSON is emitted on
 * stdout.
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

    /** Thread-safe, line-buffered progress sink (file + stderr). */
    private static final class ProgressSink {
        private final Writer writer; // may be null
        private final Object lock = new Object();

        ProgressSink(String progressFile) {
            Writer w = null;
            if (progressFile != null && !progressFile.isEmpty()) {
                try {
                    w = new BufferedWriter(new OutputStreamWriter(
                            new FileOutputStream(progressFile, false), StandardCharsets.UTF_8));
                } catch (Exception ex) {
                    w = null;
                }
            }
            this.writer = w;
        }

        void line(String text) {
            synchronized (lock) {
                System.err.println(text);
                System.err.flush();
                if (writer != null) {
                    try {
                        writer.write(text);
                        writer.write('\n');
                        writer.flush();
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        void close() {
            synchronized (lock) {
                if (writer != null) {
                    try {
                        writer.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }
    }

    public static void main(String[] args) {
        if (args.length < 6) {
            System.err.println(
                    "Usage: java IbmiSourceSearcher <host> <user> <password> <sourceLib> <sourceFile> <searchTerm> [maxResults] [progressFile] [threads]");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        String sourceLib = args[3].toUpperCase();
        String sourceFile = args[4].toUpperCase();
        String searchTerm = args[5];
        int maxResults = args.length > 6 ? parseIntSafe(args[6], 500) : 500;
        String progressFile = args.length > 7 ? args[7] : null;
        int requestedThreads = args.length > 8 ? parseIntSafe(args[8], 0) : 0;

        // Support multiple terms separated by |
        String[] terms = searchTerm.split("\\|");
        final String[] lowerTerms = new String[terms.length];
        for (int i = 0; i < terms.length; i++) {
            lowerTerms[i] = terms[i].trim().toLowerCase();
        }

        ProgressSink progress = new ProgressSink(progressFile);
        final ConcurrentLinkedQueue<Match> matches = new ConcurrentLinkedQueue<>();
        final AtomicInteger matchCount = new AtomicInteger(0);
        final AtomicInteger scannedCount = new AtomicInteger(0);
        final AtomicInteger errorCount = new AtomicInteger(0);
        String errorMessage = null;
        int memberCount = 0;
        long t0 = System.currentTimeMillis();

        AS400 listSystem = null;
        try {
            listSystem = new AS400(host, user, password);
            String sourceFilePath = "/QSYS.LIB/" + sourceLib + ".LIB/" + sourceFile + ".FILE";
            IFSFile sourceFileDir = new IFSFile(listSystem, sourceFilePath);

            if (!sourceFileDir.exists()) {
                errorMessage = "Source file not found: " + sourceFilePath;
            } else {
                IFSFile[] members = sourceFileDir.listFiles("*.MBR");
                if (members == null) {
                    members = new IFSFile[0];
                }
                memberCount = members.length;

                int threads = requestedThreads > 0 ? requestedThreads : 16;
                if (threads > memberCount)
                    threads = Math.max(1, memberCount);

                progress.line("[start] " + now() + " members=" + memberCount + " threads=" + threads
                        + " terms=" + String.join("|", terms) + " maxResults=" + maxResults);

                final IFSFile[] memberList = members;
                final int total = memberCount;
                final int limit = maxResults;
                final AtomicInteger nextIndex = new AtomicInteger(0);
                final CountDownLatch done = new CountDownLatch(threads);

                for (int t = 0; t < threads; t++) {
                    Thread worker = new Thread(() -> {
                        AS400 sys = null;
                        try {
                            sys = new AS400(host, user, password);
                            while (matchCount.get() < limit) {
                                int idx = nextIndex.getAndIncrement();
                                if (idx >= total)
                                    break;
                                IFSFile member = memberList[idx];
                                try {
                                    searchMember(sys, member, lowerTerms, terms, matches, matchCount, limit, progress);
                                } catch (Exception ex) {
                                    errorCount.incrementAndGet();
                                }
                                int sc = scannedCount.incrementAndGet();
                                if (sc % 200 == 0 || sc == total) {
                                    progress.line("[progress] scanned=" + sc + "/" + total
                                            + " matches=" + matchCount.get());
                                }
                            }
                        } catch (Exception ex) {
                            errorCount.incrementAndGet();
                        } finally {
                            if (sys != null) {
                                try {
                                    sys.disconnectAllServices();
                                } catch (Exception ignored) {
                                }
                            }
                            done.countDown();
                        }
                    }, "searcher-" + t);
                    worker.start();
                }

                done.await();
            }
        } catch (Exception ex) {
            errorMessage = ex.getMessage();
        } finally {
            if (listSystem != null) {
                try {
                    listSystem.disconnectAllServices();
                } catch (Exception ignored) {
                }
            }
        }

        // Collect + sort for deterministic output
        List<Match> sorted = new ArrayList<>(matches);
        sorted.sort(Comparator
                .comparing((Match m) -> m.memberName == null ? "" : m.memberName)
                .thenComparingInt(m -> m.lineNumber)
                .thenComparing(m -> m.term == null ? "" : m.term));
        if (sorted.size() > maxResults) {
            sorted = new ArrayList<>(sorted.subList(0, maxResults));
        }

        long elapsedMs = System.currentTimeMillis() - t0;
        progress.line("[done] scanned=" + scannedCount.get() + "/" + memberCount
                + " matches=" + sorted.size() + " errors=" + errorCount.get()
                + " elapsedMs=" + elapsedMs);
        progress.close();

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
        json.append("\"scannedCount\":").append(scannedCount.get()).append(",");
        json.append("\"errorCount\":").append(errorCount.get()).append(",");
        json.append("\"matchCount\":").append(sorted.size()).append(",");
        json.append("\"elapsedMs\":").append(elapsedMs).append(",");
        json.append("\"truncated\":").append(sorted.size() >= maxResults ? "true" : "false").append(",");

        if (errorMessage != null) {
            json.append("\"error\":\"").append(escape(errorMessage)).append("\",");
        }

        json.append("\"matches\":[");
        for (int i = 0; i < sorted.size(); i++) {
            if (i > 0)
                json.append(",");
            Match m = sorted.get(i);
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
            ConcurrentLinkedQueue<Match> matches, AtomicInteger matchCount, int limit, ProgressSink progress)
            throws Exception {
        String memberPath = member.getPath();
        String memberName = member.getName();
        if (memberName.endsWith(".MBR")) {
            memberName = memberName.substring(0, memberName.length() - 4);
        }

        // Read the QSYS source member honoring its EBCDIC CCSID. IFSFileReader
        // converts from the member's CCSID to Unicode automatically; reading the
        // raw bytes as UTF-8 would misdecode EBCDIC and match nothing.
        //
        // Source members read via IFS arrive WITHOUT line terminators: the file
        // server returns fixed-width, space-padded records concatenated end to
        // end. splitMemberLines() reconstructs the individual records so line
        // numbers and snippets are correct.
        IFSFile target = new IFSFile(system, memberPath);
        StringBuilder content = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new IFSFileReader(target))) {
            char[] buf = new char[8192];
            int read;
            while ((read = reader.read(buf)) != -1) {
                content.append(buf, 0, read);
            }
        }

        String[] lines = splitMemberLines(content.toString());
        int lineNumber = 0;
        for (String line : lines) {
            if (matchCount.get() >= limit)
                break;
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
                    int total = matchCount.incrementAndGet();
                    progress.line("[hit] " + memberName + " L" + lineNumber + " <" + m.term + "> "
                            + line.trim());
                    if (total >= limit)
                        break;
                }
            }
        }
    }

    /**
     * Split a source member's raw content into individual records/lines.
     *
     * Members read via IFS may either contain real line separators (rare) or,
     * more commonly, arrive as fixed-width, space-padded records with no
     * delimiter. This method handles both: it first tries separator-based
     * splitting and falls back to fixed-width record splitting using a detected
     * record width.
     */
    private static String[] splitMemberLines(String content) {
        String[] bySep = content.split("\\r\\n|[\\r\\n\\u0085\\u2028\\u2029]", -1);
        if (bySep.length > 1) {
            return bySep;
        }
        int width = detectRecordWidth(content);
        if (width <= 0) {
            return bySep; // single line fallback (no reliable width)
        }
        int len = content.length();
        int count = (len + width - 1) / width;
        String[] out = new String[count];
        for (int i = 0; i < count; i++) {
            int start = i * width;
            int end = Math.min(start + width, len);
            out[i] = content.substring(start, end);
        }
        return out;
    }

    /**
     * Detect the fixed record width of a space-padded, delimiter-less source
     * member by testing common IBM i source record widths and scoring how often
     * the candidate's last column is a padding blank.
     */
    private static int detectRecordWidth(String content) {
        int len = content.length();
        if (len < 2) {
            return -1;
        }
        int[] candidates = { 100, 80, 92, 112, 120, 132, 150, 198, 240, 254, 79, 91 };
        int best = -1;
        double bestScore = -1.0;
        for (int w : candidates) {
            if (w < 2 || w > len || len % w != 0) {
                continue;
            }
            int recs = len / w;
            if (recs < 2) {
                continue;
            }
            int spaceEnds = 0;
            for (int r = 1; r <= recs; r++) {
                if (content.charAt(r * w - 1) == ' ') {
                    spaceEnds++;
                }
            }
            double score = (double) spaceEnds / recs;
            if (score > bestScore) {
                bestScore = score;
                best = w;
            }
        }
        return bestScore >= 0.6 ? best : -1;
    }

    private static int parseIntSafe(String value, int defaultValue) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
