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
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('ssh2');
const { OPEN_MODE, STATUS_CODE } = require('ssh2/lib/protocol/SFTP');

const USER = 'embedded-e2e';
const PASSWORD = 'embedded-e2e-password-only';
const REMOTE_ROOT = '/incoming';
const HANDLE_PREFIX = 'zeus-embedded-';

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeRemotePath(remotePath) {
  const raw = String(remotePath || '').replace(/\\/g, '/');
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : '/' + raw);
  return normalized === '.' ? '/' : normalized;
}

function createFileAttributes(stat) {
  return {
    mode: stat.mode,
    uid: 1000,
    gid: 1000,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  };
}

function fileError(error) {
  if (error && error.code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE;
  if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
    return STATUS_CODE.PERMISSION_DENIED;
  }
  return STATUS_CODE.FAILURE;
}

function isWriteRequest(flags) {
  return Boolean(
    flags &
    (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.CREAT | OPEN_MODE.TRUNC | OPEN_MODE.EXCL)
  );
}

function createHandle(prefix, value) {
  return Buffer.from(HANDLE_PREFIX + prefix + ':' + value);
}

function handleKey(handle) {
  return Buffer.isBuffer(handle) ? handle.toString('utf8') : '';
}

function createEmbeddedSftpServer({ fixtureRoot }) {
  const resolvedFixtureRoot = path.resolve(fixtureRoot);
  const handles = new Map();
  const clients = new Set();
  const serverKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
  });

  function resolveRemotePath(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    if (normalized !== REMOTE_ROOT && !normalized.startsWith(REMOTE_ROOT + '/')) {
      const error = new Error('Remote path is outside the embedded fixture root.');
      error.code = 'EOUTSIDE_FIXTURE';
      throw error;
    }
    const relative = normalized.slice(REMOTE_ROOT.length).replace(/^\/+/, '');
    const candidate = path.resolve(resolvedFixtureRoot, relative);
    const relativeToRoot = path.relative(resolvedFixtureRoot, candidate);
    if (
      relativeToRoot === '..' ||
      relativeToRoot.startsWith('..' + path.sep) ||
      path.isAbsolute(relativeToRoot)
    ) {
      const error = new Error('Remote path is outside the embedded fixture root.');
      error.code = 'EOUTSIDE_FIXTURE';
      throw error;
    }
    return { normalized, candidate };
  }

  function sendError(sftp, requestId, error) {
    sftp.status(
      requestId,
      fileError(error),
      error && error.message ? error.message : 'SFTP fixture error'
    );
  }

  function registerSftpSession(session) {
    session.on('sftp', (accept, _reject) => {
      const sftp = accept();

      sftp.on('OPEN', async (requestId, remotePath, flags) => {
        if (isWriteRequest(flags)) {
          sftp.status(requestId, STATUS_CODE.PERMISSION_DENIED, 'Embedded fixture is read-only.');
          return;
        }
        try {
          const { candidate } = resolveRemotePath(remotePath);
          const stat = await fs.promises.stat(candidate);
          if (!stat.isFile()) {
            const error = new Error('Requested path is not a file.');
            error.code = 'EISDIR';
            throw error;
          }
          const fileHandle = await fs.promises.open(candidate, 'r');
          const handle = createHandle('file', String(fileHandle.fd));
          handles.set(handleKey(handle), { type: 'file', fileHandle });
          sftp.handle(requestId, handle);
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });

      sftp.on('READ', async (requestId, handle, offset, length) => {
        const entry = handles.get(handleKey(handle));
        if (!entry || entry.type !== 'file') {
          sftp.status(requestId, STATUS_CODE.FAILURE, 'Invalid embedded fixture file handle.');
          return;
        }
        try {
          const buffer = Buffer.alloc(Math.max(0, Number(length) || 0));
          const result = await entry.fileHandle.read(buffer, 0, buffer.length, Number(offset) || 0);
          if (!result.bytesRead) {
            sftp.status(requestId, STATUS_CODE.EOF, 'End of file.');
          } else {
            sftp.data(requestId, buffer.subarray(0, result.bytesRead));
          }
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });

      sftp.on('FSTAT', async (requestId, handle) => {
        const entry = handles.get(handleKey(handle));
        if (!entry || entry.type !== 'file') {
          sftp.status(requestId, STATUS_CODE.FAILURE, 'Invalid embedded fixture file handle.');
          return;
        }
        try {
          const stat = await entry.fileHandle.stat();
          sftp.attrs(requestId, createFileAttributes(stat));
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });

      sftp.on('CLOSE', async (requestId, handle) => {
        const key = handleKey(handle);
        const entry = handles.get(key);
        handles.delete(key);
        if (!entry) {
          sftp.status(requestId, STATUS_CODE.FAILURE, 'Invalid embedded fixture handle.');
          return;
        }
        try {
          if (entry.fileHandle) await entry.fileHandle.close();
          sftp.status(requestId, STATUS_CODE.OK);
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });

      sftp.on('OPENDIR', async (requestId, remotePath) => {
        try {
          const { candidate } = resolveRemotePath(remotePath);
          const stat = await fs.promises.stat(candidate);
          if (!stat.isDirectory()) {
            const error = new Error('Requested path is not a directory.');
            error.code = 'ENOTDIR';
            throw error;
          }
          const names = await fs.promises.readdir(candidate);
          const entries = await Promise.all(
            names.map(async name => {
              const entryStat = await fs.promises.stat(path.join(candidate, name));
              return {
                filename: name,
                longname:
                  (entryStat.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--') +
                  ' 1 embedded embedded ' +
                  String(entryStat.size).padStart(8, ' ') +
                  ' Jan 01 00:00 ' +
                  name,
                attrs: createFileAttributes(entryStat),
              };
            })
          );
          const handle = createHandle('dir', String(handles.size));
          handles.set(handleKey(handle), { type: 'dir', entries, index: 0 });
          sftp.handle(requestId, handle);
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });

      sftp.on('READDIR', (requestId, handle) => {
        const entry = handles.get(handleKey(handle));
        if (!entry || entry.type !== 'dir') {
          sftp.status(requestId, STATUS_CODE.FAILURE, 'Invalid embedded fixture directory handle.');
          return;
        }
        if (entry.index >= entry.entries.length) {
          sftp.status(requestId, STATUS_CODE.EOF, 'End of directory.');
          return;
        }
        const batch = entry.entries.slice(entry.index, entry.index + 50);
        entry.index += batch.length;
        sftp.name(requestId, batch);
      });

      for (const eventName of [
        'REMOVE',
        'RMDIR',
        'SETSTAT',
        'FSETSTAT',
        'MKDIR',
        'RENAME',
        'SYMLINK',
        'LINK',
      ]) {
        sftp.on(eventName, requestId => {
          sftp.status(requestId, STATUS_CODE.PERMISSION_DENIED, 'Embedded fixture is read-only.');
        });
      }

      for (const eventName of ['STAT', 'LSTAT']) {
        sftp.on(eventName, async (requestId, remotePath) => {
          try {
            const { candidate } = resolveRemotePath(remotePath);
            const stat = await fs.promises.stat(candidate);
            sftp.attrs(requestId, createFileAttributes(stat));
          } catch (error) {
            sendError(sftp, requestId, error);
          }
        });
      }

      sftp.on('REALPATH', (requestId, remotePath) => {
        try {
          const normalized = normalizeRemotePath(remotePath);
          if (normalized === '/') {
            sftp.name(requestId, [{ filename: '/', longname: '/' }]);
            return;
          }
          resolveRemotePath(normalized);
          sftp.name(requestId, [{ filename: normalized, longname: normalized }]);
        } catch (error) {
          sendError(sftp, requestId, error);
        }
      });
    });
  }

  const server = new Server({ hostKeys: [serverKey] }, client => {
    clients.add(client);
    client
      .on('authentication', context => {
        if (
          context.method === 'password' &&
          timingSafeEqualText(context.username, USER) &&
          timingSafeEqualText(context.password, PASSWORD)
        ) {
          context.accept();
        } else {
          context.reject();
        }
      })
      .on('ready', () => {
        client.on('session', accept => registerSftpSession(accept()));
      })
      .on('close', () => clients.delete(client))
      .on('error', () => {});
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      server.unref();
      return server.address().port;
    },
    async close() {
      for (const client of clients) {
        if (client._sock && typeof client._sock.destroy === 'function') {
          client._sock.destroy();
        } else if (typeof client.end === 'function') {
          client.end();
        }
      }
      for (const entry of handles.values()) {
        if (entry.fileHandle) await entry.fileHandle.close().catch(() => {});
      }
      handles.clear();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}

async function startEmbeddedSftpFixture({ fixtureRoot }) {
  const fixture = createEmbeddedSftpServer({ fixtureRoot });
  const port = await fixture.listen();
  return {
    host: '127.0.0.1',
    port,
    user: USER,
    password: PASSWORD,
    remoteRoot: REMOTE_ROOT,
    mode: 'embedded-node-ssh2',
    async close() {
      await fixture.close();
    },
  };
}

module.exports = {
  PASSWORD,
  USER,
  REMOTE_ROOT,
  startEmbeddedSftpFixture,
};
