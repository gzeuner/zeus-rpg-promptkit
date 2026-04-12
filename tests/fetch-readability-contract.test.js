const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchSources } = require('../src/fetch/fetchService');
const { runAnalyzePipeline } = require('../src/analyze/analyzePipeline');
const { IMPORT_MANIFEST_FILE } = require('../src/fetch/importManifest');

function writeFetchedProgram(params) {
  const filePath = path.join(params.localDir, 'QRPGLESRC', 'ORDERPGM.rpgle');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [
    '**FREE',
    '// Größe für München',
    'CALL INVPGM;',
    '',
  ].join('\r\n'), 'utf8');
  return { downloadedCount: 1 };
}

test('fetched UTF-8 source with national characters remains readable for analyze across supported transports', async () => {
  const transports = ['sftp', 'jt400', 'ftp'];

  for (const transport of transports) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `zeus-fetch-readability-${transport}-`));
    const outDir = path.join(tempRoot, 'rpg_sources');
    const outputRoot = path.join(tempRoot, 'output');
    const outputProgramDir = path.join(outputRoot, 'ORDERPGM');

    try {
      const options = {
        host: 'fixture.example.com',
        user: 'FIXUSER',
        password: 'FIXPASSWORD',
        sourceLib: 'FIXLIB',
        ifsDir: '/tmp/zeus_fixture/exported_source',
        out: outDir,
        files: ['QRPGLESRC'],
        members: ['ORDERPGM'],
        replace: true,
        transport,
        streamFileCcsid: 1208,
        verbose: false,
      };

      const services = {
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
      };

      if (transport === 'sftp') {
        services.downloadDirectoryFn = async (params) => writeFetchedProgram(params);
      } else if (transport === 'jt400') {
        services.downloadDirectoryViaJt400Fn = async (params) => writeFetchedProgram(params);
      } else {
        services.downloadDirectoryViaFtpFn = async (params) => writeFetchedProgram(params);
      }

      const summary = await fetchSources(options, services);
      assert.equal(summary.transportUsed, transport);

      fs.mkdirSync(outputProgramDir, { recursive: true });
      const result = runAnalyzePipeline({
        program: 'ORDERPGM',
        sourceRoot: outDir,
        outputRoot,
        outputProgramDir,
        config: {
          extensions: ['.rpgle'],
          contextOptimizer: {},
          testData: { limit: 25, maskColumns: [] },
          db: null,
        },
        testDataLimit: 25,
        skipTestData: true,
        verbose: false,
        optimizeContextEnabled: false,
        logVerbose() {},
      });

      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, IMPORT_MANIFEST_FILE), 'utf8'));
      assert.equal(manifest.transportUsed, transport);
      assert.equal(manifest.files[0].utf8Valid, true);
      assert.equal(result.context.program, 'ORDERPGM');
      assert.deepEqual(result.context.dependencies.programCalls.map((entry) => entry.name), ['INVPGM']);
      assert.ok(!result.notes.some((note) => /Invalid UTF-8/.test(note)));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});
