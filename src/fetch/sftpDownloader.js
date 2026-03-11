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
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');

async function downloadDirectory({ host, user, password, remoteDir, localDir, verbose }) {
  const client = new SftpClient();
  let downloadedCount = 0;

  async function walk(remotePath, localPath) {
    fs.mkdirSync(localPath, { recursive: true });
    const entries = await client.list(remotePath);

    for (const entry of entries) {
      const remoteChild = path.posix.join(remotePath, entry.name);
      const localChild = path.join(localPath, entry.name);

      if (entry.type === 'd') {
        await walk(remoteChild, localChild);
      } else {
        if (verbose) {
          console.log(`[verbose] Downloading ${remoteChild} -> ${localChild}`);
        }
        await client.fastGet(remoteChild, localChild);
        downloadedCount += 1;
      }
    }
  }

  try {
    await client.connect({
      host,
      username: user,
      password,
      readyTimeout: 30000,
    });
    await walk(remoteDir, path.resolve(process.cwd(), localDir));
    return { downloadedCount };
  } finally {
    await client.end();
  }
}

module.exports = {
  downloadDirectory,
};

