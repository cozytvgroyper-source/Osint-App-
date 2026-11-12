import {explainSearchPlan,summarizePlanDiagnostics} from './search-planner.js';
import {classifyToolResult,hasUsefulData,parseToolResult} from './result-classifier.js';
import {buildSearchReport,reportHasFindings} from './search-report.js?v=2';
import {recordToolHealth,serverConnectionLabel,toolCountLabel} from './tool-health.js';
import {activeCaseId,defaultCaseName,newestFirst,shortFingerprint} from './cases-client.js';
import {argsForSearch,extractTarget,searchIntent} from './search-query.js';
import {loadStoredState,mergeStoredServers,persistStoredState} from './browser-storage.js';
import {TIERS,groupToolsByTier,runRequirements,toolRisk,toolUsage} from './tool-tiers.js';
import {resultPivot} from './result-pivots.js?v=1';
import {buildRunGrantRequest} from './run-grant-client.js?v=1';
import {deepRunBlocked,deepSearchPlan} from './deep-search.js?v=1';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bundledServers=[
  { id: 'osint-local', name: 'Open OSINT', endpoint: 'http://127.0.0.1:8892/mcp', status: 'offline', tools: [] },
  { id: 'osint-toolbox-local', name: 'OSINT Toolbox', endpoint: 'http://127.0.0.1:8893/mcp', status: 'offline', tools: [] },
  { id: 'omega-local', name: 'Omega MCP', endpoint: 'http://127.0.0.1:8894/mcp', status: 'offline', tools: [], caution: 'Use active scanning tools only on systems you own or are authorized to test.' },
  { id: 'consensus', name: 'Consensus', endpoint: 'https://mcp.consensus.app/mcp', status: 'offline', tools: [], oauth: 'consensus' }
];
// Storage keys keep the original 'signaldesk.' prefix so saved data survives the Public Desk rename.
const storedState=loadStoredState(localStorage);
const removedBundledEndpoints=new Set(storedState.disabledBundledEndpoints);
const startupServers=mergeStoredServers(bundledServers,storedState.servers,removedBundledEndpoints);
const state = {
  servers: startupServers,
  tokens: new Map(),
  history: storedState.history,
  evidence: storedState.evidence,
  toolHealth: storedState.toolHealth,
  disabledBundledEndpoints: removedBundledEndpoints,
  activeTool: null,
  lastResult: null,
  pendingFile: null,
  tierFilter: 'all',
  deepPlan: [],
  deepController: null,
  cases: [],
  activeCaseId: localStorage.getItem('signaldesk.activeCase'),
  activeCase: null
};
const clientSessionId=sessionStorage.getItem('signaldesk.clientSessionId')||crypto.randomUUID();
sessionStorage.setItem('signaldesk.clientSessionId',clientSessionId);
const sessionKeyFor=serverId=>`${clientSessionId}:${serverId}`;
// Development mode: open Public Desk at /?diagnostics to see why the planner chose each tool.
const diagnosticsEnabled=new URLSearchParams(location.search).has('diagnostics');
let latestSearchId=0;
let pendingStorageWarnings=[...storedState.warnings];
let lastStorageWarning='';
const intelNews={events:[],metrics:null,categories:[],generatedAt:'',loaded:false,loading:false,error:'',visibleLimit:30};

function persist() {
  const saved=persistStoredState(localStorage,state);
  state.evidence=saved.evidence;
  const warning=[...pendingStorageWarnings,...saved.warnings].at(-1)||'';
  pendingStorageWarnings=[];
  if(warning&&warning!==lastStorageWarning){lastStorageWarning=warning;queueMicrotask(()=>toast(warning));}
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function iconFor(name='') { if(/cyber|cve|threat|domain|ip/i.test(name))return'⌁'; if(/geo|satellite|place|flight|vessel/i.test(name))return'◈'; if(/sanction|entity|company/i.test(name))return'◎'; return'▤'; }

function switchView(id) {
  $$('.view').forEach(v => v.classList.toggle('active-view', v.id === id));
  $$('.nav').forEach(v => v.classList.toggle('active', v.dataset.view === id));
  const labels={workspace:'Hello Groyper',servers:'Connection center',library:'Explore capabilities',deep:'Plan a controlled test',news:'IntelMap news',evidence:'Your case file'};
  $('#pageTitle').textContent=labels[id]||'Public Desk'; window.scrollTo({top:0,behavior:'smooth'});
  if(id==='news'&&!intelNews.loaded&&!intelNews.loading)loadIntelNews();
  if(id==='deep')loadDeepHistory();
}

function safeExternalUrl(value=''){
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'#';}catch{return'#';}
}
function relativeTime(value){
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));
  if(seconds<60)return `${seconds}s ago`; if(seconds<3600)return `${Math.floor(seconds/60)}m ago`; if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`; return `${Math.floor(seconds/86400)}d ago`;
}
function renderIntelNews(){
  const list=$('#intelNewsList'); if(!list)return;
  if(intelNews.loading){list.innerHTML='<div class="empty-state">Loading IntelMap JSON feed…</div>';return;}
  if(intelNews.error){list.innerHTML=`<div class="empty-state">${escapeHtml(intelNews.error)} <button class="text-button" id="retryIntelNews">Try again</button></div>`;$('#retryIntelNews')?.addEventListener('click',()=>loadIntelNews(true));return;}
  const filter=$('#intelNewsFilter').value.trim().toLowerCase(); const category=$('#intelNewsCategory').value;
  const matching=intelNews.events.filter(event=>(!category||event.category===category)&&(!filter||[event.title,event.description,event.source,event.country,event.region,event.category].some(value=>String(value||'').toLowerCase().includes(filter))));
  const events=matching.slice(0,intelNews.visibleLimit);
  const metrics=intelNews.metrics||{};
  $('#intelNewsMetrics').innerHTML=[['Signal index',`${metrics.threatIndex??'—'} · ${metrics.threatLevel||'Unknown'}`],['Live signals',metrics.signals??intelNews.events.length],['High priority',metrics.highPriority??'—'],['Sources online',metrics.sourcesOnline!=null?`${metrics.sourcesOnline}/${metrics.sourcesTotal||metrics.sourcesOnline}`:'—']].map(([label,value])=>`<article><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></article>`).join('');
  $('#intelNewsFreshness').textContent=intelNews.generatedAt?`Updated ${relativeTime(intelNews.generatedAt)} · showing ${events.length}`:`Showing ${events.length}`;
  list.innerHTML=events.length?events.map(event=>`<article class="news-card"><div class="news-card-top"><span class="badge">${escapeHtml(event.category||event.kind||'signal')}</span><time title="${escapeHtml(event.timestamp||'')}">${escapeHtml(relativeTime(event.timestamp))}</time></div><h3>${escapeHtml(event.title||'Untitled signal')}</h3>${event.description?`<p>${escapeHtml(event.description)}</p>`:''}<div class="news-meta"><span>${escapeHtml(event.source||'Unknown source')}</span><span>${escapeHtml(event.country||event.region||'Global')}</span><span>P${escapeHtml(event.severity??'—')} · ${escapeHtml(event.confidence??'—')}% confidence</span></div><a class="text-button" href="${escapeHtml(safeExternalUrl(event.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></article>`).join('')+(matching.length>events.length?`<button class="ghost news-load-more" data-load-more-news>Show ${Math.min(30,matching.length-events.length)} more</button>`:''):'<div class="empty-state">No IntelMap signals match these filters.</div>';
}
async function loadIntelNews(force=false){
  if(intelNews.loading||(!force&&intelNews.loaded))return; intelNews.loading=true;intelNews.error='';intelNews.visibleLimit=30;renderIntelNews();
  try{
    const response=await fetch('https://intelmap.watch/api/feed/',{headers:{accept:'application/json'}}); if(!response.ok)throw new Error(`IntelMap returned ${response.status}`);
    const data=await response.json(); intelNews.events=Array.isArray(data.events)?data.events:[];intelNews.metrics=data.metrics||null;intelNews.categories=Array.isArray(data.categories)?data.categories:[];intelNews.generatedAt=data.generatedAt||data.cacheTimestamp||new Date().toISOString();intelNews.loaded=true;
    const select=$('#intelNewsCategory');const current=select.value;select.innerHTML='<option value="">All categories</option>'+intelNews.categories.map(item=>`<option value="${escapeHtml(item.name)}">${escapeHtml(humanize(item.name))} (${escapeHtml(item.count)})</option>`).join('');select.value=current;
  }catch(error){intelNews.error=`Could not load IntelMap news: ${error.message}`;}finally{intelNews.loading=false;renderIntelNews();}
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function api(path, payload, options={}) {
  const response = await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:options.signal});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function connect(server) {
  if(server.status==='connecting')return;
  server.disconnected=false;
  server.needsAuth=false;
  server.status='connecting'; renderServers(); renderConnections();
  try {
    const payload={endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:sessionKeyFor(server.id),method:'tools/list',params:{},initialize:true};
    const response=await api('/api/mcp',payload);
    if(response.error) throw new Error(response.error.message || 'MCP error');
    server.tools=response.result?.tools || [];
    server.status='connected';
    toast(`${server.name} connected · ${server.tools.length} tools`);
  } catch(error) {
    server.status='offline'; server.error=error.message;
    if(server.oauth&&/401|Authentication required|unauthorized/i.test(error.message))server.needsAuth=true;
    toast(server.needsAuth?`${server.name} needs sign-in`:`Could not connect: ${error.message}`);
  }
  renderAll();
}

async function disconnect(server) {
  if(!server)return;
  await api('/api/mcp/disconnect',{sessionKey:sessionKeyFor(server.id)}).catch(()=>{});
  server.status='offline';
  server.tools=[];
  server.error='';
  server.needsAuth=false;
  server.disconnected=true;
  renderAll();
  toast(`${server.name} disconnected`);
}

function renderWorkflows(){
  $('#workflowGrid').innerHTML=state.servers.length?state.servers.map(server=>`<article class="workflow server-workflow"><div class="server-workflow-head"><span class="workflow-icon">${server.name==='Open OSINT'?'◎':'⌘'}</span><span class="server-dot ${server.status==='connected'?'connected':''}"></span></div><b>${escapeHtml(server.name)}</b><small>${escapeHtml(server.endpoint)}</small><div class="server-workflow-foot"><span>${server.status==='connected'?toolCountHtml(server):server.status==='connecting'?'Connecting…':server.disconnected?'Disconnected':'Ready to connect'}</span><button class="text-button" ${server.status==='connected'?`data-disconnect="${server.id}"`:`data-connect="${server.id}"`}>${server.status==='connected'?'Disconnect':'Connect'} →</button></div></article>`).join(''):'<div class="empty-state">No MCP servers saved.</div>';
}
function renderHistory(){
  $('#history').innerHTML=state.history.length?state.history.slice(0,5).map(item=>`<div class="history-item"><span class="mini-icon">${iconFor(item.title)}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.server||'Local workspace')}</small></div><time>${new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):'<div class="history-empty">Your investigations will appear here.</div>';
}
function renderConnections(){
  $('#serverStatus').textContent=serverConnectionLabel(state.servers);
  $('#connectionCount').textContent=serverConnectionLabel(state.servers);
  $('#connectionSummary').innerHTML=state.servers.map(s=>`<div class="connection"><div class="connection-name"><span class="server-dot ${s.status==='connected'?'connected':''}"></span><div><b>${escapeHtml(s.name)}</b><small>${s.status==='connected'?toolCountHtml(s):s.status==='connecting'?'Connecting…':s.disconnected?'Disconnected':'Ready to connect'}</small></div></div><button class="text-button" ${s.status==='connected'?`data-disconnect="${s.id}"`:`data-connect="${s.id}"`}>${s.status==='connected'?'Disconnect':'Connect'}</button></div>`).join('');
}
function renderServers(){
  $('#serverList').innerHTML=state.servers.length?state.servers.map(s=>`<article class="server-card"><div class="server-card-top"><span class="badge">STREAMABLE HTTP</span><span class="server-dot ${s.status==='connected'?'connected':''}"></span></div><h3>${escapeHtml(s.name)}</h3><p class="endpoint">${escapeHtml(s.endpoint)}</p><p class="subtle">${s.status==='connected'?toolCountHtml(s):s.needsAuth?'Sign in is required to search academic research.':s.disconnected?'Disconnected':s.error?escapeHtml(s.error):'Not connected'}</p>${s.caution?`<p class="form-note">${escapeHtml(s.caution)}</p>`:''}<div class="server-actions"><button class="ghost" data-remove="${s.id}">${bundledServers.some(item=>item.endpoint===s.endpoint)?'Disable':'Remove'}</button>${s.needsAuth?`<a class="primary" href="/api/oauth/consensus/start">Sign in to Consensus</a>`:s.status==='connected'?`<button class="ghost" data-disconnect="${s.id}">Disconnect</button><button class="primary" data-connect="${s.id}">Refresh</button>`:`<button class="primary" data-connect="${s.id}">${s.status==='connecting'?'Connecting…':'Connect'}</button>`}</div></article>`).join(''):'<div class="empty-state">Add your first MCP server to begin.</div>';
}
// Data sources: API keys for the services behind Open OSINT's tools, saved by the server in work/api-keys.env.
// The server reports statuses and which fields are saved, never key values, and key inputs are cleared on close.
const dataSources={list:[],loaded:false,error:'',editing:null};
const SOURCE_STATUS={connected:'Connected · key saved',disconnected:'Disconnected · key kept',not_configured:'Not connected'};
async function loadDataSources(){
  try{dataSources.list=(await api('/api/data-sources',{})).sources;dataSources.error='';}
  catch(error){dataSources.error=`Could not load data sources: ${error.message}`;}
  dataSources.loaded=true;renderDataSources();
}
function replaceDataSource(source){dataSources.list=dataSources.list.map(item=>item.id===source.id?source:item);renderDataSources();}
function renderDataSources(){
  const list=dataSources.list;const connected=list.filter(s=>s.status==='connected');
  const count=dataSources.loaded&&!dataSources.error?`${connected.length} of ${list.length} connected`:'';
  $('#dataSourceCount').textContent=count;$('#dataSourceSummary').textContent=count;
  $('#dataSourceStrip').innerHTML=dataSources.error?`<div class="empty-state">${escapeHtml(dataSources.error)}</div>`:connected.length?connected.map(s=>`<span class="source-pill"><span class="server-dot connected"></span>${escapeHtml(s.name)}</span>`).join(''):dataSources.loaded?'<div class="empty-state">No data sources connected yet.</div>':'';
  if(dataSources.error){$('#dataSourceList').innerHTML=`<div class="empty-state">${escapeHtml(dataSources.error)}</div>`;return;}
  if(!dataSources.loaded)return;
  $('#dataSourceList').innerHTML=list.map(s=>{
    const dot=s.status==='connected'?'connected':s.status==='disconnected'?'':'idle';
    const feeds=s.feeds.length?`Feeds ${s.feeds.join(', ')}`:'No search tool uses it directly';
    const id=escapeHtml(s.id);
    const actions=s.status==='not_configured'
      ?`<a class="ghost" href="${escapeHtml(s.signup)}" target="_blank" rel="noopener noreferrer">Get a key ↗</a><button class="primary" data-source-edit="${id}">Connect</button>`
      :`<button class="ghost" data-source-remove="${id}">Remove</button><button class="ghost" data-source-edit="${id}">Change key</button>${s.status==='connected'?`<button class="primary" data-source-disconnect="${id}">Disconnect</button>`:`<button class="primary" data-source-connect="${id}">Connect</button>`}`;
    return `<article class="server-card source-card"><div class="server-card-top"><span class="badge">API KEY</span><span class="server-dot ${dot}"></span></div><h3>${escapeHtml(s.name)}${s.recommended?' <span class="badge recommended-badge">Recommended</span>':''}</h3><p class="endpoint">${escapeHtml(feeds)}</p><p class="subtle">${SOURCE_STATUS[s.status]||''}</p><p class="source-improves"><b>Improves:</b> ${escapeHtml(s.improves||'')}</p><p class="form-note">${escapeHtml(s.note)}</p>${s.example?`<button class="text-button source-try" data-prompt="${escapeHtml(s.example)}">Try a search: ${escapeHtml(s.example)} →</button>`:''}<div class="server-actions">${actions}</div></article>`;
  }).join('');
}
function openKeyDialog(source){
  dataSources.editing=source.id;
  $('#keyDialogTitle').textContent=`${source.status==='not_configured'?'Connect':'Change key for'} ${source.name}`;
  $('#keyFields').innerHTML=source.fields.map(f=>{const saved=source.saved.includes(f.env);const email=/EMAIL/.test(f.env);return `<label>${escapeHtml(f.label)}<input name="${escapeHtml(f.env)}" type="${email?'email':'password'}" autocomplete="off" spellcheck="false" placeholder="${saved?'Saved. Leave empty to keep it.':'Paste here'}" /></label>`;}).join('');
  $('#keyNote').innerHTML=`Get a key at <a href="${escapeHtml(source.signup)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(source.signup).host)}</a>. It is saved on this Mac only and is not shown again.`;
  $('#keyError').textContent='';$('#saveKey').textContent=source.status==='not_configured'?'Connect':'Save';
  $('#keyDialog').showModal();$('#keyFields input')?.focus();
}
async function dataSourceAction(action,id,values){
  const source=dataSources.list.find(s=>s.id===id);if(!source)return;
  try{const result=await api(`/api/data-sources/${action}`,values?{id,values}:{id});replaceDataSource(result.source);toast(`${source.name} ${action==='remove'?'key removed':action==='disconnect'?'disconnected':'connected'}`);return true;}
  catch(error){if(values){$('#keyError').textContent=error.message;}else toast(error.message);return false;}
}

function allTools(){ return state.servers.flatMap(server=>(server.tools||[]).map(tool=>({...tool,serverId:server.id,serverName:server.name}))); }
// Tool Library groups tools by risk tier (tool-tiers.js): what running each one does to the target.
const FLAG_LABELS={credits:'💳 Uses AI credits','side-effects':'⚙ Side effects'};
function tierBadge(risk){return `<span class="tier-badge tier-${escapeHtml(risk.key)}" title="${escapeHtml(risk.targetSees)}">${escapeHtml(risk.label)}</span>`;}
function renderTools(){
  const filter=$('#toolFilter').value.trim().toLowerCase();
  const matching=allTools().filter(t=>(t.name+' '+(t.description||'')+' '+(t.serverName||'')).toLowerCase().includes(filter));
  const groups=groupToolsByTier(matching);
  const chips=[['all','All',matching.length],...groups.map(group=>[group.tier.key,group.tier.label,group.tools.length])];
  if(!chips.some(([key])=>key===state.tierFilter))state.tierFilter='all';
  $('#tierFilters').innerHTML=matching.length?chips.map(([key,label,count])=>`<button class="tier-chip${state.tierFilter===key?' active':''}" data-tier-filter="${escapeHtml(key)}">${escapeHtml(label)} <span>${count}</span></button>`).join(''):'';
  const shown=groups.filter(group=>state.tierFilter==='all'||group.tier.key===state.tierFilter);
  $('#toolCount').textContent=matching.length?`${matching.length} tools across ${new Set(matching.map(t=>t.serverId)).size} connected server(s), grouped by what running them does to the target.`:'Connect a server to discover tools.';
  $('#toolLibrary').innerHTML=shown.length?shown.map(group=>`<section class="tier-group"><div class="tier-group-head">${tierBadge(toolRisk(group.tools[0]))}<p class="subtle">${escapeHtml(group.tier.targetSees)}</p></div><div class="tool-grid">${group.tools.map(t=>{
    const risk=toolRisk(t);const flags=risk.flags.map(flag=>`<span class="badge">${escapeHtml(FLAG_LABELS[flag]||flag)}</span>`).join('');
    return `<article class="tool-card"><div class="tool-card-head"><code>${escapeHtml(t.name)}</code>${tierBadge(risk)}</div><p class="tool-meta">${escapeHtml(t.serverName)} · ${escapeHtml(toolUsage(t))}${risk.needsReview?' · <span title="Tier set from a short description; confirm in docs/search-overhaul.md">needs review</span>':''}</p>${flags?`<div class="tool-flags">${flags}</div>`:''}<p class="tool-desc" title="${escapeHtml(t.description||'')}">${escapeHtml(t.description||'No description provided.')}</p><button class="text-button" data-run="${escapeHtml(t.serverId)}::${escapeHtml(t.name)}">${risk.level>=2?`Run ${escapeHtml(risk.label.toLowerCase())} tool →`:'Run tool →'}</button></article>`;
  }).join('')}</div></section>`).join(''):'<div class="empty-state">No tools to show yet.</div>';
}
function renderEvidence(){
  const options=state.cases.map(item=>`<option value="${escapeHtml(item.id)}"${item.id===state.activeCaseId?' selected':''}${item.damaged?' disabled':''}>${escapeHtml(item.name)}${item.damaged?'':` (${item.evidenceCount})`}</option>`).join('');
  $('#caseSelect').innerHTML=state.cases.length?`<option value="">Choose a case…</option>${options}`:'<option value="">No cases yet</option>';
  $('#caseSelect').value=state.activeCaseId||'';
  $('#renameCase').disabled=$('#deleteCase').disabled=$('#exportEvidence').disabled=$('#reportMarkdown').disabled=$('#reportHtml').disabled=!state.activeCase;
  const legacy=state.evidence.length;
  $('#caseImport').hidden=!legacy;
  $('#caseImport').innerHTML=legacy?`<p>${legacy} finding${legacy===1?' is':'s are'} saved only in this browser. Import ${legacy===1?'it':'them'} into a case on this Mac so ${legacy===1?'it survives':'they survive'} a browser change.</p><button class="primary" id="importBrowserEvidence">Import into a new case</button>`:'';
  const current=state.activeCase;
  const byStatus=status=>current.evidence.filter(item=>(item.status||'unverified')===status).length;
  $('#caseSummary').textContent=current?`${current.evidence.length} finding${current.evidence.length===1?'':'s'} (${byStatus('confirmed')} confirmed, ${byStatus('unverified')} unverified, ${byStatus('ruled out')} ruled out) · ${current.searches.length} search${current.searches.length===1?'':'es'} logged · created ${new Date(current.createdAt).toLocaleDateString()}`:'';
  $('#evidenceList').innerHTML=!current?'<div class="empty-state">Create or choose a case to save findings. Results you save while a case is open go into it.</div>':current.evidence.length?newestFirst(current.evidence).map(item=>`<article class="evidence-card"><div><p class="eyebrow">${new Date(item.time).toLocaleString()}${item.server?` · ${escapeHtml(item.server)}`:''}</p><h3>${escapeHtml(item.title)}</h3><p class="subtle" title="SHA-256 of the saved result">Fingerprint ${escapeHtml(shortFingerprint(item.sha256))}</p><div class="evidence-review"><label>Status<select data-evidence-status="${escapeHtml(item.id)}" class="status-${escapeHtml((item.status||'unverified').replace(' ','-'))}">${['unverified','confirmed','ruled out'].map(status=>`<option value="${status}"${(item.status||'unverified')===status?' selected':''}>${status[0].toUpperCase()+status.slice(1)}</option>`).join('')}</select></label><label class="evidence-note">Note<textarea data-evidence-note="${escapeHtml(item.id)}" maxlength="4000" rows="2" placeholder="Why you trust or doubt this finding">${escapeHtml(item.note||'')}</textarea></label><button class="ghost" data-save-note="${escapeHtml(item.id)}">Save note</button></div><pre>${escapeHtml(JSON.stringify(item.result,null,2))}</pre></div><button class="icon-button" data-delete-evidence="${escapeHtml(item.id)}" title="Remove">×</button></article>`).join(''):'<div class="empty-state">This case has no findings yet. Open a result and choose Save to evidence.</div>';
}
async function loadDeepHistory(){
  const box=$('#deepHistory');
  try{
    const {entries,total,skipped}=await apiGet('/api/deep-search/audit');
    const levelName=level=>TIERS[level]?.label||`Level ${level}`;
    box.innerHTML=entries.length?`<table class="deep-history-table"><thead><tr><th>When</th><th>Target</th><th>Max level</th><th>Tools</th><th>Outcome</th></tr></thead><tbody>${entries.map(entry=>`<tr><td>${escapeHtml(new Date(entry.time).toLocaleString())}</td><td><code>${escapeHtml(entry.target)}</code></td><td>${escapeHtml(levelName(entry.level))}</td><td title="${escapeHtml((entry.tools||[]).join(', '))}">${(entry.tools||[]).length} tool${(entry.tools||[]).length===1?'':'s'}</td><td>${escapeHtml(entry.outcome)}</td></tr>`).join('')}</tbody></table>${total>entries.length?`<p class="subtle">Showing the latest ${entries.length} of ${total} runs.</p>`:''}${skipped?`<p class="subtle">${skipped} damaged line${skipped===1?' was':'s were'} skipped in the audit log.</p>`:''}`:'<div class="empty-state">No Deep Search runs yet.</div>';
  }catch(error){box.innerHTML=`<div class="empty-state">Could not read the audit log: ${escapeHtml(error.message)}</div>`;}
}
async function loadCases(){
  try{
    state.cases=(await apiGet('/api/cases')).cases;
    state.activeCaseId=activeCaseId(state.cases,state.activeCaseId);
    state.activeCase=state.activeCaseId?await apiGet(`/api/cases/${state.activeCaseId}`):null;
  }catch(error){toast(`Could not load cases: ${error.message}`);}
  if(state.activeCaseId)localStorage.setItem('signaldesk.activeCase',state.activeCaseId);else localStorage.removeItem('signaldesk.activeCase');
  renderEvidence();
}
async function selectCase(id){state.activeCaseId=id||null;await loadCases();}
async function createCase(suggested){
  const name=prompt('Name for the new case',suggested||defaultCaseName(''));
  if(name===null||!name.trim())return null;
  const created=await api('/api/cases',{name});
  await selectCase(created.id);
  return created;
}
function recordHistory(entry){
  state.history.unshift(entry);
  if(state.activeCaseId)api(`/api/cases/${state.activeCaseId}/searches`,{title:entry.title,time:entry.time,server:entry.server}).then(()=>loadCases()).catch(()=>{});
}
async function saveLastResultToCase(){
  if(!state.lastResult)return;
  if(!state.activeCase&&!(await createCase(defaultCaseName(state.lastResult.title))))return;
  await api(`/api/cases/${state.activeCaseId}/evidence`,state.lastResult);
  await loadCases();
  toast(`Saved to ${state.activeCase?.name||'the case'}`);$('#resultDialog').close();
}
async function importBrowserEvidence(){
  const items=[...state.evidence];
  if(!items.length)return;
  const created=await api('/api/cases',{name:`Imported from browser — ${new Date().toISOString().slice(0,10)}`});
  for(const item of [...items].reverse())await api(`/api/cases/${created.id}/evidence`,item);
  state.evidence=[];persist();
  await selectCase(created.id);
  toast(`Imported ${items.length} finding${items.length===1?'':'s'} into a case on this Mac`);
}
// Keep each part ("116 tools", "98 working") on one line so narrow cards wrap only between parts.
function toolCountHtml(server){return escapeHtml(toolCountLabel(server,state.toolHealth).replace(/(?<!·) (?!·)/g,'\u00a0'));}
function noteToolHealth(serverId,toolName,kind){state.toolHealth=recordToolHealth(state.toolHealth,serverId,toolName,kind,new Date().toISOString());}
function renderAll(){renderWorkflows();renderHistory();renderConnections();renderServers();renderDataSources();renderTools();renderEvidence();persist();}

function openTool(tool, serverId){
  state.activeTool={tool,serverId}; $('#runToolName').textContent=tool.name; $('#runToolDescription').textContent=tool.description||'';
  const props=tool.inputSchema?.properties||{}; const sample={}; Object.entries(props).forEach(([key,schema])=>sample[key]=schema.default??(schema.type==='number'?0:schema.type==='boolean'?false:''));
  // Controlled tools need explicit confirmation before the server will issue a one-use run grant.
  const risk=toolRisk(tool);const needs=runRequirements(risk);
  $('#runRisk').innerHTML=`<div class="run-risk run-risk-${escapeHtml(risk.key)}"><div>${tierBadge(risk)}<span>${escapeHtml(risk.targetSees)}</span></div>`
    +(needs.acknowledgement?'<label class="run-check"><input type="checkbox" id="runAcknowledge" /> I understand this tool may contact the target or perform a controlled action.</label>':'')
    +(needs.authorization?'<label class="run-check"><input type="checkbox" id="runAuthorize" /> I own this target or have written permission to test it.</label>':'')
    +(needs.typeName?`<label class="run-confirm">Type <code>${escapeHtml(tool.name)}</code> to confirm<input id="runConfirmName" autocomplete="off" spellcheck="false" /></label>`:'')
    +(needs.credits?'<label class="run-check"><input type="checkbox" id="runCredits" /> This tool may spend paid AI credits.</label>':'')
    +(needs.sideEffects?'<label class="run-check"><input type="checkbox" id="runSideEffects" /> This tool may send, store, schedule, or change data.</label>':'')+'</div>';
  $('#runArgs').value=JSON.stringify(sample,null,2); $('#runError').textContent=''; $('#runDialog').showModal();
}
// Returns why a tool may not run yet, or '' when every confirmation it needs is given.
function runBlockedReason(tool){
  const needs=runRequirements(toolRisk(tool));
  if(needs.acknowledgement&&!$('#runAcknowledge')?.checked)return 'Confirm that you understand this controlled run.';
  if(needs.authorization&&!$('#runAuthorize')?.checked)return 'Confirm that you own this target or have written permission to test it.';
  if(needs.typeName&&$('#runConfirmName')?.value.trim()!==tool.name)return `Type ${tool.name} exactly to confirm.`;
  if(needs.credits&&!$('#runCredits')?.checked)return 'Confirm that this tool may spend paid AI credits.';
  if(needs.sideEffects&&!$('#runSideEffects')?.checked)return 'Confirm that this tool may send, store, schedule, or change data.';
  return '';
}

async function requestRunGrant(tool,serverId,args){
  const risk=toolRisk(tool);const needs=runRequirements(risk);
  if(!needs.acknowledgement)return null;
  const server=state.servers.find(s=>s.id===serverId);if(!server)throw new Error('Server not found');
  return api('/api/run-grants',buildRunGrantRequest({tool:{...tool,risk},server,args,confirmation:{
    acknowledged:$('#runAcknowledge')?.checked,
    authorization:$('#runAuthorize')?.checked,
    typedName:$('#runConfirmName')?.value.trim(),
    credits:$('#runCredits')?.checked,
    sideEffects:$('#runSideEffects')?.checked
  }}));
}

async function runTool(tool,serverId,args,title=tool.name,grant=null){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  const response=await callTool(tool,serverId,args,grant).catch(error=>{noteToolHealth(serverId,tool.name,'error');renderAll();throw error;});
  noteToolHealth(serverId,tool.name,response.error?'error':classifyToolResult(response.result).kind);
  if(response.error){renderAll();throw new Error(response.error.message||'Tool call failed');}
  const result=response.result; state.lastResult={title,result,time:new Date().toISOString(),server:server.name};
  recordHistory({title,time:state.lastResult.time,server:server.name}); renderAll(); showResult(title,result); return result;
}

async function callTool(tool,serverId,args,grant=null,options={}){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  return api('/api/mcp',{endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:sessionKeyFor(server.id),method:'tools/call',params:{name:tool.name,arguments:args},initialize:server.status!=='connected',runGrant:grant?.token||'',runTarget:grant?.target||''},{signal:options.signal});
}

function humanize(value=''){return String(value).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
function sourceLabel(value=''){return humanize(String(value).replace(/^(?:get_|omega_)/,''));}
function readableValue(key,value){
  if(value===null||value===undefined||value==='')return 'Not reported';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value==='number'){
    if(/At$|timestamp|date/i.test(key)&&value>1e11)return new Date(value).toLocaleString();
    return value.toLocaleString();
  }
  if(typeof value==='string'){
    if(/^https?:\/\//.test(value))return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">Open source ↗</a>`;
    if(/^\d{4}-\d{2}-\d{2}T/.test(value)){const date=new Date(value);if(!Number.isNaN(date.valueOf()))return date.toLocaleString();}
    return escapeHtml(value);
  }
  return escapeHtml(JSON.stringify(value));
}
function pivotButton(value){
  const pivot=resultPivot(value);
  return pivot?`<button type="button" class="pivot-button" data-pivot="${escapeHtml(pivot.target)}" aria-label="${escapeHtml(`${pivot.label}: ${pivot.target}`)}">Pivot →</button>`:'';
}
function renderRecord(data){
  // Multi-line text (Omega's captured module output) keeps its line breaks and column alignment.
  if(typeof data==='string'&&data.includes('\n'))return `<pre>${escapeHtml(data)}</pre>`;
  if(!data||typeof data!=='object')return `<p>${readableValue('',data)}</p>`;
  const scalarEntries=Object.entries(data).filter(([,value])=>!Array.isArray(value)&&(typeof value!=='object'||value===null));
  return scalarEntries.length?`<dl class="fact-list">${scalarEntries.map(([key,value])=>`<div><dt>${escapeHtml(humanize(key))}</dt><dd>${readableValue(key,value)}${pivotButton(value)}</dd></div>`).join('')}</dl>`:'';
}
function renderArray(items){
  if(!items.length)return '<p class="empty-copy">No matching items reported.</p>';
  return `<div class="result-items">${items.slice(0,25).map((item,index)=>{
    if(typeof item!=='object'||item===null)return `<div class="result-item"><b>${index+1}.</b> ${readableValue('',item)}${pivotButton(item)}</div>`;
    const title=item.title||item.name||item.place||item.headline||item.id||`Item ${index+1}`;
    const rest=Object.fromEntries(Object.entries(item).filter(([key])=>!['title','name','place','headline','id'].includes(key)));
    return `<article class="result-item"><div class="result-item-title"><h4>${escapeHtml(title)}</h4>${pivotButton(title)}</div>${renderRecord(rest)}</article>`;
  }).join('')}</div>${items.length>25?`<p class="result-note">Showing 25 of ${items.length.toLocaleString()} items.</p>`:''}`;
}
function renderCategory(name,entry){
  const data=entry?.data??entry;
  const arrays=data&&typeof data==='object'?Object.entries(data).filter(([,value])=>Array.isArray(value)):[];
  const objects=data&&typeof data==='object'?Object.entries(data).filter(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)):[];
  return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">${escapeHtml(entry?.eyebrow||'CATEGORY')}</p><h3>${escapeHtml(humanize(name))}</h3></div>${entry?.description?`<p>${escapeHtml(entry.description)}</p>`:''}</div>${renderRecord(data)}${objects.map(([key,value])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderRecord(value)}</div>`).join('')}${arrays.map(([key,items])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}</section>`;
}
function renderSources(entry){
  const sources=entry?.data?.sources||[];
  const when=value=>value?`<time datetime="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleString())}</time>`:'—';
  const cards=sources.map(source=>{
    const outcome=source.outcome||{kind:'running'};const error=outcome.error?`<p class="source-error">${escapeHtml(outcome.error)}</p>`:'';
    return `<article class="source-entry"><div class="source-entry-head"><div><h4>${escapeHtml(source.tool)}</h4><p>${escapeHtml(source.server)}</p></div>${tierBadge(source.tier)}</div><p class="source-reason">${escapeHtml(source.reason)}</p><dl class="source-meta"><div><dt>Started</dt><dd>${when(source.startedAt)}</dd></div><div><dt>Finished</dt><dd>${when(source.finishedAt)}</dd></div><div><dt>Outcome</dt><dd><span class="source-outcome source-outcome-${escapeHtml(outcome.kind)}">${escapeHtml(humanize(outcome.kind))}</span></dd></div></dl><div class="source-arguments"><b>Arguments sent</b><pre>${escapeHtml(JSON.stringify(source.arguments||{},null,2))}</pre></div>${error}</article>`;
  }).join('');
  return `<section class="result-category sources-category"><div class="category-head"><div><p class="eyebrow">${escapeHtml(entry?.eyebrow||'SEARCH PROVENANCE')}</p><h3>Sources</h3></div>${entry?.description?`<p>${escapeHtml(entry.description)}</p>`:''}</div><div class="source-list">${cards}</div></section>`;
}
function renderReadableResult(result){
  const parsed=parseToolResult(result); const payload=parsed?.data??parsed; const report=payload?.report;
  if(report&&typeof report==='object'){
    const entries=Object.entries(report); const hasFindings=reportHasFindings(report);
    const content=entries.map(([name,entry])=>name==='Sources'?renderSources(entry):renderCategory(name,entry)).join('');
    const errors=!('Still Running' in report)&&!hasFindings&&Array.isArray(payload.errors)&&payload.errors.length?`<section class="result-category warning"><div class="category-head"><div><p class="eyebrow">SEARCH RESULT</p><h3>No results returned</h3></div></div>${renderArray(payload.errors)}</section>`:'';
    return `${content}${errors}`||'<p class="empty-copy">No matching results returned.</p>';
  }
  if(Array.isArray(payload))return renderArray(payload);
  if(payload&&typeof payload==='object')return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">RESULT</p><h3>Findings</h3></div></div>${renderRecord(payload)}${Object.entries(payload).filter(([,value])=>Array.isArray(value)).map(([key,items])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}</section><details class="raw-result"><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(parsed,null,2))}</pre></details>`;
  return `<div class="plain-result">${escapeHtml(String(payload??'No result returned.'))}</div>`;
}
function showResult(title,result){
  const dialog=$('#resultDialog'); const refresh=dialog.open&&$('#resultTitle').textContent===title;
  const scroll=refresh?[dialog.scrollTop,$('#resultBody').scrollTop]:[0,0];
  $('#resultTitle').textContent=title; $('#resultBody').innerHTML=renderReadableResult(result);
  if(refresh){dialog.scrollTop=scroll[0];$('#resultBody').scrollTop=scroll[1];}
  if(!dialog.open)dialog.showModal();
}
// Refreshes a search that is still running without reopening the window if the user has closed it.
function updateOpenResult(title,result){if($('#resultDialog').open&&$('#resultTitle').textContent===title)showResult(title,result);}

const categoryNames={
  get_nvd_cves:'Vulnerability Details',get_cisa_kev:'Known Exploitation Status',whois_lookup:'Registration and Ownership',dnstwist_lookalike_domains:'Look-alike and Phishing Risk',
  get_bgp:'Routing and Network Ownership',get_greynoise:'Scanner and Reputation Context',get_whois:'Registration Data',get_wikidata:'Identity and Background',get_opencorporates:'Corporate Records',
  get_news_rss:'Related Coverage',get_gdelt:'Global Event Coverage',get_news_velocity:'Coverage Momentum',get_geocode:'Map and Coordinates',get_country_facts:'Country Overview',get_travel_advisories:'Travel and Safety',
  get_arxiv:'Research Papers',get_opensanctions:'Global Sanctions Matches',get_sanctions:'OFAC Sanctions Matches',get_earthquakes:'Earthquake Activity',get_natural_events:'Active Natural Events',get_disaster_alerts:'Disaster Alerts',
  get_cyber_news:'Cybersecurity Coverage',get_ransomware:'Ransomware Activity',get_threatfox:'Threat Indicators',get_maritime_news:'Maritime Coverage',get_chokepoints:'Chokepoint Status',get_ais_vessels:'Vessel Positions',
  get_notams:'Airspace Notices',get_aviation_news:'Aviation Coverage',get_aircraft:'Aircraft Positions',get_crypto:'Market Prices',get_fear_greed:'Market Sentiment',get_stablecoins:'Stablecoin Market',
  get_fmp_quote:'Market Quote',get_fmp_profile:'Company Profile',get_sec_filings:'Regulatory Filings',get_economic_macro:'Macroeconomic Snapshot',get_bis_rates:'Policy Rates',get_bis_fx:'Exchange Rates',
  get_github_activity:'Public Repository Activity',get_satellite_snapshot:'Satellite Imagery Links',get_satellites:'Satellite Tracking',get_election_monitor:'Election Monitoring',get_health_advisories:'Health Advisories',
  get_nuclear_status:'Nuclear and Arms-Control Updates',get_radiation_safecast:'Radiation Monitoring',get_energy_commodities_news:'Energy and Commodities Coverage',get_critical_minerals:'Critical Minerals',get_offshore_leaks:'Offshore Records',get_food_security:'Food-Security Conditions',
  sherlock_username_search:'Username Matches',blackbird_username_search:'Additional Account Matches',holehe_email_search:'Email Account Presence',phoneinfoga_scan:'Phone Information',get_malwarebazaar:'Malware Records',omega_malware:'Malware Reputation'
};
function categoryForTool(tool){return categoryNames[tool.name]||sourceLabel(tool.name);}

function relatedLinks(intentInfo,query){
  let clean=query.replace(/^(?:https?:\/\/)/i,'').replace(/\/$/,'').trim();
  clean=clean.replace(/^(?:location|city|country|organization|company|business|domain|website|news|current events?|academic|research)\s*(?::|-)?\s+/i,'').replace(/^(?:recent|latest|current|today'?s?)\s+/i,'').replace(/\s+(?:news|developments|updates)$/i,'').trim();
  const encoded=encodeURIComponent(clean); const links=[];
  if(intentInfo.id==='cve'){const cve=(clean.match(/CVE-\d{4}-\d+/i)||[])[0];if(cve)links.push({title:'NIST NVD record',url:`https://nvd.nist.gov/vuln/detail/${cve.toUpperCase()}`,description:'Official vulnerability record and references.'});}
  if(intentInfo.id==='domain'){const target=extractTarget(query);const domain=target?.type==='domain'?target.value:clean.split('/')[0];links.push({title:'Certificate Transparency',url:`https://crt.sh/?q=${encodeURIComponent('%.'.concat(domain))}`,description:'Certificates issued for this domain and its subdomains.'},{title:'ICANN lookup',url:`https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`,description:'Domain registration lookup.'});}
  if(intentInfo.id==='research')links.push({title:'Google Scholar',url:`https://scholar.google.com/scholar?q=${encoded}`,description:'Broader scholarly literature search.'},{title:'arXiv search',url:`https://arxiv.org/search/?query=${encoded}&searchtype=all`,description:'Preprints related to this topic.'});
  if(intentInfo.id==='organization'||intentInfo.id==='offshore')links.push({title:'OpenCorporates search',url:`https://opencorporates.com/companies?q=${encoded}`,description:'Company registrations across jurisdictions.'});
  if(intentInfo.id==='location')links.push({title:'OpenStreetMap',url:`https://www.openstreetmap.org/search?query=${encoded}`,description:'Map and geographic context.'});
  if(intentInfo.id==='news')links.push({title:'Google News',url:`https://news.google.com/search?q=${encoded}`,description:'Additional current coverage.'});
  if(!['email','phone','username'].includes(intentInfo.id))links.push({title:'Wikipedia search',url:`https://en.wikipedia.org/w/index.php?search=${encoded}`,description:'Background and linked references.'});
  return links;
}

function formatBytes(bytes){if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024**2).toFixed(1)} MB`;}
function fileAsDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the selected file'));reader.readAsDataURL(file);});}
function clearSelectedFile(){state.pendingFile=null;$('#fileInput').value='';$('#fileSelection').hidden=true;$('#fileName').textContent='';$('#fileDetails').textContent='';}

async function analyzeSelectedFile(file,note=''){
  if(file.size>50_000_000)throw new Error('Files must be 50 MB or smaller');
  const tool=allTools().find(candidate=>candidate.name==='exiftool_metadata');
  if(!tool)throw new Error('Connect OSINT Toolbox to analyze files, pictures, and videos');
  toast(`Analyzing ${file.name} locally…`);
  const upload=await api('/api/upload',{name:file.name,type:file.type,size:file.size,data:await fileAsDataUrl(file)});
  try{
    const response=await callTool(tool,tool.serverId,{file_path:upload.path});
    if(response.error)throw new Error(response.error.message||'File analysis failed');
    const parsed=parseToolResult(response.result); const metadata=parsed?.data??parsed;
    const kind=file.type.startsWith('image/')?'Image':file.type.startsWith('video/')?'Video':'Document';
    const report={
      'File Overview':{eyebrow:'LOCAL FILE',description:'Basic details for the selected file.',data:{name:file.name,type:file.type||'Unknown',category:kind,size:formatBytes(file.size),investigationNote:note||'Not provided'}},
      'Technical Metadata':{eyebrow:`${tool.serverName} · ExifTool`,description:'Embedded metadata, media properties, timestamps, software, camera, codec, and location fields reported by ExifTool.',data:metadata}
    };
    const result={content:[{type:'text',text:JSON.stringify({description:`Local ${kind.toLowerCase()} analysis for “${file.name}”`,data:{query:note||file.name,modulesQueried:1,modulesWithResults:hasUsefulData(metadata)?1:0,report,errors:[]}})}]};
    const time=new Date().toISOString();state.lastResult={title:file.name,result,time,server:tool.serverName};recordHistory({title:file.name,time,server:`${tool.serverName} · Local file`});renderAll();showResult(file.name,result);clearSelectedFile();
  }finally{await api('/api/upload/delete',{id:upload.id}).catch(()=>{});}
}

async function smartInvestigate(query){
  const tools=allTools(); if(!tools.length){recordHistory({title:query,time:new Date().toISOString(),server:'Demo workspace'});renderAll();showResult(query,{message:'Connect Open OSINT to run this investigation with live sources.',suggested_next_step:'Open MCP servers and connect http://127.0.0.1:8892/mcp'});return;}
  const intent=searchIntent(query);
  const explained=explainSearchPlan({query,intentId:intent.id,preferredNames:intent.tools,tools,maxTools:6});
  const plan=explained.selected.map(({tool,score,reason})=>({tool,score,reason}));
  if(!plan.length&&intent.id==='entity'){const fallback=tools.find(tool=>tool.name==='get_wikidata')||tools.find(tool=>tool.name==='get_hn_search');if(fallback)plan.push({tool:fallback,score:1,reason:'General entity fallback'});}
  const runStartedAt=new Date().toISOString();
  plan.forEach(item=>{item.args=argsForSearch(item.tool,query);item.startedAt=runStartedAt;});
  const selected=plan.map(item=>item.tool);
  const plannedServers=new Set(selected.map(tool=>tool.serverName));
  toast(selected.length?`Searching ${selected.length} relevant tools across ${plannedServers.size} server${plannedServers.size===1?'':'s'}…`:'Relevant server is not connected');
  // Each source's results are shown as soon as it answers; a newer search makes this one's late answers stale.
  const searchId=++latestSearchId; const startedAt=performance.now(); const outcomes=new Array(selected.length);
  const reportOptions={query,intent,plan,outcomes,diagnostics:diagnosticsEnabled?summarizePlanDiagnostics(explained):null,links:relatedLinks(intent,query),categoryForTool,sourceLabel};
  const show=()=>{
    if(searchId!==latestSearchId)return null;
    const built=buildSearchReport({...reportOptions,elapsedMs:Math.round(performance.now()-startedAt)});
    state.lastResult={title:query,result:built.result,time:new Date().toISOString(),server:[...built.servers].join(', ')||'Connected MCP'};
    if(built.finished)showResult(query,built.result);else updateOpenResult(query,built.result);
    return built;
  };
  if(selected.length)showResult(query,buildSearchReport(reportOptions).result);
  await Promise.allSettled(plan.map(async(item,index)=>{
    const tool=item.tool;
    try{
      const response=await callTool(tool,tool.serverId,item.args);
      if(response.error)throw new Error(response.error.message||'Tool call failed');
      const outcome=classifyToolResult(response.result);
      outcomes[index]={status:'fulfilled',value:{tool,outcome},finishedAt:new Date().toISOString()};noteToolHealth(tool.serverId,tool.name,outcome.kind);
    }catch(error){outcomes[index]={status:'rejected',reason:error,finishedAt:new Date().toISOString()};noteToolHealth(tool.serverId,tool.name,'error');}
    show();
  }));
  const final=show();
  if(!final)return;
  recordHistory({title:query,time:state.lastResult.time,server:state.lastResult.server,sourceLog:final.sourceLog}); renderAll();
}

function renderDeepPlan(){
  const plan=state.deepPlan;
  $('#deepPlan').innerHTML=plan.length?plan.map((item,index)=>`<label class="deep-tool"><input type="checkbox" data-deep-tool="${index}" ${item.selected?'checked':''} /><div><b>${escapeHtml(item.tool.name)}</b><p>${escapeHtml(item.tool.description||'No description provided.')}</p><p>${escapeHtml(item.risk.targetSees)}</p></div><div class="deep-tool-meta">${tierBadge(item.risk)}<br>${item.risk.level<=1?'about 30 seconds':item.risk.level===2?'up to 2 minutes':'up to 2 minutes'}</div></label>`).join(''):'<div class="empty-state">No reviewed Deep Search tools match this target and level on the connected servers.</div>';
  $('#deepConfirmations').hidden=!plan.length;
  $('#deepTypedWrap').hidden=Number($('#deepLevel').value)!==3;
}

function addDeepLog(message){const log=$('#deepLog');log.hidden=false;log.textContent+=`${new Date().toLocaleTimeString()}  ${message}\n`;log.scrollTop=log.scrollHeight;}

function buildDeepPlan(){
  const target=$('#deepTarget').value.trim();const level=Number($('#deepLevel').value);
  state.deepPlan=deepSearchPlan(allTools(),target,level);$('#deepError').textContent='';$('#deepLog').textContent='';$('#deepLog').hidden=true;renderDeepPlan();
}

async function runDeepSearch(){
  state.deepPlan.forEach((item,index)=>item.selected=$(`[data-deep-tool="${index}"]`)?.checked!==false);
  const selected=state.deepPlan.filter(item=>item.selected);const target=$('#deepTarget').value.trim();const level=Number($('#deepLevel').value);
  const blocked=deepRunBlocked({target,level,authorization:$('#deepAuthorize').checked,typedTarget:$('#deepTypedTarget').value,selectedCount:selected.length});
  if(blocked){$('#deepError').textContent=blocked;return;}
  $('#deepError').textContent='';$('#runDeepSearch').disabled=true;$('#cancelDeepRun').disabled=false;state.deepController=new AbortController();
  const tools=selected.map(item=>{const server=state.servers.find(entry=>entry.id===item.tool.serverId);return{endpoint:server.endpoint,name:item.tool.name,arguments:item.args};});
  let outcome='completed';let failures=0;
  try{
    const grant=await api('/api/run-grants',{purpose:'deep-search',target,level,tools,confirmation:{acknowledged:true,authorization:true,typedTarget:$('#deepTypedTarget').value}});
    addDeepLog(`Confirmed ${selected.length} tool${selected.length===1?'':'s'} for ${target}.`);
    for(const item of selected){
      if(state.deepController.signal.aborted)throw new DOMException('Cancelled','AbortError');
      addDeepLog(`Running ${item.tool.name}…`);
      try{const response=await callTool(item.tool,item.tool.serverId,item.args,grant,{signal:state.deepController.signal});if(response.error)throw new Error(response.error.message||'Tool call failed');addDeepLog(`Finished ${item.tool.name}.`);}
      catch(error){if(error.name==='AbortError')throw error;failures++;addDeepLog(`${item.tool.name} failed: ${error.message}`);}
    }
    if(failures)outcome=`completed-with-${failures}-errors`;
  }catch(error){outcome=error.name==='AbortError'?'cancelled':'failed';addDeepLog(outcome==='cancelled'?'Run cancelled.':`Run stopped: ${error.message}`);}
  finally{
    await api('/api/deep-search/audit',{target,level,tools:selected.map(item=>item.tool.name),outcome}).catch(error=>addDeepLog(`Audit log failed: ${error.message}`));
    loadDeepHistory();
    if(outcome.startsWith('completed'))addDeepLog(`Run ${outcome}. Audit saved on this Mac.`);
    state.deepController=null;$('#runDeepSearch').disabled=false;$('#cancelDeepRun').disabled=true;
  }
}

document.addEventListener('click',async event=>{
  const pivot=event.target.closest('[data-pivot]');if(pivot){event.preventDefault();const target=pivot.dataset.pivot;$('#resultDialog').close();switchView('workspace');$('#query').value=target;$('#query').focus();try{await smartInvestigate(target);}catch(error){toast(error.message);}return;}
  const nav=event.target.closest('[data-view]'); if(nav)switchView(nav.dataset.view);
  const link=event.target.closest('[data-view-link]'); if(link)switchView(link.dataset.viewLink);
  const prompt=event.target.closest('[data-prompt]'); if(prompt){switchView('workspace');$('#query').value=prompt.dataset.prompt;$('#query').focus();}
  const connectButton=event.target.closest('[data-connect]'); if(connectButton){const server=state.servers.find(s=>s.id===connectButton.dataset.connect);if(server)connect(server);}
  const disconnectButton=event.target.closest('[data-disconnect]'); if(disconnectButton){const server=state.servers.find(s=>s.id===disconnectButton.dataset.disconnect);if(server)disconnect(server);}
  const remove=event.target.closest('[data-remove]'); if(remove){const server=state.servers.find(s=>s.id===remove.dataset.remove);if(server&&bundledServers.some(item=>item.endpoint===server.endpoint))removedBundledEndpoints.add(server.endpoint);state.servers=state.servers.filter(s=>s.id!==remove.dataset.remove);renderAll();}
  const run=event.target.closest('[data-run]'); if(run){const [serverId,name]=run.dataset.run.split('::');const tool=allTools().find(t=>t.serverId===serverId&&t.name===name);if(tool)openTool(tool,serverId);}
  const del=event.target.closest('[data-delete-evidence]');if(del&&state.activeCaseId&&confirm('Remove this finding from the case? This cannot be undone.')){api(`/api/cases/${state.activeCaseId}/evidence/${del.dataset.deleteEvidence}/delete`,{}).then(loadCases).catch(error=>toast(error.message));}
  if(event.target.closest('#importBrowserEvidence'))importBrowserEvidence().catch(error=>toast(`Import stopped: ${error.message}. Your browser copy was kept.`));
  const tierChip=event.target.closest('[data-tier-filter]');if(tierChip){state.tierFilter=tierChip.dataset.tierFilter;renderTools();}
  const moreNews=event.target.closest('[data-load-more-news]');if(moreNews){intelNews.visibleLimit+=30;renderIntelNews();}
  const sourceEdit=event.target.closest('[data-source-edit]');if(sourceEdit){const source=dataSources.list.find(s=>s.id===sourceEdit.dataset.sourceEdit);if(source)openKeyDialog(source);}
  const sourceConnect=event.target.closest('[data-source-connect]');if(sourceConnect)dataSourceAction('connect',sourceConnect.dataset.sourceConnect);
  const sourceDisconnect=event.target.closest('[data-source-disconnect]');if(sourceDisconnect)dataSourceAction('disconnect',sourceDisconnect.dataset.sourceDisconnect);
  const sourceRemove=event.target.closest('[data-source-remove]');if(sourceRemove){const source=dataSources.list.find(s=>s.id===sourceRemove.dataset.sourceRemove);if(source&&confirm(`Remove the saved key for ${source.name}? You will need to paste it again to reconnect.`))dataSourceAction('remove',source.id);}
});

$('#investigateForm').addEventListener('submit',async e=>{e.preventDefault();const q=$('#query').value.trim();if(!q&&!state.pendingFile)return;try{if(state.pendingFile)await analyzeSelectedFile(state.pendingFile,q);else await smartInvestigate(q);}catch(error){toast(error.message);}});
$('#fileInput').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;state.pendingFile=file;$('#fileName').textContent=file.name;$('#fileDetails').textContent=`${file.type||'Unknown type'} · ${formatBytes(file.size)}`;$('#fileIcon').textContent=file.type.startsWith('image/')?'▧':file.type.startsWith('video/')?'▶':'◇';$('#fileSelection').hidden=false;});
$('#removeFile').onclick=clearSelectedFile;
$('#addServer').onclick=()=>$('#serverDialog').showModal();
$('#newInvestigation').onclick=()=>{switchView('workspace');$('#query').focus();};
$('#cmdButton').onclick=()=>{switchView('workspace');$('#query').focus();};
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();switchView('workspace');$('#query').focus();}});
$('#saveServer').addEventListener('click',e=>{e.preventDefault();const form=new FormData($('#serverForm'));const server={id:crypto.randomUUID(),name:form.get('name').trim(),endpoint:form.get('endpoint').trim(),status:'offline',tools:[]};if(!server.name||!server.endpoint)return;removedBundledEndpoints.delete(server.endpoint);state.servers.push(server);state.tokens.set(server.id,form.get('token'));$('#serverDialog').close();renderAll();connect(server);});
$('#executeTool').addEventListener('click',async e=>{e.preventDefault();const blocked=runBlockedReason(state.activeTool.tool);if(blocked){$('#runError').textContent=blocked;return;}try{const args=JSON.parse($('#runArgs').value);const grant=await requestRunGrant(state.activeTool.tool,state.activeTool.serverId,args);$('#runDialog').close();await runTool(state.activeTool.tool,state.activeTool.serverId,args,state.activeTool.tool.name,grant);}catch(error){$('#runError').textContent=error.message;}});
$('#buildDeepPlan').onclick=buildDeepPlan;
$('#deepLevel').onchange=()=>{$('#deepTypedWrap').hidden=Number($('#deepLevel').value)!==3;if(state.deepPlan.length)buildDeepPlan();};
$('#runDeepSearch').onclick=runDeepSearch;
$('#cancelDeepRun').onclick=()=>state.deepController?.abort();
$$('[data-close-result]').forEach(b=>b.onclick=()=>$('#resultDialog').close());
$$('[data-close-dialog]').forEach(button=>button.onclick=()=>button.closest('dialog')?.close());
$('#saveEvidence').onclick=()=>saveLastResultToCase().catch(error=>toast(`Could not save: ${error.message}`));
$('#caseSelect').onchange=event=>selectCase(event.target.value);
const updateFinding=(itemId,changes,message)=>api(`/api/cases/${state.activeCaseId}/evidence/${itemId}/update`,changes).then(()=>{toast(message);return loadCases();}).catch(error=>toast(`Could not update: ${error.message}`));
$('#evidenceList').addEventListener('change',event=>{const select=event.target.closest('[data-evidence-status]');if(select&&state.activeCaseId)updateFinding(select.dataset.evidenceStatus,{status:select.value},`Marked ${select.value}`);});
$('#evidenceList').addEventListener('click',event=>{const button=event.target.closest('[data-save-note]');if(!button||!state.activeCaseId)return;const note=$(`[data-evidence-note="${button.dataset.saveNote}"]`).value;updateFinding(button.dataset.saveNote,{note},'Note saved');});
$('#refreshDeepHistory').onclick=()=>loadDeepHistory();
const downloadReport=extension=>{if(!state.activeCaseId)return;const a=document.createElement('a');a.href=`/api/cases/${state.activeCaseId}/report.${extension}`;a.download='';a.click();};
$('#reportMarkdown').onclick=()=>downloadReport('md');
$('#reportHtml').onclick=()=>downloadReport('html');
$('#newCase').onclick=()=>createCase().catch(error=>toast(error.message));
$('#renameCase').onclick=async()=>{if(!state.activeCase)return;const name=prompt('New name for this case',state.activeCase.name);if(name&&name.trim())await api(`/api/cases/${state.activeCaseId}/rename`,{name}).then(loadCases).catch(error=>toast(error.message));};
$('#deleteCase').onclick=async()=>{const c=state.activeCase;if(!c||!confirm(`Delete the case "${c.name}" and its ${c.evidence.length} finding${c.evidence.length===1?'':'s'} from this Mac? This cannot be undone.`))return;await api(`/api/cases/${c.id}/delete`,{}).catch(error=>toast(error.message));state.activeCaseId=null;await loadCases();};
$('#clearHistory').onclick=()=>{if(confirm('Clear all investigation history?')){state.history=[];renderAll();}};
$('#toolFilter').oninput=renderTools;
$('#intelNewsFilter').oninput=()=>{intelNews.visibleLimit=30;renderIntelNews();};
$('#intelNewsCategory').onchange=()=>{intelNews.visibleLimit=30;renderIntelNews();};
$('#refreshIntelNews').onclick=()=>loadIntelNews(true);
$('#exportEvidence').onclick=()=>{const c=state.activeCase;if(!c)return;const blob=new Blob([JSON.stringify(c,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`public-desk-case-${c.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||c.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('#themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('signaldesk.theme',next);};
document.documentElement.dataset.theme=localStorage.getItem('signaldesk.theme')||'light';
if(new URLSearchParams(location.search).get('consensus')==='connected'){
  history.replaceState({},'',location.pathname);
  toast('Consensus sign-in complete');
}
$('#saveKey').addEventListener('click',async e=>{
  e.preventDefault();const id=dataSources.editing;if(!id)return;
  const values=Object.fromEntries([...$$('#keyFields input')].map(input=>[input.name,input.value.trim()]).filter(([,value])=>value));
  const source=dataSources.list.find(s=>s.id===id);
  if(!Object.keys(values).length&&source?.status==='not_configured'){$('#keyError').textContent='Paste the key first.';return;}
  if(await dataSourceAction('connect',id,values))$('#keyDialog').close();
});
// Drop typed keys from the page as soon as the dialog closes, whether saved or cancelled.
$('#keyDialog').addEventListener('close',()=>{$('#keyFields').innerHTML='';dataSources.editing=null;});
renderAll();
loadDataSources();
loadCases();
setTimeout(()=>state.servers.filter(server=>!server.disconnected).forEach(server=>connect(server)),100);
