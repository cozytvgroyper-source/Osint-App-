import {planSearchTools} from './search-planner.js';
import {classifyToolResult,hasUsefulData,parseToolResult} from './result-classifier.js';
import {recordToolHealth,serverConnectionLabel,toolCountLabel} from './tool-health.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bundledServers=[
  { id: 'osint-local', name: 'Open OSINT', endpoint: 'http://127.0.0.1:8892/mcp', status: 'offline', tools: [] },
  { id: 'osint-toolbox-local', name: 'OSINT Toolbox', endpoint: 'http://127.0.0.1:8893/mcp', status: 'offline', tools: [] },
  { id: 'omega-local', name: 'Omega MCP', endpoint: 'http://127.0.0.1:8894/mcp', status: 'offline', tools: [], caution: 'Use active scanning tools only on systems you own or are authorized to test.' },
  { id: 'consensus', name: 'Consensus', endpoint: 'https://mcp.consensus.app/mcp', status: 'offline', tools: [], oauth: 'consensus' }
];
const removedBundledEndpoints=new Set();
// Storage keys keep the original 'signaldesk.' prefix so saved data survives the Public Desk rename.
const storedServers=JSON.parse(localStorage.getItem('signaldesk.servers') || '[]');
const retainedServers=storedServers.filter(server=>!removedBundledEndpoints.has(server.endpoint)).map(server=>{
  const bundled=bundledServers.find(candidate=>candidate.endpoint===server.endpoint);
  return {...bundled,...server,status:'offline',tools:[]};
});
const missingBundled=bundledServers.filter(bundled=>!retainedServers.some(server=>server.endpoint===bundled.endpoint));
const startupServers=[...missingBundled,...retainedServers];
const state = {
  servers: startupServers.length?startupServers:bundledServers,
  tokens: new Map(),
  history: JSON.parse(localStorage.getItem('signaldesk.history') || '[]'),
  evidence: JSON.parse(localStorage.getItem('signaldesk.evidence') || '[]'),
  toolHealth: JSON.parse(localStorage.getItem('signaldesk.toolHealth') || '{}'),
  activeTool: null,
  lastResult: null,
  pendingFile: null
};
const clientSessionId=sessionStorage.getItem('signaldesk.clientSessionId')||crypto.randomUUID();
sessionStorage.setItem('signaldesk.clientSessionId',clientSessionId);
const sessionKeyFor=serverId=>`${clientSessionId}:${serverId}`;
const intelNews={events:[],metrics:null,categories:[],generatedAt:'',loaded:false,loading:false,error:''};

function persist() {
  localStorage.setItem('signaldesk.servers', JSON.stringify(state.servers.map(({ tools, ...server }) => ({ ...server, status: 'offline' }))));
  localStorage.setItem('signaldesk.history', JSON.stringify(state.history.slice(0, 20)));
  localStorage.setItem('signaldesk.evidence', JSON.stringify(state.evidence));
  localStorage.setItem('signaldesk.toolHealth', JSON.stringify(state.toolHealth));
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function iconFor(name='') { if(/cyber|cve|threat|domain|ip/i.test(name))return'⌁'; if(/geo|satellite|place|flight|vessel/i.test(name))return'◈'; if(/sanction|entity|company/i.test(name))return'◎'; return'▤'; }

function switchView(id) {
  $$('.view').forEach(v => v.classList.toggle('active-view', v.id === id));
  $$('.nav').forEach(v => v.classList.toggle('active', v.dataset.view === id));
  const labels={workspace:'Hello Groyper',servers:'Connection center',library:'Explore capabilities',news:'IntelMap news',evidence:'Evidence notebook'};
  $('#pageTitle').textContent=labels[id]||'Public Desk'; window.scrollTo({top:0,behavior:'smooth'});
  if(id==='news'&&!intelNews.loaded&&!intelNews.loading)loadIntelNews();
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
  const events=intelNews.events.filter(event=>(!category||event.category===category)&&(!filter||[event.title,event.description,event.source,event.country,event.region,event.category].some(value=>String(value||'').toLowerCase().includes(filter)))).slice(0,120);
  const metrics=intelNews.metrics||{};
  $('#intelNewsMetrics').innerHTML=[['Signal index',`${metrics.threatIndex??'—'} · ${metrics.threatLevel||'Unknown'}`],['Live signals',metrics.signals??intelNews.events.length],['High priority',metrics.highPriority??'—'],['Sources online',metrics.sourcesOnline!=null?`${metrics.sourcesOnline}/${metrics.sourcesTotal||metrics.sourcesOnline}`:'—']].map(([label,value])=>`<article><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></article>`).join('');
  $('#intelNewsFreshness').textContent=intelNews.generatedAt?`Updated ${relativeTime(intelNews.generatedAt)} · showing ${events.length}`:`Showing ${events.length}`;
  list.innerHTML=events.length?events.map(event=>`<article class="news-card"><div class="news-card-top"><span class="badge">${escapeHtml(event.category||event.kind||'signal')}</span><time title="${escapeHtml(event.timestamp||'')}">${escapeHtml(relativeTime(event.timestamp))}</time></div><h3>${escapeHtml(event.title||'Untitled signal')}</h3>${event.description?`<p>${escapeHtml(event.description)}</p>`:''}<div class="news-meta"><span>${escapeHtml(event.source||'Unknown source')}</span><span>${escapeHtml(event.country||event.region||'Global')}</span><span>P${escapeHtml(event.severity??'—')} · ${escapeHtml(event.confidence??'—')}% confidence</span></div><a class="text-button" href="${escapeHtml(safeExternalUrl(event.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a></article>`).join(''):'<div class="empty-state">No IntelMap signals match these filters.</div>';
}
async function loadIntelNews(force=false){
  if(intelNews.loading||(!force&&intelNews.loaded))return; intelNews.loading=true;intelNews.error='';renderIntelNews();
  try{
    const response=await fetch('https://intelmap.watch/api/feed/',{headers:{accept:'application/json'}}); if(!response.ok)throw new Error(`IntelMap returned ${response.status}`);
    const data=await response.json(); intelNews.events=Array.isArray(data.events)?data.events:[];intelNews.metrics=data.metrics||null;intelNews.categories=Array.isArray(data.categories)?data.categories:[];intelNews.generatedAt=data.generatedAt||data.cacheTimestamp||new Date().toISOString();intelNews.loaded=true;
    const select=$('#intelNewsCategory');const current=select.value;select.innerHTML='<option value="">All categories</option>'+intelNews.categories.map(item=>`<option value="${escapeHtml(item.name)}">${escapeHtml(humanize(item.name))} (${escapeHtml(item.count)})</option>`).join('');select.value=current;
  }catch(error){intelNews.error=`Could not load IntelMap news: ${error.message}`;}finally{intelNews.loading=false;renderIntelNews();}
}

async function api(path, payload) {
  const response = await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
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
  $('#serverList').innerHTML=state.servers.length?state.servers.map(s=>`<article class="server-card"><div class="server-card-top"><span class="badge">STREAMABLE HTTP</span><span class="server-dot ${s.status==='connected'?'connected':''}"></span></div><h3>${escapeHtml(s.name)}</h3><p class="endpoint">${escapeHtml(s.endpoint)}</p><p class="subtle">${s.status==='connected'?toolCountHtml(s):s.needsAuth?'Sign in is required to search academic research.':s.disconnected?'Disconnected':s.error?escapeHtml(s.error):'Not connected'}</p>${s.caution?`<p class="form-note">${escapeHtml(s.caution)}</p>`:''}<div class="server-actions"><button class="ghost" data-remove="${s.id}">Remove</button>${s.needsAuth?`<a class="primary" href="/api/oauth/consensus/start">Sign in to Consensus</a>`:s.status==='connected'?`<button class="ghost" data-disconnect="${s.id}">Disconnect</button><button class="primary" data-connect="${s.id}">Refresh</button>`:`<button class="primary" data-connect="${s.id}">${s.status==='connecting'?'Connecting…':'Connect'}</button>`}</div></article>`).join(''):'<div class="empty-state">Add your first MCP server to begin.</div>';
}
function allTools(){ return state.servers.flatMap(server=>(server.tools||[]).map(tool=>({...tool,serverId:server.id,serverName:server.name}))); }
function renderTools(){
  const filter=$('#toolFilter').value.trim().toLowerCase(); const tools=allTools().filter(t=>(t.name+' '+(t.description||'')+' '+(t.serverName||'')).toLowerCase().includes(filter));
  $('#toolCount').textContent=tools.length?`${tools.length} tools across ${new Set(tools.map(t=>t.serverId)).size} connected server(s).`:'Connect a server to discover tools.';
  $('#toolLibrary').innerHTML=tools.length?tools.map(t=>`<article class="tool-card"><div class="tool-card-head"><code>${escapeHtml(t.name)}</code><span class="badge">${escapeHtml(t.serverName)}</span></div><p>${escapeHtml(t.description||'No description provided.')}</p><button class="text-button" data-run="${escapeHtml(t.serverId)}::${escapeHtml(t.name)}">Run tool →</button></article>`).join(''):'<div class="empty-state">No tools to show yet.</div>';
}
function renderEvidence(){
  $('#evidenceList').innerHTML=state.evidence.length?state.evidence.map((item,index)=>`<article class="evidence-card"><div><p class="eyebrow">${new Date(item.time).toLocaleString()}</p><h3>${escapeHtml(item.title)}</h3><pre>${escapeHtml(JSON.stringify(item.result,null,2))}</pre></div><button class="icon-button" data-delete-evidence="${index}" title="Remove">×</button></article>`).join(''):'<div class="empty-state">Save a tool result to build a traceable case file.</div>';
}
// Keep each part ("116 tools", "98 working") on one line so narrow cards wrap only between parts.
function toolCountHtml(server){return escapeHtml(toolCountLabel(server,state.toolHealth).replace(/(?<!·) (?!·)/g,'\u00a0'));}
function noteToolHealth(serverId,toolName,kind){state.toolHealth=recordToolHealth(state.toolHealth,serverId,toolName,kind,new Date().toISOString());}
function renderAll(){renderWorkflows();renderHistory();renderConnections();renderServers();renderTools();renderEvidence();persist();}

function openTool(tool, serverId){
  state.activeTool={tool,serverId}; $('#runToolName').textContent=tool.name; $('#runToolDescription').textContent=tool.description||'';
  const props=tool.inputSchema?.properties||{}; const sample={}; Object.entries(props).forEach(([key,schema])=>sample[key]=schema.default??(schema.type==='number'?0:schema.type==='boolean'?false:''));
  $('#runArgs').value=JSON.stringify(sample,null,2); $('#runError').textContent=''; $('#runDialog').showModal();
}

async function runTool(tool,serverId,args,title=tool.name){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  const response=await callTool(tool,serverId,args).catch(error=>{noteToolHealth(serverId,tool.name,'error');renderAll();throw error;});
  noteToolHealth(serverId,tool.name,response.error?'error':classifyToolResult(response.result).kind);
  if(response.error){renderAll();throw new Error(response.error.message||'Tool call failed');}
  const result=response.result; state.lastResult={title,result,time:new Date().toISOString(),server:server.name};
  state.history.unshift({title,time:state.lastResult.time,server:server.name}); renderAll(); showResult(title,result); return result;
}

async function callTool(tool,serverId,args){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  return api('/api/mcp',{endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:sessionKeyFor(server.id),method:'tools/call',params:{name:tool.name,arguments:args},initialize:server.status!=='connected'});
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
function renderRecord(data){
  if(!data||typeof data!=='object')return `<p>${readableValue('',data)}</p>`;
  const scalarEntries=Object.entries(data).filter(([,value])=>!Array.isArray(value)&&(typeof value!=='object'||value===null));
  return scalarEntries.length?`<dl class="fact-list">${scalarEntries.map(([key,value])=>`<div><dt>${escapeHtml(humanize(key))}</dt><dd>${readableValue(key,value)}</dd></div>`).join('')}</dl>`:'';
}
function renderArray(items){
  if(!items.length)return '<p class="empty-copy">No matching items reported.</p>';
  return `<div class="result-items">${items.slice(0,25).map((item,index)=>{
    if(typeof item!=='object'||item===null)return `<div class="result-item"><b>${index+1}.</b> ${readableValue('',item)}</div>`;
    const title=item.title||item.name||item.place||item.headline||item.id||`Item ${index+1}`;
    const rest=Object.fromEntries(Object.entries(item).filter(([key])=>!['title','name','place','headline','id'].includes(key)));
    return `<article class="result-item"><h4>${escapeHtml(title)}</h4>${renderRecord(rest)}</article>`;
  }).join('')}</div>${items.length>25?`<p class="result-note">Showing 25 of ${items.length.toLocaleString()} items.</p>`:''}`;
}
function renderCategory(name,entry){
  const data=entry?.data??entry;
  const arrays=data&&typeof data==='object'?Object.entries(data).filter(([,value])=>Array.isArray(value)):[];
  const objects=data&&typeof data==='object'?Object.entries(data).filter(([,value])=>value&&typeof value==='object'&&!Array.isArray(value)):[];
  return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">${escapeHtml(entry?.eyebrow||'CATEGORY')}</p><h3>${escapeHtml(humanize(name))}</h3></div>${entry?.description?`<p>${escapeHtml(entry.description)}</p>`:''}</div>${renderRecord(data)}${objects.map(([key,value])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderRecord(value)}</div>`).join('')}${arrays.map(([key,items])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}</section>`;
}
function renderReadableResult(result){
  const parsed=parseToolResult(result); const payload=parsed?.data??parsed; const report=payload?.report;
  if(report&&typeof report==='object'){
    const stats=[['Categories queried',payload.modulesQueried],['Categories with results',payload.modulesWithResults],['Completed in',payload.durationMs?`${(payload.durationMs/1000).toFixed(1)} seconds`:null]].filter(([,value])=>value!==undefined&&value!==null);
    const errors=Array.isArray(payload.errors)&&payload.errors.length?`<section class="result-category warning"><div class="category-head"><div><p class="eyebrow">SOURCE NOTES</p><h3>Unavailable Sources</h3></div></div>${renderArray(payload.errors)}</section>`:'';
    return `<div class="result-summary"><p>${escapeHtml(parsed.description||'Multi-source intelligence report')}</p><div class="result-stats">${stats.map(([label,value])=>`<div><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`).join('')}</div></div>${Object.entries(report).map(([name,entry])=>renderCategory(name,entry)).join('')}${errors}<details class="raw-result"><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(parsed,null,2))}</pre></details>`;
  }
  if(Array.isArray(payload))return renderArray(payload);
  if(payload&&typeof payload==='object')return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">RESULT</p><h3>Findings</h3></div></div>${renderRecord(payload)}${Object.entries(payload).filter(([,value])=>Array.isArray(value)).map(([key,items])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}</section><details class="raw-result"><summary>Technical details</summary><pre>${escapeHtml(JSON.stringify(parsed,null,2))}</pre></details>`;
  return `<div class="plain-result">${escapeHtml(String(payload??'No result returned.'))}</div>`;
}
function showResult(title,result){ $('#resultTitle').textContent=title; $('#resultBody').innerHTML=renderReadableResult(result); $('#resultDialog').showModal(); }

const intent=(id,label,tools)=>({id,label,tools});
function searchIntent(query){
  const q=query.trim();
  if(/\bCVE-\d{4}-\d+\b/i.test(q))return intent('cve','Vulnerability intelligence',['get_nvd_cves','get_cisa_kev']);
  if(/\b(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})\b/.test(q))return intent('malware','File and malware reputation',['get_malwarebazaar','omega_malware']);
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(q)||/\b(ip address|asn|bgp|routing)\b/i.test(q))return intent('network','IP and network intelligence',['get_bgp','get_greynoise','get_whois']);
  if(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(q)||/\b(domain|website|whois|certificate|dns)\b/i.test(q))return intent('domain','Domain intelligence',['whois_lookup','dnstwist_lookalike_domains']);
  if(/^@?[a-z0-9_.-]{2,32}$/i.test(q)&&(/^@/.test(q)||/\b(username|handle|account)\b/i.test(q)))return intent('username','Public username presence',['sherlock_username_search','blackbird_username_search']);
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q))return intent('email','Public email-account presence',['holehe_email_search']);
  if(/^\+?[\d\s().-]{8,}$/.test(q))return intent('phone','Public phone information',['phoneinfoga_scan']);
  if(/\b(sanction|ofac|sdn|pep|embargo)\b/i.test(q))return intent('sanctions','Sanctions screening',['get_opensanctions','get_sanctions']);
  if(/\b(earthquake|wildfire|hurricane|storm|flood|volcano|disaster|natural hazard)\b/i.test(q))return intent('hazard','Natural hazard intelligence',['get_earthquakes','get_natural_events','get_disaster_alerts']);
  if(/\b(vessel|ship|maritime|port|chokepoint|piracy)\b/i.test(q))return intent('maritime','Maritime intelligence',['get_maritime_news','get_chokepoints','get_ais_vessels']);
  if(/\b(aircraft|flight|airport|aviation|notam|airspace)\b/i.test(q))return intent('aviation','Aviation intelligence',['get_notams','get_aviation_news','get_aircraft']);
  if(/\b(cyber|ransomware|malware|threat actor|ioc|phishing|botnet)\b/i.test(q))return intent('cyber','Cyber threat intelligence',['get_cyber_news','get_ransomware','get_threatfox']);
  if(/\b(paper|research|study|academic|arxiv|literature)\b/i.test(q))return intent('research','Research literature',['get_arxiv']);
  if(/\b(crypto|bitcoin|ethereum|stablecoin|blockchain)\b/i.test(q))return intent('crypto','Cryptocurrency and market context',['get_crypto','get_fear_greed','get_stablecoins']);
  if(/\b(stock|share price|ticker|equity|market quote)\b/i.test(q))return intent('markets','Market and company profile',['get_fmp_quote','get_fmp_profile','get_sec_filings']);
  if(/\b(gdp|inflation|unemployment|economic|economy|interest rate|exchange rate)\b/i.test(q))return intent('economy','Economic indicators',['get_economic_macro','get_bis_rates','get_bis_fx']);
  if(/\b(sec filing|10-k|10-q|8-k|edgar)\b/i.test(q))return intent('filings','Corporate filings',['get_sec_filings','get_opencorporates']);
  if(/\b(github|repository|open source project|developer activity)\b/i.test(q))return intent('github','Public development activity',['get_github_activity','get_hn_search']);
  if(/\b(satellite|imagery|orbit|spacecraft)\b/i.test(q))return intent('satellite','Satellite and imagery context',['get_satellite_snapshot','get_satellites']);
  if(/\b(election|vote|polling|ballot)\b/i.test(q))return intent('election','Election monitoring',['get_election_monitor','get_news_rss']);
  if(/\b(outbreak|disease|health advisory|epidemic|pandemic)\b/i.test(q))return intent('health','Health and outbreak intelligence',['get_health_advisories','get_news_rss']);
  if(/\b(nuclear|arms control|radiation|iaea)\b/i.test(q))return intent('nuclear','Nuclear and arms-control intelligence',['get_nuclear_status','get_radiation_safecast']);
  if(/\b(oil|gas|lng|energy|commodity|uranium|mineral)\b/i.test(q))return intent('energy','Energy and commodities intelligence',['get_energy_commodities_news','get_critical_minerals']);
  if(/\b(offshore|panama papers|paradise papers|pandora papers|shell company)\b/i.test(q))return intent('offshore','Offshore entity intelligence',['get_offshore_leaks','get_opencorporates']);
  if(/\b(food security|famine|hunger|crop)\b/i.test(q))return intent('food','Food-security intelligence',['get_food_security','get_news_rss']);
  if(/\b(country|city|location|coordinates|geocode|travel advisory|place)\b/i.test(q))return intent('location','Location and country context',['get_geocode','get_country_facts','get_travel_advisories']);
  if(/\b(company|corporation|business|filing|organization|hospital|university|nonprofit)\b/i.test(q))return intent('organization','Organization intelligence',['get_wikidata','get_opencorporates','get_news_rss']);
  if(/\b(latest|recent|news|current|today|event|developments)\b/i.test(q))return intent('news','Current-event coverage',['get_gdelt','get_news_velocity','get_news_rss']);
  return intent('entity','Entity and related coverage',['get_wikidata','get_news_rss','get_hn_search']);
}

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
  if(intentInfo.id==='domain'){const domain=clean.split('/')[0];links.push({title:'Certificate Transparency',url:`https://crt.sh/?q=${encodeURIComponent('%.'.concat(domain))}`,description:'Certificates issued for this domain and its subdomains.'},{title:'ICANN lookup',url:`https://lookup.icann.org/en/lookup?name=${encodeURIComponent(domain)}`,description:'Domain registration lookup.'});}
  if(intentInfo.id==='research')links.push({title:'Google Scholar',url:`https://scholar.google.com/scholar?q=${encoded}`,description:'Broader scholarly literature search.'},{title:'arXiv search',url:`https://arxiv.org/search/?query=${encoded}&searchtype=all`,description:'Preprints related to this topic.'});
  if(intentInfo.id==='organization'||intentInfo.id==='offshore')links.push({title:'OpenCorporates search',url:`https://opencorporates.com/companies?q=${encoded}`,description:'Company registrations across jurisdictions.'});
  if(intentInfo.id==='location')links.push({title:'OpenStreetMap',url:`https://www.openstreetmap.org/search?query=${encoded}`,description:'Map and geographic context.'});
  if(intentInfo.id==='news')links.push({title:'Google News',url:`https://news.google.com/search?q=${encoded}`,description:'Additional current coverage.'});
  if(!['email','phone','username'].includes(intentInfo.id))links.push({title:'Wikipedia search',url:`https://en.wikipedia.org/w/index.php?search=${encoded}`,description:'Background and linked references.'});
  return links;
}

function argsForSearch(tool,query){
  const props=tool.inputSchema?.properties||{}; const required=tool.inputSchema?.required||[]; const args={};
  let clean=query.replace(/^(?:https?:\/\/)/i,'').replace(/^@/,'').replace(/\/$/,'').trim();
  clean=clean.replace(/^(?:location|city|country|organization|company|business|domain|website|username|handle|news|current events?|academic|research)\s*(?::|-)?\s+/i,'');
  clean=clean.replace(/^(?:recent|latest|current|today'?s?)\s+/i,'').replace(/\s+(?:news|developments|updates)$/i,'').trim();
  const countryQuery=['get_country_facts','get_travel_advisories'].includes(tool.name)&&clean.includes(',')?clean.split(',').at(-1).trim():clean;
  const queryKey=['query','target','keyword','username','email','number','identifier','domain','search','q'].find(key=>props[key]);
  if(queryKey)args[queryKey]=countryQuery;
  if(props.limit)args.limit=10;
  if(props.timeout)args.timeout=25;
  if(props.only_used)args.only_used=true;
  if(props.registered_only)args.registered_only=true;
  if(props.output_format)args.output_format='json';
  if(props.format)args.format='json';
  for(const key of required){if(args[key]!==undefined)continue;const schema=props[key]||{};args[key]=schema.type==='number'?10:schema.type==='boolean'?false:countryQuery;}
  return args;
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
    const time=new Date().toISOString();state.lastResult={title:file.name,result,time,server:tool.serverName};state.history.unshift({title:file.name,time,server:`${tool.serverName} · Local file`});renderAll();showResult(file.name,result);clearSelectedFile();
  }finally{await api('/api/upload/delete',{id:upload.id}).catch(()=>{});}
}

async function smartInvestigate(query){
  const tools=allTools(); if(!tools.length){state.history.unshift({title:query,time:new Date().toISOString(),server:'Demo workspace'});renderAll();showResult(query,{message:'Connect Open OSINT to run this investigation with live sources.',suggested_next_step:'Open MCP servers and connect http://127.0.0.1:8892/mcp'});return;}
  const intent=searchIntent(query);
  const plan=planSearchTools({query,intentId:intent.id,preferredNames:intent.tools,tools,maxTools:6});
  if(!plan.length&&intent.id==='entity'){const fallback=tools.find(tool=>tool.name==='get_wikidata')||tools.find(tool=>tool.name==='get_hn_search');if(fallback)plan.push({tool:fallback,score:1,reason:'General entity fallback'});}
  const selected=plan.map(item=>item.tool);
  const plannedServers=new Set(selected.map(tool=>tool.serverName));
  toast(selected.length?`Searching ${selected.length} relevant tools across ${plannedServers.size} server${plannedServers.size===1?'':'s'}…`:'Relevant server is not connected');
  const settled=await Promise.allSettled(selected.map(async tool=>{
    const response=await callTool(tool,tool.serverId,argsForSearch(tool,query));
    if(response.error)throw new Error(response.error.message||'Tool call failed');
    return{tool,outcome:classifyToolResult(response.result)};
  }));
  const report={}; const errors=[]; const servers=new Set();
  if(plan.length)report['Search Plan']={eyebrow:'DYNAMIC MCP ROUTING',description:'Public Desk inspected every connected tool and selected the most relevant passive capabilities for this query.',data:plan.map(item=>({tool:item.tool.name,server:item.tool.serverName,reason:item.reason}))};
  if(!selected.length)errors.push({source:'Relevant MCP server',error:'No connected server currently provides the tools needed for this search category. Connect the matching server and try again.'});
  settled.forEach((outcome,index)=>{
    const tool=selected[index];
    noteToolHealth(tool.serverId,tool.name,outcome.status==='fulfilled'?outcome.value.outcome.kind:'error');
    if(outcome.status==='fulfilled'){
      servers.add(tool.serverName);
      const result=outcome.value.outcome;
      if(result.kind==='error')errors.push({source:sourceLabel(tool.name),error:result.error});
      else if(result.kind==='empty')errors.push({source:sourceLabel(tool.name),error:'No matching records returned for this subject.'});
      else{
        const category=categoryForTool(tool); let key=category;
        if(report[key])key=`${category} — ${sourceLabel(tool.name)}`;
        report[key]={eyebrow:`${tool.serverName} · ${sourceLabel(tool.name)}`,description:tool.description||`Results from ${tool.serverName}`,data:result.data};
      }
    }else errors.push({source:sourceLabel(tool.name),error:outcome.reason?.message||'Source unavailable'});
  });
  const links=relatedLinks(intent,query);
  if(links.length)report['Related Links']={eyebrow:'FOLLOW-UP SOURCES',description:'Useful external sources for verifying and expanding this search.',data:{links}};
  const findingCount=Object.keys(report).filter(key=>!['Related Links','Search Plan'].includes(key)).length;
  const result={content:[{type:'text',text:JSON.stringify({description:`${intent.label} for “${query}”`,data:{query,modulesQueried:selected.length,modulesWithResults:findingCount,durationMs:0,report,errors}})}]};
  const time=new Date().toISOString(); state.lastResult={title:query,result,time,server:[...servers].join(', ')||'Connected MCP'};
  state.history.unshift({title:query,time,server:state.lastResult.server}); renderAll(); showResult(query,result);
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]'); if(nav)switchView(nav.dataset.view);
  const link=event.target.closest('[data-view-link]'); if(link)switchView(link.dataset.viewLink);
  const prompt=event.target.closest('[data-prompt]'); if(prompt){$('#query').value=prompt.dataset.prompt;$('#query').focus();}
  const connectButton=event.target.closest('[data-connect]'); if(connectButton){const server=state.servers.find(s=>s.id===connectButton.dataset.connect);if(server)connect(server);}
  const disconnectButton=event.target.closest('[data-disconnect]'); if(disconnectButton){const server=state.servers.find(s=>s.id===disconnectButton.dataset.disconnect);if(server)disconnect(server);}
  const remove=event.target.closest('[data-remove]'); if(remove){state.servers=state.servers.filter(s=>s.id!==remove.dataset.remove);renderAll();}
  const run=event.target.closest('[data-run]'); if(run){const [serverId,name]=run.dataset.run.split('::');const tool=allTools().find(t=>t.serverId===serverId&&t.name===name);if(tool)openTool(tool,serverId);}
  const del=event.target.closest('[data-delete-evidence]');if(del){state.evidence.splice(Number(del.dataset.deleteEvidence),1);renderAll();}
});

$('#investigateForm').addEventListener('submit',async e=>{e.preventDefault();const q=$('#query').value.trim();if(!q&&!state.pendingFile)return;try{if(state.pendingFile)await analyzeSelectedFile(state.pendingFile,q);else await smartInvestigate(q);}catch(error){toast(error.message);}});
$('#fileInput').addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;state.pendingFile=file;$('#fileName').textContent=file.name;$('#fileDetails').textContent=`${file.type||'Unknown type'} · ${formatBytes(file.size)}`;$('#fileIcon').textContent=file.type.startsWith('image/')?'▧':file.type.startsWith('video/')?'▶':'◇';$('#fileSelection').hidden=false;});
$('#removeFile').onclick=clearSelectedFile;
$('#addServer').onclick=()=>$('#serverDialog').showModal();
$('#newInvestigation').onclick=()=>{switchView('workspace');$('#query').focus();};
$('#cmdButton').onclick=()=>{switchView('workspace');$('#query').focus();};
$('#saveServer').addEventListener('click',e=>{e.preventDefault();const form=new FormData($('#serverForm'));const server={id:crypto.randomUUID(),name:form.get('name').trim(),endpoint:form.get('endpoint').trim(),status:'offline',tools:[]};if(!server.name||!server.endpoint)return;state.servers.push(server);state.tokens.set(server.id,form.get('token'));$('#serverDialog').close();renderAll();connect(server);});
$('#executeTool').addEventListener('click',async e=>{e.preventDefault();try{const args=JSON.parse($('#runArgs').value);$('#runDialog').close();await runTool(state.activeTool.tool,state.activeTool.serverId,args);}catch(error){$('#runError').textContent=error.message;}});
$$('[data-close-result]').forEach(b=>b.onclick=()=>$('#resultDialog').close());
$$('[data-close-dialog]').forEach(button=>button.onclick=()=>button.closest('dialog')?.close());
$('#saveEvidence').onclick=()=>{if(state.lastResult){state.evidence.unshift(state.lastResult);renderAll();toast('Saved to evidence');$('#resultDialog').close();}};
$('#clearHistory').onclick=()=>{state.history=[];renderAll();};
$('#toolFilter').oninput=renderTools;
$('#intelNewsFilter').oninput=renderIntelNews;
$('#intelNewsCategory').onchange=renderIntelNews;
$('#refreshIntelNews').onclick=()=>loadIntelNews(true);
$('#exportEvidence').onclick=()=>{const blob=new Blob([JSON.stringify(state.evidence,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`public-desk-evidence-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);};
$('#themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('signaldesk.theme',next);};
document.documentElement.dataset.theme=localStorage.getItem('signaldesk.theme')||'light';
if(new URLSearchParams(location.search).get('consensus')==='connected'){
  history.replaceState({},'',location.pathname);
  toast('Consensus sign-in complete');
}
renderAll();
setTimeout(()=>state.servers.filter(server=>!server.disconnected).forEach(server=>connect(server)),100);
