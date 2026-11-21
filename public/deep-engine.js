import {classifyToolResult} from './result-classifier.js';
import {adaptToolResult,trimRaw} from './deep-adapters.js';
import {linkFindings} from './deep-linking.js';
import {deepArgs,deepToolsFor,isPersonType,isReservedIp,normalizeIdentifier} from './deep-search.js';

export const MAX_ROUNDS=3;
export const MAX_IDENTIFIERS=25;
export const PASSIVE_CONCURRENCY=4;
export const MAX_RUN_RAW_BYTES=20_000_000;
export const SKIPPED_PUBLIC_ONLY='Only covers public internet addresses.';

// Servers that run one tool at a time. omega-mcp's tools are plain functions that FastMCP calls on its event loop, so
// calls sent together wait in Omega's queue, where a call can time out here and then still run with nobody waiting
// for it. Deep Search sends these servers one call at a time, so each call's timeout covers only its own run.
export const ONE_AT_A_TIME_SERVERS=new Set(['Omega MCP']);

const identifierKey=identifier=>`${identifier.type}:${identifier.value}`;
const callKey=task=>`${task.tool.serverName}::${task.tool.name}::${identifierKey(task.identifier)}`;
const sleepTick=()=>Promise.resolve();
// Raw results are JSON text, and the saved run stores that text inside JSON again, which escapes it a second time.
// They are counted as saved, so a run at the raw limit still fits what the results store accepts.
const storedBytes=text=>new TextEncoder().encode(JSON.stringify(text)).byteLength;

// Runs the work given to it one after another, in the order given.
function oneAtATime(){
  let tail=Promise.resolve();
  return work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
}

// At most PASSIVE_CONCURRENCY passive calls run at once. Tools of a one-at-a-time server get a lane of their own, so
// they never hold the shared workers while they wait for that server.
async function passivePool(tasks,worker,signal){
  const lanes=new Map();const shared=[];
  for(const task of tasks){
    const server=task.tool.serverName;
    if(!ONE_AT_A_TIME_SERVERS.has(server)){shared.push(task);continue;}
    if(!lanes.has(server))lanes.set(server,[]);
    lanes.get(server).push(task);
  }
  const drain=async queue=>{while(queue.length&&!signal?.aborted)await worker(queue.shift(),null);};
  const sharedWorkers=Math.min(shared.length,Math.max(1,PASSIVE_CONCURRENCY-lanes.size));
  await Promise.all([...Array.from({length:sharedWorkers},()=>drain(shared)),...[...lanes.values()].map(drain)]);
}

function chunks(values,size=25){
  const out=[];for(let index=0;index<values.length;index+=size)out.push(values.slice(index,index+size));return out;
}

function byIdentifier(tasks){
  const groups=new Map();
  for(const task of tasks){const key=identifierKey(task.identifier);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(task);}
  return[...groups.values()];
}

function resultText(result){
  try{return JSON.stringify(result??null);}catch{return JSON.stringify({isError:true,content:[{type:'text',text:'The tool returned a value that could not be serialized.'}]});}
}

export async function runDeepSearch(options={}){
  const target=normalizeIdentifier(options.target);
  if(!target)throw new Error('Deep Search needs a supported target.');
  const level=Math.max(0,Math.min(3,Number(options.level)||0));
  const tools=Array.isArray(options.tools)?options.tools:[];
  const excluded=options.excluded||new Set();
  const confirmation=options.confirmation||{acknowledged:true};
  const callTool=options.callTool;
  if(typeof callTool!=='function')throw new Error('Deep Search needs a tool caller.');
  const requestGrant=options.requestGrant;
  const releaseGrants=options.releaseGrants||(()=>{});
  const signal=options.signal;
  const onEvent=typeof options.onEvent==='function'?options.onEvent:()=>{};
  const now=options.now||(()=>Date.now());
  const id=String(options.id||globalThis.crypto?.randomUUID?.()||`deep-${now()}`);
  const startedMs=now();
  const startedAt=new Date(startedMs).toISOString();
  const person=isPersonType(target.type);
  const calls=[];const raw={};const adapted=[];const madeCalls=new Set();
  const searched=[];const searchedKeys=new Set();const leadsNotFollowed=[];
  let pending=[target];let round=0;let total=0;let rawBytes=0;let linkedResult={findings:[],leads:[]};

  const countsEvent=()=>{
    const linked=linkedResult.findings.filter(finding=>finding.status==='linked').length;
    const possible=linkedResult.findings.filter(finding=>finding.status==='possible').length;
    onEvent({type:'counts',linked,possible,done:calls.length,total});
  };

  const serverLocks=new Map();
  const lockFor=server=>{
    if(!ONE_AT_A_TIME_SERVERS.has(server))return work=>work();
    if(!serverLocks.has(server))serverLocks.set(server,oneAtATime());
    return serverLocks.get(server);
  };

  const recordTask=async(task,grantToken=null,allowRenew=true)=>{
    if(signal?.aborted)return;
    let started=now();let stopped=false;
    let response;let grantRefused=false;
    try{
      // A one-at-a-time server's call starts (and its timeout starts) only once the server is free.
      response=await lockFor(task.tool.serverName)(()=>{
        if(signal?.aborted){stopped=true;return null;}
        started=now();onEvent({type:'tool-start',tool:task.tool,identifier:task.identifier});
        return callTool(task.tool,task.args,{grant:grantToken,deepSearch:true,timeoutMs:task.timeoutMs,signal});
      });
    }
    catch(error){grantRefused=error?.code==='RUN_GRANT';response={error:{message:error?.message||String(error)}};}
    // Stopped while waiting for the server: the call never started, so there is nothing to record.
    if(stopped)return;
    // Renew only when Public Desk refused the grant itself (it does that before running anything). A tool's own error
    // can mention permission too, and that tool already ran: renewing would run it again on the same confirmation.
    // An error a tool returns can't claim the code, since only a thrown refusal from the server sets grantRefused.
    if(grantRefused&&grantToken&&allowRenew&&typeof requestGrant==='function'&&!signal?.aborted){
      // A refused renewal keeps the tool's own error below; it never ends the whole run.
      let renewed=null;
      try{renewed=await requestGrant({target:task.identifier.value,level:task.risk.level,runId:id,ttlMs:30*60_000,tools:[{tool:task.tool,args:task.args}],confirmation:task.confirmation});}catch{}
      if(renewed?.token)return recordTask(task,renewed.token,false);
    }
    const ms=Math.max(0,now()-started);let outcome='error';let error='';
    if(response?.error){error=String(response.error.message||'Tool call failed');}
    else{
      const result=response?.result;
      const requested=Math.min(1_000_000,Math.max(0,MAX_RUN_RAW_BYTES-rawBytes));
      if(requested>0){
        const trimmed=trimRaw(resultText(result),requested);raw[callKey(task)]=trimmed.text;rawBytes+=storedBytes(trimmed.text);
        const classified=classifyToolResult(result);outcome=trimmed.trimmed?'trimmed':classified.kind;
      }else outcome='trimmed';
      adapted.push(...adaptToolResult({name:task.tool.name,serverName:task.tool.serverName},result,task.identifier));
    }
    calls.push({tool:task.tool.name,serverName:task.tool.serverName,identifier:task.identifier,outcome,error:error||undefined,ms});
    onEvent({type:'tool-end',tool:task.tool,identifier:task.identifier,outcome,ms});
    countsEvent();
  };

  try{
    while(pending.length&&round<(person?MAX_ROUNDS:1)&&!signal?.aborted){
      round+=1;
      onEvent({type:'stage',stage:round===1?'start':'leads',round});
      const current=[];
      for(const identifier of pending){
        const normalized=normalizeIdentifier(identifier);const key=normalized&&identifierKey(normalized);
        if(!normalized||searchedKeys.has(key))continue;
        if(searched.length>=MAX_IDENTIFIERS){leadsNotFollowed.push(normalized);continue;}
        searchedKeys.add(key);searched.push(normalized);current.push(normalized);
      }
      pending=[];
      const tasks=[];const skipped=[];
      for(const identifier of current){
        const taskLevel=person&&identifier.type==='domain'?1:isPersonType(identifier.type)?0:level;
        const taskConfirmation=person&&identifier.type==='domain'?{acknowledged:true}:confirmation;
        for(const picked of deepToolsFor(tools,{type:identifier.type,level:taskLevel,excluded})){
          const task={...picked,identifier,args:deepArgs(picked.tool,identifier),confirmation:taskConfirmation};
          const key=callKey(task);if(madeCalls.has(key))continue;madeCalls.add(key);
          // A tool that only knows public internet addresses can't answer for a private or reserved IP: record it
          // as skipped, with the reason, rather than calling it and showing a failure.
          if(picked.publicIpOnly&&identifier.type==='ip'&&isReservedIp(identifier.value))skipped.push(task);
          else tasks.push(task);
        }
      }
      total+=tasks.length+skipped.length;
      for(const task of skipped){
        calls.push({tool:task.tool.name,serverName:task.tool.serverName,identifier:task.identifier,outcome:'skipped',error:SKIPPED_PUBLIC_ONLY,ms:0});
        onEvent({type:'tool-end',tool:task.tool,identifier:task.identifier,outcome:'skipped',ms:0});
      }
      countsEvent();
      const passive=tasks.filter(task=>task.risk.level===0);
      const controlled=tasks.filter(task=>task.risk.level>0);
      // A permission that can't be had fails only the tools it was for, with the reason; the rest of the run carries on
      // and keeps everything already found.
      const refuse=(chunk,message)=>{
        for(const task of chunk){
          calls.push({tool:task.tool.name,serverName:task.tool.serverName,identifier:task.identifier,outcome:'error',error:message,ms:0});
          onEvent({type:'tool-end',tool:task.tool,identifier:task.identifier,outcome:'error',ms:0});
        }
        countsEvent();
      };
      const controlledRun=async()=>{
        for(const group of byIdentifier(controlled)){
          for(const chunk of chunks(group,25)){
            if(signal?.aborted)break;
            if(typeof requestGrant!=='function'){refuse(chunk,'A confirmed Deep Search permission is required for target-contacting tools.');continue;}
            let grant;
            try{grant=await requestGrant({target:chunk[0].identifier.value,level:Math.max(...chunk.map(task=>task.risk.level)),runId:id,ttlMs:30*60_000,tools:chunk.map(task=>({tool:task.tool,args:task.args})),confirmation:chunk[0].confirmation});}
            catch(error){refuse(chunk,`Permission to run this tool was not given: ${error?.message||String(error)}`);continue;}
            for(const task of chunk){if(signal?.aborted)break;await recordTask(task,grant?.token);}
          }
        }
      };
      await Promise.all([passivePool(passive,recordTask,signal),controlledRun()]);
      linkedResult=linkFindings(adapted,target,{searched});countsEvent();
      if(!person||signal?.aborted)break;
      const newLeads=[];
      // Leads found in the last round can't be followed any more, so they are listed as not followed, not announced.
      const lastRound=round>=MAX_ROUNDS;
      for(const lead of linkedResult.leads){
        const normalized=normalizeIdentifier(lead);const key=normalized&&identifierKey(normalized);
        if(!normalized||searchedKeys.has(key)||newLeads.some(item=>identifierKey(item)===key))continue;
        if(lastRound||searched.length+newLeads.length>=MAX_IDENTIFIERS)leadsNotFollowed.push(normalized);
        else{newLeads.push(normalized);onEvent({type:'lead',identifier:normalized,from:target});}
      }
      pending=newLeads;
      await sleepTick();
    }
    onEvent({type:'stage',stage:'finish',round});
    linkedResult=linkFindings(adapted,target,{searched});countsEvent();
  }finally{
    await releaseGrants(id);
  }

  const outcome=signal?.aborted?'stopped':'completed';
  const finishedAt=new Date(now()).toISOString();
  const record={id,target,level,startedAt,finishedAt,outcome,rounds:round,calls,findings:linkedResult.findings,
    leadsNotFollowed:dedupeIdentifiers(leadsNotFollowed),raw,identifiersSearched:searched.length};
  onEvent({type:'done',outcome});
  return record;
}

function dedupeIdentifiers(values){
  const map=new Map();for(const value of values){const normalized=normalizeIdentifier(value);if(normalized)map.set(identifierKey(normalized),normalized);}return[...map.values()];
}
