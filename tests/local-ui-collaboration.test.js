'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startLocalUiServer } = require('../src/ui/localUiServer');

test('local UI collaboration shares tasks and rejects cross-origin and authority injection', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-ui-collaboration-'));
  const started = await startLocalUiServer({
    port: 0,
    outputRoot: path.join(cwd, 'output'),
    actionServiceOptions: { cwd, env: {} },
  });
  t.after(async () => {
    await new Promise(resolve => started.server.close(resolve));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const send = (body, headers = {}) =>
    fetch(started.url + '/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  const denied = await send(
    { operation: 'create', goal: 'Explain local evidence', scope: {} },
    { Origin: 'https://untrusted.invalid' }
  );
  assert.equal(denied.status, 403);
  assert.equal(fs.existsSync(path.join(cwd, '.zeus', 'collaboration')), false);

  const injected = await send({
    operation: 'create',
    goal: 'Explain local evidence',
    scope: {},
    authority: { remoteAccess: true },
  });
  assert.equal(injected.status, 400);

  const created = await send({ operation: 'create', goal: 'Explain local evidence', scope: {} });
  assert.equal(created.status, 200);
  const task = (await created.json()).result;
  assert.equal(task.authority.remoteAccess, false);

  const shown = await send({ operation: 'show', id: task.id });
  assert.equal((await shown.json()).result.id, task.id);
  const events = await fetch(
    started.url + '/api/collaboration/events?id=' + encodeURIComponent(task.id)
  );
  assert.equal(events.status, 200);
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  assert.match(await events.text(), /event: task/);

  const invalid = await send({ operation: 'show', id: '../outside' });
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(await invalid.text(), /zeus-ui-collaboration-|outside/);
});
