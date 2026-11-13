import {normalizeIdentifier} from './deep-search.js';

const PERSON_TYPES=new Set(['email','username','phone']);
const STATUS_WEIGHT={dropped:0,possible:1,linked:2};

const idKey=identifier=>{
  const normalized=normalizeIdentifier(identifier);
  return normalized?`${normalized.type}:${normalized.value}`:'';
};
const sourceKey=source=>`${source.serverName}\n${source.name}`;
const unique=values=>[...new Set((values||[]).filter(Boolean))];

export function normalizeUrl(value){
  try{
    const url=new URL(String(value));
    const host=url.hostname.toLowerCase().replace(/^www\./,'');
    const path=url.pathname.replace(/\/+$/,'').toLowerCase();
    return`${host}${path}`;
  }catch{return String(value||'').trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/,'').replace(/[?#].*$/,'').replace(/\/+$/,'');}
}

function evidenceIdentifiers(finding){
  const evidence=finding?.evidence||{};const out=[];
  for(const value of evidence.emails||[])out.push(normalizeIdentifier({type:'email',value}));
  for(const value of evidence.usernames||[])out.push(normalizeIdentifier({type:'username',value}));
  for(const value of evidence.phones||[])out.push(normalizeIdentifier({type:'phone',value}));
  if(finding?.lead)out.push(normalizeIdentifier(finding.lead));
  return out.filter(Boolean);
}

function matchingIdentifier(finding,known){
  return evidenceIdentifiers(finding).find(identifier=>known.has(idKey(identifier)))||null;
}

function echoOnly(finding){
  if(!finding||!finding.kind||!finding.subject||!finding.tool)return true;
  if(finding.kind==='fact'){
    const value=String(finding.fact?.value||'').trim().toLowerCase();
    if(!value||value===String(finding.subject.value||'').trim().toLowerCase())return true;
  }
  if(finding.kind==='host'&&!finding.host?.value)return true;
  if(finding.kind==='lead'&&!normalizeIdentifier(finding.lead))return true;
  return false;
}

function linkedStep(finding,reason,prior=[]){
  return{...finding,status:'linked',reason,trail:[...prior,{from:{...finding.subject},tool:finding.tool.name,note:reason}],sources:[{...finding.tool}]};
}

function possible(finding,reason='Same username; nothing else links it.'){
  return{...finding,status:'possible',reason,trail:[],sources:[{...finding.tool}]};
}

function dropped(finding,reason='No evidence links this answer to the target.'){
  return{...finding,status:'dropped',reason,trail:[],sources:[{...finding.tool}]};
}

function classificationKey(finding){
  if(finding.kind==='account')return`account:${normalizeUrl(finding.account?.url)||String(finding.account?.site||'').toLowerCase()}`;
  if(finding.kind==='breach')return`breach:${String(finding.breach?.name||'').toLowerCase()}:${finding.breach?.date||''}`;
  if(finding.kind==='fact')return`fact:${String(finding.fact?.label||'').toLowerCase()}:${String(finding.fact?.value||'').toLowerCase()}`;
  if(finding.kind==='host')return`host:${String(finding.host?.relation||'')}:${String(finding.host?.value||'').toLowerCase()}`;
  if(finding.kind==='problem')return`problem:${String(finding.problem?.title||'').toLowerCase()}`;
  if(finding.kind==='lead')return`lead:${idKey(finding.lead)}`;
  return`${finding.kind}:${finding.id}`;
}

function mergeEvidence(a={},b={}){
  const keys=['emails','usernames','phones','urls','names','places'];
  return Object.fromEntries(keys.map(key=>[key,unique([...(a[key]||[]),...(b[key]||[])])]));
}

function mergeFindings(findings){
  const merged=new Map();
  for(const item of findings){
    const key=classificationKey(item);const current=merged.get(key);
    if(!current){merged.set(key,{...item,evidence:mergeEvidence({},item.evidence),sources:[...(item.sources||[])]});continue;}
    const stronger=STATUS_WEIGHT[item.status]>STATUS_WEIGHT[current.status]?item:current;
    const sources=new Map([...(current.sources||[]),...(item.sources||[])].map(entry=>[sourceKey(entry),entry]));
    merged.set(key,{...current,...stronger,evidence:mergeEvidence(current.evidence,item.evidence),sources:[...sources.values()]});
  }
  return[...merged.values()];
}

function nameSourceCounts(findings){
  const names=new Map();
  for(const finding of findings){
    if(finding.status!=='linked')continue;
    for(const name of finding.evidence?.names||[]){
      const key=String(name).trim().toLowerCase();if(!key)continue;
      if(!names.has(key))names.set(key,new Set());
      names.get(key).add(sourceKey(finding.tool));
    }
  }
  return names;
}

export function linkFindings(input,seed,{searched=[]}={}){
  const normalizedSeed=normalizeIdentifier(seed);if(!normalizedSeed)return{findings:[],leads:[]};
  const raw=(input||[]).filter(Boolean);
  const known=new Map();const trailsByIdentifier=new Map();
  for(const identifier of [normalizedSeed,...searched.map(normalizeIdentifier).filter(Boolean)]){
    known.set(idKey(identifier),identifier);trailsByIdentifier.set(idKey(identifier),[]);
  }
  const linkedUrls=new Map();
  const classified=new Map();
  const siteSearch=!PERSON_TYPES.has(normalizedSeed.type);

  for(const finding of raw){
    if(echoOnly(finding)){classified.set(finding.id,dropped(finding,'The answer only repeated the query or contained no finding.'));continue;}
    if(siteSearch){classified.set(finding.id,linkedStep(finding,`Found for ${normalizedSeed.value}.`));continue;}
    if(finding.tool?.name==='get_opensanctions')continue;
    const subjectKnown=known.has(idKey(finding.subject));
    if(finding.kind==='account'&&finding.account?.verified&&subjectKnown){
      const reason=`Registered with ${finding.subject.value}.`;
      classified.set(finding.id,linkedStep(finding,reason,trailsByIdentifier.get(idKey(finding.subject))||[]));
      continue;
    }
    const match=matchingIdentifier(finding,known);
    if(match){
      const reason=finding.kind==='account'?`Profile shows ${match.value}.`:`Found while checking ${match.value}.`;
      classified.set(finding.id,linkedStep(finding,reason,trailsByIdentifier.get(idKey(match))||[]));
      continue;
    }
    if(finding.kind==='account')classified.set(finding.id,possible(finding));
    else classified.set(finding.id,dropped(finding));
  }

  let changed=true;
  while(changed){
    changed=false;
    for(const finding of raw){
      const current=classified.get(finding.id);
      if(!current||current.status!=='linked')continue;
      const trail=current.trail||[];
      for(const identifier of evidenceIdentifiers(finding)){
        const key=idKey(identifier);
        if(key&&!known.has(key)){known.set(key,identifier);trailsByIdentifier.set(key,trail);changed=true;}
      }
      if(finding.kind==='account'&&finding.account?.url){
        const key=normalizeUrl(finding.account.url);
        if(key&&!linkedUrls.has(key)){linkedUrls.set(key,trail);changed=true;}
      }
    }
    for(const finding of raw){
      const current=classified.get(finding.id);
      if(!current||current.status==='linked'||finding.tool?.name==='get_opensanctions')continue;
      const match=matchingIdentifier(finding,known);
      if(match){
        const reason=finding.kind==='account'?`Profile shows ${match.value}.`:`Found while checking ${match.value}.`;
        classified.set(finding.id,linkedStep(finding,reason,trailsByIdentifier.get(idKey(match))||[]));changed=true;continue;
      }
      if(finding.kind==='account'){
        const linked=(finding.evidence?.urls||[]).map(url=>[normalizeUrl(url),url]).find(([key])=>linkedUrls.has(key));
        if(linked){
          const reason=`Links to ${linked[0]} (linked).`;
          classified.set(finding.id,linkedStep(finding,reason,linkedUrls.get(linked[0])||[]));changed=true;
        }
      }
    }
  }

  const names=nameSourceCounts([...classified.values()]);
  for(const finding of raw.filter(item=>item.tool?.name==='get_opensanctions')){
    const matched=(finding.evidence?.names||[]).find(name=>(names.get(String(name).toLowerCase())?.size||0)>=2);
    classified.set(finding.id,matched?possible(finding,`Possible sanctions match for ${matched}: check.`):dropped(finding,'The name was not established by two linked sources.'));
  }

  const merged=mergeFindings([...classified.values()]);
  const searchedKeys=new Set([idKey(normalizedSeed),...searched.map(idKey)].filter(Boolean));
  const leadMap=new Map();
  for(const finding of merged){
    if(finding.status!=='linked')continue;
    for(const identifier of evidenceIdentifiers(finding)){
      const key=idKey(identifier);
      if(key&&!searchedKeys.has(key)&&!leadMap.has(key))leadMap.set(key,identifier);
    }
  }
  return{findings:merged,leads:[...leadMap.values()]};
}
