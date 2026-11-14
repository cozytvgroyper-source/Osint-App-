// Search page: planning and running a search, and uploaded files.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import {explainSearchPlan,summarizePlanDiagnostics} from '../search-planner.js?v=1';
import {emptyState,escapeHtml} from '../ui.js?v=6';
import {classifyToolResult,hasUsefulData,parseToolResult} from '../result-classifier.js';
import {buildSearchReport} from '../search-report.js?v=4';
import {argsForSearch,extractTarget,searchIntent,searchSubjectFor} from '../search-query.js?v=1';
import {$,state,diagnosticsEnabled,toast,iconFor,api,renderAll} from './core.js';
import {connect,noteToolHealth} from './servers.js';
import {allTools,callTool} from './tools.js';
import {recordHistory} from './evidence.js';
import {sourceLabel,showResult,updateOpenResult,categoryForTool} from './results.js';

let latestSearchId=0;
// Recent searches: a main search (it has a source log) can be run again; file analyses and single tool runs cannot,
// since rerunning their title as a text search would do something else.
function renderRecentSearches(){
  const items=state.history.slice(0,5).map(item=>{
    const body=`<span class="mini-icon" aria-hidden="true">${iconFor(item.title)}</span><span class="history-text"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.server||'Local workspace')}</small></span><time datetime="${escapeHtml(item.time||'')}">${new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>`;
    return Array.isArray(item.sourceLog)?`<button type="button" class="history-item" data-rerun="${escapeHtml(item.title)}"><span class="visually-hidden">Search again: </span>${body}</button>`:`<div class="history-item">${body}</div>`;
  });
  $('#history').innerHTML=items.length?items.join(''):emptyState({title:'No searches yet',text:'Your searches will appear here so you can run them again.'});
}
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
  const reportOptions={query,intent,plan,outcomes,diagnostics:diagnosticsEnabled?summarizePlanDiagnostics(explained):null,links:relatedLinks(intent,query),categoryForTool,sourceLabel,subject:searchSubjectFor(query),preferredNames:intent.tools,target:!!extractTarget(query)};
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


export {latestSearchId,renderRecentSearches,relatedLinks,formatBytes,fileAsDataUrl,clearSelectedFile,analyzeSelectedFile,smartInvestigate};
