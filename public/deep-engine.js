import {classifyToolResult} from './result-classifier.js';
import {adaptToolResult,trimRaw} from './deep-adapters.js';
import {linkFindings} from './deep-linking.js';
import {deepArgs,deepToolsFor,isPersonType,isReservedIp,normalizeIdentifier} from './deep-search.js';

export const MAX_ROUNDS=3;
export const MAX_IDENTIFIERS=25;
export const PASSIVE_CONCURRENCY=4;
export const MAX_RUN_RAW_BYTES=20_000_000;
export const SKIPPED_PUBLIC_ONLY='Only covers public internet addresses.';

const identifierKey=identifier=>`${identifier.type}:${identifier.value}`;
const callKey=task=>`${task.tool.serverName}::${task.tool.name}::${identifierKey(task.identifier)}`;
const sleepTick=()=>Promise.resolve();

async function passivePool(tasks,worker,signal){
  let index=0;
  const run=async()=>{
    while(index<tasks.length&&!signal?.aborted){
      const task=tasks[index++];
      await worker(task,null);
    }
  };
  await Promise.all(Array.from({length:Math.min(PASSIVE_CONCURRENCY,tasks.length)},run));
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

  const recordTask=async(task,grantToken=null,allowRenew=true)=>{
    if(signal?.aborted)return;
    const started=now();onEvent({type:'tool-start',tool:task.tool,identifier:task.identifier});
    let response;
    try{response=await callTool(task.tool,task.args,{grant:grantToken,deepSearch:true,timeoutMs:task.timeoutMs,signal});}
    catch(error){response={error:{message:error?.message||String(error)}};}
    if(response?.error&&grantToken&&allowRenew&&/grant|permission|expired|confirmed/i.test(String(response.error.message||''))&&typeof requestGrant==='function'&&!signal?.aborted){
      const renewed=await requestGrant({target:task.identifier.value,level:task.risk.level,runId:id,ttlMs:30*60_000,tools:[{tool:task.tool,args:task.args}],confirmation:task.confirmation});
      return recordTask(task,renewed?.token,false);
    }
    const ms=Math.max(0,now()-started);let outcome='error';let error='';
    if(response?.error){error=String(response.error.message||'Tool call failed');}
    else{
      const result=response?.result;
      const requested=Math.min(1_000_000,Math.max(0,MAX_RUN_RAW_BYTES-rawBytes));
      if(requested>0){
        const trimmed=trimRaw(resultText(result),requested);raw[callKey(task)]=trimmed.text;rawBytes+=new TextEncoder().encode(trimmed.text).byteLength;
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
      const controlledRun=async()=>{
        for(const group of byIdentifier(controlled)){
          for(const chunk of chunks(group,25)){
            if(signal?.aborted)break;
            if(typeof requestGrant!=='function')throw new Error('A confirmed Deep Search permission is required for target-contacting tools.');
            const grant=await requestGrant({target:chunk[0].identifier.value,level:Math.max(...chunk.map(task=>task.risk.level)),runId:id,ttlMs:30*60_000,tools:chunk.map(task=>({tool:task.tool,args:task.args})),confirmation:chunk[0].confirmation});
            for(const task of chunk){if(signal?.aborted)break;await recordTask(task,grant?.token);}
          }
        }
      };
      await Promise.all([passivePool(passive,recordTask,signal),controlledRun()]);
      linkedResult=linkFindings(adapted,target,{searched});countsEvent();
      if(!person||signal?.aborted)break;
      const newLeads=[];
      for(const lead of linkedResult.leads){
        const normalized=normalizeIdentifier(lead);const key=normalized&&identifierKey(normalized);
        if(!normalized||searchedKeys.has(key)||newLeads.some(item=>identifierKey(item)===key))continue;
        if(searched.length+newLeads.length>=MAX_IDENTIFIERS)leadsNotFollowed.push(normalized);
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
