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
import com.ibm.as400.access.AS400;
import com.ibm.as400.access.IFSFile;
import com.ibm.as400.access.IFSFileInputStream;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.time.Instant;

public class IbmiIfsDownloader {
    private static int downloadedCount = 0;

    private static String escape(String value) {
        if (value == null) return "";
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }

    private static void copyFile(AS400 system, String remotePath, File localFile) throws Exception {
        File parent = localFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        try (InputStream in = new IFSFileInputStream(system, remotePath);
             FileOutputStream out = new FileOutputStream(localFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                out.write(buffer, 0, read);
            }
        }
        downloadedCount += 1;
    }

    private static void walk(AS400 system, String remotePath, File localPath) throws Exception {
        IFSFile remote = new IFSFile(system, remotePath);
        if (!remote.exists()) {
            throw new Exception("Remote path does not exist: " + remotePath);
        }

        if (remote.isDirectory()) {
            if (!localPath.exists()) {
                localPath.mkdirs();
            }

            IFSFile[] children = remote.listFiles();
            if (children == null) return;

            for (IFSFile child : children) {
                String childRemotePath = child.getPath();
                File childLocalPath = new File(localPath, child.getName());
                walk(system, childRemotePath, childLocalPath);
            }
        } else {
            copyFile(system, remotePath, localPath);
        }
    }

    public static void main(String[] args) {
        if (args.length < 5) {
            System.err.println("Usage: java IbmiIfsDownloader <host> <user> <password> <remoteDir> <localDir>");
            System.exit(3);
        }

        String host = args[0];
        String user = args[1];
        String password = args[2];
        String remoteDir = args[3];
        String localDir = args[4];

        AS400 system = null;
        try {
            system = new AS400(host, user, password);
            walk(system, remoteDir, new File(localDir));

            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":true,");
            json.append("\"downloadedCount\":").append(downloadedCount).append(",");
            json.append("\"messages\":[],");
            json.append("\"timestamp\":\"").append(escape(Instant.now().toString())).append("\"");
            json.append("}");
            System.out.println(json.toString());
            System.exit(0);
        } catch (Exception ex) {
            StringBuilder json = new StringBuilder();
            json.append("{");
            json.append("\"ok\":false,");
            json.append("\"downloadedCount\":").append(downloadedCount).append(",");
            json.append("\"messages\":[\"").append(escape(ex.getMessage())).append("\"],");
            json.append("\"timestamp\":\"").append(escape(Instant.now().toString())).append("\"");
            json.append("}");
            System.out.println(json.toString());
            System.exit(3);
        } finally {
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

