// MCP servers page: connecting servers, their status and the data-source keys.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import {serverCard,serverFocusTarget} from '../servers-view.js?v=4';
import {emptyState,escapeHtml} from '../ui.js?v=6';
import {recordToolHealth,toolCountLabel} from '../tool-health.js';
import {$,bundledServers,state,sessionKeyFor,openDialog,toast,api,renderAll} from './core.js';

// After a data source changes, focus its Connect/Change key button so keyboard users keep their place.
function focusSourceCard(id){document.querySelector(`[data-source-edit="${CSS.escape(id)}"]`)?.focus();}
async function connect(server) {
  if(server.status==='connecting')return;
  server.disconnected=false;
  server.needsAuth=false;
  server.status='connecting'; renderServers(); renderSourcesStatus();
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

// One plain line about what searches can use, in place of the connection panels (details live on MCP servers).
// It is a live region, so it is only rewritten when its words change.
let lastSourcesStatus='';
function renderSourcesStatus(){
  const connected=state.servers.filter(server=>server.status==='connected').length;
  const connecting=state.servers.some(server=>server.status==='connecting');
  const keys=dataSources.list.filter(source=>source.status==='connected').length;
  const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
  const sources=dataSources.error?"data sources couldn't be loaded":dataSources.loaded?`${plural(keys,'data source')} set up`:'checking data sources…';
  const html=connected
    ?`${plural(connected,'MCP server')} connected · ${sources} · <button type="button" class="text-button" data-view-link="servers">Manage</button>`
    :connecting?'Connecting to MCP servers…'
    :`No MCP servers are connected, so searches can't run yet. <button type="button" class="text-button" data-view-link="servers">Open MCP servers</button>`;
  if(html===lastSourcesStatus)return;
  lastSourcesStatus=html;$('#sourcesStatus').innerHTML=html;
}
function renderServers(){
  $('#serverList').innerHTML=state.servers.length?state.servers.map(s=>serverCard(s,{bundled:bundledServers.some(item=>item.endpoint===s.endpoint),toolCountText:s.status==='connected'?toolCountLabel(s,state.toolHealth):''})).join(''):emptyState({title:'No MCP servers yet.',text:'Add one to start searching.'});
}
// After a server card is re-drawn, put focus back on that card's main button so keyboard users keep their place.
function focusServerCard(id,{onlyIfStranded=false}={}){
  const card=document.querySelector(`[data-server-card="${CSS.escape(id)}"]`);
  if(!card)return;
  // When a slow request finishes, take focus back only if it was left nowhere (or still on this card).
  if(onlyIfStranded&&!(document.activeElement===document.body||!document.activeElement||card.contains(document.activeElement)))return;
  serverFocusTarget(card)?.focus();
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
  $('#dataSourceCount').textContent=count;renderSourcesStatus();
  if(dataSources.error){$('#dataSourceList').innerHTML=`<div class="empty-state">${escapeHtml(dataSources.error)}</div>`;return;}
  if(!dataSources.loaded)return;
  $('#dataSourceList').innerHTML=list.map(s=>{
    const dot=s.status==='connected'?'connected':s.status==='disconnected'?'':'idle';
    const feeds=s.feeds.length?`Feeds ${s.feeds.join(', ')}`:'No search tool uses it directly';
    const id=escapeHtml(s.id);
    const actions=s.status==='not_configured'
      ?`<a class="ghost" href="${escapeHtml(s.signup)}" target="_blank" rel="noopener noreferrer">Get a key<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a><button class="primary" data-source-edit="${id}">Connect</button>`
      :`<button class="ghost" data-source-remove="${id}">Remove</button><button class="ghost" data-source-edit="${id}">Change key</button>${s.status==='connected'?`<button class="primary" data-source-disconnect="${id}">Disconnect</button>`:`<button class="primary" data-source-connect="${id}">Connect</button>`}`;
    return `<article class="server-card source-card"><div class="server-card-top"><h3>${escapeHtml(s.name)}${s.recommended?' <span class="ui-badge ui-badge-safe">Recommended</span>':''}</h3><span class="server-dot ${dot}" aria-hidden="true"></span></div>`
      +`<p class="source-improves"><b>Improves:</b> ${escapeHtml(s.improves||'')}</p>`
      +`<p class="server-status">${SOURCE_STATUS[s.status]||''}</p>`
      +`<p class="endpoint">${escapeHtml(feeds)}</p><p class="form-note">${escapeHtml(s.note)}</p>`
      +`${s.example?`<button class="text-button source-try" data-prompt="${escapeHtml(s.example)}">Try a search: ${escapeHtml(s.example)} →</button>`:''}<div class="server-actions">${actions}</div></article>`;
  }).join('');
}
function openKeyDialog(source){
  dataSources.editing=source.id;
  $('#keyDialogTitle').textContent=`${source.status==='not_configured'?'Connect':'Change key for'} ${source.name}`;
  $('#keyFields').innerHTML=source.fields.map(f=>{const saved=source.saved.includes(f.env);const email=/EMAIL/.test(f.env);return `<label>${escapeHtml(f.label)}<input name="${escapeHtml(f.env)}" type="${email?'email':'password'}" autocomplete="off" spellcheck="false" placeholder="${saved?'Saved. Leave empty to keep it.':'Paste here'}" /></label>`;}).join('');
  $('#keyNote').innerHTML=`Get a key at <a href="${escapeHtml(source.signup)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(source.signup).host)}</a>. It is saved on this Mac only and is not shown again.`;
  $('#keyError').textContent='';$('#saveKey').textContent=source.status==='not_configured'?'Connect':'Save';
  openDialog($('#keyDialog'));
}
async function dataSourceAction(action,id,values){
  const source=dataSources.list.find(s=>s.id===id);if(!source)return;
  try{const result=await api(`/api/data-sources/${action}`,values?{id,values}:{id});replaceDataSource(result.source);toast(`${source.name} ${action==='remove'?'key removed':action==='disconnect'?'disconnected':'connected'}`);return true;}
  catch(error){if(values){$('#keyError').textContent=error.message;}else toast(error.message);return false;}
}

// Keep each part ("116 tools", "98 working") on one line so narrow cards wrap only between parts.
function toolCountHtml(server){return escapeHtml(toolCountLabel(server,state.toolHealth).replace(/(?<!·) (?!·)/g,'\u00a0'));}
function noteToolHealth(serverId,toolName,kind){state.toolHealth=recordToolHealth(state.toolHealth,serverId,toolName,kind,new Date().toISOString());}

export {focusSourceCard,connect,disconnect,lastSourcesStatus,renderSourcesStatus,renderServers,focusServerCard,dataSources,SOURCE_STATUS,loadDataSources,replaceDataSource,renderDataSources,openKeyDialog,dataSourceAction,toolCountHtml,noteToolHealth};
