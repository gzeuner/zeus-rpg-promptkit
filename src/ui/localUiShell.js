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
function renderLocalUiShell() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zeus Local UI</title>
<style>
body{margin:0;font-family:Georgia,serif;background:#f6f1e6;color:#1f2933}
*{box-sizing:border-box}
.app{display:grid;grid-template-columns:300px 1fr;min-height:100vh}
.panel{background:#fffaf0;border:1px solid #d4c3a3;border-radius:14px}
aside{padding:18px;border-right:1px solid #d4c3a3;background:#fffaf0}
.main{padding:18px;display:grid;gap:14px;min-height:100vh}
.list,.tabs,.chips{display:flex;flex-wrap:wrap;gap:8px}
.stack{display:grid;gap:12px}
.run-list,.item-list{display:grid;gap:8px;max-height:70vh;overflow:auto}
button,.chip,a.btn,select,input,textarea{font:inherit}
.run,.item,.tab,.btn{border:1px solid #d4c3a3;background:#fff;padding:10px 12px;border-radius:12px;cursor:pointer;text-decoration:none;color:#8a4b08}
.active{background:#fff0cf;border-color:#8a4b08}
.hero{padding:18px;display:flex;justify-content:space-between;gap:12px}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.metric{padding:14px}
.metric strong{display:block;font-size:24px;color:#8a4b08}
.view{display:none}
.view.active{display:grid}
.two{grid-template-columns:300px 1fr;gap:14px}
.three{grid-template-columns:260px 1fr 1fr;gap:14px}
.sub{padding:14px;display:grid;gap:10px;align-content:start}
.preview{border:1px solid #d4c3a3;border-radius:12px;background:#fffdf7;min-height:340px;overflow:auto}
pre{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:12px;line-height:1.45}
.empty{padding:18px;color:#5c6b73;border:1px dashed #d4c3a3;border-radius:12px}
.tokens{display:flex;flex-wrap:wrap;gap:6px}
.token{padding:6px 9px;border:1px solid #d4c3a3;border-radius:999px;background:#fff}
iframe{width:100%;height:420px;border:0;background:#fff}
textarea{width:100%;min-height:120px;padding:10px;border:1px solid #d4c3a3;border-radius:12px;background:#fff}
.card-grid{display:grid;gap:10px}
.card{border:1px solid #d4c3a3;background:#fff;padding:12px;border-radius:12px;display:grid;gap:8px}
.card h3{margin:0;color:#8a4b08;font-size:17px}
.card p{margin:0;color:#344854;font-size:14px;line-height:1.35}
.card .meta{display:flex;gap:8px;flex-wrap:wrap}
.card .meta .token{font-size:12px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
input[type="search"]{width:100%;padding:9px;border:1px solid #d4c3a3;border-radius:10px;background:#fff}
.field-grid{display:grid;gap:8px}
.field-grid label{font-size:12px;color:#5b6570;font-weight:bold}
.field-grid input,.field-grid textarea,.field-grid select{width:100%;padding:9px;border:1px solid #d4c3a3;border-radius:10px;background:#fff}
.module-row{display:grid;gap:6px;border:1px solid #d4c3a3;border-radius:10px;padding:9px;background:#fff}
.module-row.active{background:#fff0cf;border-color:#8a4b08}
.module-row h4{margin:0;color:#8a4b08}
.small{font-size:12px;color:#5c6b73}
.status-ok{color:#1f7a3f}
.status-warn{color:#8a4b08}
.status-err{color:#a11d2d}
@media(max-width:1100px){
  .app{grid-template-columns:1fr}
  .metrics,.two,.three{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="stack">
      <div>
        <h1>Zeus Local UI</h1>
        <p>Focused read-only views.</p>
      </div>
      <div class="token">Local-only API</div>
    </div>
    <div id="runs" class="run-list"></div>
  </aside>
  <div class="main">
    <div class="panel hero">
      <div class="stack">
        <h2 id="title">Analysis Runs</h2>
        <p id="subtitle">Select a run.</p>
      </div>
      <div id="chips" class="chips"></div>
    </div>

    <div id="metrics" class="metrics"></div>
    <div id="tabs" class="panel tabs" style="padding:10px"></div>

    <div id="graph" class="panel view two"></div>
    <div id="db2" class="panel view two"></div>
    <div id="prompts" class="panel view three"></div>
    <div id="workbench" class="panel view two"></div>
    <div id="artifacts" class="panel view two"></div>
  </div>
</div>

<script>
const s={
  runs:[],detail:null,program:null,tab:'graph',artifact:null,node:null,table:null,left:null,right:null,cache:new Map(),
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
    contextSourceStatus:''
  }
};

const tabs=[
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
    q('title').textContent='Analysis Runs';
    q('subtitle').textContent='Select a run.';
    q('chips').innerHTML='';
    return;
  }
  const x=s.detail.summary;
  q('title').textContent=x.program;
  q('subtitle').textContent='Focused explorer over graph, DB2, prompts, and Prompt Workbench.';
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
    .split(/\n|,/g)
    .map((entry)=>entry.trim())
    .filter(Boolean);
}

function arrayToText(value){
  if(!Array.isArray(value)) return '';
  return value.join('\n');
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
    root.innerHTML='<div class="sub"><div class="empty">No prompt builder use cases available.</div></div>';
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

  root.innerHTML='<div class="sub"><h2>Prompt Workbench</h2><p>Prompt Canvas for direct toolset implementation workflows.</p><input id="wbFilter" type="search" placeholder="Filter use cases"><div class="card-grid">'+filtered.map((entry)=>'<div class="card'+(selected&&selected.id===entry.id?' active':'')+'"><h3>'+esc(entry.title)+'</h3><p>'+esc(entry.description||'')+'</p><div class="meta"><div class="token">Priority: '+esc(entry.priority||'n/a')+'</div><div class="token">Default Modules: '+esc(String((entry.defaultModuleIds||[]).length))+'</div></div><div class="actions"><button class="btn" data-wb-select="'+esc(entry.id)+'">Select</button></div></div>').join('')+'</div><h3>Template</h3><div class="field-grid"><label>Name<input id="wbTemplateName" value="'+escAttr(s.promptBuilder.templateName||'')+'" placeholder="Template name"></label><label>Description<textarea id="wbTemplateDescription" placeholder="Template description">'+esc(s.promptBuilder.templateDescription||'')+'</textarea></label><label>Tags (comma separated)<input id="wbTemplateTags" value="'+escAttr(s.promptBuilder.templateTags||'')+'" placeholder="mvp, api, ui"></label><label>Saved Templates<select id="wbTemplateSel"><option value="">'+esc('Select saved template')+'</option>'+((s.promptBuilder.templates||[]).map((template)=>'<option value="'+esc(template.id)+'"'+(template.id===s.promptBuilder.selectedTemplateId?' selected':'')+'>'+esc(template.name)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbLoadTemplate">Load</button><button class="btn" id="wbSaveTemplate">Save Template</button><button class="btn" id="wbDeleteTemplate">Delete</button></div><div class="small '+(String(s.promptBuilder.saveStatus||'').toLowerCase().includes('failed')?'status-err':'status-ok')+'">'+esc(s.promptBuilder.saveStatus||'')+'</div><h3>Output Context Source</h3><div class="field-grid"><label>Analyze Run<select id="wbContextRunSel"><option value="">'+esc('Select output/<PROGRAM>')+'</option>'+((s.promptBuilder.contextSources||[]).map((entry)=>'<option value="'+esc(entry.program)+'"'+(entry.program===s.promptBuilder.contextSourceProgram?' selected':'')+'>'+esc(entry.program+' ('+(entry.promptArtifactCount||0)+' prompts)')+'</option>').join(''))+'</select></label><label>Prompt Artifact<select id="wbContextPromptSel"><option value="">'+esc('Select ai_prompt_*.md')+'</option>'+((s.promptBuilder.contextSourcePrompts||[]).map((entry)=>'<option value="'+esc(entry.path)+'"'+(entry.path===s.promptBuilder.contextSourcePromptPath?' selected':'')+'>'+esc(entry.path)+'</option>').join(''))+'</select></label></div><div class="actions"><button class="btn" id="wbContextRefresh">Refresh Runs</button><button class="btn" id="wbContextLoadPrompts">Load Prompts</button><button class="btn" id="wbContextImport">Import As Seed</button></div><div class="small '+(String(s.promptBuilder.contextSourceStatus||'').toLowerCase().includes('failed')?'status-err':'status-ok')+'">'+esc(s.promptBuilder.contextSourceStatus||'')+'</div><h3>Prompt Canvas</h3><div class="item-list">'+moduleOrder.map((moduleId,index)=>'<div class="module-row'+(s.promptBuilder.selectedModuleId===moduleId?' active':'')+'"><h4>'+esc(moduleMap[moduleId]||moduleId)+'</h4><div class="small">'+esc(moduleId)+'</div><div class="actions"><button class="btn" data-wb-module-select="'+esc(moduleId)+'">Config</button><button class="btn" data-wb-module-up="'+esc(String(index))+'">Up</button><button class="btn" data-wb-module-down="'+esc(String(index))+'">Down</button><button class="btn" data-wb-module-remove="'+esc(String(index))+'">Remove</button></div></div>').join('')+'</div><h4>Add Module</h4><div class="chips">'+(availableModules.length?availableModules.map((module)=>'<button class="btn" data-wb-module-add="'+esc(module.id)+'">+ '+esc(module.title)+'</button>').join(''):'<div class="empty">All modules in canvas.</div>')+'</div><h4>Additional Requirements</h4><textarea id="wbAddReq" style="min-height:180px" placeholder="Additional requirements for this implementation prompt...">'+esc(s.promptBuilder.additionalRequirements||'')+'</textarea></div>'+
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
  await loadPromptBuilderData();
  s.runs=await getJson('/api/runs');
  renderRuns();
  renderTabs();
  if(s.runs.length) await selectRun(s.runs[0].program);
  else await render();
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
