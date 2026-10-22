'use strict';

/* global document, Option */

function renderCollaborationView() {
  return `<section id="collaboration" class="panel view two collaboration-view" role="tabpanel" aria-labelledby="main-tab-collaboration" aria-label="Local collaboration tasks">
  <style>
    .collaboration-view{min-width:0;overflow-wrap:anywhere}
    .collaboration-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:16px}
    .collaboration-view input,.collaboration-view select,.collaboration-view textarea{width:100%;min-width:0;padding:10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--text);font:inherit}
    .collaboration-view textarea{min-height:90px;resize:vertical}
    .collaboration-form{display:grid;gap:12px;align-content:start}
    .collaboration-log{min-height:220px;max-height:460px;overflow:auto;border-block:1px solid var(--line);padding:8px 0}
    .collaboration-message{padding:10px 0;border-bottom:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
    .collaboration-message strong{display:block;color:var(--muted);font-size:12px;text-transform:uppercase}
    .collaboration-status{min-height:24px;color:var(--muted)}
    .collaboration-error{min-height:24px;color:var(--danger)}
    @media(max-width:760px){.collaboration-grid{grid-template-columns:minmax(0,1fr)}}
  </style>
  <div class="stack"><div><h2>Local collaboration</h2><p>Shared, revisioned task notes and bounded local process lookup. No model call is made here.</p></div></div>
  <div class="collaboration-grid">
    <form id="collaboration-create" class="collaboration-form">
      <label>Task goal<input id="collaboration-goal" maxlength="4000" required autocomplete="off"></label>
      <label>Process catalog path<input id="collaboration-catalog" maxlength="512" placeholder="output/process-candidates.json" autocomplete="off"></label>
      <label>Optional glossary path<input id="collaboration-glossary" maxlength="512" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" type="submit">Create task</button><button class="btn" id="collaboration-refresh" type="button">Refresh</button></div>
      <label>Existing task<select id="collaboration-task"><option value="">Select a task</option></select></label>
      <div class="actions"><button class="btn" id="collaboration-handoff" type="button" disabled>Show handoff</button><button class="btn" id="collaboration-recover" type="button" disabled>Recover abandoned task</button><button class="btn" id="collaboration-cancel" type="button" disabled>Cancel</button></div>
    </form>
    <div class="stack">
      <div id="collaboration-status" class="collaboration-status" role="status"></div>
      <div id="collaboration-error" class="collaboration-error" role="alert"></div>
      <div id="collaboration-log" class="collaboration-log" role="log" aria-label="Task conversation" aria-live="polite"></div>
      <form id="collaboration-message" class="collaboration-form">
        <label>Add a request or review note<textarea id="collaboration-text" maxlength="4000" required></textarea></label>
        <div class="actions"><button class="btn" type="submit" disabled id="collaboration-send">Add note</button><button class="btn primary" type="button" disabled id="collaboration-run">Run local lookup</button></div>
      </form>
      <pre id="collaboration-handoff-output" hidden></pre>
    </div>
  </div>
</section>`;
}

function mountCollaborationView() {
  const q = id => document.getElementById(`collaboration-${id}`);
  const state = { task: null, busy: false, runPending: false };
  const error = value => {
    q('error').textContent = value ? String(value) : '';
  };
  const call = async body => {
    const response = await fetch('/api/collaboration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.code || 'Task request failed.');
    return payload.result;
  };
  const render = () => {
    const task = state.task;
    const log = q('log');
    log.replaceChildren();
    if (task) {
      for (const message of task.messages || []) {
        const row = document.createElement('div');
        row.className = 'collaboration-message';
        const actor = document.createElement('strong');
        actor.textContent = message.actor;
        const text = document.createElement('div');
        text.textContent = message.text;
        row.append(actor, text);
        log.append(row);
      }
      q('status').textContent =
        `Task ${task.id} · ${task.state} · revision ${task.revision} · local-only`;
    } else {
      q('status').textContent = 'Select or create a local task.';
    }
    const active = Boolean(task) && !state.busy;
    const running = Boolean(task) && ['running', 'cancelling'].includes(task.state);
    q('send').disabled = !active || running || state.runPending;
    q('run').disabled =
      !active || !task.scope?.catalog || task.state !== 'ready' || state.runPending;
    q('cancel').disabled = !active || !['ready', 'running'].includes(task.state);
    q('recover').disabled = !active || !running;
    q('handoff').disabled = !task;
    q('task').value = task?.id || '';
  };
  const busy = value => {
    state.busy = value;
    render();
  };
  const refresh = async () => {
    error('');
    try {
      const tasks = await call({ operation: 'list' });
      const select = q('task');
      const current = state.task?.id || select.value;
      select.replaceChildren(new Option('Select a task', ''));
      for (const item of tasks)
        select.add(new Option(`${item.goal} · ${item.state} · r${item.revision}`, item.id));
      if (current && tasks.some(item => item.id === current)) {
        select.value = current;
        state.task = await call({ operation: 'show', id: current });
      } else if (!tasks.length) state.task = null;
      render();
    } catch (cause) {
      error(cause.message);
    }
  };
  q('create').addEventListener('submit', async event => {
    event.preventDefault();
    busy(true);
    error('');
    try {
      const scope = {};
      if (q('catalog').value.trim()) scope.catalog = q('catalog').value.trim();
      if (q('glossary').value.trim()) scope.glossary = q('glossary').value.trim();
      state.task = await call({
        operation: 'create',
        goal: q('goal').value,
        actor: 'human',
        scope,
      });
      q('handoff-output').hidden = true;
      await refresh();
    } catch (cause) {
      error(cause.message);
    } finally {
      busy(false);
    }
  });
  q('refresh').addEventListener('click', refresh);
  q('task').addEventListener('change', async () => {
    busy(true);
    try {
      state.task = q('task').value ? await call({ operation: 'show', id: q('task').value }) : null;
    } catch (cause) {
      error(cause.message);
    } finally {
      busy(false);
    }
  });
  q('message').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.task) return;
    busy(true);
    try {
      state.task = await call({
        operation: 'message',
        id: state.task.id,
        actor: 'human',
        text: q('text').value,
        expectedRevision: state.task.revision,
      });
      q('text').value = '';
      q('handoff-output').hidden = true;
    } catch (cause) {
      error(cause.message);
    } finally {
      busy(false);
    }
  });
  q('run').addEventListener('click', async () => {
    if (!state.task || state.runPending) return;
    const { id, revision } = state.task;
    state.runPending = true;
    error('');
    render();
    let runError = null;
    const runRequest = call({ operation: 'run', id, expectedRevision: revision }).then(
      task => {
        state.task = task;
      },
      cause => {
        runError = cause;
      }
    );
    while (state.runPending && !runError) {
      try {
        const current = await call({ operation: 'show', id });
        if (!state.task || current.revision >= state.task.revision) state.task = current;
        render();
        if (!['running', 'cancelling'].includes(current.state) && current.revision > revision)
          break;
      } catch (cause) {
        runError = cause;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    await runRequest;
    state.runPending = false;
    if (runError) error(runError.message);
    render();
  });
  q('cancel').addEventListener('click', async () => {
    if (!state.task) return;
    busy(true);
    try {
      state.task = await call({
        operation: 'cancel',
        id: state.task.id,
        expectedRevision: state.task.revision,
      });
    } catch (cause) {
      error(cause.message);
    } finally {
      busy(false);
    }
  });
  q('recover').addEventListener('click', async () => {
    if (!state.task) return;
    busy(true);
    try {
      state.task = await call({
        operation: 'recover',
        id: state.task.id,
        expectedRevision: state.task.revision,
      });
    } catch (cause) {
      error(cause.message);
    } finally {
      busy(false);
    }
  });
  q('handoff').addEventListener('click', async () => {
    if (!state.task) return;
    try {
      const handoff = await call({ operation: 'handoff', id: state.task.id });
      const output = q('handoff-output');
      output.textContent = JSON.stringify(handoff, null, 2);
      output.hidden = false;
    } catch (cause) {
      error(cause.message);
    }
  });
  globalThis.zeusCollaboration = { open: refresh };
  refresh();
}

function renderCollaborationScript() {
  return `(${mountCollaborationView.toString()})();`;
}

module.exports = { renderCollaborationView, renderCollaborationScript };
