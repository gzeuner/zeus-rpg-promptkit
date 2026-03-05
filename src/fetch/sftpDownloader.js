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

