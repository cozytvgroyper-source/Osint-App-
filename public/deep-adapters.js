import {classifyToolResult,parseToolResult} from './result-classifier.js';
import {extractIndicatorLists} from './search-dedup.js';

const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN=/https?:\/\/[^\s<>"'\\\])}]+/gi;
const PHONE=/\+\d{7,15}\b/g;
const VALID_KINDS=new Set(['account','breach','fact','host','problem','lead']);

const emptyEvidence=()=>({emails:[],usernames:[],phones:[],urls:[],names:[],places:[]});
const emptyDetails=()=>({names:[],usernames:[],emails:[],phones:[],ips:[],websites:[],places:[]});
const IMAGE_KEY=/^(?:image|image_bg|avatar|photo|picture)$/i;
const IMAGE_VALUE=/\.(?:jpe?g|png|gif|webp|svg)$/i;
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

// Omega tools wrap their answer as {"status":"ok","result":"…"}; read the inner text so escaped line breaks become real ones.
export function unwrapText(result){
  const text=textOf(result);
  try{
    const parsed=JSON.parse(text);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
      if(typeof parsed.result==='string')return parsed.result;
      if(typeof parsed.output==='string')return parsed.output;
    }
  }catch{}
  return text;
}

export function cleanUrl(value){
  let text=String(value??'').trim();let previous;
  do{previous=text;text=text.replace(/(?:\\[nrt]|\\)+$/,'').replace(/[.,;)\]]+$/,'');}while(text!==previous);
  return text;
}

const extractUrls=text=>(String(text).match(URL_PATTERN)||[]).map(cleanUrl).filter(Boolean);

// Known data addresses (JSON/API endpoints) mapped to the public profile page they describe.
const PAGE_RULES=[
  [/^https?:\/\/(?:www\.|old\.)?reddit\.com\/user\/([^/?#]+)\/about\.js(?:on)?(?:[?#]|$)/i,user=>`https://www.reddit.com/user/${user}`],
  [/^https?:\/\/hacker-news\.firebaseio\.com\/v0\/user\/([^/?#]+?)\.jso(?:n)?(?:[?#]|$)/i,user=>`https://news.ycombinator.com/user?id=${user}`],
  [/^https?:\/\/dev\.to\/api\/users\/by_username\?(?:[^#]*&)?url=([^&#]+)/i,user=>`https://dev.to/${user}`],
  [/^https?:\/\/(?:en\.)?gravatar\.com\/([^/?#]+)\.json(?:[?#]|$)/i,user=>`https://gravatar.com/${user}`],
  [/^https?:\/\/hub\.docker\.com\/v2\/users\/([^/?#]+)\/?(?:[?#]|$)/i,user=>`https://hub.docker.com/u/${user}`],
  [/^https?:\/\/api\.twitch\.tv\/helix\/users\?(?:[^#]*&)?login=([^&#]+)/i,user=>`https://www.twitch.tv/${user}`]
];

export function profilePageUrl(value){
  const raw=String(value??'').trim();
  if(!raw)return{url:'',rawUrl:''};
  for(const [pattern,page] of PAGE_RULES){
    const match=raw.match(pattern);
    if(match)return{url:page(match[1]),rawUrl:raw};
  }
  let parsed;
  try{parsed=new URL(raw);}catch{return{url:'',rawUrl:raw};}
  const host=parsed.hostname.toLowerCase();const pathname=parsed.pathname.toLowerCase();
  if(host.startsWith('api.')||host.includes('firebaseio')||pathname.includes('/api/')||pathname.endsWith('.json'))return{url:'',rawUrl:raw};
  return{url:raw,rawUrl:''};
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
  evidence.urls.push(...extractUrls(text));
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

const sameUrl=(a,b)=>Boolean(a&&b)&&cleanUrl(a).toLowerCase().replace(/\/+$/,'')===cleanUrl(b).toLowerCase().replace(/\/+$/,'');

// Details hold only what the account's own profile says: never its own address, images, or the searched value.
function cleanDetails(details,{url,rawUrl,subject}){
  const searched=String(subject?.value??'').trim().toLowerCase();
  const keep=value=>{
    const text=String(value).trim();
    if(!text||text.toLowerCase().replace(/^@/,'')===searched)return false;
    if(IMAGE_VALUE.test(text.replace(/[?#].*$/,'')))return false;
    if(sameUrl(text,url)||sameUrl(text,rawUrl))return false;
    return true;
  };
  return Object.fromEntries(Object.keys(emptyDetails()).map(key=>[key,unique((details?.[key]||[]).map(value=>String(value).trim())).filter(keep)]));
}

function accountFinding(tool,subject,{site,url='',displayName='',verified=false,evidence=emptyEvidence(),presence='found',presenceNote='',details=emptyDetails()}){
  const page=profilePageUrl(cleanUrl(url));
  const host=hostFromUrl(page.url||page.rawUrl)||site;
  const evidenceUrl=page.rawUrl||page.url;
  return finding(tool,subject,'account',evidenceUrl||site,{
    evidence:cleanEvidence({...emptyEvidence(),...evidence,urls:unique([...(evidence.urls||[]),evidenceUrl])}),
    account:{
      site:String(site||host||'Account'),url:page.url,...(page.rawUrl?{rawUrl:page.rawUrl}:{}),
      ...(displayName?{displayName:String(displayName)}:{}),category:accountCategory(host),verified:Boolean(verified),
      presence,...(presenceNote?{presenceNote:String(presenceNote)}:{}),
      details:cleanDetails(details,{url:page.url,rawUrl:page.rawUrl,subject})
    }
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
    const url=cleanUrl(match[3]);
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
    out.push(accountFinding(tool,subject,{site,url:entry.url,displayName:evidence.names[0]||'',verified:false,evidence,details:maigretDetails(entry.data,subject)}));
  }
  return out;
}

function maigretDetails(data,subject){
  const details=emptyDetails();
  if(!data||typeof data!=='object'||Array.isArray(data))return details;
  const searched=String(subject?.value??'').trim().toLowerCase();
  for(const [key,value] of Object.entries(data)){
    if(value===null||value===undefined||IMAGE_KEY.test(key))continue;
    const values=(Array.isArray(value)?value:[value]).filter(item=>item!==null&&typeof item!=='object').map(String);
    if(/^(?:fullname|name)$/i.test(key))details.names.push(...values);
    if(/^links$/i.test(key))details.websites.push(...values.flatMap(item=>item.split(/[\s,]+/)).map(cleanUrl).filter(item=>/^https?:\/\//i.test(item)));
    if(/^location$/i.test(key))details.places.push(...values);
    if(/^(?:username|nickname|login)$/i.test(key))details.usernames.push(...values.map(item=>item.trim().replace(/^@/,'')).filter(item=>item.toLowerCase()!==searched));
    for(const item of values){
      details.emails.push(...(item.match(EMAIL)||[]));
      details.phones.push(...(item.match(PHONE)||[]));
    }
  }
  return details;
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

// Evidence for a table answer: what the tool said, minus the searched username echoed back.
function tableEvidence(text,subject,url){
  const all=cleanEvidence(collectEvidence(text));
  return {...emptyEvidence(),emails:all.emails,phones:all.phones,urls:[url],names:all.names,places:all.places};
}

function presenceFor(status,cross){
  if(cross||status==='404')return'not-found';
  if(status==='200')return'found';
  return'unchecked';
}

// omega_socmint: "Platform   Status   URL" rows; 200 found, ❌/404 not found, anything else couldn't check.
function socmintAdapter(tool,result,subject){
  const text=unwrapText(result);if(!text)return[];
  const out=[];
  for(const line of text.split(/\r?\n/)){
    const coded=line.match(/^\s*(\S.*?)\s{2,}(❌\s*)?(\d{3})\s+(https?:\/\/\S+)/u);
    const marked=coded?null:line.match(/^\s*(\S.*?)\s{2,}✅\s*Found\s+(https?:\/\/\S+)/u);
    if(!coded&&!marked)continue;
    const site=(coded||marked)[1].trim();const url=cleanUrl(coded?coded[4]:marked[2]);
    if(!url)continue;
    const presence=coded?presenceFor(coded[3],Boolean(coded[2])):'found';
    out.push(accountFinding(tool,subject,{site,url,verified:false,presence,presenceNote:coded&&presence!=='found'?coded[3]:'',evidence:tableEvidence(text,subject,url)}));
  }
  return out;
}

// omega_identity: a "Found on N platform(s)" list of "Platform   URL" rows, all found.
function identityAdapter(tool,result,subject){
  const text=unwrapText(result);if(!text)return[];
  const lines=text.split(/\r?\n/);
  const start=lines.findIndex(line=>/Found on\s+\d+/i.test(line));
  if(start<0)return[];
  const out=[];
  for(const line of lines.slice(start+1)){
    const match=line.match(/^\s*(\S.*?)\s{2,}(https?:\/\/\S+)/u);
    if(!match)continue;
    const url=cleanUrl(match[2]);if(!url)continue;
    out.push(accountFinding(tool,subject,{site:match[1].trim(),url,verified:false,presence:'found',evidence:tableEvidence(text,subject,url)}));
  }
  return out;
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
  omega_identity:identityAdapter,
  omega_socmint:socmintAdapter,
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
