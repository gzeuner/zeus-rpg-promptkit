const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const { fetchSources } = require('../src/fetch/fetchService');
const { downloadDirectoryViaFtp } = require('../src/fetch/ftpDownloader');
const { IMPORT_MANIFEST_FILE } = require('../src/fetch/importManifest');

function ignoreFixtureConnectionReset(error) {
  if (error.code !== 'ECONNRESET') throw error;
}

async function createLocalFtpFixture(fileName = 'PROGRAM_001.rpgle') {
  const content = '**FREE\nDCL-F TABLE_001 DISK;\n';
  const commands = [];
  const controlServer = net.createServer(socket => {
    let buffer = '';
    let passive = null;
    socket.setEncoding('utf8');
    socket.on('error', ignoreFixtureConnectionReset);
    socket.write('220 Local fixture ready\r\n');

    async function handle(line) {
      commands.push(line);
      const command = line.split(' ')[0].toUpperCase();
      if (command === 'USER') return socket.write('331 Password required\r\n');
      if (command === 'PASS') return socket.write('230 Logged in\r\n');
      if (command === 'FEAT') return socket.write('211-Features\r\n211 End\r\n');
      if (['OPTS', 'TYPE', 'STRU'].includes(command)) return socket.write('200 OK\r\n');
      if (command === 'EPSV') {
        const transfer = {};
        transfer.socket = new Promise(resolve => (transfer.resolve = resolve));
        const dataServer = net.createServer(dataSocket => {
          dataSocket.on('error', ignoreFixtureConnectionReset);
          transfer.resolve(dataSocket);
        });
        transfer.server = dataServer;
        passive = transfer;
        await new Promise(resolve => dataServer.listen(0, '127.0.0.1', resolve));
        return socket.write(
          `229 Entering Extended Passive Mode (|||${dataServer.address().port}|)\r\n`
        );
      }
      if (command === 'LIST' || command === 'RETR') {
        if (!passive) return socket.write('425 No data connection\r\n');
        const transfer = passive;
        passive = null;
        socket.write('150 Opening data connection\r\n');
        const dataSocket = await transfer.socket;
        const listing = line.includes('QRPGLESRC')
          ? `-rw-r--r-- 1 owner group ${Buffer.byteLength(content)} Jan 01 12:00 ${fileName}\r\n`
          : 'drwxr-xr-x 1 owner group 0 Jan 01 12:00 QRPGLESRC\r\n';
        dataSocket.end(command === 'RETR' ? content : listing);
        dataSocket.once('close', () => {
          transfer.server.close();
          socket.write('226 Transfer complete\r\n');
        });
        return;
      }
      if (command === 'QUIT') return socket.end('221 Bye\r\n');
      socket.write('500 Unsupported fixture command\r\n');
    }

    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        void handle(line).catch(error => socket.destroy(error));
      }
    });
  });
  await new Promise(resolve => controlServer.listen(0, '127.0.0.1', resolve));
  return {
    port: controlServer.address().port,
    commands,
    close: () => new Promise(resolve => controlServer.close(resolve)),
  };
}

function buildFetchOptions(outDir, overrides = {}) {
  return {
    host: 'fixture.example.com',
    user: 'FIXUSER',
    password: 'FIXPASSWORD',
    sourceLib: 'FIXLIB',
    ifsDir: '/tmp/zeus_fixture/exported_source',
    out: outDir,
    files: ['QRPGLESRC'],
    members: ['PROGRAM_001'],
    replace: true,
    transport: 'auto',
    streamFileCcsid: 1208,
    verbose: false,
    ...overrides,
  };
}

function buildExportResult() {
  return [
    {
      sourceFile: 'QRPGLESRC',
      member: 'PROGRAM_001',
      ok: true,
      command: 'CPYTOSTMF ...',
      messages: [],
      stderr: '',
      fallbackUsed: false,
    },
  ];
}

function readManifest(outDir) {
  return JSON.parse(fs.readFileSync(path.join(outDir, IMPORT_MANIFEST_FILE), 'utf8'));
}

function writeDownloadedSource(params, content) {
  const filePath = path.join(params.localDir, 'QRPGLESRC', 'PROGRAM_001.rpgle');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return { downloadedCount: 1 };
}

test('fetchSources records the direct sftp transport contract with CRLF-normalized Windows-readable output', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-sftp-contract-'));
  const outDir = path.join(tempRoot, 'rpg_sources');
  let sftpCalls = 0;
  let jt400Calls = 0;
  let ftpCalls = 0;

  try {
    const summary = await fetchSources(buildFetchOptions(outDir, { transport: 'sftp' }), {
      exportMembersForSourceFileFn() {
        return buildExportResult();
      },
      async downloadDirectoryFn(params) {
        sftpCalls += 1;
        return writeDownloadedSource(
          params,
          Buffer.from('**FREE\r\nDCL-F TABLE_001 DISK;\r\n', 'utf8')
        );
      },
      async downloadDirectoryViaJt400Fn() {
        jt400Calls += 1;
        throw new Error('jt400 should not be used');
      },
      async downloadDirectoryViaFtpFn() {
        ftpCalls += 1;
        throw new Error('ftp should not be used');
      },
    });

    const manifest = readManifest(outDir);
    assert.equal(summary.transportUsed, 'sftp');
    assert.equal(summary.encodingPolicy, 'UTF-8 stream files (CCSID 1208)');
    assert.equal(manifest.transportRequested, 'sftp');
    assert.equal(manifest.transportUsed, 'sftp');
    assert.equal(manifest.streamFileCcsid, 1208);
    assert.equal(manifest.files[0].utf8Valid, true);
    assert.equal(manifest.files[0].newlineStyle, 'CRLF');
    assert.equal(manifest.files[0].validationStatus, 'ok');
    assert.equal(manifest.summary.invalidFileCount, 0);
    assert.equal(manifest.summary.warningCount, 0);
    assert.equal(sftpCalls, 1);
    assert.equal(jt400Calls, 0);
    assert.equal(ftpCalls, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('fetchSources falls back from sftp to jt400 and preserves the UTF-8 manifest contract', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-jt400-contract-'));
  const outDir = path.join(tempRoot, 'rpg_sources');
  let sftpCalls = 0;
  let jt400Calls = 0;
  let ftpCalls = 0;

  try {
    const summary = await fetchSources(buildFetchOptions(outDir, { transport: 'auto' }), {
      exportMembersForSourceFileFn() {
        return buildExportResult();
      },
      async downloadDirectoryFn() {
        sftpCalls += 1;
        throw new Error('SFTP unavailable for fixture');
      },
      async downloadDirectoryViaJt400Fn(params) {
        jt400Calls += 1;
        return writeDownloadedSource(
          params,
          Buffer.from('**FREE\nDCL-F TABLE_001 DISK;\n', 'utf8')
        );
      },
      async downloadDirectoryViaFtpFn() {
        ftpCalls += 1;
        throw new Error('ftp should not be used');
      },
    });

    const manifest = readManifest(outDir);
    assert.equal(summary.transportUsed, 'jt400');
    assert.ok(
      summary.notes.some(
        note => note.includes('sftp') && note.includes('SFTP unavailable for fixture')
      )
    );
    assert.equal(manifest.transportRequested, 'auto');
    assert.equal(manifest.transportUsed, 'jt400');
    assert.equal(manifest.files[0].utf8Valid, true);
    assert.equal(manifest.files[0].newlineStyle, 'LF');
    assert.equal(manifest.files[0].validationStatus, 'ok');
    assert.equal(manifest.summary.invalidFileCount, 0);
    assert.equal(sftpCalls, 1);
    assert.equal(jt400Calls, 1);
    assert.equal(ftpCalls, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('fetchSources falls back to ftp and records mixed newline diagnostics in the import manifest', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-ftp-contract-'));
  const outDir = path.join(tempRoot, 'rpg_sources');
  let sftpCalls = 0;
  let jt400Calls = 0;
  let ftpCalls = 0;

  try {
    const summary = await fetchSources(
      buildFetchOptions(outDir, { transport: 'auto', port: 2121 }),
      {
        exportMembersForSourceFileFn() {
          return buildExportResult();
        },
        async downloadDirectoryFn() {
          sftpCalls += 1;
          throw new Error('SFTP unavailable for fixture');
        },
        async downloadDirectoryViaJt400Fn() {
          jt400Calls += 1;
          throw new Error('JT400 unavailable for fixture');
        },
        async downloadDirectoryViaFtpFn(params) {
          ftpCalls += 1;
          assert.equal(params.port, 2121);
          return writeDownloadedSource(
            params,
            Buffer.from('**FREE\r\nDCL-F TABLE_001 DISK;\n', 'utf8')
          );
        },
      }
    );

    const manifest = readManifest(outDir);
    assert.equal(summary.transportUsed, 'ftp');
    assert.ok(
      summary.notes.some(
        note => note.includes('sftp') && note.includes('SFTP unavailable for fixture')
      )
    );
    assert.ok(
      summary.notes.some(
        note => note.includes('jt400') && note.includes('JT400 unavailable for fixture')
      )
    );
    assert.equal(manifest.transportUsed, 'ftp');
    assert.equal(manifest.files[0].utf8Valid, true);
    assert.equal(manifest.files[0].newlineStyle, 'MIXED');
    assert.equal(manifest.files[0].validationStatus, 'warning');
    assert.match(manifest.files[0].validationMessages.join('\n'), /Mixed newline styles detected/);
    assert.equal(manifest.summary.invalidFileCount, 0);
    assert.equal(manifest.summary.warningCount, 1);
    assert.equal(sftpCalls, 1);
    assert.equal(jt400Calls, 1);
    assert.equal(ftpCalls, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('patched FTP client downloads a source member from a local server on the configured port', async () => {
  const fixture = await createLocalFtpFixture();
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-real-ftp-'));

  try {
    const result = await downloadDirectoryViaFtp({
      host: '127.0.0.1',
      port: fixture.port,
      user: 'test',
      password: 'test',
      remoteDir: '/export',
      localDir,
      verbose: false,
    });
    assert.equal(result.downloadedCount, 1);
    assert.equal(
      fs.readFileSync(path.join(localDir, 'QRPGLESRC', 'PROGRAM_001.rpgle'), 'utf8'),
      '**FREE\nDCL-F TABLE_001 DISK;\n'
    );
    assert.ok(fixture.commands.some(command => command.startsWith('LIST')));
    assert.ok(fixture.commands.some(command => command.startsWith('RETR')));
  } finally {
    await fixture.close();
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});

test('FTP download rejects a listed member name that escapes the local directory', async () => {
  const fixture = await createLocalFtpFixture('../escape.rpgle');
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-ftp-unsafe-'));

  try {
    await assert.rejects(
      downloadDirectoryViaFtp({
        host: '127.0.0.1',
        port: fixture.port,
        user: 'test',
        password: 'test',
        remoteDir: '/export',
        localDir,
        verbose: false,
      }),
      /unsafe member name/
    );
    assert.equal(fs.existsSync(path.join(localDir, 'escape.rpgle')), false);
  } finally {
    await fixture.close();
    fs.rmSync(localDir, { recursive: true, force: true });
  }
});

test('fetchSources records invalid UTF-8 output as an invalid imported source contract', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-invalid-utf8-'));
  const outDir = path.join(tempRoot, 'rpg_sources');
  let jt400Calls = 0;

  try {
    const summary = await fetchSources(buildFetchOptions(outDir, { transport: 'jt400' }), {
      exportMembersForSourceFileFn() {
        return buildExportResult();
      },
      async downloadDirectoryFn() {
        throw new Error('sftp should not be used');
      },
      async downloadDirectoryViaJt400Fn(params) {
        jt400Calls += 1;
        return writeDownloadedSource(params, Buffer.from([0xc3, 0x28]));
      },
      async downloadDirectoryViaFtpFn() {
        throw new Error('ftp should not be used');
      },
    });

    const manifest = readManifest(outDir);
    assert.equal(summary.transportUsed, 'jt400');
    assert.equal(manifest.transportRequested, 'jt400');
    assert.equal(manifest.transportUsed, 'jt400');
    assert.equal(manifest.files[0].utf8Valid, false);
    assert.equal(manifest.files[0].newlineStyle, 'UNKNOWN');
    assert.equal(manifest.files[0].validationStatus, 'invalid');
    assert.match(
      manifest.files[0].validationMessages.join('\n'),
      /Invalid UTF-8 source encoding detected/
    );
    assert.equal(manifest.summary.invalidFileCount, 1);
    assert.equal(jt400Calls, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
