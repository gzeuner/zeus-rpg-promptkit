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
const ftp = require('basic-ftp');

async function downloadDirectoryViaFtp({
  host,
  user,
  password,
  remoteDir,
  localDir,
  verbose,
}) {
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;
  let downloadedCount = 0;

  async function walk(remotePath, localPath) {
    fs.mkdirSync(localPath, { recursive: true });
    const list = await client.list(remotePath);

    for (const entry of list) {
      const remoteChild = path.posix.join(remotePath, entry.name);
      const localChild = path.join(localPath, entry.name);
      const isDirectory = entry.isDirectory === true
        || entry.type === 2
        || String(entry.permissions || '').startsWith('d');

      if (isDirectory) {
        await walk(remoteChild, localChild);
      } else {
        if (verbose) {
          console.log(`[verbose] FTP download ${remoteChild} -> ${localChild}`);
        }
        await client.downloadTo(localChild, remoteChild);
        downloadedCount += 1;
      }
    }
  }

  try {
    await client.access({
      host,
      user,
      password,
      secure: false,
    });
    await walk(remoteDir, path.resolve(process.cwd(), localDir));
    return { downloadedCount };
  } finally {
    client.close();
  }
}

module.exports = {
  downloadDirectoryViaFtp,
};
