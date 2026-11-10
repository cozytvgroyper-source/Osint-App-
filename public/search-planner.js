import {splitTarget} from './search-query.js';

// Includes request words ("reports", "info", "lookup") that describe the ask rather than the subject.
const STOP_WORDS=new Set(['a','an','and','are','as','at','be','by','for','from','how','in','is','it','of','on','or','the','to','what','when','where','which','report','reports','info','information','data','details','lookup','check','find','search','who','with']);
const INTENT_TERMS={
  cve:['cve','vulnerability','exploit','nvd','cisa','kev'],malware:['malware','hash','sample','reputation','ioc'],network:['ip','asn','bgp','routing','network','reputation'],domain:['domain','dns','whois','certificate','website','phishing'],username:['username','handle','account','social','profile'],email:['email','account','breach','reputation'],phone:['phone','number','carrier','location'],sanctions:['sanction','ofac','sdn','pep','embargo'],hazard:['earthquake','wildfire','storm','flood','volcano','disaster','hazard'],maritime:['ship','vessel','maritime','port','chokepoint','piracy'],aviation:['aircraft','flight','airport','aviation','notam','airspace'],cyber:['cyber','ransomware','malware','threat','ioc','phishing','botnet'],research:['research','paper','study','academic','arxiv','literature'],crypto:['crypto','bitcoin','ethereum','stablecoin','blockchain'],markets:['stock','ticker','equity','quote','company','filing'],economy:['gdp','inflation','unemployment','economy','rates','currency'],filings:['filing','sec','edgar','company','corporate'],github:['github','repository','developer','commit','code'],satellite:['satellite','imagery','orbit','spacecraft'],election:['election','vote','polling','ballot'],health:['health','outbreak','disease','epidemic','pandemic'],nuclear:['nuclear','arms','radiation','iaea'],energy:['energy','oil','gas','lng','commodity','mineral'],offshore:['offshore','company','entity','panama','paradise','pandora'],food:['food','famine','hunger','crop'],location:['location','country','city','geocode','map','travel'],organization:['organization','company','business','corporate','filing','news'],news:['news','current','event','latest','coverage','developments'],entity:['entity','identity','background','news','records']
};
const ACTIVE_TOOL_NAMES=/^(?:omega_(?:ports|fuzzer|redteam|vuln|auto|autopilot|dnsbrute|crawl|spider|webcrawl|jscan|buckets|secrets|creds|exfil|pivot|proxy)|spiderfoot_scan)$/i;
const ACTIVE_LANGUAGE=/\b(?:zone transfer|zone ?walk(?:ing)?|port scanner|web fuzzer|brute forc(?:e|ing)|red team|penetration test|active scan|vulnerability scanning|secret scanning|credential discovery|deep spider|recursive crawl)\b/i;

// A target's own text is not matched against tools (a domain's ".com" is not the word "com");
// these words stand in for it. IP addresses have none because "ip" occurs inside unrelated words.
const TARGET_TERMS={domain:['domain'],email:['email'],username:['username'],phone:['phone'],cve:['cve','vulnerability'],hash:['hash','malware']};

function words(value=''){
  return [...new Set(String(value).toLowerCase().replace(/https?:\/\//g,' ').replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(word=>word.length>1&&!STOP_WORDS.has(word)))];
}
function toolText(tool){
  const properties=Object.keys(tool.inputSchema?.properties||{}).join(' ');
  return `${tool.name||''} ${tool.description||''} ${tool.serverName||''} ${properties}`.toLowerCase();
}
// Omega's descriptions do not reliably reveal side effects (target probing, paid AI calls,
// on-demand package installs, outbound webhooks), so automatic search may only use Omega
// tools whose source was reviewed and found to query public lookup services alone.
const OMEGA_AUTO_SEARCH_TOOLS=new Set(['omega_whois','omega_dns','omega_ipinfo','omega_crtsh','omega_wayback','omega_cve','omega_asn','omega_malware','omega_spoofcheck','omega_reverseip','omega_dorks','omega_threatfeed']);
function isOmegaTool(tool){return tool.serverName==='Omega MCP'||/^omega_/i.test(tool.name||'');}
// Full enumeration tools that query dozens of sources and routinely exceed the 45-second request limit,
// stalling the whole search. They stay available in Tool Library.
const TOO_SLOW_FOR_AUTO_SEARCH=new Set(['subfinder_subdomain_search','theharvester_domain_search']);
function passiveCandidate(tool){
  if(TOO_SLOW_FOR_AUTO_SEARCH.has(tool.name))return false;
  if(isOmegaTool(tool)&&!OMEGA_AUTO_SEARCH_TOOLS.has(tool.name))return false;
  return !ACTIVE_TOOL_NAMES.test(tool.name||'')&&!ACTIVE_LANGUAGE.test(tool.description||'');
}
function compatibleTarget(tool,query,target){
  const constrained=new Set(tool.inputSchema?.required||[]);
  const value=String(query).trim();
  if(constrained.has('file_path')&&!/\.(?:jpe?g|png|gif|webp|heic|mp4|mov|pdf|docx?|txt|csv|json)$/i.test(value))return false;
  if(constrained.has('domain')&&target?.type!=='domain')return false;
  if(constrained.has('email')&&target?.type!=='email')return false;
  if(constrained.has('username')&&!(target?.type==='username'||/\b(?:username|handle|account)\b/i.test(value)))return false;
  if(constrained.has('number')&&target?.type!=='phone')return false;
  if(constrained.has('bbox')&&!/\b(?:bbox|bounding box|over|near|region|area|coordinates?)\b/i.test(value))return false;
  return true;
}
function matchScore(terms,text,name){
  let score=0;const matches=[];
  for(const term of terms){
    if(name.includes(term)){score+=7;matches.push(term);}
    else if(text.includes(term)){score+=3;matches.push(term);}
  }
  return{score,matches:[...new Set(matches)]};
}

export function planSearchTools({query,intentId,preferredNames=[],tools,maxTools=6}){
  const {text,target}=splitTarget(query);
  const queryTerms=[...new Set([...words(text),...(TARGET_TERMS[target?.type]||[])])];const intentTerms=INTENT_TERMS[intentId]||INTENT_TERMS.entity;const preferred=new Set(preferredNames);
  const ranked=tools.filter(tool=>passiveCandidate(tool)&&compatibleTarget(tool,query,target)).map(tool=>{
    const text=toolText(tool);const name=String(tool.name||'').toLowerCase();
    const direct=matchScore(queryTerms,text,name);const thematic=matchScore(intentTerms,text,name);
    let score=direct.score*2+thematic.score;
    if(preferred.has(tool.name))score+=100;
    if(tool.serverName==='Open OSINT')score+=5;
    else if(tool.serverName==='OSINT Toolbox')score+=3;
    else if(tool.serverName==='Omega MCP')score-=10;
    if(/report|summary|briefing|dashboard/i.test(name)&&!preferred.has(tool.name))score-=5;
    const matched=[...new Set([...direct.matches,...thematic.matches])];
    const reason=preferred.has(tool.name)?`Primary ${intentId} source`:matched.length?`Matches ${matched.slice(0,4).join(', ')}`:`Related ${intentId} capability`;
    return{tool,score,reason};
  }).filter(item=>preferred.has(item.tool.name)||item.score>3&&matchScore(queryTerms,toolText(item.tool),String(item.tool.name||'').toLowerCase()).score>0).sort((a,b)=>b.score-a.score||String(a.tool.name).localeCompare(String(b.tool.name)));
  const selected=[];const names=new Set();const serverCounts=new Map();
  for(const item of ranked){
    if(names.has(item.tool.name))continue;
    const count=serverCounts.get(item.tool.serverId)||0;
    if(count>=4&&!preferred.has(item.tool.name))continue;
    selected.push(item);names.add(item.tool.name);serverCounts.set(item.tool.serverId,count+1);
    if(selected.length>=maxTools)break;
  }
  return selected;
}

export function isPassiveSearchTool(tool){return passiveCandidate(tool);}
