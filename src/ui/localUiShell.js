/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const fs = require('fs');
const path = require('path');

function resolveBrandLogoDataUri() {
  const logoPath = path.resolve(__dirname, '../../images/tiny_tool_logo-1030x254.png');
  if (!fs.existsSync(logoPath)) {
    return null;
  }

  const content = fs.readFileSync(logoPath);
  const mime = 'image/png';
  return `data:${mime};base64,${content.toString('base64')}`;
}

function renderLocalUiShell() {
  const brandLogoDataUri = resolveBrandLogoDataUri();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zeus RPG PromptKit</title>
<style>
:root{
  --bg:#eaf4f6;
  --panel:#f9fdfe;
  --panel-strong:#e7f4f7;
  --panel-soft:rgba(249,253,254,.88);
  --text:#12304f;
  --muted:#46607c;
  --line:#c2dbe2;
  --accent:#0f8ea8;
  --accent-soft:#d7eef3;
  --brand-dark:#0d2f57;
  --brand-mint:#2bb7a3;
  --success:#166534;
  --danger:#991b1b;
  --shadow:0 18px 40px rgba(13,47,87,.12);
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  color:var(--text);
  font-family:"Space Grotesk","Avenir Next","Trebuchet MS",sans-serif;
  background:
    radial-gradient(circle at top left, rgba(15,142,168,.16), transparent 32%),
    radial-gradient(circle at 90% 15%, rgba(43,183,163,.18), transparent 22%),
    linear-gradient(180deg, #f8fdfe 0%, var(--bg) 100%);
}
.app{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);min-height:100vh}
aside{
  padding:24px 20px;
  border-right:1px solid var(--line);
  background:var(--panel-soft);
  backdrop-filter:blur(6px);
  display:grid;
  align-content:start;
  gap:18px;
  min-width:0;
  overflow:hidden;
}
.main{
  padding:24px;
  display:grid;
  gap:18px;
  min-height:100vh;
  align-content:start;
  min-width:0;
}
h1,h2,h3,h4{margin:0;font-weight:700}
h1{font-size:24px;letter-spacing:.01em;line-height:1.15}
h2{font-size:19px}
h3{
  font-size:13px;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:var(--muted);
}
h4{font-size:15px}
p{margin:0;color:var(--muted);line-height:1.45}
.brand{
  display:grid;
  gap:14px;
  align-items:start;
  min-width:0;
}
.brand-logo-wrap{
  width:min(100%,220px);
  min-height:44px;
  height:auto;
  border-radius:10px;
  background:#fff;
  border:1px solid var(--line);
  box-shadow:0 10px 24px rgba(15,142,168,.16);
  display:grid;
  place-items:center;
  overflow:hidden;
  padding:4px 8px;
}
.brand-logo{
  width:100%;
  max-width:180px;
  height:auto;
  display:block;
}
.brand-logo-fallback{
  font-size:11px;
  letter-spacing:.08em;
  text-transform:uppercase;
  color:var(--brand-dark);
  font-weight:700;
}
.brand-note{
  color:var(--brand-dark);
  font-weight:700;
  letter-spacing:.06em;
  text-transform:uppercase;
  font-size:11px;
}
.brand-copy{
  min-width:0;
  overflow-wrap:anywhere;
}
.panel{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:18px;
  box-shadow:var(--shadow);
}
.hero{
  padding:22px 24px;
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:20px;
}
.hero-meta{justify-content:flex-end}
.list,.tabs,.chips,.tokens,.actions,.hero-meta{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
.tabs{
  padding:12px;
  align-items:center;
  overflow:auto;
}
.stack{display:grid;gap:14px}
.run-list,.item-list,.card-grid{
  display:grid;
  gap:10px;
}
.run-list{
  max-height:calc(100vh - 190px);
  overflow:auto;
  min-width:0;
}
.item-list{
  max-height:min(560px, calc(100vh - 360px));
  overflow:auto;
}
button,.chip,a.btn,select,input,textarea{
  font:inherit;
  color:inherit;
}
.run,.item,.tab,.btn,.card,.module-row{
  border:1px solid var(--line);
  background:#fff;
  border-radius:14px;
  transition:transform 140ms ease,border-color 140ms ease,box-shadow 140ms ease,background 140ms ease;
}
.run,.item,.tab,.btn{
  padding:12px 14px;
  cursor:pointer;
  text-decoration:none;
}
.run,.item{text-align:left}
.run:hover,.item:hover,.tab:hover,.btn:hover,.card:hover,.module-row:hover{
  transform:translateY(-1px);
  border-color:var(--accent);
  box-shadow:0 10px 24px rgba(13,47,87,.12);
}
.run.active,.item.active,.tab.active,.card.active,.module-row.active{
  background:linear-gradient(135deg, #f4fcfe, #e7f4f7);
  border-color:var(--accent);
}
.run strong,.item strong{
  display:block;
  font-size:15px;
  overflow-wrap:anywhere;
}
.run div,.run small,.item div,.small{
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
}
.tab{
  color:var(--accent);
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(220,244,249,.86));
}
.btn{
  color:var(--accent);
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(220,244,249,.86));
}
.btn.primary{
  background:linear-gradient(135deg,var(--accent),var(--brand-dark));
  color:#fff;
  border-color:transparent;
}
.btn.primary:hover{
  border-color:transparent;
  box-shadow:0 12px 26px rgba(13,47,87,.24);
}
.token{
  padding:7px 12px;
  border:1px solid var(--line);
  border-radius:999px;
  background:var(--panel-strong);
  color:var(--accent);
  font-size:12px;
  max-width:100%;
  overflow-wrap:anywhere;
}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.metric{
  padding:16px 18px;
  background:linear-gradient(180deg, rgba(255,255,255,.9), rgba(225,244,248,.82));
}
.metric div{
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:var(--muted);
  font-weight:700;
}
.metric strong{
  display:block;
  font-size:26px;
  color:var(--accent);
  margin-top:8px;
}
.view{
  display:none;
  overflow:hidden;
}
.view.active{display:grid}
.two{grid-template-columns:minmax(260px,300px) minmax(0,1fr);gap:18px}
.three{grid-template-columns:minmax(220px,260px) minmax(0,1fr) minmax(0,1fr);gap:18px}
.sub{
  padding:18px;
  display:grid;
  gap:12px;
  align-content:start;
  min-width:0;
}
.view.active>.sub:not(:first-child){
  border-left:1px solid rgba(194,219,226,.7);
}
.preview{
  border:1px solid var(--line);
  border-radius:14px;
  background:#f8fdff;
  min-height:340px;
  overflow:auto;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.75);
}
pre{
  margin:0;
  padding:16px;
  white-space:pre-wrap;
  word-break:break-word;
  font-family:"Cascadia Code",Consolas,monospace;
  font-size:13px;
  line-height:1.5;
}
iframe{width:100%;height:520px;border:0;background:#fff}
textarea{
  width:100%;
  min-height:120px;
  padding:12px;
  border:1px solid var(--line);
  border-radius:12px;
  background:#fbfeff;
}
.card-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.card{
  padding:14px;
  display:grid;
  gap:10px;
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(225,244,248,.78));
}
.card h3{color:var(--text);font-size:17px}
.card p{color:#344854;font-size:14px;line-height:1.4}
.card .meta{display:flex;gap:8px;flex-wrap:wrap}
.card .meta .token{font-size:12px}
input[type="search"]{
  width:100%;
  padding:10px 12px;
  border:1px solid var(--line);
  border-radius:12px;
  background:#fff;
}
.field-grid{display:grid;gap:10px}
.field-grid label{
  display:grid;
  gap:6px;
  font-size:12px;
  color:var(--muted);
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.08em;
}
.field-grid input,.field-grid textarea,.field-grid select{
  width:100%;
  padding:10px 12px;
  border:1px solid var(--line);
  border-radius:12px;
  background:#fff;
}
.home-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:12px;
}
.workflow-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:12px;
}
.workflow-card{
  padding:16px;
  display:grid;
  gap:10px;
  border:1px solid var(--line);
  border-radius:16px;
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(226,244,248,.78));
}
.workflow-card h4{
  font-size:16px;
}
.workflow-meta{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.configure-layout{
  display:grid;
  grid-template-columns:minmax(220px,280px) minmax(0,1fr);
  gap:14px;
}
.section-list{
  display:grid;
  gap:8px;
}
.section-btn{
  width:100%;
  text-align:left;
}
.field-list{
  display:grid;
  gap:10px;
}
.field-item{
  padding:12px 14px;
  border:1px solid var(--line);
  border-radius:14px;
  background:#fff;
  display:grid;
  gap:6px;
}
.field-item strong{
  font-size:15px;
}
.home-card{
  padding:16px;
  display:grid;
  gap:10px;
  border:1px solid var(--line);
  border-radius:16px;
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(225,244,248,.76));
}
.home-card strong{
  font-size:16px;
  color:var(--text);
}
.home-card code{
  font-family:"Cascadia Code",Consolas,monospace;
  font-size:12px;
  background:rgba(215,238,243,.62);
  padding:2px 6px;
  border-radius:999px;
}
.home-callout{
  padding:18px;
  border:1px solid var(--line);
  border-radius:16px;
  background:
    radial-gradient(circle at top right, rgba(15,142,168,.14), transparent 34%),
    linear-gradient(180deg, rgba(255,255,255,.98), rgba(225,244,248,.82));
}
.home-callout h2{margin-bottom:6px}
.command-block{
  border:1px solid var(--line);
  border-radius:14px;
  background:#f8fdff;
  overflow:auto;
}
.command-block pre{
  font-size:12px;
  line-height:1.6;
}
.hint-list{
  display:grid;
  gap:10px;
}
.hint-item{
  padding:12px 14px;
  border:1px dashed var(--line);
  border-radius:14px;
  background:rgba(234,248,251,.82);
}
.step-list{
  display:grid;
  gap:10px;
}
.step-item{
  border:1px solid var(--line);
  border-radius:14px;
  background:#fff;
  padding:12px;
  display:grid;
  gap:6px;
}
.step-item strong{
  font-size:13px;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:var(--brand-dark);
}
.module-row{
  display:grid;
  gap:8px;
  padding:12px 13px;
}
.module-row h4{color:var(--text)}
.small{font-size:12px}
.empty{
  padding:28px;
  color:var(--muted);
  border:1px dashed var(--line);
  border-radius:16px;
  background:rgba(225,244,248,.76);
}
.status-ok{color:var(--success)}
.status-warn{color:var(--accent)}
.status-err{color:var(--danger)}
@media(max-width:1200px){
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:980px){
  .app{grid-template-columns:1fr}
  aside{
    border-right:0;
    border-bottom:1px solid var(--line);
  }
  .main{padding:18px}
  .hero{padding:18px}
  .metrics,.two,.three{grid-template-columns:1fr}
  .configure-layout{grid-template-columns:1fr}
  .view.active>.sub:not(:first-child){border-left:0;border-top:1px solid rgba(194,219,226,.7)}
  .run-list,.item-list{max-height:none}
}
@media(max-width:640px){
  .metrics{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="stack">
      <div class="brand">
        <div class="brand-logo-wrap" aria-hidden="true">
          ${brandLogoDataUri
            ? `<img class="brand-logo" src="${brandLogoDataUri}" alt="tiny-tool.de logo">`
            : '<div class="brand-logo-fallback">tiny-tool.de</div>'}
        </div>
        <div class="brand-copy">
          <h1>Zeus RPG PromptKit</h1>
          <p>Run explorer and local prompt tools.</p>
          <div class="brand-note">tiny-tool.de</div>
        </div>
      </div>
      <div class="token">Brand Edition - Local-only UI + API</div>
    </div>
    <div id="runs" class="run-list"><div class="empty">No runs loaded yet. Start with Prompt Workbench or create output under <code>./output</code>.</div></div>
  </aside>
  <div class="main">
    <div class="panel hero">
      <div class="stack">
        <h2 id="title">Welcome to Zeus RPG PromptKit</h2>
        <p id="subtitle">Open Prompt Workbench now or load analysis runs from ./output.</p>
      </div>
      <div id="chips" class="chips hero-meta"><div class="token">Runs: 0</div><div class="token">Workbench loading</div></div>
    </div>

    <div id="metrics" class="metrics"><div class="panel metric"><div>Runs</div><strong>0</strong></div><div class="panel metric"><div>Next Step</div><strong>Open Workbench</strong></div><div class="panel metric"><div>Output Root</div><strong>./output</strong></div><div class="panel metric"><div>Mode</div><strong>PromptKit UI</strong></div></div>
    <div id="tabs" class="panel tabs"><button class="tab active">Home</button><button class="tab">Configure</button><button class="tab">Graph</button><button class="tab">DB2/Test Data</button><button class="tab">Prompt Compare</button><button class="tab">Prompt Workbench</button><button class="tab">Artifacts</button></div>

    <div id="home" class="panel view two active"><div class="sub"><div class="home-callout"><h2>Start Here</h2><p>No analysis runs are loaded yet. You can still open Prompt Workbench now, or create your first run and refresh this screen.</p><div class="tokens"><div class="token">Runs: 0</div><div class="token">Local-only UI</div></div></div><h3>Quick Actions</h3><div class="home-grid"><div class="home-card"><strong>Open Prompt Workbench</strong><p>Build or refine prompts directly in the browser with guided use cases.</p></div><div class="home-card"><strong>Create an analysis run</strong><p>Generate artifacts under <code>./output</code> so the explorers have something to show.</p><div class="command-block"><pre>zeus analyze --source ./src --program ORDERPGM --out ./output</pre></div></div><div class="home-card"><strong>Use a guided workflow</strong><p>Generate richer prompt packs and workflow-specific output.</p><div class="command-block"><pre>zeus workflow --preset modernization-review --source ./src --program ORDERPGM --out ./output</pre></div></div></div></div><div class="sub"><h2>What You Can Do Here</h2><p>The home screen gives you the fastest path into the tool, even before the first run exists.</p><div class="hint-list"><div class="hint-item"><strong>1. Create output</strong><p>Use <code>zeus analyze</code> or <code>zeus workflow</code> so this UI has artifacts to browse.</p></div><div class="hint-item"><strong>2. Refresh runs</strong><p>Once output exists, reload the run list and switch into graph, DB2, prompts, or artifacts.</p></div><div class="hint-item"><strong>3. Start with Prompt Workbench</strong><p>Use the guided prompt canvas immediately, even if your first analysis run is still being prepared.</p></div></div></div></div>
    <div id="configure" class="panel view two"></div>
    <div id="graph" class="panel view two"></div>
    <div id="db2" class="panel view two"></div>
    <div id="prompts" class="panel view three"></div>
    <div id="workbench" class="panel view two"></div>
    <div id="artifacts" class="panel view two"></div>
  </div>
</div>

<script>
const s={
  runs:[],detail:null,program:null,tab:'home',homePanel:'guide',artifact:null,node:null,table:null,left:null,right:null,cache:new Map(),
  uiMetadata:{
    loading:false,
    error:null,
    payload:null,
    selectedConfigSection:'profile'
  },
  uiActions:{
    doctor:{
      profile:'dev',
      running:false,
      error:null,
      result:null
    },
    analyze:{
      profile:'dev',
      program:'',
      member:'',
      safeSharing:true,
      running:false,
      error:null,
      result:null
    }
  },
  promptBuilder:{
    loading:false,
    loaded:false,
    error:null,
    useCases:[],
    modules:[],
    selectedUseCaseId:null,
    selectedModuleId:null,
    moduleOrder:[],
    fields:{},
    preview:null,
    previewEditable:false,
    previewEditableContent:'',
    previewDebounceHandle:null,
    previewLoading:false,
    previewError:null,
    additionalRequirements:'',
    templates:[],
    selectedTemplateId:null,
    templateName:'',
    templateDescription:'',
    templateTags:'',
    saveStatus:'',
    contextSources:[],
    contextSourceProgram:'',
    contextSourcePrompts:[],
    contextSourcePromptPath:'',
    contextSourceStatus:'',
    starterGoal:'',
    starterLanguage:'German',
    starterUseCaseId:''
  }
};

const tabs=[
  ['home','Home'],
  ['configure','Configure'],
  ['graph','Graph'],
  ['db2','DB2/Test Data'],
  ['prompts','Prompt Compare'],
  ['workbench','Prompt Workbench'],
  ['artifacts','Artifacts']
];

const WB_PREVIEW_DEBOUNCE_MS=220;

const pref=['report.md','architecture.html','analysis-index.json','context.json','ai_prompt_documentation.md'];

const q=(id)=>document.getElementById(id);

const esc=(v)=>String(v)
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;');

const escAttr=(v)=>esc(v).replace(/"/g,'&quot;');

const statusToneClass=(value)=>{
  const normalized=String(value||'').trim().toLowerCase();
  if(!normalized) return '';
  if(/fail|error|unavailable|not found/.test(normalized)) return 'status-err';
  if(/warn|warning|loading|refreshing|saving|deleting|importing|select |nothing to|no ai_prompt|empty/.test(normalized)) return 'status-warn';
  return 'status-ok';
};

const fmt=(v)=>{
  if(!v) return 'n/a';
  const d=new Date(v);
  return Number.isNaN(d.getTime())?v:d.toLocaleString();
};

async function getJson(u){
  const r=await fetch(u);
  if(!r.ok){
    const txt=await r.text();
    throw new Error(txt||('Request failed: '+r.status));
  }
  return r.json();
}

async function sendJson(method,u,payload){
  const r=await fetch(u,{method,headers:{'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  if(!r.ok){
    const txt=await r.text();
    throw new Error(txt||('Request failed: '+r.status));
  }
  return r.json();
}

async function getArtifact(p){
  const k=s.program+':'+p;
  if(s.cache.has(k)) return s.cache.get(k);
  const v=await getJson('/api/runs/'+encodeURIComponent(s.program)+'/artifacts/content?path='+encodeURIComponent(p));
  s.cache.set(k,v);
  return v;
}

function runDefaultArtifact(){
  const a=s.detail&&s.detail.artifacts||[];
  for(const p of pref){
    const m=a.find((x)=>x.path===p);
    if(m) return m.path;
  }
  return a[0]&&a[0].path||null;
}

function renderRuns(){
  const root=q('runs');
  if(!s.runs.length){
    root.innerHTML='<div class="empty">No runs.</div>';
    return;
  }
  root.innerHTML=s.runs.map((r)=>'<button class="run'+(r.program===s.program?' active':'')+'" data-run="'+esc(r.program)+'"><strong>'+esc(r.program)+'</strong><div>'+esc(r.workflowPreset||r.workflowMode||'standard')+'</div><div>'+esc(fmt(r.completedAt))+'</div></button>').join('');
  for(const b of root.querySelectorAll('[data-run]')) b.onclick=()=>selectRun(b.dataset.run);
}

function renderHero(){
  if(!s.detail){
    q('title').textContent='Welcome to Zeus RPG PromptKit';
    q('subtitle').textContent='Start with Prompt Workbench or load analysis runs from ./output.';
    q('chips').innerHTML=[
      'Runs: '+String(s.runs.length||0),
      s.promptBuilder.loading?'Workbench loading':s.promptBuilder.error?'Workbench issue':'Workbench ready'
    ].map((v)=>'<div class="token">'+esc(v)+'</div>').join('');
    return;
  }
  const x=s.detail.summary;
  q('title').textContent=x.program;
  q('subtitle').textContent=s.tab==='home'
    ? 'Choose your next step from the guided start view.'
    : 'Focused explorer over graph, DB2, prompts, and Prompt Workbench.';
  q('chips').innerHTML=['Status: '+(x.status||'unknown'),'Mode: '+(x.workflowPreset||x.workflowMode||'standard'),'Artifacts: '+x.artifactCount,x.safeSharingEnabled?'Safe sharing':'No safe sharing'].map((v)=>'<div class="token">'+esc(v)+'</div>').join('');
}

function renderMetrics(){
  const root=q('metrics');
  if(!s.detail){
    root.innerHTML='';
    return;
  }
  const a=s.detail.analyzeManifest;
  const v=s.detail.views;
  const m=[
    ['Completed',fmt(s.detail.summary.completedAt)],
    ['Stages',a.summary.stageCount||0],
    ['Graph Nodes',v.summary.graphNodeCount||0],
    ['Prompt Packs',v.summary.promptCount||0]
  ];
  root.innerHTML=m.map(([k,vv])=>'<div class="panel metric"><div>'+esc(k)+'</div><strong>'+esc(String(vv))+'</strong></div>').join('');
}

function renderTabs(){
  q('tabs').innerHTML=tabs.map(([id,label])=>'<button class="tab'+(s.tab===id?' active':'')+'" data-tab="'+id+'">'+label+'</button>').join('');
  for(const b of q('tabs').querySelectorAll('[data-tab]')) b.onclick=()=>selectTab(b.dataset.tab);
}

function renderCommandBlock(lines){
  return '<div class="command-block"><pre>'+esc((Array.isArray(lines)?lines:[String(lines||'')]).join('\\n'))+'</pre></div>';
}

function promptWorkbenchHighlights(){
  const useCases=(s.promptBuilder.useCases||[]).slice(0,3);
  if(s.promptBuilder.loading){
    return '<div class="empty">Loading Prompt Workbench options...</div>';
  }
  if(s.promptBuilder.error){
    return '<div class="empty">Prompt Workbench unavailable: '+esc(s.promptBuilder.error)+'</div>';
  }
  if(!useCases.length){
    return '<div class="empty">No Prompt Workbench use cases available.</div>';
  }
  return '<div class="home-grid">'+useCases.map((entry)=>'<div class="home-card"><strong>'+esc(entry.title)+'</strong><p>'+esc(entry.description||'')+'</p><div class="actions"><button class="btn" data-home-workbench="'+esc(entry.id)+'">Open In Workbench</button></div></div>').join('')+'</div>';
}

function fallbackWorkflowCards(){
  return [
    { id:'configure', title:'Configure', description:'Review profile and environment metadata.', badge:'configure', status:'Not checked yet', primaryActionLabel:'Open Configure', recommendedNext:'doctor' },
    { id:'fetch-sources', title:'Fetch Sources', description:'Prepare source evidence from IBM i.', badge:'fetch', status:'Not checked yet', primaryActionLabel:'Prepare Fetch', recommendedNext:'copy-to-workspace' },
    { id:'analyze-workspace', title:'Analyze Workspace', description:'Run analysis and generate artifacts.', badge:'analyze', status:'Not checked yet', primaryActionLabel:'Analyze Workspace', recommendedNext:'serve' },
    { id:'query-db2', title:'Query DB2', description:'Run read-only DB2 query workflows.', badge:'query', status:'Not checked yet', primaryActionLabel:'Review Queries', recommendedNext:'query-table' },
    { id:'review-reports', title:'Review Reports', description:'Inspect report and artifact output.', badge:'review', status:'Not checked yet', primaryActionLabel:'Open Artifacts', recommendedNext:'bundle' },
    { id:'generate-ai-context', title:'Generate AI Context', description:'Bundle and refine AI context artifacts.', badge:'context', status:'Not checked yet', primaryActionLabel:'Open Workbench', recommendedNext:'bundle' }
  ];
}

function workflowCards(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  const cards=payload&&Array.isArray(payload.workflowCards)?payload.workflowCards:[];
  return cards.length>0?cards:fallbackWorkflowCards();
}

function metadataSections(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  const sections=payload&&payload.config&&Array.isArray(payload.config.sections)?payload.config.sections:[];
  return sections.length>0?sections:[];
}

function metadataFields(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  const fields=payload&&payload.config&&Array.isArray(payload.config.fields)?payload.config.fields:[];
  return fields.length>0?fields:[];
}

function defaultConfigSection(){
  const sections=metadataSections();
  return sections[0]&&sections[0].id?sections[0].id:'profile';
}

function cardToHomeTarget(cardId){
  if(cardId==='configure') return 'configure';
  if(cardId==='fetch-sources') return 'configure';
  if(cardId==='analyze-workspace') return 'analyze-workspace';
  if(cardId==='query-db2') return 'db2';
  if(cardId==='review-reports') return 'artifacts';
  if(cardId==='generate-ai-context') return 'workbench';
  return 'home';
}

async function loadUiMetadata(){
  s.uiMetadata.loading=true;
  s.uiMetadata.error=null;
  try{
    const payload=await getJson('/api/ui-metadata');
    s.uiMetadata.payload=payload;
    if(!metadataSections().some((section)=>section.id===s.uiMetadata.selectedConfigSection)){
      s.uiMetadata.selectedConfigSection=defaultConfigSection();
    }
  }catch(error){
    s.uiMetadata.error=error.message||String(error);
  }finally{
    s.uiMetadata.loading=false;
  }
}

async function runDoctorReadinessAction(){
  const profile=String(s.uiActions.doctor.profile||'dev').trim()||'dev';
  s.uiActions.doctor.running=true;
  s.uiActions.doctor.error=null;
  try{
    const payload=await sendJson('POST','/api/ui-actions/doctor',{
      profile,
      showResolved:false
    });
    s.uiActions.doctor.result=payload;
  }catch(error){
    s.uiActions.doctor.error=error.message||String(error);
    s.uiActions.doctor.result=null;
  }finally{
    s.uiActions.doctor.running=false;
  }
}

async function runAnalyzeExistingWorkspaceAction(){
  const profile=String(s.uiActions.analyze.profile||'dev').trim()||'dev';
  const program=String(s.uiActions.analyze.program||'').trim();
  const member=String(s.uiActions.analyze.member||'').trim();
  s.uiActions.analyze.running=true;
  s.uiActions.analyze.error=null;
  try{
    const payload={profile,safeSharing:s.uiActions.analyze.safeSharing!==false};
    if(program) payload.program=program;
    if(member) payload.member=member;
    const result=await sendJson('POST','/api/ui-actions/analyze-existing-workspace',payload);
    s.uiActions.analyze.result=result;
    if(result&&result.output&&result.output.program&&(result.status==='completed'||result.status==='warning')){
      await refreshRuns(result.output.program);
    }
  }catch(error){
    s.uiActions.analyze.error=error.message||String(error);
    s.uiActions.analyze.result=null;
  }finally{
    s.uiActions.analyze.running=false;
  }
}

function normalizeDoctorDiagnostics(result){
  const diagnostics=result&&Array.isArray(result.diagnostics)?result.diagnostics:[];
  return diagnostics.filter((entry)=>entry&&typeof entry==='object');
}

function renderDoctorDiagnosticEntry(diagnostic){
  const code=String(diagnostic.code||'').trim().toUpperCase();
  const severity=String(diagnostic.severity||'').trim().toUpperCase()||'INFO';
  const tone=statusToneClass(severity);
  const message=String(diagnostic.message||'').trim();
  if(code==='ENV_PROFILE_CONFLICT'){
    return '<div class="hint-item"><strong>Selected profile and environment point to different DB targets.</strong><div class="tokens"><div class="token '+esc(tone)+'">'+esc(severity)+'</div>'+(diagnostic.profile?'<div class="token">Profile: '+esc(String(diagnostic.profile))+'</div>':'')+'</div><p class="small">Field: '+esc(String(diagnostic.path||''))+'</p><p class="small">Profile value: '+esc(String(diagnostic.profileValue||''))+'</p><p class="small">Environment override: '+esc(String(diagnostic.envVar||''))+' -> '+esc(String(diagnostic.effectiveValue||''))+'</p><p class="small">Effective target: '+esc(String(diagnostic.effectiveValue||''))+'</p>'+(message?'<p class="small">'+esc(message)+'</p>':'')+'</div>';
  }
  return '<div class="hint-item"><strong>'+esc(code||'Diagnostic')+'</strong><div class="tokens"><div class="token '+esc(tone)+'">'+esc(severity)+'</div>'+(diagnostic.path?'<div class="token">'+esc(String(diagnostic.path))+'</div>':'')+'</div><p>'+(message?esc(message):'No additional details.')+'</p></div>';
}

function renderDoctorDiagnostics(result){
  const diagnostics=normalizeDoctorDiagnostics(result);
  if(!diagnostics.length) return '';
  const warningCount=diagnostics.filter((entry)=>String(entry.severity||'').toUpperCase()==='WARN'||String(entry.severity||'').toUpperCase()==='WARNING').length;
  const errorCount=diagnostics.filter((entry)=>/ERROR|FAIL/.test(String(entry.severity||'').toUpperCase())).length;
  const heading=warningCount>0?'Configuration warnings':'Configuration issues';
  const summaryParts=[];
  if(warningCount>0) summaryParts.push('warn '+String(warningCount));
  if(errorCount>0) summaryParts.push('error '+String(errorCount));
  return '<div class="hint-list"><div class="hint-item"><strong>'+esc(heading)+'</strong><p>'+(warningCount>0?'These warnings explain why the selected profile and the active environment may point to different DB targets.':'Doctor returned structured diagnostics for review.')+'</p>'+(summaryParts.length?'<p class="small">'+esc(summaryParts.join(' • '))+'</p>':'')+'</div>'+diagnostics.map((entry)=>renderDoctorDiagnosticEntry(entry)).join('')+'</div>';
}

function normalizeAnalyzeActionDiagnostics(result){
  const diagnostics=result&&Array.isArray(result.diagnostics)?result.diagnostics:[];
  return diagnostics.filter((entry)=>entry&&typeof entry==='object');
}

function isSafeLocalUiReportUrl(value){
  const normalized=String(value||'').trim();
  return normalized.startsWith('/runs/')
    && normalized.includes('/artifacts/raw?path=')
    && !/[<>"'\\s]/.test(normalized);
}

function renderAnalyzeActionDiagnostics(result){
  const diagnostics=normalizeAnalyzeActionDiagnostics(result);
  if(!diagnostics.length) return '';
  return '<div class="hint-list">'+diagnostics.map((entry)=>{
    const severity=String(entry.severity||'').trim().toUpperCase()||'INFO';
    return '<div class="hint-item"><strong>'+esc(String(entry.code||'ANALYZE_DIAGNOSTIC'))+'</strong><div class="tokens"><div class="token '+esc(statusToneClass(severity))+'">'+esc(severity)+'</div></div><p>'+(entry.message?esc(String(entry.message)):'No additional details.')+'</p></div>';
  }).join('')+'</div>';
}

function renderAnalyzeWorkspacePanel(){
  const analyzeState=s.uiActions.analyze||{};
  const analyzeResult=analyzeState.result;
  const analyzeSummary=analyzeResult&&analyzeResult.result&&analyzeResult.result.summary;
  const analyzeStatus=analyzeResult&&analyzeResult.status
    ? String(analyzeResult.status)
    : (analyzeState.running?'running':analyzeState.error?'error':'not-run');
  const analyzeTone=statusToneClass(analyzeStatus);
  const analyzeStatusLabel=analyzeState.running
    ? 'running'
    : (analyzeState.error?'error':(analyzeResult&&analyzeResult.status?analyzeResult.status:'not-run'));
  const analyzeHint=analyzeState.error
    ? analyzeState.error
    : (analyzeResult
      ? ('last run: '+String(fmt(analyzeResult.finishedAt||analyzeResult.startedAt||'')))
      : 'Uses the selected profile source root. Browser-provided filesystem paths are not accepted.');
  const workspace=analyzeResult&&analyzeResult.workspace?analyzeResult.workspace:null;
  const sourceRoot=workspace&&workspace.sourceRoot?String(workspace.sourceRoot):'profile-defined';
  const outputRoot=workspace&&workspace.outputRoot?String(workspace.outputRoot):'profile-defined';
  const safeReportUrl=analyzeResult&&analyzeResult.output&&isSafeLocalUiReportUrl(analyzeResult.output.reportUrl)
    ? String(analyzeResult.output.reportUrl)
    : '';
  const rawResult=analyzeResult
    ? JSON.stringify({
      output:analyzeResult.output||null,
      result:analyzeResult.result||null,
      diagnostics:analyzeResult.diagnostics||[],
      notes:analyzeResult.notes||[],
    },null,2)
    : '';

  return '<div class="sub"><h2>Analyze Workspace</h2><p>Run the existing local analyze pipeline against the selected profile workspace. This action stays local-only: no remote fetch, no DB2 query execution, and no browser-provided commands.</p><div class="tokens"><div class="token '+esc(analyzeTone)+'">Analyze: '+esc(analyzeStatusLabel)+'</div><div class="token">source root: '+esc(sourceRoot)+'</div><div class="token">output: '+esc(outputRoot)+'</div>'+(analyzeResult?'<div class="token">duration: '+esc(String(analyzeResult.durationMs||0))+' ms</div>':'')+'</div><div class="field-grid"><label>Profile Name<input id="analyzeProfile" value="'+escAttr(analyzeState.profile||'dev')+'" placeholder="dev"></label><label>Program Name<input id="analyzeProgram" value="'+escAttr(analyzeState.program||'')+'" placeholder="ORDERPGM"></label><label>Member Name<input id="analyzeMember" value="'+escAttr(analyzeState.member||'')+'" placeholder="ORDERPGM"></label></div><div class="actions"><button class="btn primary" data-analyze-run="1">'+esc(analyzeState.running?'Analyzing...':'Analyze Workspace')+'</button><button class="btn" data-analyze-toggle-safe-sharing="1">Safe Sharing: '+esc(analyzeState.safeSharing===false?'off':'on')+'</button><button class="btn" data-home-target="guide">Back To Guidance</button></div><div class="hint-list"><div class="hint-item"><strong>Input rules</strong><p>Provide a safe profile name plus either a program or a member. The source root comes from the selected profile.</p><p class="small">'+esc(analyzeHint)+'</p></div>'+(analyzeResult&&analyzeResult.notes&&analyzeResult.notes.length?'<div class="hint-item"><strong>Notes</strong><p>'+esc(analyzeResult.notes.join(' '))+'</p></div>':'')+'</div>'+
    (analyzeSummary?'<div class="hint-list"><div class="hint-item"><strong>Summary</strong><p>stages '+esc(String(analyzeSummary.stageCount||0))+' • source files '+esc(String(analyzeSummary.sourceFileCount||0))+' • artifacts '+esc(String(analyzeSummary.generatedArtifactCount||0))+' • warnings '+esc(String(analyzeSummary.warningCount||0))+' • errors '+esc(String(analyzeSummary.errorCount||0))+'</p></div></div>':'')+
    renderAnalyzeActionDiagnostics(analyzeResult)+
    ((safeReportUrl||(analyzeResult&&analyzeResult.output&&analyzeResult.output.program))?'<div class="actions">'+(safeReportUrl?'<a class="btn" href="'+escAttr(safeReportUrl)+'" target="_blank" rel="noopener noreferrer">Open analysis report</a>':'')+((analyzeResult&&analyzeResult.output&&analyzeResult.output.program)?'<button class="btn" data-analyze-open-artifacts="'+esc(String(analyzeResult.output.program))+'">Open In Artifacts</button>':'')+'</div>':'')+
    (rawResult?'<details><summary>Show raw result</summary><div class="preview"><pre>'+esc(rawResult)+'</pre></div></details>':'')+
    '</div>';
}

function renderHomeGuidePanel(){
  return '<div class="sub"><h2>Workflow Guidance</h2><p>Only allowlisted local UI actions are executable here. Configure and Analyze Workspace are wired into the shell; fetch, DB2, and arbitrary commands remain outside the browser.</p><div class="hint-list"><div class="hint-item"><strong>Recommended sequence</strong><p>Configure -> doctor -> analyze -> review -> bundle/context.</p></div><div class="hint-item"><strong>Analyze starter</strong><p>Use the Analyze Workspace card to run the local analyzer against the selected profile source root.</p></div><div class="hint-item"><strong>Workflow starter</strong><p>Prompt Workbench remains available immediately, even before your first analysis run is generated.</p></div></div><h3>Prompt Workbench Choices</h3>'+promptWorkbenchHighlights()+'</div>';
}

async function refreshRuns(preferredProgram){
  const currentProgram=preferredProgram||s.program;
  s.runs=await getJson('/api/runs');
  renderRuns();

  const preferred=currentProgram&&s.runs.some((run)=>run.program===currentProgram)
    ? currentProgram
    : s.runs[0]&&s.runs[0].program||null;

  if(preferred){
    await selectRun(preferred);
    return;
  }

  s.program=null;
  s.detail=null;
  s.artifact=null;
  s.node=null;
  s.table=null;
  s.left=null;
  s.right=null;
  renderHero();
  renderMetrics();
  await render();
}

async function openHomeTarget(target,options){
  const opts=options||{};
  if(target==='refresh'){
    await refreshRuns();
    return;
  }

  if(target==='guide'){
    s.tab='home';
    s.homePanel='guide';
    await render();
    return;
  }

  if(target==='analyze-workspace'){
    s.tab='home';
    s.homePanel='analyze-workspace';
    await render();
    return;
  }

  if(target==='configure'){
    s.tab='configure';
    await render();
    return;
  }

  if(target==='workbench'){
    s.tab='workbench';
    await render();
    if(!s.promptBuilder.loaded&&!s.promptBuilder.loading){
      await loadPromptBuilderData();
    }
    if(opts.useCaseId&&s.promptBuilder.loaded&&!s.promptBuilder.error){
      setWorkbenchUseCase(opts.useCaseId);
      return;
    }
    await render();
    return;
  }

  if((target==='graph'||target==='db2'||target==='prompts'||target==='artifacts')&&!s.detail&&s.runs.length>0){
    await selectRun(s.runs[0].program);
  }
  s.tab=target;
  await render();
}

function ensureStarterDefaults(){
  if(!s.promptBuilder||!s.promptBuilder.loaded||s.promptBuilder.error) return;
  if(!s.promptBuilder.starterUseCaseId){
    s.promptBuilder.starterUseCaseId=s.promptBuilder.selectedUseCaseId
      ||(s.promptBuilder.useCases[0]&&s.promptBuilder.useCases[0].id)
      ||'';
  }
  if(!s.promptBuilder.starterGoal){
    s.promptBuilder.starterGoal='Describe what you want to analyze and what outcome you need.';
  }
  if(!s.promptBuilder.starterLanguage){
    s.promptBuilder.starterLanguage='German';
  }
}

async function startWorkbenchFromStarter(){
  if(!s.promptBuilder.loaded||s.promptBuilder.error){
    await openHomeTarget('workbench');
    return;
  }

  const useCaseId=((q('starterUseCase')&&q('starterUseCase').value)||s.promptBuilder.starterUseCaseId||'').trim();
  const goal=((q('starterGoal')&&q('starterGoal').value)||s.promptBuilder.starterGoal||'').trim();
  const language=((q('starterLanguage')&&q('starterLanguage').value)||s.promptBuilder.starterLanguage||'German').trim()||'German';

  if(useCaseId){
    setWorkbenchUseCase(useCaseId);
  }
  s.promptBuilder.starterUseCaseId=useCaseId;
  s.promptBuilder.starterGoal=goal;
  s.promptBuilder.starterLanguage=language;

  if(!s.promptBuilder.fields||typeof s.promptBuilder.fields!=='object'){
    s.promptBuilder.fields={};
  }
  s.promptBuilder.fields.goal=goal||s.promptBuilder.fields.goal||'';
  s.promptBuilder.fields.language=language;
  s.promptBuilder.saveStatus='Starter template applied.';

  s.tab='workbench';
  renderWorkbench();
  scheduleWorkbenchPreview();
}

function renderHome(){
  const root=q('home');
  root.classList.toggle('active',s.tab==='home');
  if(s.tab!=='home') return;

  const cards=workflowCards();
  const hasRun=Boolean(s.detail);
  const summary=hasRun?s.detail.summary:null;
  const nextHint=summary
    ? 'Selected run: '+summary.program+' ('+String(summary.workflowPreset||summary.workflowMode||'standard')+').'
    : 'No run selected yet. Start with Configure, then use Analyze Workspace or refresh existing runs.';

  root.innerHTML='<div class="sub"><div class="home-callout"><h2>Workflow Shell</h2><p>A calmer entry point: pick one workflow card, then move to the next recommended step.</p><div class="tokens"><div class="token">Cards: '+esc(String(cards.length))+'</div><div class="token">Metadata: '+esc(s.uiMetadata.error?'degraded fallback':'live API')+'</div><div class="token">'+esc(nextHint)+'</div></div></div><h3>Workflow Cards</h3>'+
    (s.uiMetadata.loading
      ? '<div class="empty">Loading UI metadata...</div>'
      : '<div class="workflow-grid">'+cards.map((card)=>'<div class="workflow-card"><h4>'+esc(card.title)+'</h4><p>'+esc(card.description||'')+'</p><div class="workflow-meta"><div class="token">'+esc(card.badge||card.category||'workflow')+'</div><div class="token">'+esc(card.status||'Not checked yet')+'</div><div class="token">Commands: '+esc(String(card.commandCount||0))+'</div></div><p><strong>Next:</strong> '+esc(card.recommendedNext||'TBD')+'</p><div class="actions"><button class="btn primary" data-home-target="'+esc(cardToHomeTarget(card.id))+'">'+esc(card.primaryActionLabel||'Open')+'</button></div></div>').join('')+'</div>'
    )+
    '<div class="actions"><button class="btn" data-home-target="configure">Open Configure</button><button class="btn" data-home-target="analyze-workspace">Open Analyze Workspace</button><button class="btn" data-home-target="refresh">Refresh Runs</button><button class="btn" data-home-target="workbench">Open Prompt Workbench</button></div></div>'+
    (s.homePanel==='analyze-workspace'?renderAnalyzeWorkspacePanel():renderHomeGuidePanel());

  for(const b of root.querySelectorAll('[data-home-target]')){
    b.onclick=()=>openHomeTarget(b.dataset.homeTarget);
  }
  for(const b of root.querySelectorAll('[data-home-workbench]')){
    b.onclick=()=>openHomeTarget('workbench',{useCaseId:b.dataset.homeWorkbench});
  }
  const analyzeProfileInput=root.querySelector('#analyzeProfile');
  if(analyzeProfileInput){
    analyzeProfileInput.oninput=(event)=>{
      s.uiActions.analyze.profile=String(event.target.value||'').trim();
    };
  }
  const analyzeProgramInput=root.querySelector('#analyzeProgram');
  if(analyzeProgramInput){
    analyzeProgramInput.oninput=(event)=>{
      s.uiActions.analyze.program=String(event.target.value||'').trim();
    };
  }
  const analyzeMemberInput=root.querySelector('#analyzeMember');
  if(analyzeMemberInput){
    analyzeMemberInput.oninput=(event)=>{
      s.uiActions.analyze.member=String(event.target.value||'').trim();
    };
  }
  const analyzeRunButton=root.querySelector('[data-analyze-run]');
  if(analyzeRunButton){
    analyzeRunButton.onclick=async ()=>{
      const profileInput=q('analyzeProfile');
      const programInput=q('analyzeProgram');
      const memberInput=q('analyzeMember');
      if(profileInput){
        s.uiActions.analyze.profile=String(profileInput.value||'').trim()||'dev';
      }
      if(programInput){
        s.uiActions.analyze.program=String(programInput.value||'').trim();
      }
      if(memberInput){
        s.uiActions.analyze.member=String(memberInput.value||'').trim();
      }
      renderHome();
      await runAnalyzeExistingWorkspaceAction();
      renderHome();
    };
  }
  const analyzeToggleButton=root.querySelector('[data-analyze-toggle-safe-sharing]');
  if(analyzeToggleButton){
    analyzeToggleButton.onclick=()=>{
      s.uiActions.analyze.safeSharing=s.uiActions.analyze.safeSharing===false;
      renderHome();
    };
  }
  for(const b of root.querySelectorAll('[data-analyze-open-artifacts]')){
    b.onclick=async ()=>{
      await selectRun(b.dataset.analyzeOpenArtifacts);
      s.tab='artifacts';
      await render();
    };
  }
}

function renderConfigure(){
  const root=q('configure');
  root.classList.toggle('active',s.tab==='configure');
  if(s.tab!=='configure') return;

  const sections=metadataSections();
  const fields=metadataFields();
  const selectedSection=s.uiMetadata.selectedConfigSection||defaultConfigSection();
  const selectedFields=fields.filter((field)=>field.section===selectedSection);
  const sectionMeta=sections.find((section)=>section.id===selectedSection)||{ label:selectedSection };

  const statusLine=s.uiMetadata.loading
    ? 'Loading metadata...'
    : (s.uiMetadata.error
      ? ('Metadata API unavailable: '+s.uiMetadata.error)
      : 'Metadata loaded from /api/ui-metadata');

  const doctorState=s.uiActions.doctor||{};
  const doctorResult=doctorState.result;
  const doctorSummary=doctorResult&&doctorResult.result&&doctorResult.result.summary;
  const doctorStatus=doctorResult&&doctorResult.status
    ? String(doctorResult.status)
    : (doctorState.running?'running':doctorState.error?'error':'not-run');
  const doctorTone=statusToneClass(doctorStatus);
  const doctorStatusLabel=doctorState.running
    ? 'running'
    : (doctorState.error?'error':(doctorResult&&doctorResult.status?doctorResult.status:'not-run'));
  const doctorHint=doctorState.error
    ? doctorState.error
    : (doctorResult
      ? ('last run: '+String(fmt(doctorResult.finishedAt||doctorResult.startedAt||'')))
      : 'No readiness check executed yet.');
  const doctorDetails=doctorResult&&doctorResult.result&&Array.isArray(doctorResult.result.checks)
    ? doctorResult.result.checks
      .map((entry)=>String(entry.status||'')+' | '+String(entry.name||'')+' | '+String(entry.details||''))
      .join('\\n')
    : '';
  const doctorDiagnosticsPanel=renderDoctorDiagnostics(doctorResult);

  root.innerHTML='<div class="sub"><h2>Configure (Read-only)</h2><p>This view renders config metadata only. No resolved env/profile values are shown.</p><div class="tokens"><div class="token">'+esc(statusLine)+'</div><div class="token">Sections: '+esc(String(sections.length||0))+'</div><div class="token">Fields: '+esc(String(fields.length||0))+'</div></div><div class="hint-list"><div class="hint-item"><strong>Doctor action is allowlisted</strong><p>Only <code>doctor readiness</code> is supported from UI actions. Arbitrary command execution is intentionally blocked.</p></div><div class="hint-item"><strong>Safety</strong><p>Action payload is strictly validated server-side and responses are JSON-only.</p></div></div><h3>Readiness Check</h3><div class="field-grid"><label>Profile Name<input id="configDoctorProfile" value="'+escAttr(doctorState.profile||'dev')+'" placeholder="dev"></label></div><div class="actions"><button class="btn primary" data-config-doctor="1">'+esc(doctorState.running?'Checking...':'Check Readiness')+'</button><button class="btn" data-config-refresh="1">Refresh Metadata</button></div><div class="tokens"><div class="token '+esc(doctorTone)+'">Doctor: '+esc(doctorStatusLabel)+'</div><div class="token">profile: '+esc(doctorState.profile||'dev')+'</div>'+(doctorResult?'<div class="token">duration: '+esc(String(doctorResult.durationMs||0))+' ms</div>':'')+'</div>'+
    (doctorSummary?'<div class="hint-list"><div class="hint-item"><strong>Summary</strong><p>pass '+esc(String(doctorSummary.pass||0))+' • warn '+esc(String(doctorSummary.warn||0))+' • fail '+esc(String(doctorSummary.fail||0))+' • skip '+esc(String(doctorSummary.skip||0))+'</p><p class="small">'+esc(doctorHint)+'</p></div></div>':'<div class="hint-list"><div class="hint-item"><strong>Status</strong><p>'+esc(doctorHint)+'</p></div></div>')+
    doctorDiagnosticsPanel+
    (doctorDetails?'<details><summary>Show checks</summary><div class="preview"><pre>'+esc(doctorDetails)+'</pre></div></details>':'')+
    '</div>'+
    '<div class="sub"><h2>'+esc(sectionMeta.label||selectedSection)+'</h2><div class="configure-layout"><div class="section-list">'+
      sections.map((section)=>'<button class="btn section-btn'+(section.id===selectedSection?' active':'')+'" data-config-section="'+esc(section.id)+'">'+esc(section.label||section.id)+'</button>').join('')+
    '</div><div class="field-list">'+
      (selectedFields.length>0
        ? selectedFields.map((field)=>'<div class="field-item"><strong>'+esc(field.label||field.key)+'</strong><p>'+esc(field.description||'')+'</p><div class="workflow-meta"><div class="token">key: '+esc(field.key)+'</div><div class="token">type: '+esc(field.type||'string')+'</div><div class="token">'+esc(field.sensitive?'sensitive':'non-sensitive')+'</div></div><div class="small">placeholder: '+esc(field.placeholder||'(none)')+'</div><div class="small">example: '+esc(field.example||'(none)')+'</div><div class="small">env: '+esc(field.envVar||'(none)')+'</div><div class="small">profile path: '+esc(field.profilePath||'(none)')+'</div></div>').join('')
        : '<div class="empty">No fields for this section.</div>')+
    '</div></div></div>';

  for(const button of root.querySelectorAll('[data-config-section]')){
    button.onclick=()=>{
      s.uiMetadata.selectedConfigSection=button.dataset.configSection;
      renderConfigure();
    };
  }
  const profileInput=root.querySelector('#configDoctorProfile');
  if(profileInput){
    profileInput.oninput=(event)=>{
      s.uiActions.doctor.profile=String(event.target.value||'').trim();
    };
  }
  const doctorButton=root.querySelector('[data-config-doctor]');
  if(doctorButton){
    doctorButton.onclick=async ()=>{
      const profileInput=q('configDoctorProfile');
      if(profileInput){
        s.uiActions.doctor.profile=String(profileInput.value||'').trim()||'dev';
      }
      await runDoctorReadinessAction();
      renderConfigure();
    };
  }
  const refreshButton=root.querySelector('[data-config-refresh]');
  if(refreshButton){
    refreshButton.onclick=async ()=>{
      await loadUiMetadata();
      renderConfigure();
      if(s.tab==='home') renderHome();
    };
  }
}

function linkArtifacts(paths){
  return !paths||!paths.length
    ? '<div class="empty">No related artifacts.</div>'
    : '<div class="chips">'+paths.map((p)=>'<button class="btn" data-art="'+esc(p)+'">'+esc(p)+'</button>').join('')+'</div>';
}

function linkPrompts(paths){
  return !paths||!paths.length
    ? '<div class="empty">No related prompts.</div>'
    : '<div class="chips">'+paths.map((p)=>'<button class="btn" data-prompt="'+esc(p)+'">'+esc(p)+'</button>').join('')+'</div>';
}

function linkNodes(paths){
  return !paths||!paths.length
    ? '<div class="empty">No connected nodes.</div>'
    : '<div class="chips">'+paths.map((p)=>'<button class="btn" data-node="'+esc(p)+'">'+esc(p)+'</button>').join('')+'</div>';
}

function bindCross(root){
  for(const b of root.querySelectorAll('[data-art]')) b.onclick=()=>{s.artifact=b.dataset.art;s.tab='artifacts';render();};
  for(const b of root.querySelectorAll('[data-prompt]')) b.onclick=()=>{s.left=b.dataset.prompt;if(!s.right)s.right=b.dataset.prompt;s.tab='prompts';render();};
  for(const b of root.querySelectorAll('[data-node]')) b.onclick=()=>{s.node=b.dataset.node;s.tab='graph';render();};
}

function renderGraph(){
  const root=q('graph');
  root.classList.toggle('active',s.tab==='graph');
  if(s.tab!=='graph') return;

  if(!s.detail||!s.detail.views.graph.available){
    root.innerHTML='<div class="sub"><div class="empty">No graph available.</div></div>';
    return;
  }

  const g=s.detail.views.graph;
  const f=((q('graphFilter')&&q('graphFilter').value)||'').toLowerCase();
  const nodes=g.nodes.filter((n)=>!f||n.id.toLowerCase().includes(f)||n.type.toLowerCase().includes(f));
  const sel=g.nodes.find((n)=>n.id===s.node)||nodes[0]||null;

  root.innerHTML='<div class="sub"><h2>Graph Explorer</h2><p>Click nodes to follow related artifacts and prompts.</p><input id="graphFilter" placeholder="Filter nodes"><div class="item-list">'+nodes.map((n)=>'<button class="item'+(sel&&sel.id===n.id?' active':'')+'" data-nid="'+esc(n.id)+'"><strong>'+esc(n.id)+'</strong><div>'+esc(n.type)+' • in '+esc(String(n.incomingCount))+' • out '+esc(String(n.outgoingCount))+'</div></button>').join('')+'</div></div><div class="sub">'+(sel?'<h2>'+esc(sel.id)+'</h2><div class="tokens"><div class="token">'+esc(sel.type)+'</div><div class="token">Connected '+esc(String(sel.connectedNodeIds.length))+'</div></div><h3>Connected Nodes</h3>'+linkNodes(sel.connectedNodeIds)+'<h3>Related Artifacts</h3>'+linkArtifacts(sel.relatedArtifactPaths)+'<h3>Related Prompts</h3>'+linkPrompts(sel.relatedPromptPaths)+(g.viewerArtifact?'<a class="btn" target="_blank" rel="noreferrer" href="/runs/'+encodeURIComponent(s.program)+'/artifacts/raw?path='+encodeURIComponent(g.viewerArtifact)+'">Open Architecture Viewer</a>':''):'<div class="empty">No nodes matched.</div>')+'</div>';

  q('graphFilter').value=f;
  q('graphFilter').oninput=()=>renderGraph();
  for(const b of root.querySelectorAll('[data-nid]')) b.onclick=()=>{s.node=b.dataset.nid;renderGraph();};
  bindCross(root);
}

function renderDb2(){
  const root=q('db2');
  root.classList.toggle('active',s.tab==='db2');
  if(s.tab!=='db2') return;

  if(!s.detail){
    root.innerHTML='<div class="sub"><div class="empty">No run selected.</div></div>';
    return;
  }

  const d=s.detail.views.db2;
  if(!d.metadataAvailable&&!d.testDataAvailable){
    root.innerHTML='<div class="sub"><div class="empty">No DB2 metadata or test data.</div></div>';
    return;
  }

  const f=((q('db2Filter')&&q('db2Filter').value)||'').toLowerCase();
  const tables=d.tables.filter((t)=>!f||t.qualifiedName.toLowerCase().includes(f));
  const sel=d.tables.find((t)=>t.id===s.table)||tables[0]||null;

  root.innerHTML='<div class="sub"><h2>DB2/Test Data</h2><div class="tokens"><div class="token">Metadata '+esc(String(d.metadataSummary&&d.metadataSummary.tableCount||0))+'</div><div class="token">Samples '+esc(String(d.testDataSummary&&d.testDataSummary.tableCount||0))+'</div><div class="token">Masked '+esc(String(d.testDataSummary&&d.testDataSummary.policySummary&&d.testDataSummary.policySummary.maskedTableCount||0))+'</div></div><input id="db2Filter" placeholder="Filter tables"><div class="item-list">'+tables.map((t)=>'<button class="item'+(sel&&sel.id===t.id?' active':'')+'" data-tid="'+esc(t.id)+'"><strong>'+esc(t.qualifiedName||t.table)+'</strong><div>rows '+esc(String(t.sampleRowCount||0))+' • masks '+esc(String(t.maskedColumnCount||0))+'</div></button>').join('')+'</div></div><div class="sub">'+(sel?'<h2>'+esc(sel.qualifiedName||sel.table)+'</h2><div class="tokens"><div class="token">match '+esc(sel.matchStatus||'unknown')+'</div><div class="token">policy '+esc(sel.policyEligibility||'not-exported')+'</div><div class="token">evidence '+esc(String(sel.sourceEvidenceCount||0))+'</div></div><h3>Artifacts</h3>'+linkArtifacts(sel.relatedArtifactPaths)+'<h3>Prompts</h3>'+linkPrompts(sel.relatedPromptPaths):'<div class="empty">No tables matched.</div>')+'</div>';

  q('db2Filter').value=f;
  q('db2Filter').oninput=()=>renderDb2();
  for(const b of root.querySelectorAll('[data-tid]')) b.onclick=()=>{s.table=b.dataset.tid;renderDb2();};
  bindCross(root);
}

async function renderPromptPreview(id,path){
  const root=q(id);
  if(!path){
    root.innerHTML='<div class="empty">Choose a prompt.</div>';
    return;
  }
  root.innerHTML='<pre>Loading...</pre>';
  const p=await getArtifact(path);
  root.innerHTML='<pre>'+esc(p.content)+'</pre>';
}

async function renderPrompts(){
  const root=q('prompts');
  root.classList.toggle('active',s.tab==='prompts');
  if(s.tab!=='prompts') return;

  if(!s.detail||!s.detail.views.prompts.artifacts.length){
    root.innerHTML='<div class="sub"><div class="empty">No prompt artifacts.</div></div>';
    return;
  }

  const ps=s.detail.views.prompts.artifacts;
  if(!s.left) s.left=ps[0].path;
  if(!s.right) s.right=(ps[1]&&ps[1].path)||ps[0].path;

  root.innerHTML='<div class="sub"><h2>Prompt Compare</h2><p>Compare prompt packs side by side.</p><div class="item-list">'+ps.map((p)=>'<button class="item" data-pick="'+esc(p.path)+'"><strong>'+esc(p.title)+'</strong><div>'+esc(p.path)+'</div></button>').join('')+'</div></div><div class="sub"><h3>Left Prompt</h3><select id="leftSel">'+ps.map((p)=>'<option value="'+esc(p.path)+'"'+(p.path===s.left?' selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select><div id="leftPrev" class="preview"></div></div><div class="sub"><h3>Right Prompt</h3><select id="rightSel">'+ps.map((p)=>'<option value="'+esc(p.path)+'"'+(p.path===s.right?' selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select><div id="rightPrev" class="preview"></div></div>';

  for(const b of root.querySelectorAll('[data-pick]')) b.onclick=()=>{s.left=b.dataset.pick;renderPrompts();};
  q('leftSel').onchange=(e)=>{s.left=e.target.value;renderPrompts();};
  q('rightSel').onchange=(e)=>{s.right=e.target.value;renderPrompts();};
  await Promise.all([renderPromptPreview('leftPrev',s.left),renderPromptPreview('rightPrev',s.right)]);
}

function moduleTitleMap(){
  const map={};
  for(const module of s.promptBuilder.modules||[]){
    map[module.id]=module.title;
  }
  return map;
}

function moduleById(moduleId){
  return (s.promptBuilder.modules||[]).find((entry)=>entry.id===moduleId)||null;
}

function splitTextToList(value){
  return String(value||'')
    .split(/\\n|,/g)
    .map((entry)=>entry.trim())
    .filter(Boolean);
}

function arrayToText(value){
  if(!Array.isArray(value)) return '';
  return value.join('\\n');
}

function collectFieldDefinitions(useCase,moduleOrder){
  const map={};
  const ordered=[];

  for(const moduleId of moduleOrder||[]){
    const module=moduleById(moduleId);
    if(!module) continue;
    for(const field of module.configFields||[]){
      const name=String(field.name||'').trim();
      if(!name||map[name]) continue;
      map[name]={
        name,
        label:name,
        type:String(field.type||'string'),
      };
      ordered.push(map[name]);
    }
  }

  for(const hint of (useCase&&useCase.fieldHints)||[]){
    const name=String(hint.name||'').trim();
    if(!name||map[name]) continue;
    map[name]={
      name,
      label:String(hint.label||name),
      type:String(hint.type||'string'),
    };
    ordered.push(map[name]);
  }

  return ordered;
}

function fieldValueAsText(value,type){
  if(type==='array') return arrayToText(value);
  return value===undefined||value===null?'':String(value);
}

function parseFieldValue(rawValue,type){
  if(type==='array') return splitTextToList(rawValue);
  return String(rawValue||'');
}

function renderCanvasFieldInput(field,value){
  const type=String(field&&field.type||'string')==='array'?'array':'string';
  const name=escAttr(String(field&&field.name||''));
  const label=esc(String(field&&field.label||field&&field.name||''));
  if(type==='array'){
    return '<label>'+label+'<textarea data-wb-field-name=\"'+name+'\" data-wb-field-type=\"array\" placeholder=\"One value per line\">'+esc(fieldValueAsText(value,'array'))+'</textarea></label>';
  }
  return '<label>'+label+'<input data-wb-field-name=\"'+name+'\" data-wb-field-type=\"string\" placeholder=\"Enter value\" value=\"'+escAttr(fieldValueAsText(value,'string'))+'\"></label>';
}

function ensureWorkbenchUseCaseSelection(){
  if(!selectedUseCase()&&(s.promptBuilder.useCases||[]).length>0){
    s.promptBuilder.selectedUseCaseId=s.promptBuilder.useCases[0].id;
  }
}

function selectedUseCase(){
  const id=s.promptBuilder.selectedUseCaseId;
  return (s.promptBuilder.useCases||[]).find((entry)=>entry.id===id)||null;
}

function initializeWorkbenchForUseCase(useCase,options){
  if(!useCase) return;
  const opts=options||{};
  const reset=Boolean(opts.reset);
  const moduleSet=new Set((s.promptBuilder.modules||[]).map((entry)=>entry.id));

  if(reset||s.promptBuilder.activeUseCaseId!==useCase.id){
    s.promptBuilder.activeUseCaseId=useCase.id;
    s.promptBuilder.moduleOrder=(useCase.defaultModuleIds||[]).filter((id)=>moduleSet.has(id));
    s.promptBuilder.fields={
      language:'German',
      goal:useCase.description||useCase.title||'',
    };
    s.promptBuilder.additionalRequirements='';
    s.promptBuilder.preview=null;
    s.promptBuilder.previewEditable=false;
    s.promptBuilder.previewEditableContent='';
    s.promptBuilder.previewError=null;
    s.promptBuilder.saveStatus='';
    s.promptBuilder.selectedTemplateId=null;
    s.promptBuilder.templateName=(useCase.title||'Prompt')+' Template';
    s.promptBuilder.templateDescription='';
    s.promptBuilder.templateTags='';
  }

  s.promptBuilder.moduleOrder=(s.promptBuilder.moduleOrder||[]).filter((id)=>moduleSet.has(id));
  if(s.promptBuilder.moduleOrder.length===0){
    s.promptBuilder.moduleOrder=(useCase.defaultModuleIds||[]).filter((id)=>moduleSet.has(id));
  }
  if(s.promptBuilder.moduleOrder.length===0&&(s.promptBuilder.modules||[]).length>0){
    s.promptBuilder.moduleOrder=[s.promptBuilder.modules[0].id];
  }

  if(!s.promptBuilder.selectedModuleId||!s.promptBuilder.moduleOrder.includes(s.promptBuilder.selectedModuleId)){
    s.promptBuilder.selectedModuleId=s.promptBuilder.moduleOrder[0]||null;
  }
}

function selectedCanvasModule(){
  return moduleById(s.promptBuilder.selectedModuleId);
}

function currentPreviewText(){
  if(s.promptBuilder.previewEditable) return s.promptBuilder.previewEditableContent||'';
  return (s.promptBuilder.preview&&s.promptBuilder.preview.content)||'';
}

function scheduleWorkbenchPreview(){
  if(s.promptBuilder.previewDebounceHandle){
    clearTimeout(s.promptBuilder.previewDebounceHandle);
  }
  s.promptBuilder.previewDebounceHandle=setTimeout(()=>{
    s.promptBuilder.previewDebounceHandle=null;
    generateWorkbenchPreview({silent:true});
  },WB_PREVIEW_DEBOUNCE_MS);
}

async function refreshWorkbenchTemplates(){
  const payload=await getJson('/api/prompt-builder/templates');
  s.promptBuilder.templates=(payload&&Array.isArray(payload.templates))?payload.templates:[];
}

async function refreshContextSources(){
  const payload=await getJson('/api/prompt-builder/context-sources');
  s.promptBuilder.contextSources=(payload&&Array.isArray(payload.contextSources))?payload.contextSources:[];
  if(!s.promptBuilder.contextSourceProgram&&s.promptBuilder.contextSources.length>0){
    s.promptBuilder.contextSourceProgram=s.promptBuilder.contextSources[0].program||'';
  }
}

async function loadContextSourcePrompts(program,options){
  const opts=options||{};
  const normalized=String(program||'').trim();
  if(!normalized){
    s.promptBuilder.contextSourcePrompts=[];
    s.promptBuilder.contextSourcePromptPath='';
    if(!opts.silent) renderWorkbench();
    return;
  }
  s.promptBuilder.contextSourceProgram=normalized;
  if(!opts.silent){
    s.promptBuilder.contextSourceStatus='Loading context prompts...';
    renderWorkbench();
  }
  try {
    const payload=await getJson('/api/prompt-builder/context-sources/'+encodeURIComponent(normalized)+'/prompts');
    const promptArtifacts=(payload&&Array.isArray(payload.promptArtifacts))?payload.promptArtifacts:[];
    s.promptBuilder.contextSourcePrompts=promptArtifacts;
    if(!promptArtifacts.some((entry)=>entry.path===s.promptBuilder.contextSourcePromptPath)){
      s.promptBuilder.contextSourcePromptPath=promptArtifacts[0]?promptArtifacts[0].path:'';
    }
    s.promptBuilder.contextSourceStatus=promptArtifacts.length>0?'Context prompts loaded.':'No ai_prompt artifacts for selected run.';
  } catch(error){
    s.promptBuilder.contextSourcePrompts=[];
    s.promptBuilder.contextSourcePromptPath='';
    s.promptBuilder.contextSourceStatus='Context load failed: '+(error.message||String(error));
  }
  if(!opts.silent) renderWorkbench();
}

function applyImportedContextSeed(seed){
  const content=String(seed&&seed.content||'');
  if(!content){
    s.promptBuilder.contextSourceStatus='Imported prompt is empty.';
    return;
  }
  s.promptBuilder.previewEditable=true;
  s.promptBuilder.previewEditableContent=content;
  const marker='Imported context seed from '+String(seed.program||'')+'/'+String(seed.path||'');
  const currentReq=String(s.promptBuilder.additionalRequirements||'').trim();
  s.promptBuilder.additionalRequirements=currentReq?currentReq+'\\n'+marker:marker;
  s.promptBuilder.contextSourceStatus='Imported '+String(seed.path||'')+' as preview seed.';
  s.promptBuilder.saveStatus='Context seed applied.';
}

async function importContextSourcePrompt(){
  const program=String(s.promptBuilder.contextSourceProgram||'').trim();
  const promptPath=String(s.promptBuilder.contextSourcePromptPath||'').trim();
  if(!program||!promptPath){
    s.promptBuilder.contextSourceStatus='Select a run and prompt artifact first.';
    renderWorkbench();
    return;
  }
  s.promptBuilder.contextSourceStatus='Importing context prompt...';
  renderWorkbench();
  try {
    const payload=await sendJson('POST','/api/prompt-builder/context-sources/import',{
      program,
      path:promptPath,
    });
    applyImportedContextSeed(payload.seed||{});
  } catch(error){
    s.promptBuilder.contextSourceStatus='Import failed: '+(error.message||String(error));
  }
  renderWorkbench();
}

async function loadPromptBuilderData(){
  s.promptBuilder.loading=true;
  s.promptBuilder.error=null;
  if(s.tab==='home') renderHome();
  renderWorkbench();

  try {
    const payload=await Promise.all([
      getJson('/api/prompt-builder/use-cases'),
      getJson('/api/prompt-builder/modules'),
      getJson('/api/prompt-builder/templates'),
      getJson('/api/prompt-builder/context-sources')
    ]);

    const useCases=(payload[0]&&Array.isArray(payload[0].useCases))?payload[0].useCases:[];
    const modules=(payload[1]&&Array.isArray(payload[1].modules))?payload[1].modules:[];
    const templates=(payload[2]&&Array.isArray(payload[2].templates))?payload[2].templates:[];
    const contextSources=(payload[3]&&Array.isArray(payload[3].contextSources))?payload[3].contextSources:[];

    s.promptBuilder.useCases=useCases;
    s.promptBuilder.modules=modules;
    s.promptBuilder.templates=templates;
    s.promptBuilder.contextSources=contextSources;
    s.promptBuilder.loaded=true;
    if(!s.promptBuilder.contextSourceProgram&&contextSources.length>0){
      s.promptBuilder.contextSourceProgram=contextSources[0].program||'';
    }

    ensureWorkbenchUseCaseSelection();
    initializeWorkbenchForUseCase(selectedUseCase(),{reset:false});
    scheduleWorkbenchPreview();
    if(s.promptBuilder.contextSourceProgram){
      await loadContextSourcePrompts(s.promptBuilder.contextSourceProgram,{silent:true});
    }
  } catch(error){
    s.promptBuilder.error=error.message||String(error);
  } finally {
    s.promptBuilder.loading=false;
    if(s.tab==='home') renderHome();
    renderWorkbench();
  }
}

function setWorkbenchUseCase(useCaseId){
  s.promptBuilder.selectedUseCaseId=useCaseId;
  initializeWorkbenchForUseCase(selectedUseCase(),{reset:true});
  renderWorkbench();
  scheduleWorkbenchPreview();
}

function addCanvasModule(moduleId){
  if(!moduleId) return;
  if((s.promptBuilder.moduleOrder||[]).includes(moduleId)) return;
  s.promptBuilder.moduleOrder.push(moduleId);
  s.promptBuilder.selectedModuleId=moduleId;
  s.promptBuilder.saveStatus='';
  renderWorkbench();
  scheduleWorkbenchPreview();
}

function removeCanvasModule(index){
  if(!Array.isArray(s.promptBuilder.moduleOrder)) return;
  if(index<0||index>=s.promptBuilder.moduleOrder.length) return;
  const removed=s.promptBuilder.moduleOrder[index];
  s.promptBuilder.moduleOrder.splice(index,1);
  if(s.promptBuilder.selectedModuleId===removed){
    s.promptBuilder.selectedModuleId=s.promptBuilder.moduleOrder[0]||null;
  }
  s.promptBuilder.saveStatus='';
  renderWorkbench();
  scheduleWorkbenchPreview();
}

function moveCanvasModule(index,delta){
  const target=index+delta;
  if(!Array.isArray(s.promptBuilder.moduleOrder)) return;
  if(index<0||index>=s.promptBuilder.moduleOrder.length) return;
  if(target<0||target>=s.promptBuilder.moduleOrder.length) return;
  const value=s.promptBuilder.moduleOrder[index];
  s.promptBuilder.moduleOrder.splice(index,1);
  s.promptBuilder.moduleOrder.splice(target,0,value);
  s.promptBuilder.saveStatus='';
  renderWorkbench();
  scheduleWorkbenchPreview();
}

function updateCanvasField(name,type,value){
  const fieldName=String(name||'').trim();
  if(!fieldName) return;
  if(!s.promptBuilder.fields||typeof s.promptBuilder.fields!=='object'){
    s.promptBuilder.fields={};
  }
  s.promptBuilder.fields[fieldName]=parseFieldValue(value,type);
  s.promptBuilder.saveStatus='';
  scheduleWorkbenchPreview();
}

function tagsTextToList(value){
  return splitTextToList(value);
}

function tagsListToText(values){
  return (Array.isArray(values)?values:[]).join(', ');
}

function templatePayloadFromCanvas(useCase){
  return {
    name:String(s.promptBuilder.templateName||'').trim(),
    description:String(s.promptBuilder.templateDescription||'').trim(),
    useCaseId:useCase.id,
    moduleIds:[...(s.promptBuilder.moduleOrder||[])],
    fields:s.promptBuilder.fields||{},
    additionalRequirements:String(s.promptBuilder.additionalRequirements||''),
    tags:tagsTextToList(s.promptBuilder.templateTags),
  };
}

async function saveWorkbenchTemplate(){
  const useCase=selectedUseCase();
  if(!useCase) return;
  const payload=templatePayloadFromCanvas(useCase);
  const templateId=s.promptBuilder.selectedTemplateId;
  s.promptBuilder.saveStatus='Saving template...';
  renderWorkbench();
  try {
    const result=templateId
      ? await sendJson('PUT','/api/prompt-builder/templates/'+encodeURIComponent(templateId),payload)
      : await sendJson('POST','/api/prompt-builder/templates',payload);
    s.promptBuilder.selectedTemplateId=result.template.id;
    s.promptBuilder.templateName=result.template.name||payload.name;
    s.promptBuilder.templateDescription=result.template.description||payload.description||'';
    s.promptBuilder.templateTags=tagsListToText(result.template.tags||payload.tags||[]);
    await refreshWorkbenchTemplates();
    s.promptBuilder.saveStatus='Template saved.';
  } catch(error){
    s.promptBuilder.saveStatus='Save failed: '+(error.message||String(error));
  }
  renderWorkbench();
}

async function deleteWorkbenchTemplate(){
  const templateId=s.promptBuilder.selectedTemplateId;
  if(!templateId) return;
  s.promptBuilder.saveStatus='Deleting template...';
  renderWorkbench();
  try {
    await sendJson('DELETE','/api/prompt-builder/templates/'+encodeURIComponent(templateId));
    s.promptBuilder.selectedTemplateId=null;
    s.promptBuilder.saveStatus='Template deleted.';
    await refreshWorkbenchTemplates();
  } catch(error){
    s.promptBuilder.saveStatus='Delete failed: '+(error.message||String(error));
  }
  renderWorkbench();
}

function applyTemplateToCanvas(template){
  if(!template||typeof template!=='object') return;
  s.promptBuilder.selectedUseCaseId=template.useCaseId||s.promptBuilder.selectedUseCaseId;
  const useCase=selectedUseCase();
  if(!useCase) return;
  initializeWorkbenchForUseCase(useCase,{reset:true});
  s.promptBuilder.moduleOrder=Array.isArray(template.moduleIds)?[...template.moduleIds]:[];
  initializeWorkbenchForUseCase(useCase,{reset:false});
  s.promptBuilder.fields=(template.fields&&typeof template.fields==='object'&&!Array.isArray(template.fields))?template.fields:{};
  s.promptBuilder.additionalRequirements=String(template.additionalRequirements||'');
  s.promptBuilder.selectedTemplateId=template.id||null;
  s.promptBuilder.templateName=String(template.name||'');
  s.promptBuilder.templateDescription=String(template.description||'');
  s.promptBuilder.templateTags=tagsListToText(template.tags||[]);
  s.promptBuilder.preview=null;
  s.promptBuilder.previewEditable=false;
  s.promptBuilder.previewEditableContent='';
  s.promptBuilder.previewError=null;
  s.promptBuilder.saveStatus='Template loaded.';
}

async function loadWorkbenchTemplate(templateId){
  if(!templateId) return;
  s.promptBuilder.saveStatus='Loading template...';
  renderWorkbench();
  try {
    const payload=await getJson('/api/prompt-builder/templates/'+encodeURIComponent(templateId));
    applyTemplateToCanvas(payload.template);
    scheduleWorkbenchPreview();
  } catch(error){
    s.promptBuilder.saveStatus='Load failed: '+(error.message||String(error));
  }
  renderWorkbench();
}

async function generateWorkbenchPreview(options){
  const opts=options||{};
  const useCase=selectedUseCase();
  if(!useCase) return;
  initializeWorkbenchForUseCase(useCase,{reset:false});

  s.promptBuilder.previewLoading=true;
  s.promptBuilder.previewError=null;
  if(!opts.silent) renderWorkbench();

  try {
    const preview=await sendJson('POST','/api/prompt-builder/preview',{
      useCaseId:useCase.id,
      moduleIds:[...(s.promptBuilder.moduleOrder||[])],
      additionalRequirements:String(s.promptBuilder.additionalRequirements||''),
      fields:s.promptBuilder.fields||{},
    });
    s.promptBuilder.preview=preview.preview;
    if(!s.promptBuilder.previewEditable){
      s.promptBuilder.previewEditableContent=(preview&&preview.preview&&preview.preview.content)||'';
    }
  } catch(error){
    s.promptBuilder.previewError=error.message||String(error);
  } finally {
    s.promptBuilder.previewLoading=false;
    renderWorkbench();
  }
}

function setPreviewEditMode(editable){
  const enabled=Boolean(editable);
  s.promptBuilder.previewEditable=enabled;
  if(enabled){
    s.promptBuilder.previewEditableContent=(s.promptBuilder.preview&&s.promptBuilder.preview.content)||s.promptBuilder.previewEditableContent||'';
  }
  renderWorkbench();
}

async function copyWorkbenchPreview(){
  const text=currentPreviewText();
  if(!text){
    s.promptBuilder.saveStatus='Nothing to copy.';
    renderWorkbench();
    return;
  }
  try {
    if(navigator&&navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
    } else {
      const area=document.createElement('textarea');
      area.value=text;
      document.body.appendChild(area);
      area.focus();
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    s.promptBuilder.saveStatus='Preview copied.';
  } catch(error){
    s.promptBuilder.saveStatus='Copy failed: '+(error.message||String(error));
  }
  renderWorkbench();
}

function exportWorkbenchPreview(){
  const text=currentPreviewText();
  if(!text){
    s.promptBuilder.saveStatus='Nothing to export.';
    renderWorkbench();
    return;
  }
  const useCase=selectedUseCase();
  const safeName=String((s.promptBuilder.templateName||((useCase&&useCase.id)||'prompt-workbench'))).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'prompt-workbench';
  const fileName=safeName+'.md';
  const blob=new Blob([text],{type:'text/markdown;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=fileName;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  document.body.removeChild(link);
  s.promptBuilder.saveStatus='Exported '+fileName+'.';
  renderWorkbench();
}

function renderWorkbench(){
  const root=q('workbench');
  root.classList.toggle('active',s.tab==='workbench');
  if(s.tab!=='workbench') return;

  if(s.promptBuilder.loading){
    root.innerHTML='<div class="sub"><div class="empty">Loading Prompt Workbench use cases...</div></div>';
    return;
  }

  if(s.promptBuilder.error){
    root.innerHTML='<div class="sub"><div class="empty">Prompt Workbench unavailable: '+esc(s.promptBuilder.error)+'</div><div class="actions"><button class="btn" id="wbRetry">Retry</button></div></div>';
    const retry=q('wbRetry');
    if(retry) retry.onclick=()=>loadPromptBuilderData();
    return;
  }

  const useCases=s.promptBuilder.useCases||[];
  if(!useCases.length){
    root.innerHTML='<div class="sub"><div class="empty">No Prompt Workbench use cases available.</div></div>';
    return;
  }

  ensureWorkbenchUseCaseSelection();
  initializeWorkbenchForUseCase(selectedUseCase(),{reset:false});

  const filter=((q('wbFilter')&&q('wbFilter').value)||'').toLowerCase();
  const filtered=useCases.filter((entry)=>!filter||entry.title.toLowerCase().includes(filter)||entry.description.toLowerCase().includes(filter)||entry.id.toLowerCase().includes(filter));
  const selected=selectedUseCase();
  const moduleMap=moduleTitleMap();
  const preview=s.promptBuilder.preview;
  const moduleOrder=s.promptBuilder.moduleOrder||[];
  const availableModules=(s.promptBuilder.modules||[]).filter((entry)=>!moduleOrder.includes(entry.id));
  const selectedModule=selectedCanvasModule();
  const fieldDefs=collectFieldDefinitions(selected,moduleOrder);
  const activeFieldDefs=selectedModule&&Array.isArray(selectedModule.configFields)&&selectedModule.configFields.length>0
    ? selectedModule.configFields.map((field)=>({
      name:String(field.name||'').trim(),
      label:String(field.name||'').trim(),
      type:String(field.type||'string'),
    })).filter((entry)=>entry.name)
    : fieldDefs;
  const previewText=currentPreviewText();

  root.innerHTML='<div class="sub"><h2>Prompt Workbench</h2><p>Template-based flow: choose use case, fill only your goal, preview, then compare and export.</p><input id="wbFilter" type="search" placeholder="Filter use cases"><div class="card-grid">'+filtered.map((entry)=>'<div class="card'+(selected&&selected.id===entry.id?' active':'')+'"><h3>'+esc(entry.title)+'</h3><p>'+esc(entry.description||'')+'</p><div class="meta"><div class="token">Priority: '+esc(entry.priority||'n/a')+'</div><div class="token">Default Modules: '+esc(String((entry.defaultModuleIds||[]).length))+'</div></div><div class="actions"><button class="btn" data-wb-select="'+esc(entry.id)+'">Select</button></div></div>').join('')+'</div><h3>Template</h3><div class="field-grid"><label>Name<input id="wbTemplateName" value="'+escAttr(s.promptBuilder.templateName||'')+'" placeholder="Template name"></label><label>Description<textarea id="wbTemplateDescription" placeholder="Template description">'+esc(s.promptBuilder.templateDescription||'')+'</textarea></label><label>Tags (comma separated)<input id="wbTemplateTags" value="'+escAttr(s.promptBuilder.templateTags||'')+'" placeholder="mvp, api, ui"></label><label>Saved Templates<select id="wbTemplateSel"><option value="">'+esc('Select saved template')+'</option>'+((s.promptBuilder.templates||[]).map((template)=>'<option value="'+esc(template.id)+'"'+(template.id===s.promptBuilder.selectedTemplateId?' selected':'')+'>'+esc(template.name)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbLoadTemplate">Load</button><button class="btn primary" id="wbSaveTemplate">Save Template</button><button class="btn" id="wbDeleteTemplate">Delete</button></div><div class="small '+statusToneClass(s.promptBuilder.saveStatus)+'">'+esc(s.promptBuilder.saveStatus||'')+'</div><h3>Output Context Source (optional)</h3><div class="field-grid"><label>Analyze Run<select id="wbContextRunSel"><option value="">'+esc('Select output/<PROGRAM>')+'</option>'+((s.promptBuilder.contextSources||[]).map((entry)=>'<option value="'+esc(entry.program)+'"'+(entry.program===s.promptBuilder.contextSourceProgram?' selected':'')+'>'+esc(entry.program+' ('+(entry.promptArtifactCount||0)+' prompts)')+'</option>').join(''))+'</select></label><label>Prompt Artifact<select id="wbContextPromptSel"><option value="">'+esc('Select ai_prompt_*.md')+'</option>'+((s.promptBuilder.contextSourcePrompts||[]).map((entry)=>'<option value="'+esc(entry.path)+'"'+(entry.path===s.promptBuilder.contextSourcePromptPath?' selected':'')+'>'+esc(entry.path)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbContextRefresh">Refresh Runs</button><button class="btn" id="wbContextLoadPrompts">Load Prompts</button><button class="btn" id="wbContextImport">Import As Seed</button></div><div class="small '+statusToneClass(s.promptBuilder.contextSourceStatus)+'">'+esc(s.promptBuilder.contextSourceStatus||'')+'</div><h3>Prompt Canvas</h3><div class="item-list">'+moduleOrder.map((moduleId,index)=>'<div class="module-row'+(s.promptBuilder.selectedModuleId===moduleId?' active':'')+'"><h4>'+esc(moduleMap[moduleId]||moduleId)+'</h4><div class="small">'+esc(moduleId)+'</div><div class="actions"><button class="btn" data-wb-module-select="'+esc(moduleId)+'">Config</button><button class="btn" data-wb-module-up="'+esc(String(index))+'">Up</button><button class="btn" data-wb-module-down="'+esc(String(index))+'">Down</button><button class="btn" data-wb-module-remove="'+esc(String(index))+'">Remove</button></div></div>').join('')+'</div><h4>Add Module</h4><div class="chips">'+(availableModules.length?availableModules.map((module)=>'<button class="btn" data-wb-module-add="'+esc(module.id)+'">+ '+esc(module.title)+'</button>').join(''):'<div class="empty">All modules in canvas.</div>')+'</div><h4>Additional Requirements</h4><textarea id="wbAddReq" style="min-height:180px" placeholder="Additional requirements for this implementation prompt...">'+esc(s.promptBuilder.additionalRequirements||'')+'</textarea></div>'+
    '<div class="sub">'+
    (selected?'<h2>'+esc(selected.title)+'</h2><p>'+esc(selected.description||'')+'</p><div class="tokens"><div class="token">Modules in Canvas: '+esc(String(moduleOrder.length))+'</div><div class="token">Preview tokens: '+esc(String((preview&&preview.estimatedTokens)||0))+'</div><div class="token">Mode: '+esc(s.promptBuilder.previewEditable?'edit':'live')+'</div></div><h3>Module Configuration'+(selectedModule?': '+esc(selectedModule.title):'')+'</h3>'+(activeFieldDefs.length?'<div class="field-grid">'+activeFieldDefs.map((field)=>renderCanvasFieldInput(field,(s.promptBuilder.fields||{})[field.name])).join('')+'</div>':'<div class="empty">No configurable fields for selected modules.</div>')+'<div class="actions"><button class="btn" id="wbPreviewRefresh">Refresh Preview</button><button class="btn" id="wbEditToggle">'+esc(s.promptBuilder.previewEditable?'Lock Preview':'Edit Preview')+'</button><button class="btn" id="wbCopyPreview">Copy</button><button class="btn" id="wbExportPreview">Export</button><button class="btn" id="wbToCompare">Open Prompt Compare</button></div><h3>Live Preview</h3><div id="wbPreviewPane" class="preview">'+(s.promptBuilder.previewLoading?'<pre>Generating preview...</pre>':s.promptBuilder.previewError?'<div class="empty">'+esc(s.promptBuilder.previewError)+'</div>':s.promptBuilder.previewEditable?'<textarea id="wbPreviewEditor" style="min-height:360px">'+esc(previewText)+'</textarea>':previewText?'<pre>'+esc(previewText)+'</pre>':'<div class="empty">No preview yet. Configure canvas or click refresh.</div>')+'</div>'
    :'<div class="empty">Select a use case to start.</div>')+
    '</div>';

  const filterInput=q('wbFilter');
  if(filterInput){
    filterInput.value=filter;
    filterInput.oninput=()=>renderWorkbench();
  }

  for(const b of root.querySelectorAll('[data-wb-select]')){
    b.onclick=()=>setWorkbenchUseCase(b.dataset.wbSelect);
  }

  const templateName=q('wbTemplateName');
  if(templateName){
    templateName.oninput=(e)=>{s.promptBuilder.templateName=e.target.value;s.promptBuilder.saveStatus='';};
  }

  const templateDescription=q('wbTemplateDescription');
  if(templateDescription){
    templateDescription.oninput=(e)=>{s.promptBuilder.templateDescription=e.target.value;s.promptBuilder.saveStatus='';};
  }

  const templateTags=q('wbTemplateTags');
  if(templateTags){
    templateTags.oninput=(e)=>{s.promptBuilder.templateTags=e.target.value;s.promptBuilder.saveStatus='';};
  }

  const templateSel=q('wbTemplateSel');
  if(templateSel){
    templateSel.onchange=(e)=>{
      s.promptBuilder.selectedTemplateId=e.target.value||null;
      s.promptBuilder.saveStatus='';
    };
  }

  const loadTemplateButton=q('wbLoadTemplate');
  if(loadTemplateButton){
    loadTemplateButton.onclick=()=>loadWorkbenchTemplate((q('wbTemplateSel')&&q('wbTemplateSel').value)||s.promptBuilder.selectedTemplateId);
  }

  const saveTemplateButton=q('wbSaveTemplate');
  if(saveTemplateButton){
    saveTemplateButton.onclick=()=>saveWorkbenchTemplate();
  }

  const deleteTemplateButton=q('wbDeleteTemplate');
  if(deleteTemplateButton){
    deleteTemplateButton.onclick=()=>deleteWorkbenchTemplate();
  }

  const contextRunSel=q('wbContextRunSel');
  if(contextRunSel){
    contextRunSel.onchange=(e)=>{
      s.promptBuilder.contextSourceProgram=e.target.value||'';
      s.promptBuilder.contextSourceStatus='';
    };
  }

  const contextPromptSel=q('wbContextPromptSel');
  if(contextPromptSel){
    contextPromptSel.onchange=(e)=>{
      s.promptBuilder.contextSourcePromptPath=e.target.value||'';
      s.promptBuilder.contextSourceStatus='';
    };
  }

  const contextRefresh=q('wbContextRefresh');
  if(contextRefresh){
    contextRefresh.onclick=async()=>{
      s.promptBuilder.contextSourceStatus='Refreshing context runs...';
      renderWorkbench();
      try {
        await refreshContextSources();
        s.promptBuilder.contextSourceStatus='Context runs refreshed.';
      } catch(error){
        s.promptBuilder.contextSourceStatus='Context refresh failed: '+(error.message||String(error));
      }
      renderWorkbench();
    };
  }

  const contextLoadPrompts=q('wbContextLoadPrompts');
  if(contextLoadPrompts){
    contextLoadPrompts.onclick=()=>loadContextSourcePrompts((q('wbContextRunSel')&&q('wbContextRunSel').value)||s.promptBuilder.contextSourceProgram);
  }

  const contextImport=q('wbContextImport');
  if(contextImport){
    contextImport.onclick=()=>{
      s.promptBuilder.contextSourceProgram=(q('wbContextRunSel')&&q('wbContextRunSel').value)||s.promptBuilder.contextSourceProgram;
      s.promptBuilder.contextSourcePromptPath=(q('wbContextPromptSel')&&q('wbContextPromptSel').value)||s.promptBuilder.contextSourcePromptPath;
      importContextSourcePrompt();
    };
  }

  for(const b of root.querySelectorAll('[data-wb-module-select]')){
    b.onclick=()=>{s.promptBuilder.selectedModuleId=b.dataset.wbModuleSelect;renderWorkbench();};
  }

  for(const b of root.querySelectorAll('[data-wb-module-up]')){
    b.onclick=()=>moveCanvasModule(Number(b.dataset.wbModuleUp),-1);
  }

  for(const b of root.querySelectorAll('[data-wb-module-down]')){
    b.onclick=()=>moveCanvasModule(Number(b.dataset.wbModuleDown),1);
  }

  for(const b of root.querySelectorAll('[data-wb-module-remove]')){
    b.onclick=()=>removeCanvasModule(Number(b.dataset.wbModuleRemove));
  }

  for(const b of root.querySelectorAll('[data-wb-module-add]')){
    b.onclick=()=>addCanvasModule(b.dataset.wbModuleAdd);
  }

  const addReq=q('wbAddReq');
  if(addReq){
    addReq.oninput=(e)=>{
      s.promptBuilder.additionalRequirements=e.target.value;
      s.promptBuilder.saveStatus='';
      scheduleWorkbenchPreview();
    };
  }

  for(const fieldInput of root.querySelectorAll('[data-wb-field-name]')){
    fieldInput.oninput=(e)=>{
      updateCanvasField(e.target.dataset.wbFieldName,e.target.dataset.wbFieldType,e.target.value);
    };
  }

  const previewRefresh=q('wbPreviewRefresh');
  if(previewRefresh){
    previewRefresh.onclick=()=>generateWorkbenchPreview();
  }

  const editToggle=q('wbEditToggle');
  if(editToggle){
    editToggle.onclick=()=>setPreviewEditMode(!s.promptBuilder.previewEditable);
  }

  const copyPreview=q('wbCopyPreview');
  if(copyPreview){
    copyPreview.onclick=()=>copyWorkbenchPreview();
  }

  const exportPreview=q('wbExportPreview');
  if(exportPreview){
    exportPreview.onclick=()=>exportWorkbenchPreview();
  }

  const previewEditor=q('wbPreviewEditor');
  if(previewEditor){
    previewEditor.oninput=(e)=>{s.promptBuilder.previewEditableContent=e.target.value;};
  }

  const toCompare=q('wbToCompare');
  if(toCompare){
    toCompare.onclick=()=>{s.tab='prompts';render();};
  }
}
function renderArtifacts(){
  const root=q('artifacts');
  root.classList.toggle('active',s.tab==='artifacts');
  if(s.tab!=='artifacts') return;

  if(!s.detail||!s.detail.artifacts.length){
    root.innerHTML='<div class="sub"><div class="empty">No artifacts.</div></div>';
    return;
  }

  root.innerHTML='<div class="sub"><h2>Artifact Explorer</h2><p>Artifacts are fetched only when selected.</p><div class="item-list">'+s.detail.artifacts.map((a)=>'<button class="item'+(a.path===s.artifact?' active':'')+'" data-aid="'+esc(a.path)+'"><strong>'+esc(a.path)+'</strong><div>'+esc(a.kind)+' • '+esc(String(a.sizeBytes))+' bytes</div></button>').join('')+'</div></div><div class="sub"><div class="stack"><h2 id="aTitle">Artifact Preview</h2><p id="aSub">Choose an artifact.</p></div><a id="aRaw" class="btn" target="_blank" rel="noreferrer" hidden>Open Raw</a><div id="aPrev" class="preview"><div class="empty">No artifact selected.</div></div></div>';

  for(const b of root.querySelectorAll('[data-aid]')){
    b.onclick=()=>{
      s.artifact=b.dataset.aid;
      renderArtifacts();
      renderArtifactPreview();
    };
  }
}

async function renderArtifactPreview(){
  if(s.tab!=='artifacts') return;

  const root=q('aPrev');
  const title=q('aTitle');
  const sub=q('aSub');
  const raw=q('aRaw');

  if(!s.artifact){
    title.textContent='Artifact Preview';
    sub.textContent='Choose an artifact.';
    root.innerHTML='<div class="empty">No artifact selected.</div>';
    raw.hidden=true;
    return;
  }

  const art=s.detail.artifacts.find((a)=>a.path===s.artifact);
  if(!art){
    root.innerHTML='<div class="empty">Artifact not found.</div>';
    raw.hidden=true;
    return;
  }

  title.textContent=art.path;
  sub.textContent=art.kind+' preview';

  const rawUrl='/runs/'+encodeURIComponent(s.program)+'/artifacts/raw?path='+encodeURIComponent(art.path);
  raw.href=rawUrl;
  raw.hidden=false;

  if(art.kind==='html'){
    root.innerHTML='<iframe src="'+rawUrl+'"></iframe>';
    return;
  }

  root.innerHTML='<pre>Loading...</pre>';
  const p=await getArtifact(art.path);
  const c=art.kind==='json'?JSON.stringify(JSON.parse(p.content),null,2):p.content;
  root.innerHTML='<pre>'+esc(c)+'</pre>';
}

async function selectTab(tab){
  s.tab=tab;
  await render();
}

async function render(){
  renderTabs();
  renderHome();
  renderConfigure();
  renderGraph();
  renderDb2();
  await renderPrompts();
  renderWorkbench();
  renderArtifacts();
  await renderArtifactPreview();
}

async function selectRun(program){
  s.program=program;
  s.cache.clear();
  renderRuns();

  s.detail=await getJson('/api/runs/'+encodeURIComponent(program));
  s.artifact=runDefaultArtifact();
  s.node=s.detail.views.graph.nodes[0]&&s.detail.views.graph.nodes[0].id||null;
  s.table=s.detail.views.db2.tables[0]&&s.detail.views.db2.tables[0].id||null;

  const ps=s.detail.views.prompts.artifacts;
  s.left=ps[0]&&ps[0].path||null;
  s.right=ps[1]&&ps[1].path||s.left;

  renderHero();
  renderMetrics();
  await render();
}

async function boot(){
  renderHero();
  renderTabs();
  await loadUiMetadata();
  renderHome();
  renderConfigure();
  await loadPromptBuilderData();
  await refreshRuns();
}

boot().catch((e)=>{
  q('artifacts').classList.add('active');
  q('artifacts').innerHTML='<div class="sub"><div class="empty">'+esc(e.message||String(e))+'</div></div>';
});
</script>
</body>
</html>`;
}

module.exports = {
  renderLocalUiShell,
};
