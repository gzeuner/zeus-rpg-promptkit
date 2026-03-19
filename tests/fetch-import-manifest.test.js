const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchSources } = require('../src/fetch/fetchService');
const { IMPORT_MANIFEST_FILE } = require('../src/fetch/importManifest');

test('fetchSources writes an import manifest with validated downloaded files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-fetch-manifest-'));
  const outDir = path.join(tempRoot, 'rpg_sources');

  try {
    const summary = await fetchSources({
      host: 'myibmi.example.com',
      user: 'MYUSER',
      password: 'MYPASSWORD',
      sourceLib: 'SOURCEN',
      ifsDir: '/home/zeus/rpg_sources',
      out: outDir,
      files: ['QRPGLESRC'],
      members: ['ORDERPGM'],
      replace: true,
      transport: 'sftp',
      streamFileCcsid: 1208,
      verbose: false,
    }, {
      exportMembersForSourceFileFn() {
        return [{
          sourceFile: 'QRPGLESRC',
          member: 'ORDERPGM',
          ok: true,
          command: 'CPYTOSTMF ...',
          messages: [],
          stderr: '',
          fallbackUsed: false,
        }];
      },
      async downloadDirectoryFn(params) {
        const filePath = path.join(params.localDir, 'QRPGLESRC', 'ORDERPGM.rpgle');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '**FREE\nDCL-F ORDERS DISK;\n', 'utf8');
        return { downloadedCount: 1 };
      },
    });

    const manifestPath = path.join(outDir, IMPORT_MANIFEST_FILE);
    assert.equal(summary.importManifestPath, manifestPath);
    assert.equal(fs.existsSync(manifestPath), true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.tool.command, 'fetch');
    assert.equal(manifest.transportUsed, 'sftp');
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].localPath, 'QRPGLESRC/ORDERPGM.rpgle');
    assert.equal(manifest.files[0].utf8Valid, true);
    assert.equal(manifest.files[0].validationStatus, 'ok');
    assert.equal(typeof manifest.files[0].sha256, 'string');
    assert.equal(manifest.summary.invalidFileCount, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
