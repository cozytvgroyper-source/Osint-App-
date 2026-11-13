import {argsForSearch,asciiHosts,extractTarget} from './search-query.js';
import {toolRisk} from './tool-tiers.js';

const tool=(name,options={})=>Object.freeze({name,...options});

// The reviewed tool table; see docs/deep-tool-review.md for why each tool is here or was removed.
// publicIpOnly: the tool only knows public internet addresses, so it is skipped (and shown as skipped) for a
// private or reserved IP.
export const DEEP_TOOLS=Object.freeze({
  email:Object.freeze([
    tool('holehe_email_search'),tool('ghunt_google_search'),tool('omega_email'),tool('omega_breach'),
    tool('omega_identity')
  ]),
  username:Object.freeze([
    tool('maigret_username_search',{timeoutMs:600_000}),
    tool('sherlock_username_search',{timeoutMs:300_000}),
    tool('blackbird_username_search',{timeoutMs:300_000}),
    tool('omega_social'),tool('omega_socmint'),tool('omega_gitrecon'),tool('omega_identity')
  ]),
  phone:Object.freeze([tool('phoneinfoga_scan'),tool('omega_phoneosint')]),
  domain:Object.freeze([
    tool('whois_lookup'),tool('dns_lookup'),tool('crtsh_certificate_search'),tool('wayback_snapshots'),
    tool('dnstwist_lookalike_domains'),tool('theharvester_domain_search'),tool('omega_intel'),tool('omega_spoofcheck'),
    tool('omega_headers'),tool('omega_ssl'),tool('omega_tech'),tool('omega_cors'),tool('omega_mailsec'),
    tool('omega_certhunt'),tool('omega_cvemap'),tool('omega_deepweb'),tool('omega_docosint'),
    tool('omega_harvester'),tool('omega_infra'),tool('omega_opsec'),tool('omega_phishcheck'),tool('omega_screenshot'),
    tool('omega_typosquat'),
    tool('omega_ports'),tool('omega_crawl'),tool('omega_dnsbrute'),tool('omega_subdomains'),tool('dnsrecon_domain_scan'),
    tool('spiderfoot_scan',{timeoutMs:600_000}),tool('omega_recon'),tool('omega_apiosint'),tool('omega_assetmap'),
    tool('omega_attackmap'),tool('omega_buckets'),tool('omega_cloud'),tool('omega_cloud2'),tool('omega_creds'),
    tool('omega_jscan'),tool('omega_secrets'),tool('omega_spider'),tool('omega_webcrawl'),tool('omega_dossier'),
    tool('omega_vuln'),tool('omega_fuzzer'),tool('omega_exfil')
  ]),
  ip:Object.freeze([
    tool('get_bgp'),tool('get_greynoise',{publicIpOnly:true}),tool('get_whois'),tool('omega_ipinfo'),tool('omega_ipdossier'),
    tool('omega_intel'),tool('omega_reverseip'),
    tool('omega_ssl'),tool('omega_headers'),tool('omega_infra'),tool('omega_network'),tool('omega_torcheck'),
    tool('omega_cvemap'),
    tool('omega_ports'),tool('spiderfoot_scan',{timeoutMs:600_000}),tool('omega_recon'),tool('omega_assetmap'),
    tool('omega_attackmap'),tool('omega_c2'),
    tool('omega_vuln'),tool('omega_pivot'),tool('omega_exfil')
  ]),
  cve:Object.freeze([tool('get_nvd_cves'),tool('get_cisa_kev'),tool('get_epss'),tool('omega_cvssrank'),tool('omega_cve')]),
  hash:Object.freeze([tool('get_malwarebazaar'),tool('omega_malware')])
});

const PERSON_TYPES=new Set(['email','username','phone']);
const USERNAME=/^@?[a-z0-9_.-]{2,32}$/i;
// A bare website: optional www., a host, and optionally a path/query. The host is checked with extractTarget.
const WEBSITE_INPUT=/^(?:www\.)?([^\s/?#@]+)(?:[/?#]\S*)?$/i;
const URL_PATTERN=/^https?:\/\//i;

export function normalizeIdentifier(identifier){
  if(!identifier||!identifier.type)return null;
  const type=String(identifier.type).toLowerCase();
  let value=String(identifier.value??'').trim();
  if(['email','username','domain','hash'].includes(type))value=value.toLowerCase();
  if(type==='username')value=value.replace(/^@/,'');
  if(type==='domain')value=value.replace(/^www\./i,'').replace(/\.$/,'');
  if(type==='phone'){
    const digits=value.replace(/\D/g,'');
    value=digits?`+${digits}`:'';
  }
  if(type==='cve')value=value.toUpperCase();
  return value?{type,value}:null;
}

function exactExtractedTarget(text,found){
  if(!found)return false;
  const normal=normalizeIdentifier(found);
  if(!normal)return false;
  if(found.type==='phone')return text.replace(/\D/g,'')===normal.value.slice(1);
  const comparable=found.type==='username'?text.replace(/^@/,''):text;
  return comparable.toLowerCase()===normal.value.toLowerCase();
}

export function detectDeepTarget(input){
  const text=asciiHosts(String(input??'').trim());
  if(!text)return null;
  if(URL_PATTERN.test(text)){
    try{
      const url=new URL(text);
      if(!['http:','https:'].includes(url.protocol))return null;
      const host=url.hostname.replace(/^www\./i,'');
      const found=extractTarget(host);
      return found&&['domain','ip'].includes(found.type)?normalizeIdentifier(found):null;
    }catch{return null;}
  }
  const site=text.match(WEBSITE_INPUT);
  if(site){
    const host=extractTarget(site[1]);
    if(host?.type==='domain')return normalizeIdentifier(host);
  }
  const found=extractTarget(text);
  if(found&&exactExtractedTarget(text,found))return normalizeIdentifier(found);
  if(USERNAME.test(text))return normalizeIdentifier({type:'username',value:text});
  return null;
}

export function isPersonType(type){return PERSON_TYPES.has(String(type));}

// Private, shared, loopback, link-local, documentation, benchmarking, multicast and reserved IPv4 ranges
// (IANA special-purpose registry), as [first address, prefix length].
const RESERVED_V4=[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
  ['224.0.0.0',4],['240.0.0.0',4]];
const OCTET=/^(?:0|[1-9]\d{0,2})$/;

function ipv4Number(value){
  const parts=String(value).split('.');
  if(parts.length!==4||!parts.every(part=>OCTET.test(part)&&Number(part)<=255))return null;
  return parts.reduce((total,part)=>total*256+Number(part),0);
}

function ipv6Hextets(value){
  const text=String(value).toLowerCase();
  if(!/^[0-9a-f:]+$/.test(text)||(text.match(/::/g)||[]).length>1)return null;
  const [head,tail]=text.includes('::')?text.split('::'):[text,null];
  const left=head?head.split(':'):[];const right=tail?tail.split(':'):[];
  const missing=8-left.length-right.length;
  if(tail===null?left.length!==8:missing<1)return null;
  const groups=[...left,...Array(tail===null?0:missing).fill('0'),...right];
  if(!groups.every(group=>/^[0-9a-f]{1,4}$/.test(group)))return null;
  return groups.map(group=>parseInt(group,16));
}

// True when an IP is private or reserved, so internet-wide services (like GreyNoise) know nothing about it.
// Anything that is not a well-formed address is false: the tool then runs and answers for itself.
export function isReservedIp(value){
  try{
    const v4=ipv4Number(value);
    if(v4!==null)return RESERVED_V4.some(([first,bits])=>Math.floor(v4/2**(32-bits))===Math.floor(ipv4Number(first)/2**(32-bits)));
    const v6=ipv6Hextets(value);
    if(!v6)return false;
    const [a,b]=v6;
    if(v6.every(group=>group===0))return true;                     // ::
    if(v6.slice(0,7).every(group=>group===0)&&v6[7]===1)return true; // ::1
    return (a&0xffc0)===0xfe80||(a&0xfe00)===0xfc00||(a===0x2001&&b===0x0db8)||(a&0xff00)===0xff00;
  }catch{return false;}
}

const ARG_OVERRIDES=Object.freeze({
  maigret_username_search:{all_sites:true,timeout:60},
  holehe_email_search:{only_used:true,timeout:30},
  // The installed Sherlock CLI rejects the wrapper's CSV flags; text mode returns the profile URLs reliably.
  sherlock_username_search:{output_format:'txt',timeout:60},
  blackbird_username_search:{timeout:60},
  spiderfoot_scan:{use_case:'all'}
});

export function deepArgs(toolDefinition,identifier){
  const id=normalizeIdentifier(identifier);
  if(!toolDefinition||!id)return{};
  return {...argsForSearch(toolDefinition,id.value),...(ARG_OVERRIDES[toolDefinition.name]||{})};
}

export function deepToolsFor(tools,{type,level=0,excluded=new Set()}={}){
  const entries=DEEP_TOOLS[type]||[];
  const order=new Map(entries.map((entry,index)=>[entry.name,index]));
  const byName=new Map(entries.map(entry=>[entry.name,entry]));
  const allowedLevel=isPersonType(type)?0:Math.max(0,Math.min(3,Number(level)||0));
  return (tools||[]).filter(toolDefinition=>{
    const risk=toolRisk(toolDefinition);
    return order.has(toolDefinition.name)&&risk.reviewed&&risk.level<=allowedLevel&&!risk.flags.length
      &&toolDefinition.annotations?.readOnlyHint!==false&&toolDefinition.annotations?.destructiveHint!==true
      &&!excluded.has(toolDefinition.name)&&!excluded.has(`${toolDefinition.serverName}::${toolDefinition.name}`);
  }).sort((a,b)=>{
    const levelOrder=toolRisk(a).level-toolRisk(b).level;
    return levelOrder||order.get(a.name)-order.get(b.name);
  }).map(toolDefinition=>{
    const entry=byName.get(toolDefinition.name);
    return {tool:toolDefinition,args:deepArgs(toolDefinition,{type,value:''}),risk:toolRisk(toolDefinition),timeoutMs:entry.timeoutMs||120_000,publicIpOnly:Boolean(entry.publicIpOnly)};
  });
}

export function deepRunBlocked({target,level,authorization,typedTarget,person,selectedCount}={}){
  const value=typeof target==='object'?target?.value:String(target||'').trim();
  if(!value)return 'Type the target explicitly.';
  if(selectedCount===0)return 'Select at least one tool.';
  if(person)return '';
  if(!authorization)return 'Confirm that you own this target or have written permission to test it.';
  if(Number(level)===3&&String(typedTarget||'').trim()!==value)return `Type ${value} exactly to confirm.`;
  return '';
}

// Compatibility for the existing page while Task 9 replaces its three-step wiring.
export const DEEP_SEARCH_TOOLS=Object.freeze(Object.fromEntries(Object.entries(DEEP_TOOLS)
  .map(([type,entries])=>[type,Object.freeze(entries.map(entry=>entry.name))])));

export function deepSearchPlan(tools,target,level){
  const identifier=detectDeepTarget(target)||normalizeIdentifier({type:extractTarget(target)?.type||'domain',value:target});
  if(!identifier)return[];
  return deepToolsFor(tools,{type:identifier.type,level}).map(item=>({...item,args:deepArgs(item.tool,identifier),selected:true}));
}
