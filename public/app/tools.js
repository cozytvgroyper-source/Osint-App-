// Tool library: listing tools, the tool check, and running one tool with its permission.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import {toolUsage} from '../search-planner.js?v=1';
import {tierChips,toolCard} from '../tools-view.js?v=2';
import {emptyState,escapeHtml} from '../ui.js?v=6';
import {classifyToolResult} from '../result-classifier.js';
import {selfCheckPlan,summarizeSelfCheck} from '../self-check.js';
import {groupToolsByTier,runRequirements,toolRisk} from '../tool-tiers.js?v=1';
import {buildRunGrantRequest} from '../run-grant-client.js?v=1';
import {$,state,sessionKeyFor,openDialog,toast,api,renderAll} from './core.js';
import {noteToolHealth} from './servers.js';
import {recordHistory} from './evidence.js';
import {showResult} from './results.js';

function allTools(){ return state.servers.flatMap(server=>(server.tools||[]).map(tool=>({...tool,serverId:server.id,serverName:server.name}))); }
// Tool Library groups tools by risk tier (tool-tiers.js): what running each one does to the target.
function tierBadge(risk){return `<span class="tier-badge tier-${escapeHtml(risk.key)}" title="${escapeHtml(risk.targetSees)}">${escapeHtml(risk.label)}</span>`;}
function renderTools(){
  const filter=$('#toolFilter').value.trim().toLowerCase();
  const matching=allTools().filter(t=>(t.name+' '+(t.description||'')+' '+(t.serverName||'')).toLowerCase().includes(filter));
  const groups=groupToolsByTier(matching);
  const chips=[{key:'all',label:'All',count:matching.length,explain:'Every tool from your connected MCP servers.'},...groups.map(group=>({key:group.tier.key,label:group.tier.label,count:group.tools.length,explain:group.tier.targetSees}))];
  if(!chips.some(chip=>chip.key===state.tierFilter))state.tierFilter='all';
  $('#tierFilters').innerHTML=matching.length?tierChips(chips,state.tierFilter):'';
  const shown=groups.filter(group=>state.tierFilter==='all'||group.tier.key===state.tierFilter);
  $('#toolCount').textContent=matching.length?`${matching.length} tools across ${new Set(matching.map(t=>t.serverId)).size} connected MCP server(s).`:'Connect an MCP server to see its tools.';
  $('#toolLibrary').innerHTML=shown.length?shown.map(group=>`<section class="tier-group"><div class="tier-group-head"><h2 class="tier-group-title">${escapeHtml(group.tier.label)}</h2>${tierBadge(toolRisk(group.tools[0]))}<p class="subtle">${escapeHtml(group.tier.targetSees)}</p></div><div class="tool-grid">${group.tools.map(t=>toolCard(t,{risk:toolRisk(t),usage:toolUsage(t)})).join('')}</div></section>`).join(''):emptyState({title:'No tools to show yet.',text:'Connect an MCP server to see its tools here.'});
}
const selfCheck={running:false,stop:false};
function renderSelfCheck(results,pending=0){
  $('#selfCheckSummary').textContent=results.length?`${summarizeSelfCheck(results).label}${pending?` · ${pending} to go`:''}`:'';
  // Each result is a word with an icon (never color alone).
  const label={working:['✓','Working'],empty:['○','Returned nothing'],failing:['✕','Failing'],skipped:['–','Skipped']};
  $('#selfCheckResults').innerHTML=results.length?`<div class="table-scroll" role="region" tabindex="0" aria-label="Tool check results table"><table class="deep-history-table"><thead><tr><th scope="col">Tool</th><th scope="col">Server</th><th scope="col">Test target</th><th scope="col">Result</th><th scope="col">Time</th></tr></thead><tbody>${results.map(r=>`<tr class="self-check-${r.outcome}"><td><code>${escapeHtml(r.tool)}</code></td><td>${escapeHtml(r.server)}</td><td><code>${escapeHtml(r.target)}</code></td><td>${label[r.outcome]?`<span aria-hidden="true">${label[r.outcome][0]} </span>${escapeHtml(label[r.outcome][1])}`:escapeHtml(r.outcome)}${r.detail?`<br><small>${escapeHtml(r.detail)}</small>`:''}</td><td>${r.ms==null?'':`${(r.ms/1000).toFixed(1)} s`}</td></tr>`).join('')}</tbody></table></div>`:'';
}
async function runSelfCheck(){
  if(selfCheck.running)return;
  const plan=selfCheckPlan(allTools());
  if(!plan.length){toast('Connect the MCP servers first: no tools to check.');return;}
  selfCheck.running=true;selfCheck.stop=false;$('#runSelfCheck').disabled=true;$('#stopSelfCheck').hidden=false;
  const results=[];
  for(const [index,item] of plan.entries()){
    if(selfCheck.stop)break;
    const server=state.servers.find(s=>s.id===item.tool.serverId);
    const base={tool:item.tool.name,server:item.tool.serverName,target:item.target};
    if(server?.status!=='connected'){results.push({...base,outcome:'skipped',detail:'Server not connected',ms:null});renderSelfCheck(results,plan.length-index-1);continue;}
    const started=performance.now();
    try{
      const response=await callTool(item.tool,item.tool.serverId,item.args);
      const kind=classifyToolResult(response.result).kind;
      noteToolHealth(item.tool.serverId,item.tool.name,kind);
      results.push({...base,outcome:kind==='error'?'failing':kind==='empty'?'empty':'working',detail:kind==='error'?classifyToolResult(response.result).error:'',ms:performance.now()-started});
    }catch(error){
      noteToolHealth(item.tool.serverId,item.tool.name,'error');
      results.push({...base,outcome:'failing',detail:error.message,ms:performance.now()-started});
    }
    renderSelfCheck(results,plan.length-index-1);
  }
  selfCheck.running=false;$('#runSelfCheck').disabled=false;$('#stopSelfCheck').hidden=true;renderAll();
  toast(selfCheck.stop?'Self-check stopped':summarizeSelfCheck(results).label);
}
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
  $('#runArgs').value=JSON.stringify(sample,null,2); $('#runError').textContent=''; openDialog($('#runDialog'));
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
  return api('/api/mcp',{endpoint:server.endpoint,token:state.tokens.get(server.id)||'',sessionKey:sessionKeyFor(server.id),method:'tools/call',params:{name:tool.name,arguments:args},initialize:server.status!=='connected',runGrant:grant?.token||'',runTarget:grant?.target||'',deepSearch:Boolean(options.deepSearch),timeoutMs:options.timeoutMs},{signal:options.signal});
}


export {allTools,tierBadge,renderTools,selfCheck,renderSelfCheck,runSelfCheck,openTool,runBlockedReason,requestRunGrant,runTool,callTool};
