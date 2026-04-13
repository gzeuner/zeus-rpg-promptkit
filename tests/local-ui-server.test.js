const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { startLocalUiServer } = require('../src/ui/localUiServer');

const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'zeus.js');

function createUiFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-local-ui-'));
  const outputRoot = path.join(tempRoot, 'output');
  const programDir = path.join(outputRoot, 'ORDERPGM');
  const safeDir = path.join(programDir, 'safe-sharing');
  fs.mkdirSync(safeDir, { recursive: true });

  fs.writeFileSync(path.join(programDir, 'report.md'), '# Report\n\nSummary.\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'context.json'), `${JSON.stringify({ program: 'ORDERPGM' }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(programDir, 'architecture.html'), '<!doctype html><title>Architecture Viewer</title>', 'utf8');
  fs.writeFileSync(path.join(safeDir, 'report.md'), '# Safe Report\n', 'utf8');
  fs.writeFileSync(path.join(programDir, 'analyze-run-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    tool: { name: 'zeus-rpg-promptkit', command: 'analyze' },
    run: {
      status: 'succeeded',
      completedAt: '2026-04-13T12:00:00.000Z',
    },
    inputs: {
      sourceRoot: 'C:/temp/src',
      options: {
        guidedMode: { name: 'modernization' },
        workflowPreset: { name: 'modernization-review' },
        reproducibleEnabled: false,
      },
      sourceSnapshot: {
        fileCount: 2,
      },
    },
    summary: {
      stageCount: 8,
      diagnosticCount: 1,
    },
    artifacts: [
      { path: 'context.json', kind: 'json', sizeBytes: 24, sha256: 'a' },
      { path: 'report.md', kind: 'markdown', sizeBytes: 18, sha256: 'b' },
      { path: 'architecture.html', kind: 'html', sizeBytes: 48, sha256: 'c' },
    ],
  }, null, 2)}\n`, 'utf8');

  return {
    tempRoot,
    outputRoot,
  };
}

test('local UI server exposes runs, details, and artifact content through a read-only API', async () => {
  const { tempRoot, outputRoot } = createUiFixture();
  let started = null;

  try {
    started = await startLocalUiServer({
      outputRoot,
      port: 0,
    });

    const health = await fetch(`${started.url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const runs = await fetch(`${started.url}/api/runs`).then((response) => response.json());
    assert.equal(runs.length, 1);
    assert.equal(runs[0].program, 'ORDERPGM');
    assert.equal(runs[0].workflowPreset, 'modernization-review');

    const detail = await fetch(`${started.url}/api/runs/ORDERPGM`).then((response) => response.json());
    assert.equal(detail.summary.program, 'ORDERPGM');
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'architecture.html'));
    assert.ok(detail.artifacts.some((artifact) => artifact.path === 'safe-sharing/report.md'));

    const artifact = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=report.md`).then((response) => response.json());
    assert.equal(artifact.kind, 'markdown');
    assert.match(artifact.content, /Summary\./);

    const rawArtifactResponse = await fetch(`${started.url}/runs/ORDERPGM/artifacts/raw?path=architecture.html`);
    assert.equal(rawArtifactResponse.status, 200);
    assert.match(rawArtifactResponse.headers.get('content-type'), /text\/html/);
    assert.match(await rawArtifactResponse.text(), /Architecture Viewer/);

    const shellHtml = await fetch(`${started.url}/`).then((response) => response.text());
    assert.match(shellHtml, /Zeus Local UI/);
    assert.match(shellHtml, /\/api\/runs/);

    const traversal = await fetch(`${started.url}/api/runs/ORDERPGM/artifacts/content?path=..%2Fsecret.txt`);
    assert.equal(traversal.status, 400);
  } finally {
    if (started) {
      await new Promise((resolve) => started.server.close(resolve));
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('serve CLI boots the local UI shell on loopback and answers health checks', async () => {
  const { tempRoot, outputRoot } = createUiFixture();

  try {
    const child = spawn(process.execPath, [cliPath, 'serve', '--source-output-root', outputRoot, '--port', '0'], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const started = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`serve command did not start in time\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        const match = stdout.match(/Zeus local UI available at: (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`serve command exited early with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }
      });
    });

    const health = await fetch(`${started}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
