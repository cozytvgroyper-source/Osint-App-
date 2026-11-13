import {classifyToolResult,parseToolResult} from './result-classifier.js';
import {extractIndicatorLists} from './search-dedup.js';

const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN=/https?:\/\/[^\s<>"'\])}]+/gi;
const PHONE=/\+\d{7,15}\b/g;
const VALID_KINDS=new Set(['account','breach','fact','host','problem','lead']);

const emptyEvidence=()=>({emails:[],usernames:[],phones:[],urls:[],names:[],places:[]});
const unique=values=>[...new Set(values.filter(Boolean).map(value=>String(value).trim()).filter(Boolean))];
const source=tool=>({name:String(tool?.name||'Unknown tool'),serverName:String(tool?.serverName||'Unknown MCP server')});

function stableHash(text){
  let hash=2166136261;
  for(const char of String(text)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
}

function finding(tool,subject,kind,main,extra={}){
  const toolSource=source(tool);
  return {id:`deep-${stableHash(`${toolSource.serverName}|${toolSource.name}|${kind}|${main}`)}`,kind,subject:{...subject},tool:toolSource,evidence:emptyEvidence(),...extra};
}

function textOf(result){
  return (Array.isArray(result?.content)?result.content:[]).map(part=>part?.text).filter(value=>typeof value==='string').join('\n');
}

function dataFor(result){
  const classified=classifyToolResult(result);
  return classified.kind==='data'?classified.data:null;
}

function collectEvidence(value,evidence=emptyEvidence(),key=''){
  if(value===null||value===undefined)return evidence;
  if(Array.isArray(value)){for(const item of value)collectEvidence(item,evidence,key);return evidence;}
  if(typeof value==='object'){
    for(const [childKey,child] of Object.entries(value))collectEvidence(child,evidence,childKey);
    return evidence;
  }
  const text=String(value);
  evidence.emails.push(...(text.match(EMAIL)||[]));
  evidence.urls.push(...(text.match(URL_PATTERN)||[]));
  evidence.phones.push(...(text.match(PHONE)||[]));
  if(/^(?:username|handle|login|screen_?name)$/i.test(key))evidence.usernames.push(text.replace(/^@/,''));
  if(/^(?:full_?name|display_?name|real_?name|name)$/i.test(key))evidence.names.push(text);
  if(/^(?:location|place|city|country)$/i.test(key))evidence.places.push(text);
  return evidence;
}

function cleanEvidence(evidence){
  return Object.fromEntries(Object.entries(evidence).map(([key,values])=>[key,unique(values)]));
}

function hostFromUrl(value){
  try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return'';}
}

export function accountCategory(site=''){
  const host=String(site).toLowerCase();
  if(/github|gitlab|bitbucket|pypi|npmjs|stackoverflow|stackexchange|code\./.test(host))return'developer';
  if(/twitter|x\.com|instagram|facebook|tiktok|mastodon|bsky|bluesky|linkedin|reddit|youtube|pinterest|7cups/.test(host))return'social';
  if(/forum|community|discourse|phpbb|hackernews|news\.ycombinator/.test(host))return'forums';
  if(/amazon|ebay|etsy|depop|vinted|wish/.test(host))return'shopping';
  return'other';
}

function accountFinding(tool,subject,{site,url='',displayName='',verified=false,evidence=emptyEvidence()}){
  const host=hostFromUrl(url)||site;
  return finding(tool,subject,'account',url||site,{
    evidence:cleanEvidence({...emptyEvidence(),...evidence,urls:unique([...(evidence.urls||[]),url])}),
    account:{site:String(site||host||'Account'),url:String(url||''),...(displayName?{displayName:String(displayName)}:{}),category:accountCategory(host),verified:Boolean(verified)}
  });
}

function holeheAdapter(tool,result,subject){
  const text=textOf(result);const out=[];
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\[\+\]\s*(.+?)\s*$/);
    if(!match||/^email used/i.test(match[1]))continue;
    out.push(accountFinding(tool,subject,{site:match[1],verified:true,evidence:{...emptyEvidence(),emails:[subject.value]}}));
  }
  return out;
}

function lineAccounts(tool,result,subject){
  const out=[];
  for(const line of textOf(result).split(/\r?\n/)){
    const match=line.match(/(?:\[\+\]|✔️?)\s*(?:\[([^\]]+)\]|([^:]+):)\s*(https?:\/\/\S+)/u);
    if(!match)continue;
    const url=match[3].replace(/[),.;]+$/,'');
    if(/osintsearch\.org/.test(url))continue;
    out.push(accountFinding(tool,subject,{site:(match[1]||match[2]||hostFromUrl(url)).trim(),url,verified:false}));
  }
  return out;
}

function maigretAdapter(tool,result,subject){
  const data=parseToolResult(result);
  if(!data||typeof data!=='object'||Array.isArray(data))return[];
  const out=[];
  for(const [site,entry] of Object.entries(data)){
    if(!entry||typeof entry!=='object'||typeof entry.url!=='string')continue;
    const evidence=cleanEvidence(collectEvidence(entry));
    out.push(accountFinding(tool,subject,{site,url:entry.url,displayName:evidence.names[0]||'',verified:false,evidence}));
  }
  return out;
}

function ghuntAdapter(tool,result,subject){
  const data=dataFor(result);
  if(!data||typeof data!=='object')return[];
  const evidence=cleanEvidence(collectEvidence(data));
  evidence.emails=unique([...evidence.emails,subject.value]);
  const out=[];
  const name=data.name||data.displayName||data.full_name;
  if(name)out.push(finding(tool,subject,'fact',`name:${name}`,{evidence:{...emptyEvidence(),emails:[subject.value],names:[String(name)]},fact:{label:'Name',value:String(name),group:'owner'}}));
  const url=data.profile_url||data.profileUrl||data.url;
  if(url)out.push(accountFinding(tool,subject,{site:'Google',url,displayName:name||'',verified:true,evidence}));
  return out;
}

function breachAdapter(tool,result,subject){
  const data=dataFor(result);const breaches=Array.isArray(data?.breaches)?data.breaches:[];
  return breaches.map((entry,index)=>{
    const name=typeof entry==='string'?entry:entry?.name||entry?.title||`Breach ${index+1}`;
    const date=typeof entry==='object'?(entry.date||entry.year||entry.breach_date):undefined;
    return finding(tool,subject,'breach',`${name}:${date||''}`,{evidence:{...emptyEvidence(),emails:subject.type==='email'?[subject.value]:[]},breach:{name:String(name),...(date?{date:String(date)}:{})}});
  });
}

function profileTextAdapter(tool,result,subject){
  const text=textOf(result);if(!text)return[];
  const urls=unique(text.match(URL_PATTERN)||[]);const allEvidence=cleanEvidence(collectEvidence(text));
  return urls.filter(url=>!/^https?:\/\/example\.com\/(?:avatar|linked-profile)/.test(url)).slice(0,250).map(url=>accountFinding(tool,subject,{
    site:hostFromUrl(url),url,verified:false,evidence:{...emptyEvidence(),emails:allEvidence.emails,usernames:subject.type==='username'?[subject.value]:[],phones:allEvidence.phones,urls:[url],names:allEvidence.names,places:allEvidence.places}
  }));
}

function phoneAdapter(tool,result,subject){
  const text=textOf(result);if(!text)return[];
  const evidence=cleanEvidence(collectEvidence(text));
  evidence.phones=unique([...evidence.phones,subject.value]);
  return[finding(tool,subject,'fact','phone-summary',{evidence,fact:{label:'Phone information',value:text.slice(0,2_000),group:'other'}})];
}

const riskyPorts=new Set([21,22,23,25,110,139,143,445,1433,1521,2375,3306,3389,5432,5900,6379,9200,11211,27017]);
function portsAdapter(tool,result,subject){
  const data=dataFor(result);const ports=Array.isArray(data?.ports)?data.ports:[];
  return ports.map(item=>{
    const port=Number(typeof item==='object'?item.port:item);const service=typeof item==='object'?(item.service||item.name||'service'):'service';
    const high=riskyPorts.has(port);
    return finding(tool,subject,'problem',`port:${port}`,{problem:{severity:high?'high':'medium',title:`Open port ${port}`,meaning:`${service} is reachable from the tested network.`,fix:'Confirm the service is needed, restrict access, and keep it patched.'}});
  });
}

function spoofAdapter(tool,result,subject){
  const data=dataFor(result);if(!data||typeof data!=='object')return[];
  const out=[];
  if(data.spf?.found===false)out.push(finding(tool,subject,'problem','missing-spf',{problem:{severity:'medium',title:'SPF is missing',meaning:'Email receivers lack an SPF instruction for this domain.',fix:'Publish a correct SPF record.'}}));
  if(data.dmarc?.found===false||!data.dmarc?.policy||/none/i.test(data.dmarc.policy))out.push(finding(tool,subject,'problem','weak-dmarc',{problem:{severity:'medium',title:'DMARC is not enforced',meaning:'The domain does not strongly reject spoofed mail.',fix:'Publish DMARC and move toward quarantine or reject after monitoring.'}}));
  return out;
}

function indicatorFindings(tool,data,subject){
  if(!data||typeof data!=='object')return[];
  const extracted=extractIndicatorLists(data);const out=[];
  for(const item of extracted.findings){
    if(item.type==='emailAddresses')out.push(finding(tool,subject,'lead',`email:${item.normalized}`,{evidence:{...emptyEvidence(),emails:[item.normalized]},lead:{type:'email',value:item.normalized}}));
    else if(item.type==='domains')out.push(finding(tool,subject,'host',`domain:${item.normalized}`,{host:{value:item.normalized,relation:'related'}}));
    else if(item.type==='ipAddresses')out.push(finding(tool,subject,'host',`ip:${item.normalized}`,{host:{value:item.normalized,relation:'ip'}}));
    else if(item.type==='urls')out.push(finding(tool,subject,'host',`url:${item.normalized}`,{evidence:{...emptyEvidence(),urls:[item.normalized]},host:{value:item.normalized,relation:'related'}}));
  }
  return out;
}

function genericAdapter(tool,result,subject){
  const data=dataFor(result);if(data===null)return[];
  const out=indicatorFindings(tool,data,subject);
  const evidence=cleanEvidence(collectEvidence(data));
  for(const email of evidence.emails){
    if(email.toLowerCase()===String(subject.value).toLowerCase())continue;
    out.push(finding(tool,subject,'lead',`email:${email.toLowerCase()}`,{evidence:{...emptyEvidence(),emails:[email.toLowerCase()]},lead:{type:'email',value:email.toLowerCase()}}));
  }
  if(data&&typeof data==='object'&&!Array.isArray(data)){
    for(const [key,value] of Object.entries(data)){
      if(/^(?:query|target|status|success|ok|durationMs|count|total|cmd)$/i.test(key))continue;
      if(['string','number','boolean'].includes(typeof value)&&String(value).trim()&&String(value)!==String(subject.value))
        out.push(finding(tool,subject,'fact',`${key}:${value}`,{evidence,fact:{label:key,value:String(value).slice(0,2_000),group:'other'}}));
    }
  }else if(typeof data==='string'&&data.trim()&&data.trim()!==String(subject.value)){
    out.push(finding(tool,subject,'fact',data.slice(0,200),{evidence,fact:{label:'Result',value:data.slice(0,2_000),group:'other'}}));
  }
  return dedupe(out);
}

function dedupe(findings){
  const map=new Map();
  for(const item of findings)if(VALID_KINDS.has(item.kind)&&!map.has(item.id))map.set(item.id,item);
  return[...map.values()];
}

export const ADAPTERS=Object.freeze({
  holehe_email_search:holeheAdapter,
  sherlock_username_search:lineAccounts,
  blackbird_username_search:lineAccounts,
  maigret_username_search:maigretAdapter,
  ghunt_google_search:ghuntAdapter,
  omega_breach:breachAdapter,
  omega_identity:profileTextAdapter,
  omega_socmint:profileTextAdapter,
  phoneinfoga_scan:phoneAdapter,
  omega_phoneosint:phoneAdapter,
  omega_ports:portsAdapter,
  omega_spoofcheck:spoofAdapter,
  omega_mailsec:spoofAdapter
});

export function adaptToolResult(tool,result,subject){
  try{
    const adapter=ADAPTERS[tool?.name]||genericAdapter;
    return dedupe(adapter(tool,result,subject)||[]);
  }catch{return[];}
}

export function trimRaw(value,maxBytes=1_000_000){
  const text=typeof value==='string'?value:JSON.stringify(value??null);
  const bytes=new TextEncoder().encode(text);
  if(bytes.byteLength<=maxBytes)return{text,trimmed:false};
  const note='\n[Trimmed by Public Desk]';
  const noteBytes=new TextEncoder().encode(note);
  // Leave room for a replacement character if the byte slice ends inside a multi-byte code point.
  const kept=bytes.slice(0,Math.max(0,maxBytes-noteBytes.byteLength-4));
  return{text:new TextDecoder().decode(kept)+note,trimmed:true};
}
