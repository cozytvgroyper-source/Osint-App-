const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  servers: JSON.parse(localStorage.getItem('signaldesk.servers') || 'null') || [{ id: 'osint-local', name: 'Open OSINT', endpoint: 'http://127.0.0.1:8892/mcp', status: 'offline', tools: [] }],
  tokens: new Map(),
  history: JSON.parse(localStorage.getItem('signaldesk.history') || '[]'),
  evidence: JSON.parse(localStorage.getItem('signaldesk.evidence') || '[]'),
  activeTool: null,
  lastResult: null
};

const workflows = [
  ['◎','Entity profile','People, companies & relationships','entity'],
  ['⌁','Domain & IP','Infrastructure and threat signals','domain'],
  ['◈','Geospatial scan','Places, vessels, aircraft & events','geo'],
  ['▤','Intelligence brief','Multi-source situation report','brief']
];

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
  server.status='connecting'; renderServers(); renderConnections();
  try {
    const payload={endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:server.id,method:'tools/list',params:{},initialize:true};
    const response=await api('/api/mcp',payload);
    if(response.error) throw new Error(response.error.message || 'MCP error');
    server.tools=response.result?.tools || [];
    server.status='connected';
    toast(`${server.name} connected · ${server.tools.length} tools`);
  } catch(error) {
    server.status='offline'; server.error=error.message;
    toast(`Could not connect: ${error.message}`);
  }
  renderAll();
}

function renderWorkflows(){ $('#workflowGrid').innerHTML=workflows.map(([icon,title,desc,key])=>`<button class="workflow" data-workflow="${key}"><span class="workflow-icon">${icon}</span><b>${title}</b><small>${desc}</small></button>`).join(''); }
function renderHistory(){
  $('#history').innerHTML=state.history.length?state.history.slice(0,5).map(item=>`<div class="history-item"><span class="mini-icon">${iconFor(item.title)}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.server||'Local workspace')}</small></div><time>${new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>`).join(''):'<div class="history-empty">Your investigations will appear here.</div>';
}
function renderConnections(){
  const connected=state.servers.filter(s=>s.status==='connected').length;
  $('#serverStatus').textContent=connected?`${connected} MCP server${connected===1?'':'s'} connected`:'Demo workspace ready';
  $('#connectionSummary').innerHTML=state.servers.map(s=>`<div class="connection"><div class="connection-name"><span class="server-dot ${s.status==='connected'?'connected':''}"></span><div><b>${escapeHtml(s.name)}</b><small>${s.status==='connected'?`${s.tools.length} tools available`:s.status==='connecting'?'Connecting…':'Ready to connect'}</small></div></div><button class="text-button" data-connect="${s.id}">${s.status==='connected'?'Refresh':'Connect'}</button></div>`).join('');
}
function renderServers(){
  $('#serverList').innerHTML=state.servers.length?state.servers.map(s=>`<article class="server-card"><div class="server-card-top"><span class="badge">STREAMABLE HTTP</span><span class="server-dot ${s.status==='connected'?'connected':''}"></span></div><h3>${escapeHtml(s.name)}</h3><p class="endpoint">${escapeHtml(s.endpoint)}</p><p class="subtle">${s.status==='connected'?`${s.tools.length} tools discovered`:s.error?escapeHtml(s.error):'Not connected'}</p><div class="server-actions"><button class="ghost" data-remove="${s.id}">Remove</button><button class="primary" data-connect="${s.id}">${s.status==='connecting'?'Connecting…':s.status==='connected'?'Refresh':'Connect'}</button></div></article>`).join(''):'<div class="empty-state">Add your first MCP server to begin.</div>';
}
function allTools(){ return state.servers.flatMap(server=>server.tools.map(tool=>({...tool,serverId:server.id,serverName:server.name}))); }
function renderTools(){
  const filter=$('#toolFilter').value.toLowerCase(); const tools=allTools().filter(t=>(t.name+' '+(t.description||'')).toLowerCase().includes(filter));
  $('#toolCount').textContent=tools.length?`${tools.length} tools across ${new Set(tools.map(t=>t.serverId)).size} connected server(s).`:'Connect a server to discover tools.';
  $('#toolLibrary').innerHTML=tools.length?tools.map(t=>`<article class="tool-card"><div class="tool-card-head"><code>${escapeHtml(t.name)}</code><span class="badge">${escapeHtml(t.serverName)}</span></div><p>${escapeHtml(t.description||'No description provided.')}</p><button class="text-button" data-run="${escapeHtml(t.serverId)}::${escapeHtml(t.name)}">Run tool →</button></article>`).join(''):'<div class="empty-state">No tools to show yet.</div>';
}
function renderEvidence(){
  $('#evidenceList').innerHTML=state.evidence.length?state.evidence.map((item,index)=>`<article class="evidence-card"><div><p class="eyebrow">${new Date(item.time).toLocaleString()}</p><h3>${escapeHtml(item.title)}</h3><pre>${escapeHtml(JSON.stringify(item.result,null,2))}</pre></div><button class="icon-button" data-delete-evidence="${index}" title="Remove">×</button></article>`).join(''):'<div class="empty-state">Save a tool result to build a traceable case file.</div>';
}
function renderAll(){renderHistory();renderConnections();renderServers();renderTools();renderEvidence();persist();}

function openTool(tool, serverId){
  state.activeTool={tool,serverId}; $('#runToolName').textContent=tool.name; $('#runToolDescription').textContent=tool.description||'';
  const props=tool.inputSchema?.properties||{}; const sample={}; Object.entries(props).forEach(([key,schema])=>sample[key]=schema.default??(schema.type==='number'?0:schema.type==='boolean'?false:''));
  $('#runArgs').value=JSON.stringify(sample,null,2); $('#runError').textContent=''; $('#runDialog').showModal();
}

async function runTool(tool,serverId,args,title=tool.name){
  const server=state.servers.find(s=>s.id===serverId); if(!server)throw new Error('Server not found');
  const response=await api('/api/mcp',{endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:server.id,method:'tools/call',params:{name:tool.name,arguments:args},initialize:server.status!=='connected'});
  if(response.error)throw new Error(response.error.message||'Tool call failed');
  const result=response.result; state.lastResult={title,result,time:new Date().toISOString(),server:server.name};
  state.history.unshift({title,time:state.lastResult.time,server:server.name}); renderAll(); showResult(title,result); return result;
}

function showResult(title,result){ $('#resultTitle').textContent=title; const content=result?.content; const text=Array.isArray(content)?content.map(v=>v.text||JSON.stringify(v)).join('\n\n'):JSON.stringify(result,null,2); $('#resultBody').innerHTML=`<pre>${escapeHtml(text)}</pre>`; $('#resultDialog').showModal(); }

async function smartInvestigate(query){
  const tools=allTools(); if(!tools.length){state.history.unshift({title:query,time:new Date().toISOString(),server:'Demo workspace'});renderAll();showResult(query,{message:'Connect Open OSINT to run this investigation with live sources.',suggested_next_step:'Open MCP servers and connect http://127.0.0.1:8892/mcp'});return;}
  const rules=[[/sanction/i,/sanction|opensanctions|ofac/i],[/cyber|cve|ransom|threat/i,/cyber|cve|ransom|threat|intelligence_report/i],[/earthquake|hazard|disaster|storm/i,/earthquake|natural|disaster|gdacs/i],[/brief|geopolit|situation|report/i,/intelligence_report|query_modules|news/i],[/domain|ip|whois/i,/domain|whois|ip|bgp/i],[/vessel|ship|maritime/i,/vessel|maritime|ais/i],[/aircraft|flight/i,/aircraft|flight/i]];
  const match=rules.find(([q])=>q.test(query)); const tool=tools.find(t=>(match?.[1]||/intelligence_report|query_modules|news/i).test(t.name))||tools[0];
  const props=tool.inputSchema?.properties||{}; const args={}; const queryKey=['query','q','keyword','name','entity','place','symbol'].find(k=>props[k]); if(queryKey)args[queryKey]=query;
  toast(`Running ${tool.name}…`); await runTool(tool,tool.serverId,args,query);
}

document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-view]'); if(nav)switchView(nav.dataset.view);
  const link=event.target.closest('[data-view-link]'); if(link)switchView(link.dataset.viewLink);
  const prompt=event.target.closest('[data-prompt]'); if(prompt){$('#query').value=prompt.dataset.prompt;$('#query').focus();}
  const workflow=event.target.closest('[data-workflow]'); if(workflow){const prompts={entity:'Build a source-backed profile for ',domain:'Investigate domain or IP ',geo:'Map recent events near ',brief:'Create an intelligence brief about '};$('#query').value=prompts[workflow.dataset.workflow];$('#query').focus();}
  const connectButton=event.target.closest('[data-connect]'); if(connectButton){const server=state.servers.find(s=>s.id===connectButton.dataset.connect);if(server)connect(server);}
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
$('#saveEvidence').onclick=()=>{if(state.lastResult){state.evidence.unshift(state.lastResult);renderAll();toast('Saved to evidence');$('#resultDialog').close();}};
$('#clearHistory').onclick=()=>{state.history=[];renderAll();};
$('#toolFilter').oninput=renderTools;
$('#exportEvidence').onclick=()=>{const blob=new Blob([JSON.stringify(state.evidence,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`signaldesk-evidence-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);};
$('#themeToggle').onclick=()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('signaldesk.theme',next);};
document.documentElement.dataset.theme=localStorage.getItem('signaldesk.theme')||'light';
renderWorkflows();renderAll();
const bundledLocalServer=state.servers.find(server=>server.endpoint==='http://127.0.0.1:8892/mcp');
if(bundledLocalServer)connect(bundledLocalServer);
