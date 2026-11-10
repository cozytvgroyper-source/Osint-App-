const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const bundledServers=[
  { id: 'osint-local', name: 'Open OSINT', endpoint: 'http://127.0.0.1:8892/mcp', status: 'offline', tools: [] },
  { id: 'osint-toolbox-local', name: 'OSINT Toolbox', endpoint: 'http://127.0.0.1:8893/mcp', status: 'offline', tools: [] },
  { id: 'omega-local', name: 'Omega MCP', endpoint: 'http://127.0.0.1:8894/mcp', status: 'offline', tools: [], caution: 'Use active scanning tools only on systems you own or are authorized to test.' },
  { id: 'consensus', name: 'Consensus', endpoint: 'https://mcp.consensus.app/mcp', status: 'offline', tools: [], oauth: 'consensus' }
];
const removedBundledEndpoints=new Set();
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
  activeTool: null,
  lastResult: null
};
const clientSessionId=sessionStorage.getItem('signaldesk.clientSessionId')||crypto.randomUUID();
sessionStorage.setItem('signaldesk.clientSessionId',clientSessionId);
const sessionKeyFor=serverId=>`${clientSessionId}:${serverId}`;

function persist() {
  localStorage.setItem('signaldesk.servers', JSON.stringify(state.servers.map(({ tools, ...server }) => ({ ...server, status: 'offline' }))));
  localStorage.setItem('signaldesk.history', JSON.stringify(state.history.slice(0, 20)));
  localStorage.setItem('signaldesk.evidence', JSON.stringify(state.evidence));
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2400); }
function iconFor(name='') { if(/cyber|cve|threat|domain|ip/i.test(name))return'⌁'; if(/geo|satellite|place|flight|vessel/i.test(name))return'◈'; if(/sanction|entity|company/i.test(name))return'◎'; return'▤'; }

function switchView(id) {
  $$('.view').forEach(v => v.classList.toggle('active-view', v.id === id));
  $$('.nav').forEach(v => v.classList.toggle('active', v.dataset.view === id));
  const labels={workspace:'Good morning, analyst.',servers:'Connection center',library:'Explore capabilities',evidence:'Evidence notebook'};
  $('#pageTitle').textContent=labels[id]; window.scrollTo({top:0,behavior:'smooth'});
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
  $('#workflowGrid').innerHTML=state.servers.length?state.servers.map(server=>`<article class="workflow server-workflow"><div class="server-workflow-head"><span class="workflow-icon">${server.name==='Open OSINT'?'◎':'⌘'}</span><span class="server-dot ${server.status==='connected'?'connected':''}"></span></div><b>${escapeHtml(server.name)}</b><small>${escapeHtml(server.endpoint)}</small><div class="server-workflow-foot"><span>${server.status==='connected'?`${server.tools.length} tools available`:server.status==='connecting'?'Connecting…':server.disconnected?'Disconnected':'Ready to connect'}</span><button class="text-button" ${server.status==='connected'?`data-disconnect="${server.id}"`:`data-connect="${server.id}"`}>${server.status==='connected'?'Disconnect':'Connect'} →</button></div></article>`).join(''):'<div class="empty-state">No MCP servers saved.</div>';
}
function renderHistory(){
  $('#history').innerHTML=state.history.length?state.history.slice(0,5).map(item=>`<div class="history-item"><span class="mini-icon">${iconFor(item.title)}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.server||'Local workspace')}</small></div><time>${new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):'<div class="history-empty">Your investigations will appear here.</div>';
}
function renderConnections(){
  const connected=state.servers.filter(s=>s.status==='connected').length;
  $('#serverStatus').textContent=connected?`${connected} MCP server${connected===1?'':'s'} connected`:'Demo workspace ready';
  $('#connectionSummary').innerHTML=state.servers.map(s=>`<div class="connection"><div class="connection-name"><span class="server-dot ${s.status==='connected'?'connected':''}"></span><div><b>${escapeHtml(s.name)}</b><small>${s.status==='connected'?`${s.tools.length} tools available`:s.status==='connecting'?'Connecting…':s.disconnected?'Disconnected':'Ready to connect'}</small></div></div><button class="text-button" ${s.status==='connected'?`data-disconnect="${s.id}"`:`data-connect="${s.id}"`}>${s.status==='connected'?'Disconnect':'Connect'}</button></div>`).join('');
}
function renderServers(){
  $('#serverList').innerHTML=state.servers.length?state.servers.map(s=>`<article class="server-card"><div class="server-card-top"><span class="badge">STREAMABLE HTTP</span><span class="server-dot ${s.status==='connected'?'connected':''}"></span></div><h3>${escapeHtml(s.name)}</h3><p class="endpoint">${escapeHtml(s.endpoint)}</p><p class="subtle">${s.status==='connected'?`${s.tools.length} tools discovered`:s.needsAuth?'Sign in is required to search academic research.':s.disconnected?'Disconnected':s.error?escapeHtml(s.error):'Not connected'}</p>${s.caution?`<p class="form-note">${escapeHtml(s.caution)}</p>`:''}<div class="server-actions"><button class="ghost" data-remove="${s.id}">Remove</button>${s.needsAuth?`<a class="primary" href="/api/oauth/consensus/start">Sign in to Consensus</a>`:s.status==='connected'?`<button class="ghost" data-disconnect="${s.id}">Disconnect</button><button class="primary" data-connect="${s.id}">Refresh</button>`:`<button class="primary" data-connect="${s.id}">${s.status==='connecting'?'Connecting…':'Connect'}</button>`}</div></article>`).join(''):'<div class="empty-state">Add your first MCP server to begin.</div>';
}
function allTools(){ return state.servers.flatMap(server=>(server.tools||[]).map(tool=>({...tool,serverId:server.id,serverName:server.name}))); }
function renderTools(){
  const filter=$('#toolFilter').value.toLowerCase(); const tools=allTools().filter(t=>(t.name+' '+(t.description||'')).toLowerCase().includes(filter));
  $('#toolCount').textContent=tools.length?`${tools.length} tools across ${new Set(tools.map(t=>t.serverId)).size} connected server(s).`:'Connect a server to discover tools.';
  $('#toolLibrary').innerHTML=tools.length?tools.map(t=>`<article class="tool-card"><div class="tool-card-head"><code>${escapeHtml(t.name)}</code><span class="badge">${escapeHtml(t.serverName)}</span></div><p>${escapeHtml(t.description||'No description provided.')}</p><button class="text-button" data-run="${escapeHtml(t.serverId)}::${escapeHtml(t.name)}">Run tool →</button></article>`).join(''):'<div class="empty-state">No tools to show yet.</div>';
}
function renderEvidence(){
  $('#evidenceList').innerHTML=state.evidence.length?state.evidence.map((item,index)=>`<article class="evidence-card"><div><p class="eyebrow">${new Date(item.time).toLocaleString()}</p><h3>${escapeHtml(item.title)}</h3><pre>${escapeHtml(JSON.stringify(item.result,null,2))}</pre></div><button class="icon-button" data-delete-evidence="${index}" title="Remove">×</button></article>`).join(''):'<div class="empty-state">Save a tool result to build a traceable case file.</div>';
}
function renderAll(){renderWorkflows();renderHistory();renderConnections();renderServers();renderTools();renderEvidence();persist();}

function openTool(tool, serverId){
  state.activeTool={tool,serverId}; $('#runToolName').textContent=tool.name; $('#runToolDescription').textContent=tool.description||'';
  const props=tool.inputSchema?.properties||{}; const sample={}; Object.entries(props).forEach(([key,schema])=>sample[key]=schema.default??(schema.type==='number'?0:schema.type==='boolean'?false:''));
  $('#runArgs').value=JSON.stringify(sample,null,2); $('#runError').textContent=''; $('#runDialog').showModal();
}

async function runTool(tool,serverId,args,title=tool.name){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  const response=await callTool(tool,serverId,args);
  if(response.error)throw new Error(response.error.message||'Tool call failed');
  const result=response.result; state.lastResult={title,result,time:new Date().toISOString(),server:server.name};
  state.history.unshift({title,time:state.lastResult.time,server:server.name}); renderAll(); showResult(title,result); return result;
}

async function callTool(tool,serverId,args){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  return api('/api/mcp',{endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:sessionKeyFor(server.id),method:'tools/call',params:{name:tool.name,arguments:args},initialize:server.status!=='connected'});
}

function humanize(value=''){return String(value).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
function sourceLabel(value=''){return humanize(String(value).replace(/^(?:get_|omega_)/,''));}
function parseToolResult(result){
  const content=result?.content;
  if(Array.isArray(content)&&content.length===1&&typeof content[0]?.text==='string'){
    try{return JSON.parse(content[0].text);}catch{return content[0].text;}
  }
  return result?.structuredContent??result;
}
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
  return `<section class="result-category"><div class="category-head"><div><p class="eyebrow">SOURCE</p><h3>${escapeHtml(sourceLabel(name))}</h3></div>${entry?.description?`<p>${escapeHtml(entry.description)}</p>`:''}</div>${renderRecord(data)}${objects.map(([key,value])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderRecord(value)}</div>`).join('')}${arrays.map(([key,items])=>`<div class="result-subgroup"><h4>${escapeHtml(humanize(key))}</h4>${renderArray(items)}</div>`).join('')}</section>`;
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

function searchIntent(query){
  const q=query.trim();
  if(/\bCVE-\d{4}-\d+\b/i.test(q))return{label:'Vulnerability intelligence',tools:['get_nvd_cves','get_cisa_kev']};
  if(/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(q)||/\b(domain|website|whois|certificate|dns)\b/i.test(q))return{label:'Domain intelligence',tools:['whois_lookup','dnstwist_lookalike_domains']};
  if(/^@?[a-z0-9_.-]{2,32}$/i.test(q)&&(/^@/.test(q)||/\b(username|handle|account)\b/i.test(q)))return{label:'Public username presence',tools:['sherlock_username_search','blackbird_username_search']};
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q))return{label:'Public email-account presence',tools:['holehe_email_search']};
  if(/^\+?[\d\s().-]{8,}$/.test(q))return{label:'Public phone information',tools:['phoneinfoga_scan']};
  if(/\b(sanction|ofac|sdn|pep|embargo)\b/i.test(q))return{label:'Sanctions screening',tools:['get_opensanctions','get_sanctions']};
  if(/\b(earthquake|wildfire|hurricane|storm|flood|volcano|disaster|natural hazard)\b/i.test(q))return{label:'Natural hazard intelligence',tools:['get_earthquakes','get_natural_events','get_disaster_alerts']};
  if(/\b(vessel|ship|maritime|port|chokepoint)\b/i.test(q))return{label:'Maritime intelligence',tools:['get_maritime_news','get_chokepoints']};
  if(/\b(aircraft|flight|airport|aviation|notam)\b/i.test(q))return{label:'Aviation intelligence',tools:['get_notams','get_aviation_news','get_aircraft']};
  if(/\b(cyber|ransomware|malware|threat actor|ioc)\b/i.test(q))return{label:'Cyber threat intelligence',tools:['get_cyber_news','get_ransomware','get_threatfox']};
  if(/\b(paper|research|study|academic|arxiv)\b/i.test(q))return{label:'Research literature',tools:['get_arxiv']};
  if(/\b(country|city|location|coordinates|geocode|travel advisory)\b/i.test(q))return{label:'Location and country context',tools:['get_geocode','get_country_facts','get_travel_advisories']};
  if(/\b(company|corporation|business|ticker|filing|organization|hospital|university)\b/i.test(q))return{label:'Organization intelligence',tools:['get_wikidata','get_opencorporates','get_news_rss']};
  if(/\b(latest|recent|news|current|today|event|developments)\b/i.test(q))return{label:'Current-event coverage',tools:['get_gdelt','get_news_velocity','get_news_rss']};
  return{label:'Entity and news intelligence',tools:['get_wikidata','get_gdelt','get_hn_search']};
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

function hasUsefulData(value,key=''){
  const metadata=/^(query|source|note|feedCount|filtered|totalBeforeFilter|jurisdiction|total|count)$/i;
  if(value===null||value===undefined||value==='')return false;
  if(Array.isArray(value))return value.length>0;
  if(typeof value!=='object')return !metadata.test(key);
  return Object.entries(value).some(([childKey,child])=>hasUsefulData(child,childKey));
}

async function smartInvestigate(query){
  const tools=allTools(); if(!tools.length){state.history.unshift({title:query,time:new Date().toISOString(),server:'Demo workspace'});renderAll();showResult(query,{message:'Connect Open OSINT to run this investigation with live sources.',suggested_next_step:'Open MCP servers and connect http://127.0.0.1:8892/mcp'});return;}
  const intent=searchIntent(query);
  const selected=intent.tools.map(name=>tools.find(tool=>tool.name===name)).filter(Boolean).slice(0,3);
  if(!selected.length){const fallback=tools.find(tool=>tool.name==='get_wikidata')||tools.find(tool=>tool.name==='get_hn_search')||tools[0];selected.push(fallback);}
  toast(`Searching ${selected.length} relevant source${selected.length===1?'':'s'}…`);
  const settled=await Promise.allSettled(selected.map(async tool=>{
    const response=await callTool(tool,tool.serverId,argsForSearch(tool,query));
    if(response.error)throw new Error(response.error.message||'Tool call failed');
    return{tool,data:parseToolResult(response.result)};
  }));
  const report={}; const errors=[]; const servers=new Set();
  settled.forEach((outcome,index)=>{
    const tool=selected[index];
    if(outcome.status==='fulfilled'){
      servers.add(tool.serverName);
      const value=outcome.value.data;
      if(value?.error||value?.data?.error)errors.push({source:sourceLabel(tool.name),error:value.error||value.data.error});
      else{
        const data=value?.data??value;
        if(hasUsefulData(data))report[tool.name]={description:tool.description||`Results from ${tool.serverName}`,data};
        else errors.push({source:sourceLabel(tool.name),error:'No matching records returned for this subject.'});
      }
    }else errors.push({source:sourceLabel(tool.name),error:outcome.reason?.message||'Source unavailable'});
  });
  const result={content:[{type:'text',text:JSON.stringify({description:`${intent.label} for “${query}”`,data:{query,modulesQueried:selected.length,modulesWithResults:Object.keys(report).length,durationMs:0,report,errors}})}]};
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

$('#investigateForm').addEventListener('submit',async e=>{e.preventDefault();const q=$('#query').value.trim();if(!q)return;try{await smartInvestigate(q);}catch(error){toast(error.message);}});
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
$('#exportEvidence').onclick=()=>{const blob=new Blob([JSON.stringify(state.evidence,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`signaldesk-evidence-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);};
$('#themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('signaldesk.theme',next);};
document.documentElement.dataset.theme=localStorage.getItem('signaldesk.theme')||'light';
if(new URLSearchParams(location.search).get('consensus')==='connected'){
  history.replaceState({},'',location.pathname);
  toast('Consensus sign-in complete');
}
renderAll();
setTimeout(()=>state.servers.filter(server=>!server.disconnected).forEach(server=>connect(server)),100);
