
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
import com.ibm.as400.access.AS400Message;
import com.ibm.as400.access.CommandCall;
import com.ibm.as400.access.IFSFile;
import com.ibm.as400.access.IFSFileInputStream;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class IbmiCommandRunner {
    private static String escape(String value) {
        if (value == null)
            return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static String now() {
        return Instant.now().toString();
    }

    private static void appendJsonStringArray(StringBuilder json, String key, List<String> values) {
        json.append("\"").append(key).append("\":[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0)
                json.append(",");
            json.append("\"").append(escape(values.get(i))).append("\"");
        }
        json.append("]");
    }

    private static List<String> readCommandsFile(String commandFile) throws Exception {
        List<String> commands = new ArrayList<>();
        for (String line : Files.readAllLines(Paths.get(commandFile), Charset.forName("UTF-8"))) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) {
                commands.add(trimmed);
            }
        }
        return commands;
    }

    private static String readIfsText(AS400 system, String outputFile, String charsetName) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (IFSFileInputStream in = new IFSFileInputStream(system, outputFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                out.write(buffer, 0, read);
            }
        }
        return new String(out.toByteArray(), Charset.forName(charsetName));
    }

    private static List<String> collectMessages(CommandCall commandCall) {
        List<String> messages = new ArrayList<>();
        AS400Message[] messageList = commandCall.getMessageList();
        for (AS400Message messageEntry : messageList) {
            messages.add(messageEntry.getID() + " " + messageEntry.getText());
        }
        return messages;
    }

    private static String buildJson(
            boolean ok,
            List<String> commands,
            List<Boolean> commandStatuses,
            List<List<String>> commandMessages,
            String outputFile,
            String outputText,
            boolean outputFileDeleted,
            String errorMessage) {
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"ok\":").append(ok ? "true" : "false").append(",");
        if (commands.size() == 1) {
            json.append("\"command\":\"").append(escape(commands.get(0))).append("\",");
        }
        appendJsonStringArray(json, "commands", commands);
        json.append(",");
        json.append("\"results\":[");
        List<String> aggregateMessages = new ArrayList<>();
        for (int i = 0; i < commands.size(); i++) {
            if (i > 0)
                json.append(",");
            List<String> messages = i < commandMessages.size() ? commandMessages.get(i) : new ArrayList<>();
            aggregateMessages.addAll(messages);
            json.append("{");
            json.append("\"ok\":").append(commandStatuses.get(i) ? "true" : "false").append(",");
            json.append("\"command\":\"").append(escape(commands.get(i))).append("\",");
            appendJsonStringArray(json, "messages", messages);
            json.append("}");
        }
        json.append("],");
        if (errorMessage != null && !errorMessage.isEmpty()) {
            aggregateMessages.add(errorMessage);
        }
        appendJsonStringArray(json, "messages", aggregateMessages);
        json.append(",");
        if (outputFile != null && !outputFile.isEmpty()) {
            json.append("\"outputFile\":\"").append(escape(outputFile)).append("\",");
            json.append("\"outputFileDeleted\":").append(outputFileDeleted ? "true" : "false").append(",");
        }
        if (outputText != null) {
            json.append("\"outputText\":\"").append(escape(outputText)).append("\",");
            json.append("\"stdout\":\"").append(escape(outputText)).append("\",");
        }
        json.append("\"timestamp\":\"").append(escape(now())).append("\"");
        json.append("}");
        return json.toString();
    }

    public static void main(String[] args) {
        if (args.length < 4) {
            System.err.println("Usage: java IbmiCommandRunner <host> <user> <password> <clCommand>|--commands-file <path> [--output-file <ifsPath>] [--output-ccsid <charset>]");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = ZeusSecrets.resolve(args[2]);
        List<String> commands = new ArrayList<>();
        String outputFile = "";
        String outputCharset = "Cp037";
        boolean deleteOutputFile = false;

        try {
            for (int i = 3; i < args.length; i++) {
                String arg = args[i];
                if ("--commands-file".equals(arg)) {
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException("--commands-file requires a path");
                    }
                    commands.addAll(readCommandsFile(args[++i]));
                } else if ("--command".equals(arg)) {
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException("--command requires a command value");
                    }
                    commands.add(args[++i]);
                } else if ("--output-file".equals(arg)) {
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException("--output-file requires an IFS path");
                    }
                    outputFile = args[++i];
                } else if ("--output-ccsid".equals(arg) || "--output-charset".equals(arg)) {
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException(arg + " requires a charset name");
                    }
                    outputCharset = args[++i];
                } else if ("--delete-output-file".equals(arg)) {
                    if (i + 1 >= args.length) {
                        throw new IllegalArgumentException("--delete-output-file requires true or false");
                    }
                    deleteOutputFile = "true".equalsIgnoreCase(args[++i]);
                } else {
                    commands.add(arg);
                }
            }

            if (commands.isEmpty()) {
                throw new IllegalArgumentException("At least one command is required");
            }
        } catch (Exception ex) {
            List<Boolean> statuses = new ArrayList<>();
            List<List<String>> messageLists = new ArrayList<>();
            for (int i = 0; i < Math.max(1, commands.size()); i++) {
                statuses.add(false);
                messageLists.add(new ArrayList<>());
            }
            if (commands.isEmpty()) {
                commands.add("");
            }
            System.out.println(buildJson(false, commands, statuses, messageLists, outputFile, null, false, ex.getMessage()));
            System.exit(3);
        }

        AS400 system = null;
        try {
            system = new AS400(host, user, password);
            CommandCall commandCall = new CommandCall(system);

            boolean allOk = true;
            List<Boolean> statuses = new ArrayList<>();
            List<List<String>> messageLists = new ArrayList<>();

            for (String command : commands) {
                boolean ok = commandCall.run(command);
                statuses.add(ok);
                messageLists.add(collectMessages(commandCall));
                if (!ok) {
                    allOk = false;
                    for (int j = statuses.size(); j < commands.size(); j++) {
                        statuses.add(false);
                        List<String> skippedMessages = new ArrayList<>();
                        skippedMessages.add("Skipped because a previous command failed.");
                        messageLists.add(skippedMessages);
                    }
                    break;
                }
            }

            String outputText = null;
            boolean outputFileDeleted = false;
            if (outputFile != null && !outputFile.isEmpty()) {
                outputText = readIfsText(system, outputFile, outputCharset);
                if (deleteOutputFile) {
                    outputFileDeleted = new IFSFile(system, outputFile).delete();
                }
            }

            System.out.println(buildJson(allOk, commands, statuses, messageLists, outputFile, outputText, outputFileDeleted, null));
            if (allOk) {
                System.exit(0);
            } else {
                System.exit(2);
            }
        } catch (Exception ex) {
            List<Boolean> statuses = new ArrayList<>();
            List<List<String>> messageLists = new ArrayList<>();
            for (int i = 0; i < commands.size(); i++) {
                statuses.add(false);
                messageLists.add(new ArrayList<>());
            }
            System.out.println(buildJson(false, commands, statuses, messageLists, outputFile, null, false, ex.getMessage()));
            System.exit(3);
        } finally {
            if (system != null) {
                try {
                    system.disconnectAllServices();
                } catch (Exception ignored) {
                    // Nothing to do
                }
            }
        }
    }
}
