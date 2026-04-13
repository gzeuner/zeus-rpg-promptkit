/*
Copyright 2026 Guido Zeuner

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
function renderLocalUiShell() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zeus Local UI</title>
  <style>
    :root {
      --bg: #f3efe5;
      --panel: #fffaf0;
      --panel-strong: #f9f1de;
      --text: #1f2933;
      --muted: #5c6b73;
      --line: #d4c3a3;
      --accent: #8a4b08;
      --accent-soft: #edd7b5;
      --success: #166534;
      --danger: #991b1b;
      --shadow: 0 18px 40px rgba(73, 52, 18, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(138, 75, 8, 0.14), transparent 34%),
        linear-gradient(180deg, #fcf8ef 0%, var(--bg) 100%);
      color: var(--text);
      font-family: Georgia, "Times New Roman", serif;
    }
    .app {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: rgba(255, 250, 240, 0.88);
      backdrop-filter: blur(6px);
      padding: 24px 20px;
    }
    main {
      padding: 24px;
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 18px;
    }
    h1, h2, h3 { margin: 0; font-weight: 700; }
    h1 { font-size: 28px; letter-spacing: 0.02em; }
    h2 { font-size: 19px; }
    h3 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    p { margin: 0; color: var(--muted); }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }
    .hero {
      padding: 22px 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
    }
    .hero-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-strong);
      font-size: 12px;
      color: var(--accent);
    }
    .stack {
      display: grid;
      gap: 14px;
    }
    .run-list {
      margin-top: 18px;
      display: grid;
      gap: 10px;
    }
    .run-item {
      border: 1px solid var(--line);
      background: white;
      border-radius: 14px;
      padding: 14px 16px;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
    }
    .run-item:hover {
      transform: translateY(-1px);
      border-color: var(--accent);
      box-shadow: 0 10px 24px rgba(138, 75, 8, 0.08);
    }
    .run-item.active {
      background: linear-gradient(135deg, #fff5df, #fffaf0);
      border-color: var(--accent);
    }
    .run-item strong { display: block; font-size: 16px; }
    .run-item small { color: var(--muted); display: block; margin-top: 4px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .metric {
      padding: 16px 18px;
    }
    .metric strong {
      display: block;
      font-size: 26px;
      color: var(--accent);
      margin-top: 8px;
    }
    .workspace {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 18px;
      min-height: 0;
    }
    .artifact-list {
      padding: 18px;
      display: grid;
      gap: 10px;
      align-content: start;
      max-height: calc(100vh - 248px);
      overflow: auto;
    }
    .artifact-button {
      width: 100%;
      text-align: left;
      border: 1px solid var(--line);
      background: white;
      border-radius: 12px;
      padding: 12px 13px;
      cursor: pointer;
    }
    .artifact-button.active {
      border-color: var(--accent);
      background: #fff1d6;
    }
    .artifact-button strong {
      display: block;
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .artifact-button span {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
    }
    .preview {
      padding: 18px;
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .preview-body {
      min-height: 420px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fffdf7;
      overflow: hidden;
    }
    .preview-text {
      margin: 0;
      padding: 16px;
      height: 100%;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .preview-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: white;
    }
    .empty {
      padding: 28px;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 16px;
      background: rgba(255, 250, 240, 0.8);
    }
    a.link {
      color: var(--accent);
      text-decoration: none;
      font-size: 13px;
    }
    a.link:hover {
      text-decoration: underline;
    }
    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .workspace { grid-template-columns: 1fr; }
      .artifact-list { max-height: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <div class="stack">
        <div>
          <h1>Zeus Local UI</h1>
          <p>Read-only shell over the analyze output contract.</p>
        </div>
        <div class="pill">Local-only API</div>
      </div>
      <div id="run-list" class="run-list"></div>
    </aside>
    <main>
      <section class="panel hero">
        <div class="stack">
          <h2 id="hero-title">Analysis Runs</h2>
          <p id="hero-subtitle">Select a run to inspect manifests and artifact previews.</p>
        </div>
        <div class="hero-meta" id="hero-meta"></div>
      </section>
      <section class="grid" id="metric-grid"></section>
      <section class="workspace">
        <div class="panel artifact-list" id="artifact-list"></div>
        <div class="panel preview">
          <div class="preview-header">
            <div class="stack">
              <h2 id="preview-title">Artifact Preview</h2>
              <p id="preview-subtitle">Choose an artifact from the run.</p>
            </div>
            <a id="preview-link" class="link" href="#" target="_blank" rel="noreferrer" hidden>Open Raw</a>
          </div>
          <div class="preview-body" id="preview-body">
            <div class="empty">No artifact selected.</div>
          </div>
        </div>
      </section>
    </main>
  </div>
  <script>
    const state = {
      runs: [],
      runDetail: null,
      selectedProgram: null,
      selectedArtifactPath: null,
    };

    const preferredArtifacts = [
      'report.md',
      'architecture.html',
      'analysis-index.json',
      'context.json',
      'ai_prompt_documentation.md',
      'safe-sharing/report.md'
    ];

    function byId(id) {
      return document.getElementById(id);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function formatDate(value) {
      if (!value) return 'n/a';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function chooseDefaultArtifact(detail) {
      const artifacts = detail && Array.isArray(detail.artifacts) ? detail.artifacts : [];
      for (const candidate of preferredArtifacts) {
        const match = artifacts.find((artifact) => artifact.path === candidate);
        if (match) return match.path;
      }
      return artifacts.length > 0 ? artifacts[0].path : null;
    }

    async function fetchJson(url) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    }

    function renderRunList() {
      const container = byId('run-list');
      if (state.runs.length === 0) {
        container.innerHTML = '<div class="empty">No analysis runs were found in the configured output root.</div>';
        return;
      }

      container.innerHTML = state.runs.map((run) => {
        const activeClass = run.program === state.selectedProgram ? ' active' : '';
        const mode = run.workflowPreset || run.workflowMode || 'standard';
        return '<button class="run-item' + activeClass + '" data-program="' + escapeHtml(run.program) + '">' +
          '<strong>' + escapeHtml(run.program) + '</strong>' +
          '<small>Status: ' + escapeHtml(run.status || 'unknown') + '</small>' +
          '<small>Workflow: ' + escapeHtml(mode) + '</small>' +
          '<small>Completed: ' + escapeHtml(formatDate(run.completedAt)) + '</small>' +
          '</button>';
      }).join('');

      for (const button of container.querySelectorAll('.run-item')) {
        button.addEventListener('click', () => {
          selectRun(button.getAttribute('data-program'));
        });
      }
    }

    function renderHero(detail) {
      if (!detail) {
        byId('hero-title').textContent = 'Analysis Runs';
        byId('hero-subtitle').textContent = 'Select a run to inspect manifests and artifact previews.';
        byId('hero-meta').innerHTML = '';
        return;
      }

      const summary = detail.summary;
      byId('hero-title').textContent = summary.program;
      byId('hero-subtitle').textContent = 'Manifest-driven local view over the run artifacts.';

      const pills = [
        'Status: ' + (summary.status || 'unknown'),
        'Mode: ' + (summary.workflowPreset || summary.workflowMode || 'standard'),
        'Artifacts: ' + summary.artifactCount,
        summary.safeSharingEnabled ? 'Safe sharing available' : 'Safe sharing not generated'
      ];

      byId('hero-meta').innerHTML = pills.map((item) => '<div class="pill">' + escapeHtml(item) + '</div>').join('');
    }

    function renderMetrics(detail) {
      const container = byId('metric-grid');
      if (!detail) {
        container.innerHTML = '';
        return;
      }

      const analyze = detail.analyzeManifest;
      const metrics = [
        ['Completed', formatDate(detail.summary.completedAt)],
        ['Stages', String(analyze.summary.stageCount || 0)],
        ['Diagnostics', String(analyze.summary.diagnosticCount || 0)],
        ['Source Files', String(analyze.inputs.sourceSnapshot.fileCount || 0)]
      ];

      container.innerHTML = metrics.map(([label, value]) => (
        '<div class="panel metric"><h3>' + escapeHtml(label) + '</h3><strong>' + escapeHtml(value) + '</strong></div>'
      )).join('');
    }

    function renderArtifacts(detail) {
      const container = byId('artifact-list');
      if (!detail || !Array.isArray(detail.artifacts) || detail.artifacts.length === 0) {
        container.innerHTML = '<div class="empty">This run has no previewable artifacts.</div>';
        return;
      }

      container.innerHTML = detail.artifacts.map((artifact) => {
        const activeClass = artifact.path === state.selectedArtifactPath ? ' active' : '';
        return '<button class="artifact-button' + activeClass + '" data-path="' + escapeHtml(artifact.path) + '">' +
          '<strong>' + escapeHtml(artifact.path) + '</strong>' +
          '<span>' + escapeHtml(artifact.kind) + ' • ' + escapeHtml(String(artifact.sizeBytes)) + ' bytes</span>' +
        '</button>';
      }).join('');

      for (const button of container.querySelectorAll('.artifact-button')) {
        button.addEventListener('click', () => {
          selectArtifact(button.getAttribute('data-path'));
        });
      }
    }

    async function renderArtifactPreview() {
      const previewBody = byId('preview-body');
      const previewTitle = byId('preview-title');
      const previewSubtitle = byId('preview-subtitle');
      const previewLink = byId('preview-link');

      if (!state.runDetail || !state.selectedArtifactPath) {
        previewTitle.textContent = 'Artifact Preview';
        previewSubtitle.textContent = 'Choose an artifact from the run.';
        previewBody.innerHTML = '<div class="empty">No artifact selected.</div>';
        previewLink.hidden = true;
        return;
      }

      const artifact = state.runDetail.artifacts.find((entry) => entry.path === state.selectedArtifactPath);
      if (!artifact) {
        previewBody.innerHTML = '<div class="empty">The selected artifact is no longer available.</div>';
        previewLink.hidden = true;
        return;
      }

      previewTitle.textContent = artifact.path;
      previewSubtitle.textContent = artifact.kind + ' preview';
      const rawUrl = '/runs/' + encodeURIComponent(state.selectedProgram) + '/artifacts/raw?path=' + encodeURIComponent(artifact.path);
      previewLink.href = rawUrl;
      previewLink.hidden = false;

      if (artifact.kind === 'html') {
        previewBody.innerHTML = '<iframe class="preview-frame" src="' + rawUrl + '"></iframe>';
        return;
      }

      previewBody.innerHTML = '<pre class="preview-text">Loading...</pre>';
      const payload = await fetchJson('/api/runs/' + encodeURIComponent(state.selectedProgram) + '/artifacts/content?path=' + encodeURIComponent(artifact.path));
      const content = artifact.kind === 'json'
        ? JSON.stringify(JSON.parse(payload.content), null, 2)
        : payload.content;
      previewBody.innerHTML = '<pre class="preview-text">' + escapeHtml(content) + '</pre>';
    }

    async function selectArtifact(artifactPath) {
      state.selectedArtifactPath = artifactPath;
      renderArtifacts(state.runDetail);
      await renderArtifactPreview();
    }

    async function selectRun(program) {
      state.selectedProgram = program;
      renderRunList();
      state.runDetail = await fetchJson('/api/runs/' + encodeURIComponent(program));
      renderHero(state.runDetail);
      renderMetrics(state.runDetail);
      renderArtifacts(state.runDetail);
      state.selectedArtifactPath = chooseDefaultArtifact(state.runDetail);
      renderArtifacts(state.runDetail);
      await renderArtifactPreview();
    }

    async function boot() {
      state.runs = await fetchJson('/api/runs');
      renderRunList();
      if (state.runs.length > 0) {
        await selectRun(state.runs[0].program);
      }
    }

    boot().catch((error) => {
      byId('preview-body').innerHTML = '<div class="empty">' + escapeHtml(error.message || String(error)) + '</div>';
    });
  </script>
</body>
</html>`;
}

module.exports = {
  renderLocalUiShell,
};
