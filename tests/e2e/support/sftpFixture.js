'use strict';

const path = require('node:path');
const { commandExists, runProcess, waitFor } = require('./e2eHarness');

const IMAGE = `zeus-e2e-sftp:${process.pid}`;
const USER = 'e2e';
const PASSWORD = 'e2e-password-only';

async function startSftpFixture({ fixtureRoot, repositoryRoot }) {
  if (!commandExists('docker')) {
    const error = new Error('Docker is required for the SFTP E2E module.');
    error.code = 'E2E_PREREQUISITE_MISSING';
    throw error;
  }

  const context = path.join(repositoryRoot, 'tests', 'e2e', 'sftp-fixture');
  const container = `zeus-e2e-sftp-${process.pid}-${Date.now()}`;
  const build = await runProcess('docker', ['build', '--tag', IMAGE, context], {
    cwd: repositoryRoot,
    timeoutMs: 180000,
  });
  if (build.code !== 0) {
    throw new Error(`SFTP fixture image build failed:\n${build.stdout}\n${build.stderr}`);
  }

  const started = await runProcess(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--publish',
      '127.0.0.1::22',
      '--env',
      `SFTP_USER=${USER}`,
      '--env',
      `SFTP_PASSWORD=${PASSWORD}`,
      '--mount',
      `type=bind,source=${path.resolve(fixtureRoot).replace(/\\/g, '/')},target=/home/${USER}/incoming,readonly`,
      IMAGE,
    ],
    { cwd: repositoryRoot, timeoutMs: 30000 }
  );
  if (started.code !== 0) {
    throw new Error(
      `SFTP fixture container failed to start:\n${started.stdout}\n${started.stderr}`
    );
  }

  let port;
  try {
    port = await waitFor(
      async () => {
        const result = await runProcess('docker', ['port', container, '22/tcp'], {
          cwd: repositoryRoot,
          timeoutMs: 10000,
        });
        if (result.code !== 0) return null;
        const match = result.stdout.match(/:(\d+)\s*$/m);
        return match ? Number.parseInt(match[1], 10) : null;
      },
      { timeoutMs: 30000, message: 'SFTP fixture did not publish a port.' }
    );
    return {
      host: '127.0.0.1',
      port,
      user: USER,
      password: PASSWORD,
      remoteRoot: '/incoming',
      async close() {
        await runProcess('docker', ['rm', '--force', container], {
          cwd: repositoryRoot,
          timeoutMs: 30000,
        });
        await runProcess('docker', ['rmi', IMAGE], {
          cwd: repositoryRoot,
          timeoutMs: 30000,
        });
      },
    };
  } catch (error) {
    await runProcess('docker', ['rm', '--force', container], {
      cwd: repositoryRoot,
      timeoutMs: 30000,
    });
    await runProcess('docker', ['rmi', IMAGE], {
      cwd: repositoryRoot,
      timeoutMs: 30000,
    });
    throw error;
  }
}

module.exports = { PASSWORD, USER, startSftpFixture };
