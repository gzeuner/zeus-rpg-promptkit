/*
 * Portable E2E: real SFTP socket -> Zeus fetch orchestration -> analysis -> bundle.
 * The IBM i member-discovery/export step is represented by a synthetic test backend;
 * the SFTP transport itself is real and runs against the local fixture container.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const SftpClient = require('ssh2-sftp-client');
const { fetchSources } = require('../../src/fetch/fetchService');
const { downloadDirectory } = require('../../src/fetch/sftpDownloader');
const {
  assertNoSensitiveTerms,
  commandExists,
  createE2eWorkspace,
  runProcess,
} = require('./support/e2eHarness');
const { startSftpFixture } = require('./support/sftpFixture');
const { startEmbeddedSftpFixture } = require('./support/embeddedSftpFixture');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repositoryRoot, 'cli', 'zeus.js');
const sourceFixtureRoot = path.join(__dirname, 'fixtures', 'sftp');
const forbiddenTerms = ['e2e-password-only', 'e2e-private-token'];

function sanitizedEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const name of Object.keys(environment)) {
    if (/(?:credential|password|secret|token|private[_-]?key)/i.test(name)) {
      delete environment[name];
    }
  }
  return environment;
}

test('real SFTP fetch feeds analyze and bundle with traceable synthetic evidence', async t => {
  const workspace = createE2eWorkspace('zeus-sftp-e2e-');
  let fixture;
  t.after(async () => {
    if (fixture) await fixture.close();
    workspace.cleanup();
  });

  fixture = commandExists('docker')
    ? await startSftpFixture({
        fixtureRoot: sourceFixtureRoot,
        repositoryRoot,
      })
    : await startEmbeddedSftpFixture({ fixtureRoot: sourceFixtureRoot });

  const fetchedRoot = workspace.path('fetched');
  const fetchSummary = await fetchSources(
    {
      host: fixture.host,
      port: fixture.port,
      user: fixture.user,
      password: fixture.password,
      sourceLib: 'SYNTHETIC',
      files: ['QRPGLESRC', 'QSQLSRC'],
      members: ['PROGRAM_100'],
      ifsDir: fixture.remoteRoot,
      out: fetchedRoot,
      transport: 'sftp',
      streamFileCcsid: 1208,
      replace: true,
      encrypted: false,
      diagnoseTransport: false,
    },
    {
      listMembersFn: async () => ({ ok: true, members: ['PROGRAM_100'], messages: [] }),
      exportMembersForSourceFileFn: async ({ sourceFile, members }) =>
        members.map(member => ({
          ok: true,
          sourceFile,
          member,
          messages: [],
          stderr: '',
        })),
      downloadDirectoryFn: options =>
        downloadDirectory({
          ...options,
          password: fixture.password,
        }),
    }
  );

  assert.equal(fetchSummary.transportUsed, 'sftp');
  assert.equal(fetchSummary.downloadedCount, 2);
  assert.equal(fs.existsSync(path.join(fetchedRoot, 'QRPGLESRC', 'PROGRAM_100.rpgle')), true);
  assert.equal(fs.existsSync(path.join(fetchedRoot, 'QSQLSRC', 'PROGRAM_100.sql')), true);

  const analyze = await runProcess(
    process.execPath,
    [
      cliPath,
      'analyze',
      '--source',
      fetchedRoot,
      '--program',
      'PROGRAM_100',
      '--out',
      workspace.path('analysis'),
      '--skip-db2-metadata',
      '--reproducible',
      '--mode',
      'documentation',
    ],
    { cwd: repositoryRoot, env: sanitizedEnvironment(), timeoutMs: 120000 }
  );
  assert.equal(analyze.code, 0, `${analyze.stdout}\n${analyze.stderr}`);
  assert.match(analyze.stdout, /Analysis complete for program PROGRAM_100/);

  const bundle = await runProcess(
    process.execPath,
    [
      cliPath,
      'bundle',
      '--program',
      'PROGRAM_100',
      '--source-output-root',
      workspace.path('analysis'),
      '--output',
      workspace.path('bundle'),
      '--include-json',
    ],
    { cwd: repositoryRoot, env: sanitizedEnvironment(), timeoutMs: 120000 }
  );
  assert.equal(bundle.code, 0, `${bundle.stdout}\n${bundle.stderr}`);
  const bundlePath = path.join(workspace.path('bundle'), 'PROGRAM_100-analysis-bundle.zip');
  assert.equal(fs.existsSync(bundlePath), true);
  assert.ok(fs.statSync(bundlePath).size > 0);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(fetchedRoot, 'zeus-import-manifest.json'), 'utf8')
  );
  assert.equal(manifest.transportUsed, 'sftp');
  assert.equal(manifest.summary.fileCount, 2);
  assertNoSensitiveTerms(
    `${JSON.stringify(fetchSummary)}\n${analyze.stdout}\n${bundle.stdout}\n${JSON.stringify(manifest)}`,
    forbiddenTerms
  );

  if (fixture.mode === 'embedded-node-ssh2') {
    const verificationClient = new SftpClient();
    try {
      await verificationClient.connect({
        host: fixture.host,
        port: fixture.port,
        username: fixture.user,
        password: fixture.password,
      });
      await assert.rejects(
        () =>
          verificationClient.put(
            Buffer.from('must not be written'),
            `${fixture.remoteRoot}/blocked.txt`
          ),
        /permission|read-only|failure/i
      );
      await assert.rejects(
        () => verificationClient.list(`${fixture.remoteRoot}/../outside`),
        /outside|no such|failure|permission/i
      );
    } finally {
      await verificationClient.end().catch(() => {});
    }
  }
});
