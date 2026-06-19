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
.btn[disabled]{
  cursor:not-allowed;
  opacity:.62;
  color:var(--muted);
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(237,245,247,.92));
  box-shadow:none;
  transform:none;
}
.btn[disabled]:hover{
  border-color:var(--line);
  box-shadow:none;
  transform:none;
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
.workflow-card.disabled{
  background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(241,246,247,.94));
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
          <p>Setup-first local UI for readiness checks and report review.</p>
          <div class="brand-note">tiny-tool.de</div>
        </div>
      </div>
      <div class="token">Brand Edition - Local-only UI + API</div>
    </div>
    <div id="runs" class="run-list"><div class="empty">No runs loaded yet. Start in Setup, then create analysis output under <code>./output</code> when you are ready.</div></div>
  </aside>
  <div class="main">
    <div class="panel hero">
      <div class="stack">
        <h2 id="title">Setup &amp; Readiness</h2>
        <p id="subtitle">Start with Setup to confirm profile selection, env overrides, and doctor readiness.</p>
      </div>
      <div id="chips" class="chips hero-meta"><div class="token">Runs: 0</div><div class="token">Setup first</div></div>
    </div>

    <div id="metrics" class="metrics"><div class="panel metric"><div>Primary Tab</div><strong>Setup</strong></div><div class="panel metric"><div>First Action</div><strong>Check Readiness</strong></div><div class="panel metric"><div>Reports</div><strong>After Output</strong></div><div class="panel metric"><div>Secrets</div><strong>Hidden</strong></div></div>
    <div id="tabs" class="panel tabs"><button class="tab active">Setup</button><button class="tab">Reports</button><button class="tab">Advanced / Tools</button></div>

    <div id="home" class="panel view two"></div>
    <div id="configure" class="panel view two active"></div>
    <div id="graph" class="panel view two"></div>
    <div id="db2" class="panel view two"></div>
    <div id="prompts" class="panel view three"></div>
    <div id="workbench" class="panel view two"></div>
    <div id="artifacts" class="panel view two"></div>
  </div>
</div>

<script>
const s={
  runs:[],detail:null,program:null,tab:'configure',homePanel:'guide',artifact:null,node:null,table:null,left:null,right:null,cache:new Map(),
  uiMetadata:{
    loading:false,
    error:null,
    payload:null,
    selectedConfigSection:'profile',
    selectedGuidedStep:'workspace',
    selectedGuidedIntent:'onboarding'
  },
  uiActions:{
    doctor:{
      profile:'dev',
      running:false,
      error:null,
      result:null
    },
    discovery:{
      profile:'dev',
      actionId:'discover-source-libraries',
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
    },
    aiSession:{
      profile:'dev',
      environment:'',
      goal:'',
      includeDoctorSummary:false,
      running:false,
      error:null,
      result:null,
      copyStatus:'',
      expanded:false
    }
  },
  profileWizard:{
    loading:false,
    loaded:false,
    previewing:false,
    saving:false,
    error:null,
    errorDiagnostics:[],
    saveStatus:'',
    state:null,
    selectedProfileName:'',
    draft:null,
    preview:null
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
  ['configure','Setup'],
  ['reports','Reports'],
  ['home','Advanced / Tools']
];

const reportViews=[
  ['artifacts','Overview'],
  ['graph','Graph'],
  ['db2','DB2 / Test Data'],
  ['prompts','Prompt Compare']
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
  if(/warn|warning|loading|refreshing|saving|deleting|importing|select |nothing to|no ai_prompt|empty|needs-|review|preview-ready|stale/.test(normalized)) return 'status-warn';
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
    try{
      const payload=JSON.parse(txt);
      const error=new Error(payload&&payload.error?payload.error:('Request failed: '+r.status));
      error.payload=payload;
      throw error;
    }catch(parseError){
      if(parseError&&parseError.payload) throw parseError;
      throw new Error(txt||('Request failed: '+r.status));
    }
  }
  return r.json();
}

async function sendJson(method,u,payload){
  const r=await fetch(u,{method,headers:{'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  if(!r.ok){
    const txt=await r.text();
    try{
      const parsed=JSON.parse(txt);
      const error=new Error(parsed&&parsed.error?parsed.error:('Request failed: '+r.status));
      error.payload=parsed;
      throw error;
    }catch(parseError){
      if(parseError&&parseError.payload) throw parseError;
      throw new Error(txt||('Request failed: '+r.status));
    }
  }
  return r.json();
}

const cloneJson=(value)=>JSON.parse(JSON.stringify(value));

function uniqueWizardStrings(values,{uppercase=false}={}){
  const list=Array.isArray(values)?values:String(values||'').split(',');
  const seen=new Set();
  const result=[];
  for(const entry of list){
    const trimmed=String(entry||'').trim();
    if(!trimmed) continue;
    const normalized=uppercase?trimmed.toUpperCase():trimmed;
    if(seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function emptyProfileWizardDraft(){
  return {
    profileName:'',
    comment:'',
    extends:['default-shared'],
    sourceRoot:'./workspace/source',
    outputRoot:'./workspace/output',
    analysesRegistryPath:'./analysis/_registry.json',
    productionSystem:false,
    environmentBindings:{
      defaultDbSystem:'',
      metadataSystem:'',
      testDataSystem:'',
      fetchSystem:''
    },
    fetch:{
      enabled:true,
      sourceLibrary:'',
      ifsDir:'',
      out:'./rpg_sources',
      files:['QRPGLESRC','QCLSRC','QDDSSRC'],
      members:[],
      transport:'auto'
    },
    managedEnvironments:[]
  };
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
    root.innerHTML='<div class="empty">No analysis runs found yet. Finish Setup first, then generate output with the CLI and refresh this list.</div>';
    return;
  }
  root.innerHTML=s.runs.map((r)=>'<button class="run'+(r.program===s.program?' active':'')+'" data-run="'+esc(r.program)+'"><strong>'+esc(r.program)+'</strong><div>'+esc(r.workflowPreset||r.workflowMode||'standard')+'</div><div>'+esc(fmt(r.completedAt))+'</div></button>').join('');
  for(const b of root.querySelectorAll('[data-run]')) b.onclick=()=>selectRun(b.dataset.run);
}

function renderHero(){
  if(!s.detail){
    q('title').textContent='Setup & Readiness';
    q('subtitle').textContent='Start with Setup to confirm profile selection, env overrides, and doctor readiness.';
    q('chips').innerHTML=[
      'Runs: '+String(s.runs.length||0),
      'Doctor is the first supported action'
    ].map((v)=>'<div class="token">'+esc(v)+'</div>').join('');
    return;
  }
  const x=s.detail.summary;
  q('title').textContent=x.program;
  q('subtitle').textContent=s.tab==='configure'
    ? 'Review setup, profile readiness, and safe next steps.'
    : (isReportsTab(s.tab)
      ? 'Read-only reports and report views for the selected run.'
      : (s.tab==='home'||s.tab==='workbench'
        ? 'Advanced and experimental tools live here after Setup is ready.'
        : 'Read-only explorer for generated analysis evidence.'));
  q('chips').innerHTML=['Status: '+(x.status||'unknown'),'Mode: '+(x.workflowPreset||x.workflowMode||'standard'),'Artifacts: '+x.artifactCount,x.safeSharingEnabled?'Safe sharing':'No safe sharing'].map((v)=>'<div class="token">'+esc(v)+'</div>').join('');
}

function renderMetrics(){
  const root=q('metrics');
  if(!s.detail){
    const m=[
      ['Primary Tab','Setup'],
      ['First Action','Check Readiness'],
      ['Reports','After Output'],
      ['Secrets','Hidden']
    ];
    root.innerHTML=m.map(([k,vv])=>'<div class="panel metric"><div>'+esc(k)+'</div><strong>'+esc(String(vv))+'</strong></div>').join('');
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
  q('tabs').innerHTML=tabs.map(([id,label])=>{
    const active=(id==='reports'&&isReportsTab(s.tab))||(s.tab===id)||(id==='home'&&s.tab==='workbench');
    return '<button class="tab'+(active?' active':'')+'" data-tab="'+id+'">'+label+'</button>';
  }).join('');
  for(const b of q('tabs').querySelectorAll('[data-tab]')) b.onclick=()=>selectTab(b.dataset.tab);
}

function isReportsTab(tab){
  return tab==='artifacts'||tab==='graph'||tab==='db2'||tab==='prompts';
}

function renderReportsSubnav(activeTab){
  return '<div class="stack"><div><h2>Reports</h2><p>Reports are local and read-only. They inspect existing artifacts and never fetch, query, or modify remote systems.</p></div><div class="tabs">'+reportViews.map(([id,label])=>'<button class="tab'+(id===activeTab?' active':'')+'" data-report-view="'+esc(id)+'">'+esc(label)+'</button>').join('')+'</div><div class="small">Select a run in the left sidebar, then choose the report view you want to inspect.</div></div>';
}

function bindReportsSubnav(root){
  for(const button of root.querySelectorAll('[data-report-view]')){
    button.onclick=async ()=>{
      s.tab=button.dataset.reportView||'artifacts';
      await render();
    };
  }
}

function renderCommandBlock(lines){
  return '<div class="command-block"><pre>'+esc((Array.isArray(lines)?lines:[String(lines||'')]).join('\\n'))+'</pre></div>';
}

function renderTokenRow(items,className){
  const safeItems=Array.isArray(items)?items:[];
  const tokens=safeItems.map((entry)=>{
    if(entry===null||entry===undefined||entry===false) return '';
    if(typeof entry==='object'){
      const text=entry.text===undefined||entry.text===null?'':String(entry.text);
      if(!text) return '';
      const toneClass=entry.tone?statusToneClass(entry.tone):'';
      return '<div class="token'+(toneClass?' '+escAttr(toneClass):'')+'">'+esc(text)+'</div>';
    }
    const text=String(entry);
    return text?'<div class="token">'+esc(text)+'</div>':'';
  }).filter(Boolean).join('');
  if(!tokens) return '';
  return '<div class="'+escAttr(className||'tokens')+'">'+tokens+'</div>';
}

function renderHintList(items){
  const safeItems=Array.isArray(items)?items:[];
  const content=safeItems.map((entry)=>{
    if(!entry||typeof entry!=='object') return '';
    const title=entry.title?'<strong>'+esc(String(entry.title))+'</strong>':'';
    const tokens=renderTokenRow(entry.tokens,'tokens');
    const body=entry.body?'<p>'+esc(String(entry.body))+'</p>':'';
    const bodyHtml=entry.bodyHtml?'<p>'+String(entry.bodyHtml)+'</p>':'';
    const small=entry.small?'<p class="small">'+esc(String(entry.small))+'</p>':'';
    const smallHtml=entry.smallHtml?'<p class="small">'+String(entry.smallHtml)+'</p>':'';
    return '<div class="hint-item">'+title+tokens+body+bodyHtml+small+smallHtml+'</div>';
  }).filter(Boolean).join('');
  return content?'<div class="hint-list">'+content+'</div>':'';
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
    { id:'configure', title:'Setup', description:'Review profile, environment overrides, and readiness.', badge:'configure', status:'Not checked yet', primaryActionLabel:'Open Setup', recommendedNext:'doctor', availability:'production-ready', enabledInShell:true, uiTarget:'configure', area:'primary', explanation:'Setup is the first supported browser flow.' },
    { id:'fetch-sources', title:'Fetch Sources', description:'Prepare source evidence from IBM i.', badge:'fetch', status:'Coming later', primaryActionLabel:'Coming Later', recommendedNext:'copy-to-workspace', availability:'coming-later', enabledInShell:false, uiTarget:null, area:'advanced', explanation:'Remote fetch is not a supported browser action in this iteration.' },
    { id:'analyze-workspace', title:'Analyze Workspace', description:'Run the local-only analyze pipeline against an existing workspace source root.', badge:'analyze', status:'Advanced local-only', primaryActionLabel:'Analyze Workspace', recommendedNext:'serve', availability:'advanced', enabledInShell:true, uiTarget:'analyze-workspace', area:'advanced', explanation:'Use only after Setup is ready.' },
    { id:'query-db2', title:'Query DB2', description:'Run read-only DB2 query workflows.', badge:'query', status:'Coming later', primaryActionLabel:'Coming Later', recommendedNext:'query-table', availability:'coming-later', enabledInShell:false, uiTarget:null, area:'advanced', explanation:'DB2 query execution is not exposed as a browser action here.' },
    { id:'review-reports', title:'Reports', description:'Inspect report and artifact output.', badge:'review', status:'Available now', primaryActionLabel:'Open Reports', recommendedNext:'bundle', availability:'production-ready', enabledInShell:true, uiTarget:'reports', area:'secondary', explanation:'Read-only report and artifact review is supported now.' },
    { id:'generate-ai-context', title:'Generate AI Context', description:'Bundle and refine AI context artifacts.', badge:'context', status:'Coming later', primaryActionLabel:'Coming Later', recommendedNext:'bundle', availability:'coming-later', enabledInShell:false, uiTarget:null, area:'advanced', explanation:'AI context generation is intentionally out of scope for this browser iteration.' }
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

function setupMetadata(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  return payload&&payload.setup&&typeof payload.setup==='object'
    ? payload.setup
    : null;
}

function guidedConfiguration(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  return payload&&payload.guidedConfiguration&&typeof payload.guidedConfiguration==='object'
    ? payload.guidedConfiguration
    : null;
}

function guidedConfigSteps(){
  const payload=guidedConfiguration();
  return payload&&Array.isArray(payload.steps)?payload.steps:[];
}

function guidedConfigIntents(){
  const payload=guidedConfiguration();
  return payload&&Array.isArray(payload.intents)?payload.intents:[];
}

function guidedDiscoveryActions(){
  const payload=guidedConfiguration();
  return payload&&Array.isArray(payload.discoveryActions)?payload.discoveryActions:[];
}

function guidedPurposeLabels(){
  const payload=guidedConfiguration();
  return payload&&Array.isArray(payload.purposeLabels)?payload.purposeLabels:[];
}

function profileWizardMetadata(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  return payload&&payload.profileWizard&&typeof payload.profileWizard==='object'
    ? payload.profileWizard
    : null;
}

function aiSessionStarterMetadata(){
  const payload=s.uiMetadata&&s.uiMetadata.payload;
  return payload&&payload.aiSessionStarter&&typeof payload.aiSessionStarter==='object'
    ? payload.aiSessionStarter
    : null;
}

function fallbackProfileWizardSteps(){
  return [
    { id:'identity', title:'Name The Profile', description:'Set profile name, comment, and base profile extensions.', statusWhenMissing:'needs-profile-input' },
    { id:'workspace', title:'Confirm Workspace Paths', description:'Review source, output, and analysis registry paths.', statusWhenMissing:'needs-profile-input' },
    { id:'environment-routing', title:'Route Environment Roles', description:'Bind DB and fetch roles to known system keys.', statusWhenMissing:'needs-scope' },
    { id:'fetch-scope', title:'Scope Source Fetch', description:'Define the source library, IFS directory, files, members, and transport.', statusWhenMissing:'needs-scope' },
    { id:'managed-environments', title:'Manage Local Environments', description:'Add placeholder-based systems for local-only profile overlays.', statusWhenMissing:'needs-profile-input' },
    { id:'preview-save', title:'Preview And Save', description:'Validate the draft and save only to config/local-only.', statusWhenMissing:'preview-ready' }
  ];
}

function profileWizardSteps(){
  const metadata=profileWizardMetadata();
  const steps=metadata&&Array.isArray(metadata.steps)?metadata.steps:[];
  return steps.length?steps:fallbackProfileWizardSteps();
}

function findProfileWizardSummary(profileName){
  const normalized=String(profileName||'').trim();
  const state=profileWizardState();
  const profiles=state&&Array.isArray(state.profiles)?state.profiles:[];
  return profiles.find((entry)=>entry&&entry.name===normalized)||null;
}

function defaultGuidedStep(){
  const steps=guidedConfigSteps();
  return steps[0]&&steps[0].id?steps[0].id:'workspace';
}

function defaultGuidedIntent(){
  const intents=guidedConfigIntents();
  return intents[0]&&intents[0].id?intents[0].id:'onboarding';
}

function defaultConfigSection(){
  const sections=metadataSections();
  return sections[0]&&sections[0].id?sections[0].id:'profile';
}

function cardToHomeTarget(cardId){
  const card=workflowCards().find((entry)=>entry.id===cardId);
  if(card&&card.uiTarget) return card.uiTarget;
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
    if(!guidedConfigSteps().some((step)=>step.id===s.uiMetadata.selectedGuidedStep)){
      s.uiMetadata.selectedGuidedStep=defaultGuidedStep();
    }
    if(!guidedConfigIntents().some((intent)=>intent.id===s.uiMetadata.selectedGuidedIntent)){
      s.uiMetadata.selectedGuidedIntent=defaultGuidedIntent();
    }
    if(!guidedDiscoveryActions().some((action)=>action.id===s.uiActions.discovery.actionId)){
      s.uiActions.discovery.actionId=(guidedDiscoveryActions()[0]&&guidedDiscoveryActions()[0].id)||'discover-source-libraries';
    }
  }catch(error){
    s.uiMetadata.error=error.message||String(error);
  }finally{
    s.uiMetadata.loading=false;
  }
}

function profileWizardState(){
  return s.profileWizard&&s.profileWizard.state&&typeof s.profileWizard.state==='object'
    ? s.profileWizard.state
    : null;
}

function ensureProfileWizardDraft(){
  if(!s.profileWizard.draft||typeof s.profileWizard.draft!=='object'){
    s.profileWizard.draft=emptyProfileWizardDraft();
  }
  return s.profileWizard.draft;
}

function profileWizardSystemOptions(){
  const state=profileWizardState();
  const fromState=state&&Array.isArray(state.systems)?state.systems.map((entry)=>entry.key):[];
  const draft=ensureProfileWizardDraft();
  const fromDraft=Array.isArray(draft.managedEnvironments)?draft.managedEnvironments.map((entry)=>String(entry&&entry.key||'').trim()).filter(Boolean):[];
  return Array.from(new Set([...fromState,...fromDraft])).sort((left,right)=>left.localeCompare(right));
}

async function loadProfileWizardState(){
  s.profileWizard.loading=true;
  s.profileWizard.error=null;
  s.profileWizard.errorDiagnostics=[];
  try{
    const payload=await getJson('/api/profile-wizard/state');
    s.profileWizard.state=payload;
    s.profileWizard.loaded=true;
    if(!s.profileWizard.draft){
      const nextDraft=emptyProfileWizardDraft();
      if(Array.isArray(payload.managedEnvironmentDraft)&&payload.managedEnvironmentDraft.length){
        nextDraft.managedEnvironments=cloneJson(payload.managedEnvironmentDraft);
      }
      s.profileWizard.draft=nextDraft;
    }
  }catch(error){
    s.profileWizard.error=error.message||String(error);
  }finally{
    s.profileWizard.loading=false;
  }
}

async function loadProfileWizardProfile(profileName){
  const normalized=String(profileName||'').trim();
  if(!normalized) return;
  s.profileWizard.loading=true;
  s.profileWizard.error=null;
  s.profileWizard.errorDiagnostics=[];
  try{
    const payload=await getJson('/api/profile-wizard/profiles/'+encodeURIComponent(normalized));
    s.profileWizard.selectedProfileName=normalized;
    s.profileWizard.draft=payload&&payload.draft?payload.draft:emptyProfileWizardDraft();
    s.profileWizard.preview=null;
    s.profileWizard.saveStatus=payload&&payload.sourceKind
      ? ('Loaded '+normalized+' from '+String(payload.sourceKind)+'.')
      : ('Loaded '+normalized+'.');
    s.uiActions.doctor.profile=normalized;
    s.uiActions.discovery.profile=normalized;
  }catch(error){
    s.profileWizard.error=error.message||String(error);
    s.profileWizard.errorDiagnostics=error&&error.payload&&Array.isArray(error.payload.diagnostics)?error.payload.diagnostics:[];
  }finally{
    s.profileWizard.loading=false;
  }
}

function startNewProfileWizardDraft(){
  const state=profileWizardState();
  const nextDraft=emptyProfileWizardDraft();
  if(state&&Array.isArray(state.managedEnvironmentDraft)&&state.managedEnvironmentDraft.length){
    nextDraft.managedEnvironments=cloneJson(state.managedEnvironmentDraft);
  }
  s.profileWizard.selectedProfileName='';
  s.profileWizard.draft=nextDraft;
  s.profileWizard.preview=null;
  s.profileWizard.saveStatus='New draft ready.';
}

async function previewProfileWizardDraft(){
  const draft=ensureProfileWizardDraft();
  s.profileWizard.previewing=true;
  s.profileWizard.error=null;
  s.profileWizard.errorDiagnostics=[];
  try{
    const payload=await sendJson('POST','/api/profile-wizard/preview',draft);
    s.profileWizard.preview=payload;
    s.profileWizard.saveStatus='Draft preview refreshed.';
  }catch(error){
    s.profileWizard.error=error.message||String(error);
    s.profileWizard.errorDiagnostics=error&&error.payload&&Array.isArray(error.payload.diagnostics)?error.payload.diagnostics:[];
    s.profileWizard.preview=null;
  }finally{
    s.profileWizard.previewing=false;
  }
}

async function saveProfileWizardDraft(){
  const draft=ensureProfileWizardDraft();
  s.profileWizard.saving=true;
  s.profileWizard.error=null;
  s.profileWizard.errorDiagnostics=[];
  try{
    const payload=await sendJson('POST','/api/profile-wizard/save',draft);
    s.profileWizard.preview=payload.preview||null;
    s.profileWizard.saveStatus='Saved to local-only profiles.';
    s.profileWizard.selectedProfileName=String(payload.profileName||draft.profileName||'').trim();
    s.uiActions.doctor.profile=s.profileWizard.selectedProfileName||s.uiActions.doctor.profile;
    s.uiActions.discovery.profile=s.profileWizard.selectedProfileName||s.uiActions.discovery.profile;
    await loadProfileWizardState();
  }catch(error){
    s.profileWizard.error=error.message||String(error);
    s.profileWizard.errorDiagnostics=error&&error.payload&&Array.isArray(error.payload.diagnostics)?error.payload.diagnostics:[];
  }finally{
    s.profileWizard.saving=false;
  }
}

function suggestProfileWizardCloneName(baseName){
  const normalizedBase=String(baseName||'').trim()||'profile';
  const state=profileWizardState();
  const knownNames=new Set([
    ...((state&&Array.isArray(state.profiles)?state.profiles:[]).map((entry)=>String(entry&&entry.name||'').trim()).filter(Boolean)),
    String(ensureProfileWizardDraft().profileName||'').trim()
  ]);
  let candidate=normalizedBase.endsWith('-local')?normalizedBase+'-copy':normalizedBase+'-local';
  if(!knownNames.has(candidate)) return candidate;
  let counter=2;
  while(knownNames.has(candidate+'-'+String(counter))){
    counter+=1;
  }
  return candidate+'-'+String(counter);
}

function cloneCurrentProfileWizardDraft(){
  const draft=ensureProfileWizardDraft();
  const cloned=cloneJson(draft);
  cloned.profileName=suggestProfileWizardCloneName(cloned.profileName||s.profileWizard.selectedProfileName||'profile');
  s.profileWizard.selectedProfileName='';
  s.profileWizard.draft=cloned;
  s.profileWizard.preview=null;
  s.profileWizard.saveStatus='Draft cloned. Review the new profile name before saving.';
}

async function deleteProfileWizardProfile(profileName){
  const normalized=String(profileName||'').trim();
  if(!normalized){
    s.profileWizard.error='Select a local-only profile before deleting it.';
    return;
  }
  s.profileWizard.saving=true;
  s.profileWizard.error=null;
  s.profileWizard.errorDiagnostics=[];
  try{
    const payload=await sendJson('DELETE','/api/profile-wizard/profiles/'+encodeURIComponent(normalized));
    s.profileWizard.saveStatus=payload&&Array.isArray(payload.notes)&&payload.notes.length
      ? String(payload.notes[0])
      : ('Deleted '+normalized+' from local-only profiles.');
    s.profileWizard.selectedProfileName='';
    s.profileWizard.preview=null;
    await loadProfileWizardState();
    startNewProfileWizardDraft();
  }catch(error){
    s.profileWizard.error=error.message||String(error);
    s.profileWizard.errorDiagnostics=error&&error.payload&&Array.isArray(error.payload.diagnostics)?error.payload.diagnostics:[];
  }finally{
    s.profileWizard.saving=false;
  }
}

function renderProfileWizardSystemOptions(selectedValue){
  const current=String(selectedValue||'').trim();
  const options=profileWizardSystemOptions();
  return '<option value="">'+esc('Select environment')+'</option>'+options.map((entry)=>'<option value="'+escAttr(entry)+'"'+(entry===current?' selected':'')+'>'+esc(entry)+'</option>').join('');
}

function profileWizardDiagnostics(){
  const freshness=profileWizardPreviewFreshness();
  const previewDiagnostics=s.profileWizard.preview&&Array.isArray(s.profileWizard.preview.diagnostics)
    ? s.profileWizard.preview.diagnostics
    : [];
  const errorDiagnostics=Array.isArray(s.profileWizard.errorDiagnostics)?s.profileWizard.errorDiagnostics:[];
  return freshness.isFresh&&previewDiagnostics.length?previewDiagnostics:errorDiagnostics;
}

function profileWizardStepValidation(){
  const freshness=profileWizardPreviewFreshness();
  const previewSteps=s.profileWizard.preview&&Array.isArray(s.profileWizard.preview.stepValidation)
    ? s.profileWizard.preview.stepValidation
    : [];
  return freshness.isFresh?previewSteps:[];
}

function diagnosticsForField(fieldPath){
  return profileWizardDiagnostics().filter((entry)=>String(entry&&entry.fieldPath||'')===String(fieldPath||''));
}

function renderWizardFieldDiagnostics(fieldPath){
  const diagnostics=diagnosticsForField(fieldPath);
  if(!diagnostics.length) return '';
  return '<div class="small">'+diagnostics.map((entry)=>'<span class="'+esc(statusToneClass(entry.severity||'warning'))+'">'+esc(String(entry.message||''))+'</span>').join(' ')+'</div>';
}

function normalizeProfileWizardDraftForComparison(rawDraft){
  const draft=rawDraft&&typeof rawDraft==='object'?rawDraft:{};
  const bindings=draft.environmentBindings&&typeof draft.environmentBindings==='object'?draft.environmentBindings:{};
  const fetch=draft.fetch&&typeof draft.fetch==='object'?draft.fetch:{};
  const managedEnvironments=Array.isArray(draft.managedEnvironments)?draft.managedEnvironments:[];
  return {
    profileName:String(draft.profileName||'').trim(),
    comment:String(draft.comment||'').trim(),
    extends:uniqueWizardStrings(Array.isArray(draft.extends)?draft.extends:String(draft.extends||'').split(',')),
    sourceRoot:String(draft.sourceRoot||'').trim(),
    outputRoot:String(draft.outputRoot||'').trim(),
    analysesRegistryPath:String(draft.analysesRegistryPath||'').trim(),
    productionSystem:Boolean(draft.productionSystem),
    environmentBindings:{
      defaultDbSystem:String(bindings.defaultDbSystem||'').trim(),
      metadataSystem:String(bindings.metadataSystem||'').trim(),
      testDataSystem:String(bindings.testDataSystem||'').trim(),
      fetchSystem:String(bindings.fetchSystem||'').trim()
    },
    fetch:{
      enabled:fetch.enabled===undefined?true:Boolean(fetch.enabled),
      sourceLibrary:String(fetch.sourceLibrary||'').trim().toUpperCase(),
      ifsDir:String(fetch.ifsDir||'').trim(),
      out:String(fetch.out||'').trim(),
      files:uniqueWizardStrings(fetch.files,{uppercase:true}),
      members:uniqueWizardStrings(fetch.members,{uppercase:true}),
      transport:String(fetch.transport||'').trim().toLowerCase()
    },
    managedEnvironments:managedEnvironments.map((entry)=>({
      key:String(entry&&entry.key||'').trim(),
      displayName:String(entry&&entry.displayName||'').trim(),
      systemName:String(entry&&entry.systemName||'').trim(),
      aliases:uniqueWizardStrings(entry&&entry.aliases),
      hostEnvVar:String(entry&&entry.hostEnvVar||'').trim().toUpperCase(),
      userEnvVar:String(entry&&entry.userEnvVar||'').trim().toUpperCase(),
      passwordEnvVar:String(entry&&entry.passwordEnvVar||'').trim().toUpperCase(),
      defaultLibrary:String(entry&&entry.defaultLibrary||'').trim().toUpperCase(),
      defaultSchema:String(entry&&entry.defaultSchema||'').trim().toUpperCase()
    }))
  };
}

function profileWizardPreviewFreshness(){
  const preview=s.profileWizard.preview&&typeof s.profileWizard.preview==='object'?s.profileWizard.preview:null;
  if(!preview||!preview.draft||typeof preview.draft!=='object'){
    return {
      hasPreview:false,
      isFresh:false,
      isStale:false,
      status:'preview-missing',
      message:'No draft preview has been generated yet.'
    };
  }
  const current=JSON.stringify(normalizeProfileWizardDraftForComparison(ensureProfileWizardDraft()));
  const previewDraft=JSON.stringify(normalizeProfileWizardDraftForComparison(preview.draft));
  const isFresh=current===previewDraft;
  return {
    hasPreview:true,
    isFresh,
    isStale:!isFresh,
    status:isFresh?'preview-current':'preview-stale',
    message:isFresh
      ? 'Preview matches the current draft.'
      : 'Preview is stale until you run Preview Draft again.'
  };
}

function evaluateProfileWizardDraft(){
  const draft=ensureProfileWizardDraft();
  const preview=s.profileWizard.preview;
  const previewFreshness=profileWizardPreviewFreshness();
  const systems=new Set(profileWizardSystemOptions());
  const managedEnvironments=Array.isArray(draft.managedEnvironments)?draft.managedEnvironments:[];
  const bindings=draft.environmentBindings&&typeof draft.environmentBindings==='object'?draft.environmentBindings:{};
  const fetch=draft.fetch&&typeof draft.fetch==='object'?draft.fetch:{};
  const extendsList=Array.isArray(draft.extends)?draft.extends:[];
  const usesManagedCatalog=extendsList.includes('_gui-environments');
  const issues=[];
  const blockingIssueCodes=new Set();
  const addIssue=(severity,code,message)=>{
    issues.push({ severity, code, message });
    if(severity==='error') blockingIssueCodes.add(code);
  };

  const hasProfileName=Boolean(String(draft.profileName||'').trim());
  const hasSourceRoot=Boolean(String(draft.sourceRoot||'').trim());
  const hasOutputRoot=Boolean(String(draft.outputRoot||'').trim());
  const hasRegistryPath=Boolean(String(draft.analysesRegistryPath||'').trim());
  const selectedBindings=[
    String(bindings.defaultDbSystem||'').trim(),
    String(bindings.metadataSystem||'').trim(),
    String(bindings.testDataSystem||'').trim(),
    String(bindings.fetchSystem||'').trim()
  ].filter(Boolean);
  const unknownBindings=selectedBindings.filter((entry)=>!systems.has(entry));
  const fetchFileCount=Array.isArray(fetch.files)?fetch.files.length:0;
  const fetchMemberCount=Array.isArray(fetch.members)?fetch.members.length:0;
  const hasFetchAnchor=Boolean(String(fetch.sourceLibrary||'').trim()||String(fetch.ifsDir||'').trim());
  const managedMissingSecrets=managedEnvironments.filter((entry)=>{
    const safeEntry=entry&&typeof entry==='object'?entry:{};
    return !String(safeEntry.hostEnvVar||'').trim()
      || !String(safeEntry.userEnvVar||'').trim()
      || !String(safeEntry.passwordEnvVar||'').trim();
  });
  const managedMissingKeys=managedEnvironments.filter((entry)=>!String(entry&&entry.key||'').trim());

  if(!hasProfileName){
    addIssue('error','identity','Choose a profile name before previewing or saving.');
  }
  if(!hasSourceRoot||!hasOutputRoot){
    addIssue('error','workspace','Source Root and Output Root should be set so the CLI handoff stays complete.');
  }
  if(!selectedBindings.length){
    addIssue('warning','environment-routing','No environment roles are selected yet. Add at least the systems you want DB, metadata, test data, or fetch to use.');
  }
  if(unknownBindings.length){
    addIssue('warning','environment-routing','Some selected environment keys are not known in the current profile state or draft: '+unknownBindings.join(', ')+'.');
  }
  if(fetch.enabled!==false&&!hasFetchAnchor){
    addIssue('error','fetch-scope','Fetch is enabled but no source library or IFS directory is set yet.');
  }
  if(fetch.enabled!==false&&fetchFileCount===0&&fetchMemberCount===0){
    addIssue('warning','fetch-scope','Fetch scope has no file or member filters yet. That is valid, but usually worth reviewing.');
  }
  if(usesManagedCatalog&&managedEnvironments.length===0){
    addIssue('error','managed-environments','The draft extends _gui-environments but no managed environments are defined yet.');
  }
  if(managedMissingKeys.length){
    addIssue('error','managed-environments','Each managed environment needs a stable key before the draft can be saved.');
  }
  if(managedMissingSecrets.length){
    addIssue('warning','managed-environments','Some managed environments are missing host, user, or password env-variable placeholders.');
  }

  const stepDefinitions=profileWizardSteps();
  const issueMap=new Map();
  for(const issue of issues){
    if(!issueMap.has(issue.code)) issueMap.set(issue.code,[]);
    issueMap.get(issue.code).push(issue);
  }
  const steps=stepDefinitions.map((definition)=>{
    const stepIssues=issueMap.get(definition.id)||[];
    const firstIssue=stepIssues[0]||null;
    if(definition.id==='identity'){
      return {
        id:definition.id,
        title:definition.title,
        description:definition.description,
        status:firstIssue?definition.statusWhenMissing:'ready',
        summary:firstIssue?firstIssue.message:('Profile name: '+String(draft.profileName||'(not set)'))
      };
    }
    if(definition.id==='workspace'){
      return {
        id:definition.id,
        title:definition.title,
        description:definition.description,
        status:firstIssue?definition.statusWhenMissing:(hasRegistryPath?'ready':'review'),
        summary:firstIssue
          ? firstIssue.message
          : (hasRegistryPath?'Source, output, and registry paths are set.':'Source and output are set. Add an analysis registry path when you want Analyze Workspace handoff.')
      };
    }
    if(definition.id==='environment-routing'){
      return {
        id:definition.id,
        title:definition.title,
        description:definition.description,
        status:firstIssue?(unknownBindings.length?'review':definition.statusWhenMissing):(selectedBindings.length?'ready':'needs-scope'),
        summary:firstIssue
          ? firstIssue.message
          : ('Selected roles: '+String(selectedBindings.length)+' environment binding'+(selectedBindings.length===1?'':'s')+'.')
      };
    }
    if(definition.id==='fetch-scope'){
      return {
        id:definition.id,
        title:definition.title,
        description:definition.description,
        status:firstIssue?(blockingIssueCodes.has('fetch-scope')?definition.statusWhenMissing:'review'):(fetch.enabled===false?'review':'ready'),
        summary:firstIssue
          ? firstIssue.message
          : (fetch.enabled===false?'Fetch is disabled for this draft.':'Library / IFS anchor set with '+String(fetchFileCount)+' file filters and '+String(fetchMemberCount)+' member filters.')
      };
    }
    if(definition.id==='managed-environments'){
      return {
        id:definition.id,
        title:definition.title,
        description:definition.description,
        status:firstIssue?(blockingIssueCodes.has('managed-environments')?definition.statusWhenMissing:'review'):(managedEnvironments.length?'ready':'review'),
        summary:firstIssue
          ? firstIssue.message
          : (managedEnvironments.length?String(managedEnvironments.length)+' managed environment'+(managedEnvironments.length===1?'':'s')+' in the local draft.':'No GUI-managed environments in this draft yet.')
      };
    }
    const hasBlockingIssues=blockingIssueCodes.size>0;
    const previewValid=Boolean(preview&&preview.valid===true&&previewFreshness.isFresh);
    return {
      id:definition.id,
      title:definition.title,
      description:definition.description,
      status:hasBlockingIssues
        ? 'needs-profile-input'
        : (previewValid?'save-ready':(previewFreshness.isStale?'preview-stale':'preview-ready')),
      summary:hasBlockingIssues
        ? 'Resolve the blocking draft inputs above before previewing or saving.'
        : (previewValid
          ? 'Draft preview is valid and ready to save locally.'
          : (previewFreshness.isStale
            ? 'Draft changed after the last preview. Refresh the preview before relying on it.'
            : 'Run Preview Draft to validate this local-only overlay.'))
    };
  });

  return {
    steps,
    issues,
    blockingIssueCount:blockingIssueCodes.size,
    warningCount:issues.filter((issue)=>issue.severity!=='error').length,
    canPreview:blockingIssueCodes.size===0,
    canSave:blockingIssueCodes.size===0&&Boolean(preview&&preview.valid===true&&previewFreshness.isFresh)
  };
}

function renderProfileWizardIssues(signals){
  const backendDiagnostics=profileWizardDiagnostics();
  if(backendDiagnostics.length){
    return '<div class="hint-list">'+backendDiagnostics.map((issue)=>'<div class="hint-item"><strong>'+esc(String(issue.fieldPath||issue.code||'review'))+'</strong><div class="tokens"><div class="token '+esc(statusToneClass(issue.severity||'warning'))+'">'+esc(String(issue.severity||'warning').toUpperCase())+'</div>'+(issue.stepId?'<div class="token">step: '+esc(String(issue.stepId))+'</div>':'')+'</div><p>'+esc(String(issue.message||''))+'</p></div>').join('')+'</div>';
  }
  if(!signals.issues.length){
    return '<div class="hint-list"><div class="hint-item"><strong>Local-only readiness</strong><p>This draft already covers the required local-only inputs for preview. You can validate it now and then save it into the local overlay.</p></div></div>';
  }
  return '<div class="hint-list">'+signals.issues.map((issue)=>'<div class="hint-item"><strong>'+esc(String(issue.code||'review'))+'</strong><div class="tokens"><div class="token '+esc(statusToneClass(issue.severity||'warning'))+'">'+esc(String(issue.severity||'warning').toUpperCase())+'</div></div><p>'+esc(String(issue.message||''))+'</p></div>').join('')+'</div>';
}

function renderProfileWizardStepCards(signals){
  const backendSteps=profileWizardStepValidation();
  const backendMap=new Map(backendSteps.map((entry)=>[String(entry&&entry.id||''),entry]));
  return '<div class="field-list">'+signals.steps.map((step)=>{
    const backend=backendMap.get(String(step.id||''))||null;
    const status=backend&&backend.status?backend.status:step.status;
    const summary=backend&&backend.message?backend.message:step.summary;
    const diagnosticCount=backend&&backend.diagnosticCount!==undefined?backend.diagnosticCount:null;
    return '<div class="field-item"><strong>'+esc(String(step.title||step.id||'Step'))+'</strong><div class="workflow-meta"><div class="token '+esc(statusToneClass(status||''))+'">'+esc(String(status||'review'))+'</div>'+(diagnosticCount!==null?'<div class="token">diagnostics: '+esc(String(diagnosticCount))+'</div>':'')+'</div><p>'+esc(String(summary||step.description||''))+'</p><div class="small">'+esc(String(step.description||''))+'</div></div>';
  }).join('')+'</div>';
}

function renderManagedEnvironmentEditor(entry,index){
  const safeEntry=entry&&typeof entry==='object'?entry:{};
  return '<div class="field-item"><strong>Environment '+esc(String(index+1))+'</strong><div class="field-grid">'+
    '<label>Key<input data-pw-env-key="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.key||''))+'" placeholder="dev"></label>'+renderWizardFieldDiagnostics('managedEnvironments['+String(index)+'].key')+
    '<label>Display Name<input data-pw-env-display="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.displayName||''))+'" placeholder="Development IBM i"></label>'+
    '<label>System Name<input data-pw-env-system-name="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.systemName||''))+'" placeholder="SYSDEV"></label>'+
    '<label>Aliases<input data-pw-env-aliases="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.aliases||''))+'" placeholder="DEVBOX, SYS_TEST"></label>'+
    '<label>Host Env Var<input data-pw-env-host="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.hostEnvVar||''))+'" placeholder="ZEUS_DEV_HOST"></label>'+renderWizardFieldDiagnostics('managedEnvironments['+String(index)+'].hostEnvVar')+
    '<label>User Env Var<input data-pw-env-user="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.userEnvVar||''))+'" placeholder="ZEUS_DEV_USER"></label>'+renderWizardFieldDiagnostics('managedEnvironments['+String(index)+'].userEnvVar')+
    '<label>Password Env Var<input data-pw-env-password="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.passwordEnvVar||''))+'" placeholder="ZEUS_DEV_PASSWORD"></label>'+renderWizardFieldDiagnostics('managedEnvironments['+String(index)+'].passwordEnvVar')+
    '<label>Default Library<input data-pw-env-library="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.defaultLibrary||''))+'" placeholder="APPLIB"></label>'+
    '<label>Default Schema<input data-pw-env-schema="'+esc(String(index))+'" value="'+escAttr(String(safeEntry.defaultSchema||''))+'" placeholder="APPLIB"></label>'+
  '</div><div class="actions"><button class="btn" data-pw-env-remove="'+esc(String(index))+'">Remove Environment</button></div></div>';
}

function renderProfileWizardPreviewPanel(){
  const preview=s.profileWizard.preview;
  const freshness=profileWizardPreviewFreshness();
  if(!preview){
    return '<div class="empty">Preview the current draft to see validation and emitted local-only config.</div>';
  }
  const profilePreview=preview.profilePreview?JSON.stringify(preview.profilePreview,null,2):'{}';
  const environmentPreview=preview.managedEnvironmentProfilePreview?JSON.stringify(preview.managedEnvironmentProfilePreview,null,2):'{}';
  const notes=Array.isArray(preview.notes)?preview.notes:[];
  const conflicts=Array.isArray(preview.conflicts)?preview.conflicts:[];
  const handoffCommands=Array.isArray(preview.handoffCommands)?preview.handoffCommands:[];
  return '<div class="stack">'+
    '<div class="tokens"><div class="token '+esc(statusToneClass(preview.valid===false?'error':'ready'))+'">'+esc(preview.valid===false?'invalid':'valid')+'</div><div class="token '+esc(statusToneClass(freshness.status))+'">'+esc(freshness.status)+'</div><div class="token">CLI preview commands: '+esc(String(preview.safeCliPreview&&preview.safeCliPreview.commands&&preview.safeCliPreview.commands.length||0))+'</div></div>'+
    '<div class="small '+esc(statusToneClass(freshness.status))+'">'+esc(freshness.message)+'</div>'+
    (conflicts.length?'<div class="hint-list">'+conflicts.map((entry)=>'<div class="hint-item"><strong>'+esc(String(entry.code||'warning'))+'</strong><div class="tokens"><div class="token '+esc(statusToneClass(entry.severity||'warning'))+'">'+esc(String(entry.severity||'warning').toUpperCase())+'</div></div><p>'+esc(String(entry.message||''))+'</p></div>').join('')+'</div>':'')+
    (notes.length?'<div class="hint-list">'+notes.map((entry)=>'<div class="hint-item"><p>'+esc(String(entry))+'</p></div>').join('')+'</div>':'')+
    '<details open><summary>Profile Preview JSON</summary><div class="preview"><pre>'+esc(profilePreview)+'</pre></div></details>'+
    '<details><summary>Managed Environments JSON</summary><div class="preview"><pre>'+esc(environmentPreview)+'</pre></div></details>'+
    '<details open><summary>CLI Handoff</summary><div class="preview"><pre>'+esc(handoffCommands.map((entry)=>String(entry.command||'')).filter(Boolean).join('\\n'))+'</pre></div></details>'+
    '<details><summary>Safe CLI Preview</summary><div class="preview"><pre>'+esc(((preview.safeCliPreview&&preview.safeCliPreview.commands)||[]).join('\\n'))+'</pre></div></details>'+
  '</div>';
}

function preferredProfileWizardDoctorProfile(){
  const selectedProfile=String(s.profileWizard.selectedProfileName||'').trim();
  if(selectedProfile){
    return selectedProfile;
  }
  const draftProfile=String(ensureProfileWizardDraft().profileName||'').trim();
  if(draftProfile&&findProfileWizardSummary(draftProfile)){
    return draftProfile;
  }
  const currentDoctorProfile=String(s.uiActions.doctor&&s.uiActions.doctor.profile||'').trim();
  if(currentDoctorProfile){
    return currentDoctorProfile;
  }
  const state=profileWizardState();
  const profiles=state&&Array.isArray(state.profiles)
    ? state.profiles.filter((entry)=>entry&&!entry.mixin)
    : [];
  const devProfile=profiles.find((entry)=>entry&&entry.name==='dev');
  return devProfile&&devProfile.name
    ? devProfile.name
    : (profiles[0]&&profiles[0].name?profiles[0].name:'dev');
}

function renderConfigureStartPanel(options){
  const safeOptions=options&&typeof options==='object'?options:{};
  const setupMeta=setupMetadata()||{};
  const draft=safeOptions.draft&&typeof safeOptions.draft==='object'?safeOptions.draft:ensureProfileWizardDraft();
  const signals=safeOptions.signals&&typeof safeOptions.signals==='object'?safeOptions.signals:evaluateProfileWizardDraft();
  const previewFreshness=safeOptions.previewFreshness&&typeof safeOptions.previewFreshness==='object'
    ? safeOptions.previewFreshness
    : profileWizardPreviewFreshness();
  const profiles=Array.isArray(safeOptions.profiles)?safeOptions.profiles:[];
  const localOnlyProfiles=profiles.filter((entry)=>entry&&entry.sourceKind==='local-only');
  const managedSystems=Array.isArray(safeOptions.managedSystems)?safeOptions.managedSystems:[];
  const selectedProfileSummary=safeOptions.selectedProfileSummary||null;
  const doctorProfile=String(safeOptions.doctorProfile||preferredProfileWizardDoctorProfile()).trim()||'dev';
  const doctorProfileSummary=safeOptions.doctorProfileSummary||findProfileWizardSummary(doctorProfile);
  const doctorState=safeOptions.doctorState&&typeof safeOptions.doctorState==='object'?safeOptions.doctorState:(s.uiActions.doctor||{});
  const doctorResult=doctorState&&doctorState.result&&typeof doctorState.result==='object'?doctorState.result:null;
  const draftProfileName=String(draft.profileName||'').trim();
  const draftSavedSummary=draftProfileName?findProfileWizardSummary(draftProfileName):null;
  const bindings=draft.environmentBindings&&typeof draft.environmentBindings==='object'?draft.environmentBindings:{};
  const configFields=metadataFields();
  const configSensitiveCount=configFields.filter((field)=>field&&field.sensitive===true).length;
  const configSectionCount=metadataSections().length;
  const routingTokens=[
    ['db',String(bindings.defaultDbSystem||'').trim()||'profile/defaults'],
    ['metadata',String(bindings.metadataSystem||'').trim()||'default db'],
    ['test data',String(bindings.testDataSystem||'').trim()||'default db'],
    ['fetch',String(bindings.fetchSystem||'').trim()||'profile/defaults']
  ];
  const previewStatus=signals.canSave
    ? 'save-ready'
    : (signals.canPreview
      ? (previewFreshness.isStale?'preview-stale':'preview-ready')
      : 'needs-profile-input');
  const stepOneStatus=selectedProfileSummary
    ? ('Loaded profile: '+selectedProfileSummary.name+' ['+String(selectedProfileSummary.sourceKind||'shared')+']')
    : (draftProfileName
      ? 'New unsaved draft: '+draftProfileName
      : 'No profile loaded yet.');
  const stepTwoStatus=signals.canSave
    ? 'Preview is current and this draft can be saved locally.'
    : (signals.canPreview
      ? (previewFreshness.isStale
        ? 'Draft changed after the last preview. Refresh Preview Draft, then save.'
        : 'Required inputs are present. Run Preview Draft next.')
      : 'Fill in the missing profile and path fields first.');
  const doctorStatus=safeOptions.doctorStatusLabel
    ? 'Last doctor result: '+String(safeOptions.doctorStatusLabel)
    : (doctorProfileSummary
      ? 'Doctor can run against saved profile "'+doctorProfileSummary.name+'".'
      : 'Doctor only runs against saved profiles. Save the draft first.');
  const doctorHint=doctorProfileSummary
    ? (doctorProfileSummary.sourceKind==='local-only'
      ? 'This doctor target comes from config/local-only/profiles.json.'
      : 'This doctor target comes from the shared profile catalog.')
    : (draftSavedSummary
      ? 'This draft name matches an existing saved profile, but no profile is currently loaded for doctor yet.'
      : 'The browser edits local-only config only. It does not apply unsaved drafts to doctor.');
  const precedenceRules=Array.isArray(setupMeta.precedenceRules)&&setupMeta.precedenceRules.length
    ? setupMeta.precedenceRules
    : ['CLI overrides env.','Env overrides profile.','Profile overrides defaults.'];
  const precedenceSummary='CLI overrides env. Env overrides profile. Profile overrides defaults.';
  const boundaryNotes=Array.isArray(setupMeta.boundaryNotes)&&setupMeta.boundaryNotes.length
    ? setupMeta.boundaryNotes
    : ['This screen only edits local-only config and placeholder-based environment routing.','It does not expose secrets and it does not connect to IBM i or DB2 here.'];
  const recommendedNextTokens=Array.isArray(setupMeta.recommendedNextTokens)&&setupMeta.recommendedNextTokens.length
    ? setupMeta.recommendedNextTokens
    : ['setup focus','doctor uses effective config','warnings do not auto-abort'];
  const doctorStatusGuidance=setupMeta.doctorStatusGuidance&&typeof setupMeta.doctorStatusGuidance==='object'
    ? setupMeta.doctorStatusGuidance
    : {};
  const doctorActionLabel=setupMeta.primaryAction&&setupMeta.primaryAction.label
    ? String(setupMeta.primaryAction.label)
    : 'Check Readiness';
  let recommendedNext='Choose or load a profile and fill the required path fields first.';
  if(doctorState.running){
    recommendedNext=String(doctorStatusGuidance.running||'Wait for Check Readiness to finish.');
  }else if(doctorState.error){
    recommendedNext=String(doctorStatusGuidance.error||'Review the readiness error, then try Check Readiness again.');
  }else if(doctorResult&&doctorResult.status==='ready'){
    recommendedNext=String(doctorStatusGuidance.ready||'Setup looks ready. Continue to Reports when output exists, or use Advanced / Tools if you need local-only analysis or prompt work.');
  }else if(doctorResult&&doctorResult.status==='warning'){
    recommendedNext=String(doctorStatusGuidance.warning||'Review the warning cards below. Env vars may be changing the effective target even when the saved profile looks correct.');
  }else if(doctorResult&&doctorResult.status==='failed'){
    recommendedNext=String(doctorStatusGuidance.failed||'Resolve the failed doctor checks before moving on.');
  }else if(signals.canSave){
    recommendedNext='Save the current draft if needed, then run Check Readiness.';
  }else if(signals.canPreview){
    recommendedNext='Run Preview Draft next, then save locally before Check Readiness.';
  }
  return '<div class="sub"><h2>'+esc(String(setupMeta.title||'Setup'))+'</h2><p>Use Setup as a simple 3-step path: choose or create a profile, preview and save it locally, then run Zeus Doctor.</p>'+
    renderHintList([
      { title:'Browser safety', body:boundaryNotes.join(' ') },
      { title:'Resolution order', body:(precedenceRules.length?precedenceRules.join(' '):precedenceSummary)+' Doctor checks the effective configuration after those rules are applied.' }
    ])+
    '<div class="field-list">'+
      '<div class="field-item"><strong>Recommended Next Step</strong><p>'+esc(recommendedNext)+'</p>'+renderTokenRow(recommendedNextTokens,'workflow-meta')+'</div>'+
      '<div class="field-item"><strong>1. Choose Or Create A Profile</strong><p>'+esc(stepOneStatus)+'</p>'+renderTokenRow([
        'known profiles: '+String(profiles.length),
        'local-only: '+String(localOnlyProfiles.length),
        'managed envs: '+String(managedSystems.length)
      ],'workflow-meta')+'<p class="small">Selected profile source and local-only overlays are shown here, but secret values are never displayed.</p><div class="actions"><button class="btn" data-pw-refresh="1">Reload Wizard State</button><button class="btn primary" data-pw-new="1">New Local Draft</button><button class="btn" data-pw-load="1">Load Selected Profile</button></div></div>'+
      '<div class="field-item"><strong>Environment Override Explanation</strong><p>Environment variables can change the effective target even when the saved profile looks correct.</p>'+renderTokenRow(routingTokens.map(([label,value])=>label+': '+value),'workflow-meta')+'<p class="small">Examples: <code>ZEUS_DB_HOST</code> can override <code>db.host</code>. Secret env vars may exist, but their values are never shown here.</p></div>'+
      '<div class="field-item"><strong>Config Metadata Overview</strong><p>'+esc(String(configSectionCount))+' setup sections and '+esc(String(configFields.length))+' documented fields are available in this UI payload.</p>'+renderTokenRow([
        'sensitive fields: '+String(configSensitiveCount),
        'read-only metadata',
        'no resolved values'
      ],'workflow-meta')+'<p class="small">Use the metadata section below to understand which fields can be set by profile or env without exposing runtime secrets.</p></div>'+
      '<div class="field-item"><strong>2. Preview And Save Locally</strong><p>'+esc(stepTwoStatus)+'</p>'+renderTokenRow([
        { text:previewStatus, tone:previewStatus },
        draftProfileName?'draft: '+draftProfileName:'draft name missing',
        selectedProfileSummary?'loaded source: '+String(selectedProfileSummary.sourceKind||'shared'):null
      ],'workflow-meta')+'<div class="actions"><button class="btn" data-pw-preview="1">Preview Draft</button><button class="btn primary" data-pw-save="1">Save Local-only</button></div></div>'+
      '<div class="field-item"><strong>3. Run Zeus Doctor</strong><p>'+esc(doctorStatus)+'</p>'+renderTokenRow([
        'doctor target: '+doctorProfile,
        doctorProfileSummary?'source: '+String(doctorProfileSummary.sourceKind||'shared'):'save required',
        doctorState&&doctorState.result?'result available':null
      ],'workflow-meta')+'<p class="small">'+esc(doctorHint)+'</p><div class="actions"><button class="btn primary" data-config-doctor="1">'+esc(doctorActionLabel)+'</button><button class="btn" data-config-refresh="1">Refresh Metadata</button></div></div>'+
    '</div></div>';
}

function buildAiSessionDoctorSummaryPayload(doctorResult){
  if(!doctorResult||typeof doctorResult!=='object') return null;
  const summary=doctorResult.result&&doctorResult.result.summary&&typeof doctorResult.result.summary==='object'
    ? doctorResult.result.summary
    : null;
  return {
    status:String(doctorResult.status||'').trim()||'unknown',
    summary:summary?{
      total:Number(summary.total||0),
      pass:Number(summary.pass||0),
      fail:Number(summary.fail||0),
      warn:Number(summary.warn||0),
      info:Number(summary.info||0),
      skip:Number(summary.skip||0)
    }:null,
    finishedAt:doctorResult.finishedAt||null
  };
}

function renderAiSessionStarterPanel(options){
  const safeOptions=options&&typeof options==='object'?options:{};
  const metadata=safeOptions.metadata&&typeof safeOptions.metadata==='object'
    ? safeOptions.metadata
    : (aiSessionStarterMetadata()||{});
  const state=safeOptions.state&&typeof safeOptions.state==='object'?safeOptions.state:(s.uiActions.aiSession||{});
  const doctorResult=safeOptions.doctorResult&&typeof safeOptions.doctorResult==='object'?safeOptions.doctorResult:null;
  const doctorAvailable=Boolean(doctorResult);
  const includeDoctorSummary=doctorAvailable
    ? state.includeDoctorSummary!==false
    : false;
  const starterOpen=Boolean(state.expanded||state.running||state.error||(state.result&&state.result.prompt));
  const goalMaxLength=Number(metadata.goalMaxLength||4000);
  const promptText=state.result&&state.result.prompt?String(state.result.prompt):'';
  const warnings=state.result&&Array.isArray(state.result.warnings)?state.result.warnings:[];
  const envLoading=metadata.envLoading&&typeof metadata.envLoading==='object'?metadata.envLoading:{};
  const powerShellCommand=envLoading.powerShell&&envLoading.powerShell.command
    ? String(envLoading.powerShell.command)
    : '. .\\config\\load-env.ps1 -Environment <environment>';
  const bashCommand=envLoading.bash&&envLoading.bash.command
    ? String(envLoading.bash.command)
    : 'source ./config/load-env.sh <environment>';
  const mcpSummary=metadata.capabilityGuidance&&metadata.capabilityGuidance.mcp&&typeof metadata.capabilityGuidance.mcp==='object'
    ? metadata.capabilityGuidance.mcp
    : null;
  const starterCommands=metadata.capabilityGuidance&&Array.isArray(metadata.capabilityGuidance.starterCommands)
    ? metadata.capabilityGuidance.starterCommands
    : [];
  const approvalRequiredCommands=metadata.capabilityGuidance&&Array.isArray(metadata.capabilityGuidance.approvalRequiredCommands)
    ? metadata.capabilityGuidance.approvalRequiredCommands
    : [];
  const doctorStatusText=doctorAvailable
    ? 'Doctor result available. The generated prompt can include a compact summary, but the assistant should still run doctor first.'
    : 'No doctor result is available yet. Run Check Readiness first for a better session handoff.';
  return '<div class="sub"><details'+(starterOpen?' open':'')+' id="aiSessionStarterDetails"><summary>Start AI Session</summary><p class="small">Use this after checking readiness. It creates a safe prompt for an AI assistant and stays local-only.</p>'+
    renderHintList([
      { title:'Boundary', body:'The Local UI cannot load env vars into your already-open terminal. Use the helper commands below, then validate with Doctor.' },
      { title:'Safety', bodyHtml:'Do not paste credentials into the goal. The prompt reminds the assistant to run Doctor first and follow <code>'+esc(String(metadata.authoritativeCatalogPath||'docs/tool-catalog.md'))+'</code>.' }
    ])+
    '<div class="field-grid"><label>Profile Name<input id="aiSessionProfile" value="'+escAttr(String(state.profile||safeOptions.profile||'dev'))+'" placeholder="dev"></label><label>Environment Name (optional)<input id="aiSessionEnvironment" value="'+escAttr(String(state.environment||''))+'" placeholder="development"></label><label>Session Goal<textarea id="aiSessionGoal" placeholder="Analyze program ORDERPGM and summarize dependencies." maxlength="'+escAttr(String(goalMaxLength))+'">'+esc(String(state.goal||''))+'</textarea></label></div>'+
    renderTokenRow([
      'goal max: '+String(goalMaxLength),
      'template: '+String(metadata.templateSource||'docs/ai/session-prompt.md'),
      mcpSummary?'MCP tools: '+String(mcpSummary.toolCount||0):null
    ],'tokens')+
    '<div class="field-list"><div class="field-item"><strong>Env Loading Helper</strong><p>Choose the command for your shell. Loading env is process-scoped, so existing terminal sessions do not update automatically.</p><div class="preview"><pre>'+esc(powerShellCommand)+'\\n'+esc(bashCommand)+'</pre></div><p class="small">The Local UI server only sees env vars that were present when it started.</p></div><div class="field-item"><strong>Doctor Reminder</strong><p>'+esc(doctorStatusText)+'</p><div class="actions"><label><input id="aiSessionIncludeDoctorSummary" type="checkbox"'+(includeDoctorSummary?' checked':'')+(doctorAvailable?'':' disabled')+'> Include compact Doctor summary</label></div></div><div class="field-item"><strong>Capability Guidance</strong><p>Treat the tool catalog as authoritative and prefer evidence-first, read-only work before any higher-risk action.</p>'+renderTokenRow(starterCommands,'workflow-meta')+(approvalRequiredCommands.length?'<p class="small">Approval required before: '+esc(approvalRequiredCommands.join(', '))+'.</p>':'')+(mcpSummary&&Array.isArray(mcpSummary.starterTools)&&mcpSummary.starterTools.length?'<p class="small">If MCP is available in the AI client, allowlisted Zeus tools may include: '+esc(mcpSummary.starterTools.join(', '))+'.</p>':'')+'</div></div><div class="actions"><button class="btn primary" data-ai-session-generate="1">'+esc(state.running?'Generating...':'Generate Session Prompt')+'</button><button class="btn" data-ai-session-copy="1">Copy Prompt</button></div>'+
    (state.error?renderHintList([{ title:'Prompt generation error', body:String(state.error) }]):'')+
    (warnings.length?renderHintList(warnings.map((entry)=>({ body:String(entry) }))):'')+
    (state.copyStatus?'<div class="small '+esc(statusToneClass(state.copyStatus))+'">'+esc(state.copyStatus)+'</div>':'')+
    '<div class="preview">'+(promptText?'<textarea id="aiSessionPromptOutput" style="min-height:360px" readonly>'+esc(promptText)+'</textarea>':'<div class="empty">Generate a session prompt here after Setup and Doctor are ready.</div>')+'</div></details></div>';
}

function renderProfileWizardPanel(){
  const state=profileWizardState();
  const draft=ensureProfileWizardDraft();
  const metadata=profileWizardMetadata();
  const signals=evaluateProfileWizardDraft();
  const profiles=state&&Array.isArray(state.profiles)?state.profiles.filter((entry)=>!entry.mixin):[];
  const systems=state&&Array.isArray(state.systems)?state.systems:[];
  const managedSystems=systems.filter((entry)=>entry.managedByGui);
  const externalSystems=systems.filter((entry)=>!entry.managedByGui);
  const dependentProfiles=state&&state.managedEnvironmentUsage&&Array.isArray(state.managedEnvironmentUsage.dependentProfiles)
    ? state.managedEnvironmentUsage.dependentProfiles
    : [];
  const selectedProfileSummary=findProfileWizardSummary(s.profileWizard.selectedProfileName||draft.profileName);
  const previewFreshness=profileWizardPreviewFreshness();
  const status=s.profileWizard.loading
    ? 'Loading profile wizard...'
    : (s.profileWizard.error
      ? s.profileWizard.error
      : (state&&state.source?'Local-only target: '+String(state.source.localOnlyTarget||'./config/local-only/profiles.json'):'Profile wizard ready.'));
  return '<div class="stack">'+
    '<h3>Profile &amp; Environment Wizard</h3>'+
    '<p class="small">Fill the draft below, keep environment secrets as env-var references, and use Preview before saving into the local-only overlay.</p>'+
    '<div class="tokens"><div class="token '+esc(statusToneClass(s.profileWizard.error||s.profileWizard.loading?'warning':'ready'))+'">'+esc(status)+'</div>'+(state?'<div class="token">profiles: '+esc(String(profiles.length))+'</div><div class="token">managed envs: '+esc(String(managedSystems.length))+'</div><div class="token">external env refs: '+esc(String(externalSystems.length))+'</div><div class="token">catalog dependents: '+esc(String(dependentProfiles.length))+'</div>':'')+'<div class="token '+esc(statusToneClass(signals.canSave?'save-ready':(signals.canPreview?(previewFreshness.isStale?'preview-stale':'preview-ready'):'needs-profile-input')))+'">'+esc(signals.canSave?'save-ready':(signals.canPreview?(previewFreshness.isStale?'preview-stale':'preview-ready'):'needs-profile-input'))+'</div></div>'+
    (dependentProfiles.length?'<div class="hint-list"><div class="hint-item"><strong>Managed environment catalog usage</strong><p>The local GUI environment catalog is currently referenced by: '+esc(dependentProfiles.join(', '))+'.</p></div></div>':'')+
    (previewFreshness.isStale?'<div class="hint-list"><div class="hint-item"><strong>Preview needs refresh</strong><p>'+esc(previewFreshness.message)+' The draft changed after the last successful preview, so inline diagnostics and save-readiness now reflect the newer draft.</p></div></div>':'')+
    '<div class="actions"><button class="btn" data-pw-refresh="1">'+esc(s.profileWizard.loading?'Refreshing...':'Reload Wizard State')+'</button><button class="btn" data-pw-new="1">New Profile Draft</button><button class="btn" data-pw-load="1">Load Selected Profile</button><button class="btn" data-pw-clone="1">Clone Draft</button><button class="btn" data-pw-delete="1">Delete Local-only</button><button class="btn" data-pw-preview="1">'+esc(s.profileWizard.previewing?'Previewing...':'Preview Draft')+'</button><button class="btn primary" data-pw-save="1">'+esc(s.profileWizard.saving?'Saving...':'Save Local-only')+'</button></div>'+
    (s.profileWizard.saveStatus?'<div class="small '+esc(statusToneClass(s.profileWizard.saveStatus))+'">'+esc(s.profileWizard.saveStatus)+'</div>':'')+
    (selectedProfileSummary?'<div class="tokens"><div class="token">selected source: '+esc(String(selectedProfileSummary.sourceKind||'shared'))+'</div><div class="token">'+esc(selectedProfileSummary.deleteAllowed?'local-only deletable':'shared read-only base')+'</div></div>':'')+
    '<h4>Wizard Readiness</h4>'+
    renderProfileWizardStepCards(signals)+
    renderProfileWizardIssues(signals)+
    '<div class="field-grid">'+
      '<label>Existing Profiles<select id="profileWizardProfileSelect"><option value="">'+esc('Select profile')+'</option>'+profiles.map((entry)=>'<option value="'+escAttr(entry.name)+'"'+(entry.name===String(s.profileWizard.selectedProfileName||'')?' selected':'')+'>'+esc(entry.name+' ['+String(entry.sourceKind||'shared')+']')+'</option>').join('')+'</select></label>'+
      '<label>Profile Name<input id="profileWizardName" value="'+escAttr(String(draft.profileName||''))+'" placeholder="dev-local"></label>'+renderWizardFieldDiagnostics('profileName')+
      '<label>Comment<input id="profileWizardComment" value="'+escAttr(String(draft.comment||''))+'" placeholder="Read-only local development profile"></label>'+
      '<label>Extends (comma separated)<input id="profileWizardExtends" value="'+escAttr(Array.isArray(draft.extends)?draft.extends.join(', '):'')+'" placeholder="default-shared, _gui-environments"></label>'+
      '<label>Source Root<input id="profileWizardSourceRoot" value="'+escAttr(String(draft.sourceRoot||''))+'" placeholder="./workspace/source"></label>'+renderWizardFieldDiagnostics('sourceRoot')+
      '<label>Output Root<input id="profileWizardOutputRoot" value="'+escAttr(String(draft.outputRoot||''))+'" placeholder="./workspace/output"></label>'+renderWizardFieldDiagnostics('outputRoot')+
      '<label>Analyses Registry<input id="profileWizardRegistryPath" value="'+escAttr(String(draft.analysesRegistryPath||''))+'" placeholder="./analysis/_registry.json"></label>'+renderWizardFieldDiagnostics('analysesRegistryPath')+
    '</div>'+
    '<div class="actions"><button class="btn" data-pw-production-toggle="1">Production Flag: '+esc(draft.productionSystem?'on':'off')+'</button></div>'+
    '<h4>Environment Routing</h4>'+
    '<div class="field-grid">'+
      '<label>Default DB<select id="profileWizardDefaultDbSystem">'+renderProfileWizardSystemOptions(draft.environmentBindings&&draft.environmentBindings.defaultDbSystem)+'</select></label>'+renderWizardFieldDiagnostics('environmentBindings.defaultDbSystem')+
      '<label>Metadata DB<select id="profileWizardMetadataSystem">'+renderProfileWizardSystemOptions(draft.environmentBindings&&draft.environmentBindings.metadataSystem)+'</select></label>'+renderWizardFieldDiagnostics('environmentBindings.metadataSystem')+
      '<label>Test Data DB<select id="profileWizardTestDataSystem">'+renderProfileWizardSystemOptions(draft.environmentBindings&&draft.environmentBindings.testDataSystem)+'</select></label>'+renderWizardFieldDiagnostics('environmentBindings.testDataSystem')+
      '<label>Fetch Environment<select id="profileWizardFetchSystem">'+renderProfileWizardSystemOptions(draft.environmentBindings&&draft.environmentBindings.fetchSystem)+'</select></label>'+renderWizardFieldDiagnostics('environmentBindings.fetchSystem')+
    '</div>'+
    '<h4>Fetch Scope</h4>'+
    '<div class="actions"><button class="btn" data-pw-fetch-toggle="1">Fetch Enabled: '+esc(draft.fetch&&draft.fetch.enabled===false?'off':'on')+'</button></div>'+
    '<div class="field-grid">'+
      '<label>Source Library<input id="profileWizardFetchSourceLibrary" value="'+escAttr(String(draft.fetch&&draft.fetch.sourceLibrary||''))+'" placeholder="APPLIB"></label>'+renderWizardFieldDiagnostics('fetch.sourceLibrary')+
      '<label>IFS Directory<input id="profileWizardFetchIfsDir" value="'+escAttr(String(draft.fetch&&draft.fetch.ifsDir||''))+'" placeholder="/home/zeus/source"></label>'+renderWizardFieldDiagnostics('fetch.ifsDir')+
      '<label>Fetch Output<input id="profileWizardFetchOut" value="'+escAttr(String(draft.fetch&&draft.fetch.out||''))+'" placeholder="./rpg_sources"></label>'+
      '<label>Source Files (comma separated)<input id="profileWizardFetchFiles" value="'+escAttr(Array.isArray(draft.fetch&&draft.fetch.files)?draft.fetch.files.join(', '):'')+'" placeholder="QRPGLESRC, QCLSRC"></label>'+renderWizardFieldDiagnostics('fetch.files')+
      '<label>Members (comma separated)<input id="profileWizardFetchMembers" value="'+escAttr(Array.isArray(draft.fetch&&draft.fetch.members)?draft.fetch.members.join(', '):'')+'" placeholder="ORDERPGM, CUSTSRV"></label>'+
      '<label>Transport<select id="profileWizardFetchTransport">'+['','auto','jt400','sftp','ftp'].map((entry)=>'<option value="'+escAttr(entry)+'"'+(entry===String(draft.fetch&&draft.fetch.transport||'')?' selected':'')+'>'+esc(entry||'Select transport')+'</option>').join('')+'</select></label>'+
    '</div>'+
    '<h4>Managed Environments</h4>'+
    (draft.managedEnvironments&&draft.managedEnvironments.length?'<div class="field-list">'+draft.managedEnvironments.map((entry,index)=>renderManagedEnvironmentEditor(entry,index)).join('')+'</div>':'<div class="empty">No GUI-managed environments yet. Add one to generate a safe local-only systems catalog.</div>')+
    renderWizardFieldDiagnostics('managedEnvironments')+
    '<div class="actions"><button class="btn" data-pw-env-add="1">Add Managed Environment</button></div>'+
    (externalSystems.length?'<details><summary>Known External Environment References</summary><div class="field-list">'+externalSystems.map((entry)=>'<div class="field-item"><strong>'+esc(entry.key)+'</strong><p>'+esc(entry.displayName||entry.key)+'</p><div class="workflow-meta"><div class="token">source: '+esc(entry.sourceProfile||'profile')+'</div><div class="token">host: '+esc(entry.hostMode||'unknown')+'</div><div class="token">password: '+esc(entry.passwordMode||'unknown')+'</div></div></div>').join('')+'</div></details>':'')+
    (metadata&&Array.isArray(metadata.principles)&&metadata.principles.length?'<details><summary>Safety Rules</summary><div class="hint-list">'+metadata.principles.map((entry)=>'<div class="hint-item"><p>'+esc(String(entry))+'</p></div>').join('')+'</div></details>':'')+
    '<h4>Draft Preview</h4>'+
    renderProfileWizardPreviewPanel()+
  '</div>';
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

async function runDiscoveryPreviewAction(){
  const profile=String(s.uiActions.discovery.profile||s.uiActions.doctor.profile||'dev').trim()||'dev';
  const actionId=String(s.uiActions.discovery.actionId||'').trim()||'discover-source-libraries';
  s.uiActions.discovery.running=true;
  s.uiActions.discovery.error=null;
  try{
    const payload=await sendJson('POST','/api/ui-actions/discovery-preview',{
      profile,
      actionId
    });
    s.uiActions.discovery.result=payload;
  }catch(error){
    s.uiActions.discovery.error=error.message||String(error);
    s.uiActions.discovery.result=null;
  }finally{
    s.uiActions.discovery.running=false;
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

function selectedGuidedIntent(){
  const intents=guidedConfigIntents();
  return intents.find((entry)=>entry.id===s.uiMetadata.selectedGuidedIntent)||intents[0]||null;
}

function selectedGuidedStep(){
  const steps=guidedConfigSteps();
  return steps.find((entry)=>entry.id===s.uiMetadata.selectedGuidedStep)||steps[0]||null;
}

function renderGuidedCliPreview(intent,profile){
  const previewLines=intent&&Array.isArray(intent.cliPreviewTemplate)?intent.cliPreviewTemplate:[];
  if(!previewLines.length){
    return '<div class="empty">No CLI preview available yet.</div>';
  }
  const safeProfile=String(profile||'dev').trim()||'dev';
  const rendered=previewLines.map((line)=>String(line||'')
    .replace(/\{\{profile\}\}/g,safeProfile)
    .replace(/\{\{sourceRoot\}\}/g,'./workspace/source')
    .replace(/\{\{outputRoot\}\}/g,'./workspace/output')
    .replace(/\{\{program\}\}/g,'ORDERPGM'));
  return '<div class="preview"><pre>'+esc(rendered.join('\\n'))+'</pre></div>';
}

function renderGuidedDiscoveryPreview(result){
  const preview=result&&result.result?result.result:null;
  if(!preview) return '';
  const candidates=Array.isArray(preview.candidates)?preview.candidates:[];
  const warnings=Array.isArray(preview.warnings)?preview.warnings:[];
  const resolvedScope=preview&&preview.resolvedScope&&typeof preview.resolvedScope==='object'?preview.resolvedScope:null;
  const commandPreview=Array.isArray(preview.commandPreview)&&preview.commandPreview.length
    ? '<div class="preview"><pre>'+esc(preview.commandPreview.join('\\n'))+'</pre></div>'
    : '<div class="empty">No direct CLI preview is available yet for this discovery stub.</div>';
  const scopeTokens=resolvedScope
    ? '<div class="tokens">'+
      (resolvedScope.sourceLibrary?'<div class="token">library: '+esc(String(resolvedScope.sourceLibrary))+'</div>':'')+
      (resolvedScope.sourceFileCount!==undefined?'<div class="token">source files: '+esc(String(resolvedScope.sourceFileCount))+'</div>':'')+
      (resolvedScope.memberFilterCount!==undefined?'<div class="token">members: '+esc(String(resolvedScope.memberFilterCount))+'</div>':'')+
      (resolvedScope.outputRoot?'<div class="token">output: '+esc(String(resolvedScope.outputRoot))+'</div>':'')+
      (resolvedScope.objectLibrary?'<div class="token">object library: '+esc(String(resolvedScope.objectLibrary))+'</div>':'')+
      (resolvedScope.metadataSchema?'<div class="token">metadata schema: '+esc(String(resolvedScope.metadataSchema))+'</div>':'')+
      (resolvedScope.testDataSchema?'<div class="token">test-data schema: '+esc(String(resolvedScope.testDataSchema))+'</div>':'')+
      (resolvedScope.fetchMemberCount!==undefined?'<div class="token">fetch members: '+esc(String(resolvedScope.fetchMemberCount))+'</div>':'')+
      (resolvedScope.workflowMemberCount!==undefined?'<div class="token">workflow members: '+esc(String(resolvedScope.workflowMemberCount))+'</div>':'')+
      (resolvedScope.workflowTableCount!==undefined?'<div class="token">workflow tables: '+esc(String(resolvedScope.workflowTableCount))+'</div>':'')+
      (resolvedScope.testDataAllowCount!==undefined?'<div class="token">allow tables: '+esc(String(resolvedScope.testDataAllowCount))+'</div>':'')+
      (resolvedScope.testDataRowLimit!==undefined?'<div class="token">row limit: '+esc(String(resolvedScope.testDataRowLimit))+'</div>':'')+
      (resolvedScope.testDataMaskColumnCount!==undefined?'<div class="token">mask columns: '+esc(String(resolvedScope.testDataMaskColumnCount))+'</div>':'')+
      (resolvedScope.testDataMaskRuleCount!==undefined?'<div class="token">mask rules: '+esc(String(resolvedScope.testDataMaskRuleCount))+'</div>':'')+
    '</div>'
    : '';
  const candidatePanel=candidates.length
    ? '<div class="field-list">'+candidates.map((entry)=>'<div class="field-item"><strong>'+esc(String(entry.value||''))+'</strong><p>'+esc(String(entry.rationale||'Resolved candidate.'))+'</p><div class="workflow-meta"><div class="token">kind: '+esc(String(entry.kind||'candidate'))+'</div><div class="token">confidence: '+esc(String(entry.confidence||'medium'))+'</div><div class="token">'+esc(String(entry.origin||'resolved preview'))+'</div></div></div>').join('')+'</div>'
    : '<div class="empty">No scoped candidates available yet.</div>';
  const warningPanel=warnings.length
    ? '<div class="hint-list">'+warnings.map((warning)=>'<div class="hint-item"><strong>Preview warning</strong><p>'+esc(String(warning))+'</p></div>').join('')+'</div>'
    : '';
  const previewSummary=preview.summary?'<p>'+esc(String(preview.summary))+'</p>':'';
  const previewMode=preview.previewKind==='config-derived-local-preview'
    ? 'This preview is config-derived and local-only.'
    : (preview.implemented===false?'This action is intentionally stubbed and does not execute discovery yet.':'');
  return '<div class="hint-list"><div class="hint-item"><strong>'+esc(preview.title||'Discovery Preview')+'</strong><div class="tokens"><div class="token '+esc(statusToneClass(preview.status||'not-ready'))+'">'+esc(preview.status||'not-ready')+'</div><div class="token">Safety: '+esc(preview.safetyLevel||'S2')+'</div><div class="token">'+esc(preview.scope||'read-only')+'</div></div>'+previewSummary+'<p>'+esc(previewMode)+'</p>'+scopeTokens+'</div></div>'+candidatePanel+warningPanel+commandPreview+(Array.isArray(preview.notes)&&preview.notes.length?'<div class="hint-list">'+preview.notes.map((note)=>'<div class="hint-item"><p>'+esc(String(note))+'</p></div>').join('')+'</div>':'');
}

function renderGuidedStepDetails(step,intent){
  const fields=step&&Array.isArray(step.fields)?step.fields:[];
  const purposeLabels=guidedPurposeLabels();
  const classifications=intent&&Array.isArray(intent.classifications)?intent.classifications:[];
  const stepClassification=classifications.find((entry)=>entry.stepId===String(step&&step.id||''))||null;

  return '<div class="stack">'+
    '<div class="hint-list"><div class="hint-item"><strong>'+(step?esc(step.title):'Wizard Step')+'</strong><div class="tokens"><div class="token">Safety: '+esc(step&&step.safetyLevel||'S0')+'</div>'+(stepClassification?'<div class="token">'+esc(stepClassification.classification)+'</div>':'')+'<div class="token">'+esc(step&&step.status||'foundation-ready')+'</div></div><p>'+esc(step&&step.description||'')+'</p>'+(stepClassification&&stepClassification.rationale?'<p class="small">'+esc(stepClassification.rationale)+'</p>':'')+'</div></div>'+
    '<h3>Field Guidance</h3>'+
    (fields.length?'<div class="field-list">'+fields.map((field)=>'<div class="field-item"><strong>'+esc(field.label||field.key)+'</strong><p>'+esc(field.helpText||field.description||'')+'</p><div class="workflow-meta"><div class="token">type: '+esc(field.type||'string')+'</div><div class="token">safety: '+esc(field.safetyLevel||'S0')+'</div><div class="token">'+esc(field.secret?'secret-ref only':'display-safe')+'</div></div><div class="small">validation: '+esc(field.validationRule||'n/a')+'</div>'+(Array.isArray(field.examples)&&field.examples.length?'<div class="small">examples: '+esc(field.examples.join(' | '))+'</div>':'')+(field.discoveryActionId?'<div class="small">discovery action: '+esc(field.discoveryActionId)+'</div>':'')+'</div>').join('')+'</div>':'<div class="empty">No guided fields mapped to this step yet.</div>')+
    '<h3>Purpose Labels</h3>'+
    (purposeLabels.length?'<div class="chips">'+purposeLabels.map((entry)=>'<div class="token" title="'+escAttr(entry.description||'')+'">'+esc(entry.label)+'</div>').join('')+'</div>':'<div class="empty">No purpose labels available.</div>')+
  '</div>';
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

function renderDisabledWorkflowCard(card){
  const status=String(card.availability||card.status||'coming-later');
  return '<div class="workflow-card disabled"><h4>'+esc(card.title)+'</h4><p>'+esc(card.description||'')+'</p><div class="workflow-meta"><div class="token">'+esc(card.badge||card.category||'workflow')+'</div><div class="token">'+esc(status)+'</div></div><p class="small">'+esc(card.explanation||'This workflow is not available as a browser action yet.')+'</p><div class="actions"><button class="btn" disabled>'+esc(card.primaryActionLabel||'Coming Later')+'</button></div></div>';
}

function renderAdvancedOverviewPanel(){
  const cards=workflowCards();
  const disabledCards=cards.filter((card)=>card&&card.enabledInShell===false);
  return '<div class="sub"><h2>Advanced / Tools</h2><p>Setup is the recommended starting point, and Reports is the normal follow-up for reviewing output. Everything here is optional and intended for experienced users.</p><div class="hint-list"><div class="hint-item"><strong>How to use this area</strong><p>Choose a specialist local tool when you already know what you want to inspect, preview, or generate. Nothing here is required for onboarding.</p></div><div class="hint-item"><strong>Safety boundary</strong><p>No arbitrary browser command execution. No remote fetch. No live DB2 query execution. Secret values are never shown.</p></div></div><h3>Prompt Tools</h3><div class="home-grid"><div class="home-card"><strong>Prompt Workbench</strong><p>Guided prompt canvas with local preview, saved templates, prompt import from existing runs, and export options.</p><div class="tokens"><div class="token">specialist tool</div><div class="token">local preview</div><div class="token">optional</div></div><div class="actions"><button class="btn primary" data-home-target="workbench">Open Prompt Workbench</button></div></div><div class="home-card"><strong>Prompt Compare</strong><p>Use Reports when you want to compare generated prompt artifacts from an existing run.</p><div class="tokens"><div class="token">read-only</div><div class="token">report view</div><div class="token">after output</div></div><div class="actions"><button class="btn" data-home-target="prompts">Open In Reports</button></div></div></div><h3>Local Analysis Tools</h3><div class="home-grid"><div class="home-card"><strong>Analyze Workspace</strong><p>Runs the existing local-only analyze pipeline against the profile source root after Setup is ready.</p><div class="tokens"><div class="token">local-only</div><div class="token">no remote fetch</div><div class="token">optional</div></div><div class="actions"><button class="btn" data-home-target="analyze-workspace">Open Analyze Workspace</button></div></div><div class="home-card"><strong>Reports Shortcut</strong><p>When output already exists, jump back to Reports to inspect artifacts, Graph, DB2/Test Data, or Prompt Compare.</p><div class="tokens"><div class="token">read-only</div><div class="token">after output</div><div class="token">safe local read</div></div><div class="actions"><button class="btn" data-home-target="artifacts">Open Reports</button><button class="btn" data-home-target="refresh">Refresh Runs</button></div></div></div><h3>Prompt Workbench Choices</h3><p class="small">These starter choices help you enter Prompt Workbench faster, but they do not replace Setup or Reports.</p>'+promptWorkbenchHighlights()+'</div>'+
    '<div class="sub"><h2>Experimental / Coming Later</h2><p>These cards remain visible for orientation only. They are not active production browser actions.</p><div class="hint-list"><div class="hint-item"><strong>Deferred remote workflows</strong><p>Fetch Sources, Query DB2, and Generate AI Context stay disabled here until they are safely implemented and explicitly allowlisted.</p></div></div>'+(disabledCards.length?'<div class="workflow-grid">'+disabledCards.map((card)=>renderDisabledWorkflowCard(card)).join('')+'</div>':'<div class="empty">No deferred workflow cards registered.</div>')+'</div>';
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

  if(target==='reports'){
    s.tab='artifacts';
    await render();
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

  root.innerHTML='<div class="sub"><div class="home-callout"><h2>Advanced / Tools</h2><p>This area is intentionally secondary. Start in Setup for onboarding and readiness, then use Reports for normal output review before reaching for specialist tools.</p><div class="tokens"><div class="token">Primary flow: Setup</div><div class="token">Reports: read-only follow-up</div><div class="token">Advanced: optional</div><div class="token">Metadata: '+esc(s.uiMetadata.error?'degraded fallback':'live API')+'</div></div></div></div>'+
    (s.homePanel==='analyze-workspace'?renderAnalyzeWorkspacePanel():renderAdvancedOverviewPanel());

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
  const guided=guidedConfiguration();
  const steps=guidedConfigSteps();
  const intents=guidedConfigIntents();
  const discoveryActions=guidedDiscoveryActions();
  const selectedStep=selectedGuidedStep();
  const selectedIntent=selectedGuidedIntent();

  const statusLine=s.uiMetadata.loading
    ? 'Loading metadata...'
    : (s.uiMetadata.error
      ? ('Metadata API unavailable: '+s.uiMetadata.error)
      : 'Metadata loaded from /api/ui-metadata');

  const wizardState=profileWizardState();
  const wizardDraft=ensureProfileWizardDraft();
  const wizardSignals=evaluateProfileWizardDraft();
  const wizardPreviewFreshness=profileWizardPreviewFreshness();
  const wizardProfiles=wizardState&&Array.isArray(wizardState.profiles)?wizardState.profiles.filter((entry)=>!entry.mixin):[];
  const wizardSystems=wizardState&&Array.isArray(wizardState.systems)?wizardState.systems:[];
  const wizardManagedSystems=wizardSystems.filter((entry)=>entry.managedByGui);
  const wizardSelectedProfileSummary=findProfileWizardSummary(s.profileWizard.selectedProfileName||wizardDraft.profileName);
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
  const aiSessionState=s.uiActions.aiSession||{};
  const discoveryState=s.uiActions.discovery||{};
  const discoveryResult=discoveryState.result;
  const selectedDiscoveryActionId=String(discoveryState.actionId||((discoveryActions[0]&&discoveryActions[0].id)||'discover-source-libraries'));
  const profileForWizard=String(doctorState.profile||discoveryState.profile||preferredProfileWizardDoctorProfile()).trim()||'dev';
  if(!String(aiSessionState.profile||'').trim()){
    aiSessionState.profile=profileForWizard;
  }
  if(!doctorResult){
    aiSessionState.includeDoctorSummary=false;
  }else if(aiSessionState.result===null&&aiSessionState.error===null&&String(aiSessionState.goal||'').trim()===''){
    aiSessionState.includeDoctorSummary=true;
  }
  const wizardDetailsOpen=Boolean(
    s.profileWizard.loading
    || s.profileWizard.previewing
    || s.profileWizard.saving
    || s.profileWizard.error
    || s.profileWizard.saveStatus
    || s.profileWizard.selectedProfileName
    || wizardDraft.profileName
    || wizardPreviewFreshness.hasPreview
  );

  root.innerHTML=
    renderConfigureStartPanel({
      draft:wizardDraft,
      signals:wizardSignals,
      previewFreshness:wizardPreviewFreshness,
      profiles:wizardProfiles,
      managedSystems:wizardManagedSystems,
      selectedProfileSummary:wizardSelectedProfileSummary,
      doctorProfile:profileForWizard,
      doctorProfileSummary:findProfileWizardSummary(profileForWizard),
      doctorState,
      doctorStatusLabel
    })+
    '<div class="sub"><h2>Doctor Readiness Check</h2><p>Run Zeus Doctor after the profile draft has been previewed and saved. Doctor reads saved profile data only and reports the effective configuration status as ready, warning, failed, or error.</p><div class="field-grid"><label>Profile Name<input id="configDoctorProfile" value="'+escAttr(profileForWizard)+'" placeholder="dev"></label></div><div class="actions"><button class="btn primary" data-config-doctor="1">'+esc(doctorState.running?'Checking...':'Check Readiness')+'</button><button class="btn" data-config-refresh="1">Refresh Metadata</button></div><div class="tokens"><div class="token '+esc(doctorTone)+'">Doctor: '+esc(doctorStatusLabel)+'</div><div class="token">profile: '+esc(profileForWizard)+'</div>'+(doctorResult?'<div class="token">duration: '+esc(String(doctorResult.durationMs||0))+' ms</div>':'')+'</div>'+
    (doctorSummary?'<div class="hint-list"><div class="hint-item"><strong>Summary</strong><p>pass '+esc(String(doctorSummary.pass||0))+' • warn '+esc(String(doctorSummary.warn||0))+' • fail '+esc(String(doctorSummary.fail||0))+' • skip '+esc(String(doctorSummary.skip||0))+'</p><p class="small">'+esc(doctorHint)+'</p></div></div>':'<div class="hint-list"><div class="hint-item"><strong>Status</strong><p>'+esc(doctorHint)+'</p></div></div>')+
    doctorDiagnosticsPanel+
    (doctorDetails?'<details><summary>Show checks</summary><div class="preview"><pre>'+esc(doctorDetails)+'</pre></div></details>':'')+
    '</div>'+
    renderAiSessionStarterPanel({
      metadata:aiSessionStarterMetadata(),
      state:aiSessionState,
      profile:profileForWizard,
      doctorResult
    })+
    '<div class="sub"><details'+(wizardDetailsOpen?' open':'')+'><summary>Local-only Profile Wizard</summary><p class="small">Use this only when you need to create or adjust the local-only profile overlay that Setup and Doctor rely on.</p>'+renderProfileWizardPanel()+'</details></div>'+
    '<div class="sub"><h2>Advanced Setup Details</h2><p class="small">These sections explain the metadata-driven wizard model and read-only preview stubs. They are optional once the main setup flow is clear.</p><details'+(discoveryResult||discoveryState.error?' open':'')+'><summary>Read-only Discovery Actions</summary><div class="stack"><div class="field-list">'+(discoveryActions.length?discoveryActions.map((action)=>'<div class="field-item"><strong>'+esc(action.title)+'</strong><p>'+esc(action.description||'')+'</p><div class="workflow-meta"><div class="token">safety: '+esc(action.safetyLevel||'S2')+'</div><div class="token">'+esc(action.status||'stubbed-preview-only')+'</div><div class="token">'+esc(action.expensive?'preview first':'read-only')+'</div></div><div class="actions"><button class="btn" data-discovery-preview="'+esc(action.id)+'">'+esc(String(action.status||'').indexOf('config-preview-ready')===0?'Preview':'Preview Stub')+'</button></div></div>').join(''):'<div class="empty">No discovery actions available.</div>')+'</div>'+(discoveryState.error?'<div class="hint-list"><div class="hint-item"><strong>Discovery preview error</strong><p>'+esc(discoveryState.error)+'</p></div></div>':'')+renderGuidedDiscoveryPreview(discoveryResult)+'</div></details><details><summary>Safe CLI Preview</summary><p class="small">Generated from the selected intent. Secrets are never included.</p><div class="field-grid"><label>Analysis Intent<select id="guidedIntentSelect">'+intents.map((intent)=>'<option value="'+escAttr(intent.id)+'"'+(selectedIntent&&intent.id===selectedIntent.id?' selected':'')+'>'+esc(intent.title)+'</option>').join('')+'</select></label></div>'+renderGuidedCliPreview(selectedIntent,profileForWizard)+'</details><details><summary>Guided Wizard Metadata</summary><div class="tokens"><div class="token">'+esc(statusLine)+'</div><div class="token">Wizard steps: '+esc(String(steps.length||0))+'</div><div class="token">Intents: '+esc(String(intents.length||0))+'</div><div class="token">Purpose labels: '+esc(String(guided&&guided.purposeLabels&&guided.purposeLabels.length||0))+'</div></div><div class="section-list">'+steps.map((step)=>'<button class="btn section-btn'+(selectedStep&&step.id===selectedStep.id?' active':'')+'" data-guided-step="'+esc(step.id)+'">'+esc(step.shortTitle||step.title)+'</button>').join('')+'</div><div class="configure-layout"><div class="section-list">'+
      sections.map((section)=>'<button class="btn section-btn'+(section.id===s.uiMetadata.selectedConfigSection?' active':'')+'" data-config-section="'+esc(section.id)+'">'+esc(section.label||section.id)+'</button>').join('')+
    '</div><div class="field-list">'+
      renderGuidedStepDetails(selectedStep,selectedIntent)+
      '<details><summary>Raw metadata fallback</summary>'+(fields.length>0?'<div class="field-list">'+fields.filter((field)=>field.section===String(s.uiMetadata.selectedConfigSection||defaultConfigSection())).map((field)=>'<div class="field-item"><strong>'+esc(field.label||field.key)+'</strong><p>'+esc(field.description||'')+'</p><div class="workflow-meta"><div class="token">key: '+esc(field.key)+'</div><div class="token">type: '+esc(field.type||'string')+'</div><div class="token">'+esc(field.sensitive?'sensitive':'non-sensitive')+'</div></div><div class="small">placeholder: '+esc(field.placeholder||'(none)')+'</div><div class="small">example: '+esc(field.example||'(none)')+'</div><div class="small">env: '+esc(field.envVar||'(none)')+'</div><div class="small">profile path: '+esc(field.profilePath||'(none)')+'</div></div>').join('')+'</div>':'<div class="empty">No metadata fields available.</div>')+'</details>'+
    '</div></div></details></div>';

  const bindInput=(selector,assigner)=>{
    const node=root.querySelector(selector);
    if(node){
      node.oninput=(event)=>{
        assigner(String(event.target.value||''));
      };
      node.onchange=(event)=>{
        assigner(String(event.target.value||''));
      };
    }
  };

  bindInput('#profileWizardProfileSelect',(value)=>{ s.profileWizard.selectedProfileName=value.trim(); });
  bindInput('#profileWizardName',(value)=>{ wizardDraft.profileName=value.trim(); });
  bindInput('#profileWizardComment',(value)=>{ wizardDraft.comment=value; });
  bindInput('#profileWizardExtends',(value)=>{ wizardDraft.extends=value.split(',').map((entry)=>String(entry||'').trim()).filter(Boolean); });
  bindInput('#profileWizardSourceRoot',(value)=>{ wizardDraft.sourceRoot=value.trim(); });
  bindInput('#profileWizardOutputRoot',(value)=>{ wizardDraft.outputRoot=value.trim(); });
  bindInput('#profileWizardRegistryPath',(value)=>{ wizardDraft.analysesRegistryPath=value.trim(); });
  bindInput('#profileWizardDefaultDbSystem',(value)=>{ wizardDraft.environmentBindings.defaultDbSystem=value.trim(); });
  bindInput('#profileWizardMetadataSystem',(value)=>{ wizardDraft.environmentBindings.metadataSystem=value.trim(); });
  bindInput('#profileWizardTestDataSystem',(value)=>{ wizardDraft.environmentBindings.testDataSystem=value.trim(); });
  bindInput('#profileWizardFetchSystem',(value)=>{ wizardDraft.environmentBindings.fetchSystem=value.trim(); });
  bindInput('#profileWizardFetchSourceLibrary',(value)=>{ wizardDraft.fetch.sourceLibrary=value.trim().toUpperCase(); });
  bindInput('#profileWizardFetchIfsDir',(value)=>{ wizardDraft.fetch.ifsDir=value.trim(); });
  bindInput('#profileWizardFetchOut',(value)=>{ wizardDraft.fetch.out=value.trim(); });
  bindInput('#profileWizardFetchFiles',(value)=>{ wizardDraft.fetch.files=value.split(',').map((entry)=>String(entry||'').trim().toUpperCase()).filter(Boolean); });
  bindInput('#profileWizardFetchMembers',(value)=>{ wizardDraft.fetch.members=value.split(',').map((entry)=>String(entry||'').trim().toUpperCase()).filter(Boolean); });
  bindInput('#profileWizardFetchTransport',(value)=>{ wizardDraft.fetch.transport=value.trim().toLowerCase(); });

  for(const button of root.querySelectorAll('[data-pw-env-remove]')){
    button.onclick=()=>{
      const index=Number.parseInt(String(button.dataset.pwEnvRemove||''),10);
      if(Number.isInteger(index)&&index>=0){
        wizardDraft.managedEnvironments.splice(index,1);
        renderConfigure();
      }
    };
  }
  for(const button of root.querySelectorAll('[data-pw-env-add]')){
    button.onclick=()=>{
      wizardDraft.managedEnvironments.push({
        key:'',
        displayName:'',
        systemName:'',
        aliases:'',
        hostEnvVar:'',
        userEnvVar:'',
        passwordEnvVar:'',
        defaultLibrary:'',
        defaultSchema:''
      });
      renderConfigure();
    };
  }
  const envFieldMap=[
    ['[data-pw-env-key]','key'],
    ['[data-pw-env-display]','displayName'],
    ['[data-pw-env-system-name]','systemName'],
    ['[data-pw-env-aliases]','aliases'],
    ['[data-pw-env-host]','hostEnvVar'],
    ['[data-pw-env-user]','userEnvVar'],
    ['[data-pw-env-password]','passwordEnvVar'],
    ['[data-pw-env-library]','defaultLibrary'],
    ['[data-pw-env-schema]','defaultSchema']
  ];
  for(const [selector,fieldName] of envFieldMap){
    for(const node of root.querySelectorAll(selector)){
      const applyValue=(value)=>{
        const index=Number.parseInt(String(
          node.dataset.pwEnvKey
          || node.dataset.pwEnvDisplay
          || node.dataset.pwEnvSystemName
          || node.dataset.pwEnvAliases
          || node.dataset.pwEnvHost
          || node.dataset.pwEnvUser
          || node.dataset.pwEnvPassword
          || node.dataset.pwEnvLibrary
          || node.dataset.pwEnvSchema
          || ''
        ),10);
        if(!Number.isInteger(index)||index<0||!wizardDraft.managedEnvironments[index]) return;
        const nextValue=fieldName==='defaultLibrary'||fieldName==='defaultSchema'
          ? value.trim().toUpperCase()
          : value.trim();
        wizardDraft.managedEnvironments[index][fieldName]=nextValue;
      };
      node.oninput=(event)=>applyValue(String(event.target.value||''));
      node.onchange=(event)=>applyValue(String(event.target.value||''));
    }
  }
  for(const pwRefresh of root.querySelectorAll('[data-pw-refresh]')){
    pwRefresh.onclick=async ()=>{
      await loadProfileWizardState();
      renderConfigure();
    };
  }
  for(const pwNew of root.querySelectorAll('[data-pw-new]')){
    pwNew.onclick=()=>{
      startNewProfileWizardDraft();
      renderConfigure();
    };
  }
  for(const pwLoad of root.querySelectorAll('[data-pw-load]')){
    pwLoad.onclick=async ()=>{
      await loadProfileWizardProfile(s.profileWizard.selectedProfileName);
      renderConfigure();
    };
  }
  for(const pwClone of root.querySelectorAll('[data-pw-clone]')){
    pwClone.onclick=()=>{
      cloneCurrentProfileWizardDraft();
      renderConfigure();
    };
  }
  for(const pwDelete of root.querySelectorAll('[data-pw-delete]')){
    pwDelete.onclick=async ()=>{
      const summary=findProfileWizardSummary(s.profileWizard.selectedProfileName||wizardDraft.profileName);
      if(!summary||summary.deleteAllowed!==true){
        s.profileWizard.error='Only profiles already stored in config/local-only/profiles.json can be deleted here.';
        renderConfigure();
        return;
      }
      await deleteProfileWizardProfile(summary.name);
      renderConfigure();
    };
  }
  for(const pwPreview of root.querySelectorAll('[data-pw-preview]')){
    pwPreview.onclick=async ()=>{
      await previewProfileWizardDraft();
      renderConfigure();
    };
  }
  for(const pwSave of root.querySelectorAll('[data-pw-save]')){
    pwSave.onclick=async ()=>{
      await saveProfileWizardDraft();
      renderConfigure();
    };
  }
  for(const pwProductionToggle of root.querySelectorAll('[data-pw-production-toggle]')){
    pwProductionToggle.onclick=()=>{
      wizardDraft.productionSystem=!wizardDraft.productionSystem;
      renderConfigure();
    };
  }
  for(const pwFetchToggle of root.querySelectorAll('[data-pw-fetch-toggle]')){
    pwFetchToggle.onclick=()=>{
      wizardDraft.fetch.enabled=wizardDraft.fetch.enabled===false;
      renderConfigure();
    };
  }

  for(const button of root.querySelectorAll('[data-guided-step]')){
    button.onclick=()=>{
      s.uiMetadata.selectedGuidedStep=button.dataset.guidedStep;
      renderConfigure();
    };
  }
  const profileInput=root.querySelector('#configDoctorProfile');
  if(profileInput){
    profileInput.oninput=(event)=>{
      const nextValue=String(event.target.value||'').trim();
      s.uiActions.doctor.profile=nextValue;
      s.uiActions.discovery.profile=nextValue;
      s.uiActions.aiSession.profile=nextValue;
    };
  }
  const aiSessionDetails=root.querySelector('#aiSessionStarterDetails');
  if(aiSessionDetails){
    aiSessionDetails.ontoggle=()=>{
      s.uiActions.aiSession.expanded=aiSessionDetails.open;
    };
  }
  bindInput('#aiSessionProfile',(value)=>{ s.uiActions.aiSession.profile=value.trim(); });
  bindInput('#aiSessionEnvironment',(value)=>{ s.uiActions.aiSession.environment=value.trim(); });
  bindInput('#aiSessionGoal',(value)=>{
    s.uiActions.aiSession.goal=value;
    s.uiActions.aiSession.copyStatus='';
  });
  const aiSessionDoctorSummary=root.querySelector('#aiSessionIncludeDoctorSummary');
  if(aiSessionDoctorSummary){
    aiSessionDoctorSummary.onchange=(event)=>{
      s.uiActions.aiSession.includeDoctorSummary=Boolean(event.target.checked);
    };
  }
  const intentSelect=root.querySelector('#guidedIntentSelect');
  if(intentSelect){
    intentSelect.onchange=(event)=>{
      s.uiMetadata.selectedGuidedIntent=String(event.target.value||'').trim();
      renderConfigure();
    };
  }
  for(const button of root.querySelectorAll('[data-discovery-preview]')){
    button.onclick=async ()=>{
      const profileInput=q('configDoctorProfile');
      if(profileInput){
        const nextValue=String(profileInput.value||'').trim()||'dev';
        s.uiActions.doctor.profile=nextValue;
        s.uiActions.discovery.profile=nextValue;
      }
      s.uiActions.discovery.actionId=button.dataset.discoveryPreview||selectedDiscoveryActionId;
      renderConfigure();
      await runDiscoveryPreviewAction();
      renderConfigure();
    };
  }
  for(const previousStepButton of root.querySelectorAll('[data-guided-step-prev]')){
    previousStepButton.onclick=()=>{
      const steps=guidedConfigSteps();
      const currentIndex=steps.findIndex((entry)=>entry.id===String(s.uiMetadata.selectedGuidedStep||''));
      const nextIndex=currentIndex<=0?0:currentIndex-1;
      s.uiMetadata.selectedGuidedStep=(steps[nextIndex]&&steps[nextIndex].id)||defaultGuidedStep();
      renderConfigure();
    };
  }
  for(const nextStepButton of root.querySelectorAll('[data-guided-step-next]')){
    nextStepButton.onclick=()=>{
      const steps=guidedConfigSteps();
      const currentIndex=steps.findIndex((entry)=>entry.id===String(s.uiMetadata.selectedGuidedStep||''));
      const nextIndex=currentIndex<0?0:Math.min(currentIndex+1,steps.length-1);
      s.uiMetadata.selectedGuidedStep=(steps[nextIndex]&&steps[nextIndex].id)||defaultGuidedStep();
      renderConfigure();
    };
  }
  for(const doctorButton of root.querySelectorAll('[data-config-doctor]')){
    doctorButton.onclick=async ()=>{
      const profileInput=q('configDoctorProfile');
      if(profileInput){
        const nextValue=String(profileInput.value||'').trim()||'dev';
        s.uiActions.doctor.profile=nextValue;
        s.uiActions.discovery.profile=nextValue;
        s.uiActions.aiSession.profile=nextValue;
      }
      await runDoctorReadinessAction();
      renderConfigure();
    };
  }
  for(const generateButton of root.querySelectorAll('[data-ai-session-generate]')){
    generateButton.onclick=async ()=>{
      await runGenerateAiSessionPromptAction();
      renderConfigure();
    };
  }
  for(const copyButton of root.querySelectorAll('[data-ai-session-copy]')){
    copyButton.onclick=async ()=>{
      await copyAiSessionPrompt();
    };
  }
  for(const refreshButton of root.querySelectorAll('[data-config-refresh]')){
    refreshButton.onclick=async ()=>{
      await loadUiMetadata();
      await loadProfileWizardState();
      renderConfigure();
      if(s.tab==='home') renderHome();
    };
  }
  for(const button of root.querySelectorAll('[data-config-section]')){
    button.onclick=()=>{
      s.uiMetadata.selectedConfigSection=button.dataset.configSection;
      renderConfigure();
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
    root.innerHTML='<div class="sub">'+renderReportsSubnav('graph')+'<div class="empty">No graph available for the selected run.</div></div>';
    bindReportsSubnav(root);
    return;
  }

  const g=s.detail.views.graph;
  const f=((q('graphFilter')&&q('graphFilter').value)||'').toLowerCase();
  const nodes=g.nodes.filter((n)=>!f||n.id.toLowerCase().includes(f)||n.type.toLowerCase().includes(f));
  const sel=g.nodes.find((n)=>n.id===s.node)||nodes[0]||null;

  root.innerHTML='<div class="sub">'+renderReportsSubnav('graph')+'<h3>Graph Explorer</h3><p>Click nodes to follow related artifacts and prompts.</p><input id="graphFilter" placeholder="Filter nodes"><div class="item-list">'+nodes.map((n)=>'<button class="item'+(sel&&sel.id===n.id?' active':'')+'" data-nid="'+esc(n.id)+'"><strong>'+esc(n.id)+'</strong><div>'+esc(n.type)+' • in '+esc(String(n.incomingCount))+' • out '+esc(String(n.outgoingCount))+'</div></button>').join('')+'</div></div><div class="sub">'+(sel?'<h2>'+esc(sel.id)+'</h2><div class="tokens"><div class="token">'+esc(sel.type)+'</div><div class="token">Connected '+esc(String(sel.connectedNodeIds.length))+'</div><div class="token">report view: Graph</div></div><h3>Connected Nodes</h3>'+linkNodes(sel.connectedNodeIds)+'<h3>Related Artifacts</h3>'+linkArtifacts(sel.relatedArtifactPaths)+'<h3>Related Prompts</h3>'+linkPrompts(sel.relatedPromptPaths)+(g.viewerArtifact?'<a class="btn" target="_blank" rel="noreferrer" href="/runs/'+encodeURIComponent(s.program)+'/artifacts/raw?path='+encodeURIComponent(g.viewerArtifact)+'">Open Architecture Viewer</a>':''):'<div class="empty">No nodes matched.</div>')+'</div>';

  q('graphFilter').value=f;
  q('graphFilter').oninput=()=>renderGraph();
  for(const b of root.querySelectorAll('[data-nid]')) b.onclick=()=>{s.node=b.dataset.nid;renderGraph();};
  bindReportsSubnav(root);
  bindCross(root);
}

function renderDb2(){
  const root=q('db2');
  root.classList.toggle('active',s.tab==='db2');
  if(s.tab!=='db2') return;

  if(!s.detail){
    root.innerHTML='<div class="sub">'+renderReportsSubnav('db2')+'<div class="empty">No run selected.</div></div>';
    bindReportsSubnav(root);
    return;
  }

  const d=s.detail.views.db2;
  if(!d.metadataAvailable&&!d.testDataAvailable){
    root.innerHTML='<div class="sub">'+renderReportsSubnav('db2')+'<div class="empty">No DB2 metadata or test data for the selected run.</div></div>';
    bindReportsSubnav(root);
    return;
  }

  const f=((q('db2Filter')&&q('db2Filter').value)||'').toLowerCase();
  const tables=d.tables.filter((t)=>!f||t.qualifiedName.toLowerCase().includes(f));
  const sel=d.tables.find((t)=>t.id===s.table)||tables[0]||null;

  root.innerHTML='<div class="sub">'+renderReportsSubnav('db2')+'<h3>DB2/Test Data</h3><div class="tokens"><div class="token">Metadata '+esc(String(d.metadataSummary&&d.metadataSummary.tableCount||0))+'</div><div class="token">Samples '+esc(String(d.testDataSummary&&d.testDataSummary.tableCount||0))+'</div><div class="token">Masked '+esc(String(d.testDataSummary&&d.testDataSummary.policySummary&&d.testDataSummary.policySummary.maskedTableCount||0))+'</div></div><input id="db2Filter" placeholder="Filter tables"><div class="item-list">'+tables.map((t)=>'<button class="item'+(sel&&sel.id===t.id?' active':'')+'" data-tid="'+esc(t.id)+'"><strong>'+esc(t.qualifiedName||t.table)+'</strong><div>rows '+esc(String(t.sampleRowCount||0))+' • masks '+esc(String(t.maskedColumnCount||0))+'</div></button>').join('')+'</div></div><div class="sub">'+(sel?'<h2>'+esc(sel.qualifiedName||sel.table)+'</h2><div class="tokens"><div class="token">match '+esc(sel.matchStatus||'unknown')+'</div><div class="token">policy '+esc(sel.policyEligibility||'not-exported')+'</div><div class="token">evidence '+esc(String(sel.sourceEvidenceCount||0))+'</div><div class="token">report view: DB2 / Test Data</div></div><h3>Artifacts</h3>'+linkArtifacts(sel.relatedArtifactPaths)+'<h3>Prompts</h3>'+linkPrompts(sel.relatedPromptPaths):'<div class="empty">No tables matched.</div>')+'</div>';

  q('db2Filter').value=f;
  q('db2Filter').oninput=()=>renderDb2();
  for(const b of root.querySelectorAll('[data-tid]')) b.onclick=()=>{s.table=b.dataset.tid;renderDb2();};
  bindReportsSubnav(root);
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
    root.innerHTML='<div class="sub">'+renderReportsSubnav('prompts')+'<div class="empty">No prompt artifacts for the selected run.</div></div>';
    bindReportsSubnav(root);
    return;
  }

  const ps=s.detail.views.prompts.artifacts;
  if(!s.left) s.left=ps[0].path;
  if(!s.right) s.right=(ps[1]&&ps[1].path)||ps[0].path;

  root.innerHTML='<div class="sub">'+renderReportsSubnav('prompts')+'<h3>Prompt Compare</h3><p>Compare prompt packs side by side.</p><div class="item-list">'+ps.map((p)=>'<button class="item" data-pick="'+esc(p.path)+'"><strong>'+esc(p.title)+'</strong><div>'+esc(p.path)+'</div></button>').join('')+'</div></div><div class="sub"><h3>Left Prompt</h3><select id="leftSel">'+ps.map((p)=>'<option value="'+esc(p.path)+'"'+(p.path===s.left?' selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select><div id="leftPrev" class="preview"></div></div><div class="sub"><h3>Right Prompt</h3><select id="rightSel">'+ps.map((p)=>'<option value="'+esc(p.path)+'"'+(p.path===s.right?' selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select><div id="rightPrev" class="preview"></div></div>';

  for(const b of root.querySelectorAll('[data-pick]')) b.onclick=()=>{s.left=b.dataset.pick;renderPrompts();};
  q('leftSel').onchange=(e)=>{s.left=e.target.value;renderPrompts();};
  q('rightSel').onchange=(e)=>{s.right=e.target.value;renderPrompts();};
  bindReportsSubnav(root);
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
    s.promptBuilder.contextSourceStatus='Select a report run first.';
    if(!opts.silent) renderWorkbench();
    return;
  }
  s.promptBuilder.contextSourceProgram=normalized;
  if(!opts.silent){
    s.promptBuilder.contextSourceStatus='Loading report prompt artifacts...';
    renderWorkbench();
  }
  try {
    const payload=await getJson('/api/prompt-builder/context-sources/'+encodeURIComponent(normalized)+'/prompts');
    const promptArtifacts=(payload&&Array.isArray(payload.promptArtifacts))?payload.promptArtifacts:[];
    s.promptBuilder.contextSourcePrompts=promptArtifacts;
    if(!promptArtifacts.some((entry)=>entry.path===s.promptBuilder.contextSourcePromptPath)){
      s.promptBuilder.contextSourcePromptPath=promptArtifacts[0]?promptArtifacts[0].path:'';
    }
    s.promptBuilder.contextSourceStatus=promptArtifacts.length>0?'Report prompt artifacts loaded.':'No importable prompt artifacts were found for that run.';
  } catch(error){
    s.promptBuilder.contextSourcePrompts=[];
    s.promptBuilder.contextSourcePromptPath='';
    s.promptBuilder.contextSourceStatus=workbenchUserError('Could not load report prompt artifacts',error);
  }
  if(!opts.silent) renderWorkbench();
}

function applyImportedContextSeed(seed){
  const content=String(seed&&seed.content||'');
  if(!content){
    s.promptBuilder.contextSourceStatus='The selected report prompt is empty.';
    return;
  }
  s.promptBuilder.previewEditable=true;
  s.promptBuilder.previewEditableContent=content;
  const marker='Imported context seed from '+String(seed.program||'')+'/'+String(seed.path||'');
  const currentReq=String(s.promptBuilder.additionalRequirements||'').trim();
  s.promptBuilder.additionalRequirements=currentReq?currentReq+'\\n'+marker:marker;
  s.promptBuilder.contextSourceStatus='Imported '+String(seed.path||'')+' as a preview seed.';
  s.promptBuilder.saveStatus='Report artifact seed applied to the preview draft.';
}

async function importContextSourcePrompt(){
  const program=String(s.promptBuilder.contextSourceProgram||'').trim();
  const promptPath=String(s.promptBuilder.contextSourcePromptPath||'').trim();
  if(!program||!promptPath){
    s.promptBuilder.contextSourceStatus='Select a report run and prompt artifact first.';
    renderWorkbench();
    return;
  }
  s.promptBuilder.contextSourceStatus='Importing report prompt artifact...';
  renderWorkbench();
  try {
    const payload=await sendJson('POST','/api/prompt-builder/context-sources/import',{
      program,
      path:promptPath,
    });
    applyImportedContextSeed(payload.seed||{});
  } catch(error){
    s.promptBuilder.contextSourceStatus=workbenchUserError('Could not import the report prompt artifact',error);
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

function workbenchUserError(prefix,error){
  const base=String(prefix||'Action failed').trim()||'Action failed';
  let message=String((error&&error.message)||error||'');
  message=message.split('\\r').join(' ').split('\\n').join(' ').split('\\t').join(' ').trim();
  while(message.includes('  ')) message=message.split('  ').join(' ');
  if(!message) return base+'. Try again.';
  if(message.toLowerCase().startsWith('request failed:')||message.length>180||(message.includes(' at ')&&message.includes('('))){
    return base+'. Try again.';
  }
  return base+': '+message;
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
  s.promptBuilder.saveStatus='Saving local template...';
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
    s.promptBuilder.saveStatus='Local template saved.';
  } catch(error){
    s.promptBuilder.saveStatus=workbenchUserError('Could not save the local template',error);
  }
  renderWorkbench();
}

async function deleteWorkbenchTemplate(){
  const templateId=s.promptBuilder.selectedTemplateId;
  if(!templateId) return;
  s.promptBuilder.saveStatus='Deleting local template...';
  renderWorkbench();
  try {
    await sendJson('DELETE','/api/prompt-builder/templates/'+encodeURIComponent(templateId));
    s.promptBuilder.selectedTemplateId=null;
    s.promptBuilder.saveStatus='Local template deleted.';
    await refreshWorkbenchTemplates();
  } catch(error){
    s.promptBuilder.saveStatus=workbenchUserError('Could not delete the local template',error);
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
  s.promptBuilder.saveStatus='Local template loaded.';
}

async function loadWorkbenchTemplate(templateId){
  if(!templateId) return;
  s.promptBuilder.saveStatus='Loading local template...';
  renderWorkbench();
  try {
    const payload=await getJson('/api/prompt-builder/templates/'+encodeURIComponent(templateId));
    applyTemplateToCanvas(payload.template);
    scheduleWorkbenchPreview();
  } catch(error){
    s.promptBuilder.saveStatus=workbenchUserError('Could not load the local template',error);
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
    s.promptBuilder.previewError=workbenchUserError('Preview could not be generated',error);
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

async function copyTextToClipboard(text){
  if(navigator&&navigator.clipboard&&navigator.clipboard.writeText){
    await navigator.clipboard.writeText(text);
    return;
  }
  const area=document.createElement('textarea');
  area.value=text;
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

async function copyWorkbenchPreview(){
  const text=currentPreviewText();
  if(!text){
    s.promptBuilder.saveStatus='No preview content is available to copy yet.';
    renderWorkbench();
    return;
  }
  try {
    await copyTextToClipboard(text);
    s.promptBuilder.saveStatus='Preview copied.';
  } catch(error){
    s.promptBuilder.saveStatus=workbenchUserError('Could not copy the preview',error);
  }
  renderWorkbench();
}

async function runGenerateAiSessionPromptAction(){
  const profile=String(s.uiActions.aiSession.profile||s.uiActions.doctor.profile||'dev').trim()||'dev';
  const environment=String(s.uiActions.aiSession.environment||'').trim();
  const goal=String(s.uiActions.aiSession.goal||'').trim();
  const doctorResult=s.uiActions.doctor&&s.uiActions.doctor.result&&typeof s.uiActions.doctor.result==='object'
    ? s.uiActions.doctor.result
    : null;
  const includeDoctorSummary=Boolean(doctorResult&&s.uiActions.aiSession.includeDoctorSummary!==false);
  const doctorSummary=includeDoctorSummary?buildAiSessionDoctorSummaryPayload(doctorResult):null;
  s.uiActions.aiSession.running=true;
  s.uiActions.aiSession.error=null;
  s.uiActions.aiSession.copyStatus='';
  s.uiActions.aiSession.expanded=true;
  try{
    const payload={
      profile,
      goal,
      includeDoctorSummary
    };
    if(environment) payload.environment=environment;
    if(doctorSummary) payload.doctorSummary=doctorSummary;
    const result=await sendJson('POST','/api/ui-actions/generate-ai-session-prompt',payload);
    s.uiActions.aiSession.result=result;
  }catch(error){
    s.uiActions.aiSession.error=error.message||String(error);
    s.uiActions.aiSession.result=null;
  }finally{
    s.uiActions.aiSession.running=false;
  }
}

async function copyAiSessionPrompt(){
  const text=s.uiActions.aiSession&&s.uiActions.aiSession.result&&s.uiActions.aiSession.result.prompt
    ? String(s.uiActions.aiSession.result.prompt)
    : '';
  if(!text){
    s.uiActions.aiSession.copyStatus='No session prompt is available to copy yet.';
    renderConfigure();
    return;
  }
  try{
    await copyTextToClipboard(text);
    s.uiActions.aiSession.copyStatus='Session prompt copied.';
  }catch(error){
    s.uiActions.aiSession.copyStatus='Could not copy the session prompt.';
  }
  renderConfigure();
}

function exportWorkbenchPreview(){
  const text=currentPreviewText();
  if(!text){
    s.promptBuilder.saveStatus='No preview content is available to export yet.';
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
  const templates=s.promptBuilder.templates||[];
  const contextSources=s.promptBuilder.contextSources||[];
  const contextPrompts=s.promptBuilder.contextSourcePrompts||[];
  const activeFieldDefs=selectedModule&&Array.isArray(selectedModule.configFields)&&selectedModule.configFields.length>0
    ? selectedModule.configFields.map((field)=>({
      name:String(field.name||'').trim(),
      label:String(field.name||'').trim(),
      type:String(field.type||'string'),
    })).filter((entry)=>entry.name)
    : fieldDefs;
  const previewText=currentPreviewText();

  root.innerHTML='<div class="sub"><h2>Prompt Workbench</h2><p>Advanced prompt composition tool for local drafts, previews, and reusable templates.</p><div class="hint-list"><div class="hint-item"><strong>Start here</strong><p>Finish Setup first. Use Reports for normal output review, then return here when you want to compose or refine a prompt draft.</p></div><div class="hint-item"><strong>Safety boundary</strong><p>This tool previews local prompt content, saves local templates, and imports existing local report artifacts. It does not execute arbitrary commands or contact remote systems.</p></div></div><h3>Use Cases</h3><p class="small">Pick a starting pattern, then adjust only what your draft needs.</p><input id="wbFilter" type="search" placeholder="Filter use cases"><div class="card-grid">'+filtered.map((entry)=>'<div class="card'+(selected&&selected.id===entry.id?' active':'')+'"><h3>'+esc(entry.title)+'</h3><p>'+esc(entry.description||'')+'</p><div class="meta"><div class="token">Priority: '+esc(entry.priority||'n/a')+'</div><div class="token">Default Modules: '+esc(String((entry.defaultModuleIds||[]).length))+'</div></div><div class="actions"><button class="btn" data-wb-select="'+esc(entry.id)+'">Use This Pattern</button></div></div>').join('')+'</div><h3>Templates</h3><p class="small">Save or reload reusable local templates. These actions persist local prompt-builder drafts only.</p><div class="field-grid"><label>Name<input id="wbTemplateName" value="'+escAttr(s.promptBuilder.templateName||'')+'" placeholder="Template name"></label><label>Description<textarea id="wbTemplateDescription" placeholder="Template description">'+esc(s.promptBuilder.templateDescription||'')+'</textarea></label><label>Tags (comma separated)<input id="wbTemplateTags" value="'+escAttr(s.promptBuilder.templateTags||'')+'" placeholder="mvp, api, ui"></label><label>Saved Templates<select id="wbTemplateSel"><option value="">'+esc('Select saved template')+'</option>'+(templates.map((template)=>'<option value="'+esc(template.id)+'"'+(template.id===s.promptBuilder.selectedTemplateId?' selected':'')+'>'+esc(template.name)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbLoadTemplate">Load Template</button><button class="btn primary" id="wbSaveTemplate">Save Local Template</button><button class="btn" id="wbDeleteTemplate">Delete Local Template</button></div>'+(templates.length?'<div class="small">Saved local templates: '+esc(String(templates.length))+'. Loading a template replaces the current draft fields.</div>':'<div class="small">No saved local templates yet. Preview a useful draft, then save it here for reuse.</div>')+(s.promptBuilder.saveStatus?'<div class="small '+statusToneClass(s.promptBuilder.saveStatus)+'">'+esc(s.promptBuilder.saveStatus)+'</div>':'')+'<h3>Import From Reports</h3><p class="small">Use an existing local report prompt as a seed. Import reads saved <code>ai_prompt_*.md</code> artifacts only.</p><div class="field-grid"><label>Analyze Run<select id="wbContextRunSel"><option value="">'+esc('Select output/<PROGRAM>')+'</option>'+(contextSources.map((entry)=>'<option value="'+esc(entry.program)+'"'+(entry.program===s.promptBuilder.contextSourceProgram?' selected':'')+'>'+esc(entry.program+' ('+(entry.promptArtifactCount||0)+' prompts)')+'</option>').join(''))+'</select></label><label>Prompt Artifact<select id="wbContextPromptSel"><option value="">'+esc('Select ai_prompt_*.md')+'</option>'+(contextPrompts.map((entry)=>'<option value="'+esc(entry.path)+'"'+(entry.path===s.promptBuilder.contextSourcePromptPath?' selected':'')+'>'+esc(entry.path)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbContextRefresh">Refresh Runs</button><button class="btn" id="wbContextLoadPrompts">Load Report Prompts</button><button class="btn" id="wbContextImport">Import From Report Artifact</button></div>'+(!contextSources.length?'<div class="small">No report runs are available for import yet. Generate output outside the browser, inspect it in Reports, then come back here if you want a prompt seed.</div>':(!contextPrompts.length&&s.promptBuilder.contextSourceProgram?'<div class="small">No importable prompt artifacts were found for the selected run yet.</div>':''))+(s.promptBuilder.contextSourceStatus?'<div class="small '+statusToneClass(s.promptBuilder.contextSourceStatus)+'">'+esc(s.promptBuilder.contextSourceStatus)+'</div>':'')+'<details><summary>Advanced Options</summary><p class="small">Use the canvas when you need to change module order, add lower-level sections, or add extra requirements.</p><h3>Prompt Canvas</h3><div class="item-list">'+moduleOrder.map((moduleId,index)=>'<div class="module-row'+(s.promptBuilder.selectedModuleId===moduleId?' active':'')+'"><h4>'+esc(moduleMap[moduleId]||moduleId)+'</h4><div class="small">'+esc(moduleId)+'</div><div class="actions"><button class="btn" data-wb-module-select="'+esc(moduleId)+'">Configure</button><button class="btn" data-wb-module-up="'+esc(String(index))+'">Move Up</button><button class="btn" data-wb-module-down="'+esc(String(index))+'">Move Down</button><button class="btn" data-wb-module-remove="'+esc(String(index))+'">Remove</button></div></div>').join('')+'</div><h4>Add Module</h4><div class="chips">'+(availableModules.length?availableModules.map((module)=>'<button class="btn" data-wb-module-add="'+esc(module.id)+'">+ '+esc(module.title)+'</button>').join(''):'<div class="empty">All modules are already in the canvas.</div>')+'</div><h4>Additional Requirements</h4><textarea id="wbAddReq" style="min-height:180px" placeholder="Additional requirements for this implementation prompt...">'+esc(s.promptBuilder.additionalRequirements||'')+'</textarea></details></div>'+
    '<div class="sub">'+
    (selected?'<h2>'+esc(selected.title)+'</h2><p>'+esc(selected.description||'')+'</p><div class="tokens"><div class="token">Modules in Canvas: '+esc(String(moduleOrder.length))+'</div><div class="token">Preview tokens: '+esc(String((preview&&preview.estimatedTokens)||0))+'</div><div class="token">Mode: '+esc(s.promptBuilder.previewEditable?'edit':'live')+'</div></div><div class="hint-list"><div class="hint-item"><strong>Preview</strong><p>Preview is safe and local. It does not persist anything unless you save a local template or export the preview.</p></div><div class="hint-item"><strong>Beginner path</strong><p>Use the default module set first. Open Advanced Options only when you need to reorder modules or add specialist sections.</p></div></div><h3>Draft Inputs'+(selectedModule?': '+esc(selectedModule.title):'')+'</h3>'+(activeFieldDefs.length?'<div class="field-grid">'+activeFieldDefs.map((field)=>renderCanvasFieldInput(field,(s.promptBuilder.fields||{})[field.name])).join('')+'</div>':'<div class="empty">No configurable fields are available for the current selection.</div>')+'<div class="actions"><button class="btn primary" id="wbPreviewRefresh">Preview Prompt</button><button class="btn" id="wbEditToggle">'+esc(s.promptBuilder.previewEditable?'Lock Preview Editing':'Edit Preview Draft')+'</button><button class="btn" id="wbCopyPreview">Copy Preview</button><button class="btn" id="wbExportPreview">Export Preview</button><button class="btn" id="wbToCompare">Open Prompt Compare</button></div><h3>Preview Prompt</h3><div id="wbPreviewPane" class="preview">'+(s.promptBuilder.previewLoading?'<pre>Generating preview...</pre>':s.promptBuilder.previewError?'<div class="empty">'+esc(s.promptBuilder.previewError)+'</div>':s.promptBuilder.previewEditable?'<textarea id="wbPreviewEditor" style="min-height:360px">'+esc(previewText)+'</textarea>':previewText?'<pre>'+esc(previewText)+'</pre>':'<div class="empty">No preview yet. Choose a use case, review the draft inputs, and click Preview Prompt.</div>')+'</div>'
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
        s.promptBuilder.contextSourceStatus='Report runs refreshed.';
      } catch(error){
        s.promptBuilder.contextSourceStatus=workbenchUserError('Could not refresh report runs',error);
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

  if(!s.runs.length){
    root.innerHTML='<div class="sub">'+renderReportsSubnav('artifacts')+'<div class="empty">No analysis runs were found under the current output root yet. Finish Setup, run Check Readiness, then generate analysis output with the CLI before returning here.</div><div class="actions"><button class="btn primary" data-reports-target="configure">Open Setup</button><button class="btn" data-reports-target="refresh">Refresh Runs</button><button class="btn" data-reports-target="home">Open Advanced / Tools</button></div></div>';
    bindReportsSubnav(root);
    for(const button of root.querySelectorAll('[data-reports-target]')){
      button.onclick=()=>openHomeTarget(button.dataset.reportsTarget);
    }
    return;
  }

  if(!s.detail){
    root.innerHTML='<div class="sub">'+renderReportsSubnav('artifacts')+'<div class="empty">Select a run from the left sidebar to open its report views.</div><div class="actions"><button class="btn" data-reports-target="refresh">Refresh Runs</button><button class="btn" data-reports-target="configure">Open Setup</button></div></div>';
    bindReportsSubnav(root);
    for(const button of root.querySelectorAll('[data-reports-target]')){
      button.onclick=()=>openHomeTarget(button.dataset.reportsTarget);
    }
    return;
  }

  const summary=s.detail.summary&&typeof s.detail.summary==='object'?s.detail.summary:{};
  const views=s.detail.views&&typeof s.detail.views==='object'?s.detail.views:{};
  const graphAvailable=Boolean(views.graph&&views.graph.available);
  const db2Summary=views.db2&&views.db2.summary&&typeof views.db2.summary==='object'?views.db2.summary:{};
  const db2Available=Boolean(views.db2&&(views.db2.metadataAvailable||views.db2.testDataAvailable||Number(db2Summary.tableCount||0)>0));
  const promptArtifacts=views.prompts&&Array.isArray(views.prompts.artifacts)?views.prompts.artifacts:[];
  const promptCompareAvailable=promptArtifacts.length>0;
  const artifactCount=Array.isArray(s.detail.artifacts)?s.detail.artifacts.length:0;
  const reportsCards=[
    {
      title:'Graph',
      description:graphAvailable?'Follow related nodes, artifacts, and prompt links for this run.':'Graph data is not available for this run.',
      target:'graph',
      available:graphAvailable,
      detail:graphAvailable?'nodes: '+String(views.summary&&views.summary.graphNodeCount||0):'read-only view unavailable',
    },
    {
      title:'DB2/Test Data',
      description:db2Available?'Inspect exported DB2 metadata and test-data evidence for this run.':'No DB2/Test Data report view is available for this run.',
      target:'db2',
      available:db2Available,
      detail:db2Available?'tables: '+String(views.summary&&views.summary.db2TableCount||0):'read-only view unavailable',
    },
    {
      title:'Prompt Compare',
      description:promptCompareAvailable?'Compare prompt artifacts side by side.':'No prompt artifacts are available to compare for this run.',
      target:'prompts',
      available:promptCompareAvailable,
      detail:promptCompareAvailable?'prompt packs: '+String(promptArtifacts.length):'read-only view unavailable',
    },
    {
      title:'Artifacts',
      description:artifactCount>0?'Browse the saved artifacts for this run and preview them safely.':'No artifacts are available to preview for this run.',
      target:'artifacts',
      available:artifactCount>0,
      detail:'artifacts: '+String(artifactCount),
    }
  ];

  root.innerHTML='<div class="sub">'+renderReportsSubnav('artifacts')+'<div class="workflow-meta"><div class="token">selected run: '+esc(String(summary.program||s.program||''))+'</div><div class="token">runs found: '+esc(String(s.runs.length||0))+'</div><div class="token">artifacts: '+esc(String(artifactCount))+'</div><div class="token">safe local read</div></div><div class="hint-list"><div class="hint-item"><strong>After Setup</strong><p>Use the left sidebar to switch runs, then choose the report view that best matches what you want to inspect.</p></div><div class="hint-item"><strong>What is available here</strong><p>Overview, Graph, DB2/Test Data, Prompt Compare, and artifact previews are report views over existing output. They do not execute remote actions.</p></div></div><h3>Reports Overview</h3><div class="workflow-grid">'+reportsCards.map((card)=>'<div class="workflow-card'+(card.available?'':' disabled')+'"><h4>'+esc(card.title)+'</h4><p>'+esc(card.description)+'</p><div class="workflow-meta"><div class="token">'+esc(card.available?'Available now':'Read-only unavailable')+'</div><div class="token">'+esc(card.detail)+'</div></div><div class="actions">'+(card.available&&card.target!=='artifacts'?'<button class="btn" data-reports-target="'+esc(card.target)+'">Open '+esc(card.title)+'</button>':'')+(card.target==='artifacts'?'<button class="btn'+(card.available?' primary':'')+'"'+(card.available?' data-reports-target="artifacts"':' disabled')+'>'+(card.available?'Browse Artifacts':'Artifacts unavailable')+'</button>':'')+(card.available?'<button class="btn" data-reports-target="refresh">Refresh Runs</button>':'')+'</div></div>').join('')+'</div><h3>Artifacts In This Run</h3>'+(artifactCount>0?'<div class="item-list">'+s.detail.artifacts.map((a)=>'<button class="item'+(a.path===s.artifact?' active':'')+'" data-aid="'+esc(a.path)+'"><strong>'+esc(a.path)+'</strong><div>'+esc(a.kind)+' • '+esc(String(a.sizeBytes))+' bytes</div></button>').join('')+'</div>':'<div class="empty">This run does not contain previewable artifacts yet.</div>')+'</div><div class="sub"><div class="stack"><h2 id="aTitle">Artifact Preview</h2><p id="aSub">Choose an artifact.</p></div><a id="aRaw" class="btn" target="_blank" rel="noreferrer" hidden>Open Raw</a><div id="aPrev" class="preview"><div class="empty">No artifact selected.</div></div></div>';

  for(const b of root.querySelectorAll('[data-aid]')){
    b.onclick=()=>{
      s.artifact=b.dataset.aid;
      renderArtifacts();
      renderArtifactPreview();
    };
  }
  bindReportsSubnav(root);
  for(const button of root.querySelectorAll('[data-reports-target]')){
    button.onclick=()=>openHomeTarget(button.dataset.reportsTarget);
  }
}

async function renderArtifactPreview(){
  if(s.tab!=='artifacts') return;

  const root=q('aPrev');
  const title=q('aTitle');
  const sub=q('aSub');
  const raw=q('aRaw');

  if(!root||!title||!sub||!raw){
    return;
  }

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
  try{
    const p=await getArtifact(art.path);
    let c=p.content;
    if(art.kind==='json'){
      try{
        c=JSON.stringify(JSON.parse(p.content),null,2);
      }catch(error){
        title.textContent=art.path;
        sub.textContent='json preview';
        root.innerHTML='<div class="empty">This JSON artifact could not be formatted for preview. Use Open Raw to inspect the saved file directly.</div>';
        return;
      }
    }
    root.innerHTML='<pre>'+esc(c)+'</pre>';
  }catch(error){
    root.innerHTML='<div class="empty">Artifact preview is unavailable right now. Refresh Reports or use Open Raw if the file exists.</div>';
  }
}

async function selectTab(tab){
  if(tab==='reports'){
    s.tab='artifacts';
    await render();
    return;
  }
  if(tab==='home'){
    s.homePanel='guide';
  }
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
  await loadProfileWizardState();
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
