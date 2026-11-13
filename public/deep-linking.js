import {detectDeepTarget,normalizeIdentifier} from './deep-search.js';

const PERSON_TYPES=new Set(['email','username','phone']);
const STATUS_WEIGHT={dropped:0,possible:1,linked:2};

const idKey=identifier=>{
  const normalized=normalizeIdentifier(identifier);
  return normalized?`${normalized.type}:${normalized.value}`:'';
};
const sourceKey=source=>`${source.serverName}\n${source.name}`;
const unique=values=>[...new Set((values||[]).filter(Boolean))];

const HOST_ALIASES={'twitter.com':'x.com'};
const aliasHost=host=>HOST_ALIASES[host]||host;

export function normalizeUrl(value){
  try{
    const url=new URL(String(value));
    const host=aliasHost(url.hostname.toLowerCase().replace(/^www\./,''));
    const path=url.pathname.replace(/\/+$/,'').toLowerCase();
    return`${host}${path}`;
  }catch{
    const bare=String(value||'').trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/,'').replace(/[?#].*$/,'').replace(/\/+$/,'');
    const slash=bare.indexOf('/');
    return slash<0?aliasHost(bare):`${aliasHost(bare.slice(0,slash))}${bare.slice(slash)}`;
  }
}

// Level 1 is the strongest: every one of the three rules holds.
export function accountLevel(rulesHeld){
  const count=Number(rulesHeld)||0;
  return count>=3?1:count===2?2:count===1?3:null;
}

function evidenceIdentifiers(finding){
  const evidence=finding?.evidence||{};const out=[];
  for(const value of evidence.emails||[])out.push(normalizeIdentifier({type:'email',value}));
  for(const value of evidence.usernames||[])out.push(normalizeIdentifier({type:'username',value}));
  for(const value of evidence.phones||[])out.push(normalizeIdentifier({type:'phone',value}));
  const profileUrl=normalizeUrl(finding?.account?.url||'');
  for(const value of evidence.urls||[]){
    if(profileUrl&&normalizeUrl(value)===profileUrl)continue;
    const target=detectDeepTarget(value);
    if(target?.type==='domain')out.push(target);
  }
  if(finding?.kind==='host'){
    const target=detectDeepTarget(finding.host?.value);
    if(target?.type==='domain')out.push(target);
  }
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
  if(finding.kind==='account')return accountKey(finding);
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

// ---- Accounts: confirmed only by rules a, b and c ----

const DETAIL_KEYS=['names','usernames','emails','phones','ips','websites','places'];
const PRESENCE_RANK={'not-found':0,unchecked:1,found:2};
const IMAGE_VALUE=/\.(?:jpe?g|png|gif|webp|svg)$/i;
const looseKey=value=>String(value??'').trim().toLowerCase().replace(/^@/,'');
const nameKey=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
const isImage=value=>IMAGE_VALUE.test(String(value??'').trim().replace(/[?#].*$/,''));
const hostOf=value=>normalizeUrl(value).split('/')[0];
const presenceOf=finding=>Object.hasOwn(PRESENCE_RANK,finding?.account?.presence)?finding.account.presence:'found';
// Big sites many unrelated people have pages on: a bare host here is never a personal site and never a lead.
const SHARED_HOSTS=new Set(['youtube.com','youtu.be','github.com','gitlab.com','bitbucket.org','codeberg.org','x.com','facebook.com',
  'instagram.com','linkedin.com','reddit.com','tiktok.com','pinterest.com','tumblr.com','medium.com','twitch.tv','discord.com','discord.gg',
  't.me','telegram.me','linktr.ee','google.com','gravatar.com','about.me','keybase.io','patreon.com','ko-fi.com','buymeacoffee.com',
  'mastodon.social','bsky.app','steamcommunity.com','soundcloud.com','spotify.com','vimeo.com','flickr.com','behance.net','dribbble.com',
  'stackoverflow.com','npmjs.com','pypi.org','hub.docker.com','news.ycombinator.com','dev.to','amazon.com','ebay.com','etsy.com',
  'wordpress.com','blogspot.com','substack.com','threads.net','snapchat.com','whatsapp.com','wa.me','paypal.me','cash.app','imgur.com']);
const platformKey=host=>String(host||'').toLowerCase().replace(/^(?:m|mobile)\./,'');
const accountAddress=finding=>finding?.account?.url||finding?.account?.rawUrl||'';

function accountKey(finding){
  const address=normalizeUrl(accountAddress(finding));
  return`account:${address||`site:${String(finding?.account?.site||'').toLowerCase()}`}`;
}

function presenceText(presence,note){
  const text=presence==='not-found'?'not found':presence==='unchecked'?'couldn\'t check':'found';
  return note?`${text} (${note})`:text;
}

// Details as linking sees them: no echoes (the seed anywhere, or a lead on the account found for it), no image addresses, no repeats.
function cleanDetails(values,key,isSearched){
  const seen=new Set();const out=[];
  for(const raw of values||[]){
    const value=String(raw??'').trim();if(!value)continue;
    if(isSearched(value,key))continue;
    if(key==='websites'&&isImage(value))continue;
    const dedupeKey=key==='websites'?normalizeUrl(value):key==='names'?nameKey(value):looseKey(value);
    if(seen.has(dedupeKey))continue;
    seen.add(dedupeKey);out.push(value);
  }
  return out;
}

function mergeAccounts(findings,isEcho,searchedKeys){
  const groups=new Map();
  for(const finding of findings){
    const key=accountKey(finding);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(finding);
  }
  return[...groups.entries()].map(([key,members])=>{
    const presence=members.map(presenceOf).reduce((best,value)=>PRESENCE_RANK[value]>PRESENCE_RANK[best]?value:best,'not-found');
    const base=members.find(member=>presenceOf(member)===presence)||members[0];
    const details=Object.fromEntries(DETAIL_KEYS.map(field=>[field,cleanDetails(members.flatMap(member=>
      (member.account?.details?.[field]||[]).filter(value=>!isEcho(value,field,member))),field,()=>false)]));
    const disagree=new Set(members.map(presenceOf)).size>1;
    const presenceNotes=disagree?unique(members.filter(member=>presenceOf(member)!==presence)
      .map(member=>`${member.tool?.name||'Unknown tool'}: ${presenceText(presenceOf(member),member.account?.presenceNote)}`)):[];
    const presenceNote=members.find(member=>presenceOf(member)===presence&&member.account?.presenceNote)?.account.presenceNote||'';
    const registeredWith=unique(members.filter(member=>member.account?.verified&&member.subject?.type==='email')
      .map(member=>normalizeIdentifier(member.subject)).filter(identifier=>identifier&&searchedKeys.has(idKey(identifier))).map(identifier=>identifier.value));
    const sources=[...new Map(members.map(member=>[sourceKey(member.tool),{...member.tool}])).values()];
    const url=members.map(member=>member.account?.url).find(Boolean)||'';
    const rawUrl=members.map(member=>member.account?.rawUrl).find(Boolean)||'';
    const address=url||rawUrl;
    const evidence=members.reduce((all,member)=>mergeEvidence(all,member.evidence),{});
    const account={...base.account,url,...(rawUrl?{rawUrl}:{}),presence,verified:members.some(member=>Boolean(member.account?.verified)),details};
    if(presenceNote)account.presenceNote=presenceNote;else delete account.presenceNote;
    return{key,host:address?hostOf(address):key,ownUrl:address?normalizeUrl(address):'',presence,presenceNote,presenceNotes,registeredWith,
      ids:new Set(members.map(member=>member.id)),finding:{...base,evidence,account},sources};
  });
}

// Rule c: two or more found accounts on different hosts show the same name, website or email.
function corroborations(entries,seedLoose){
  const groups=new Map();
  const add=(entry,kind,key,label)=>{
    const groupKey=`${kind}:${key}`;
    if(!groups.has(groupKey))groups.set(groupKey,{kind,label,entries:new Set()});
    groups.get(groupKey).entries.add(entry);
  };
  for(const entry of entries){
    const details=entry.finding.account.details;
    for(const name of details.names){const key=nameKey(name);if(key.length>=2&&!seedLoose.has(key))add(entry,'name',key,name.trim().replace(/\s+/g,' '));}
    for(const site of details.websites){
      if(isImage(site))continue;
      const key=normalizeUrl(site);if(!key||hostOf(site)===entry.host)continue;
      add(entry,'website',key,key);
    }
    for(const email of details.emails){const key=email.trim().toLowerCase();if(key)add(entry,'email',key,key);}
  }
  const out=new Map();
  for(const group of groups.values()){
    if(new Set([...group.entries].map(entry=>entry.host)).size<2)continue;
    const what=group.kind==='name'?`the name "${group.label}"`:group.kind==='website'?`the website ${group.label}`:`the email ${group.label}`;
    const text=`${group.entries.size} profiles with this username share ${what}.`;
    for(const entry of group.entries){if(!out.has(entry))out.set(entry,[]);out.get(entry).push(text);}
  }
  return out;
}

function emptyConfirmed(){return{urls:new Set(),bareHosts:new Set(),linkedTo:new Set(),emails:new Set(),usernames:new Set()};}

function addEntryToConfirmed(set,entry,isPlatform){
  const details=entry.finding.account.details;
  if(entry.ownUrl)set.urls.add(entry.ownUrl);
  for(const site of details.websites){
    if(isImage(site))continue;
    const key=normalizeUrl(site);if(!key)continue;
    set.urls.add(key);set.linkedTo.add(key);
    // Only a bare personal site (no path, not a big shared platform) confirms other pages on its host.
    if(!key.includes('/')&&!isPlatform(key))set.bareHosts.add(key);
  }
  for(const email of details.emails)set.emails.add(looseKey(email));
  for(const username of details.usernames)set.usernames.add(looseKey(username));
}

function mergeConfirmed(target,source){
  for(const field of Object.keys(target))for(const value of source[field])target[field].add(value);
  return target;
}

// Rule b: the account's details show something already confirmed, or a confirmed profile links to this account.
function ruleBReasons(entry,set,isPlatform){
  const details=entry.finding.account.details;const reasons=[];
  const forward=details.websites.find(site=>!isImage(site)&&(set.urls.has(normalizeUrl(site))||(set.bareHosts.has(hostOf(site))&&!isPlatform(hostOf(site)))))
    ||details.emails.find(email=>set.emails.has(looseKey(email)))
    ||details.usernames.find(username=>set.usernames.has(looseKey(username)));
  if(forward)reasons.push(`Profile links to ${forward}, which is confirmed.`);
  if(entry.ownUrl&&set.linkedTo.has(entry.ownUrl))reasons.push('A confirmed profile links to this account.');
  return reasons;
}

// Confirmed accounts and values reachable from rules a and c, spreading by b, without the excluded account,
// so an account can never back itself up through its own details.
function confirmedWithout(entries,excluded,rootSet,seedLoose,isPlatform){
  const pool=entries.filter(entry=>entry!==excluded);
  const corroborated=corroborations(pool,seedLoose);
  const confirmed=new Set(pool.filter(entry=>entry.registeredWith.length||corroborated.has(entry)));
  let changed=true;let set;
  while(changed){
    changed=false;
    set=mergeConfirmed(emptyConfirmed(),rootSet);
    for(const entry of confirmed)addEntryToConfirmed(set,entry,isPlatform);
    for(const entry of pool){
      if(confirmed.has(entry))continue;
      if(ruleBReasons(entry,set,isPlatform).length){confirmed.add(entry);changed=true;}
    }
  }
  return set;
}

function canHoldB(entry,allLinkedTo){
  const details=entry.finding.account.details;
  return details.websites.length||details.emails.length||details.usernames.length||(entry.ownUrl&&allLinkedTo.has(entry.ownUrl));
}

function judgeAccounts(entries,rootSet,seedLoose,isPlatform){
  const found=entries.filter(entry=>entry.presence==='found');
  const corroborated=corroborations(found,seedLoose);
  const allLinkedTo=new Set(found.flatMap(entry=>entry.finding.account.details.websites.map(normalizeUrl)));
  const verdicts=new Map();
  for(const entry of found){
    const reasons=[];
    for(const email of entry.registeredWith)reasons.push({rule:'a',text:`Registered with ${email}.`});
    if(canHoldB(entry,allLinkedTo)){
      for(const text of ruleBReasons(entry,confirmedWithout(found,entry,rootSet,seedLoose,isPlatform),isPlatform))reasons.push({rule:'b',text});
    }
    for(const text of corroborated.get(entry)||[])reasons.push({rule:'c',text});
    verdicts.set(entry,reasons);
  }
  return verdicts;
}

function accountResult(entry,reasons){
  const finding=entry.finding;
  const base={...finding,sources:entry.sources,presenceNotes:entry.presenceNotes};
  if(entry.presence!=='found'){
    const reason=entry.presence==='not-found'?'Not found.':entry.presenceNote?`Couldn't check (${entry.presenceNote}).`:'Couldn\'t check.';
    return{...base,status:'dropped',confirmedBy:[],level:null,reasons:[],reason,trail:[]};
  }
  const confirmedBy=[...new Set(reasons.map(item=>item.rule))].sort();
  if(!confirmedBy.length)return{...base,status:'possible',confirmedBy:[],level:null,reasons:[],reason:'Same username; nothing else links it.',trail:[]};
  return{...base,status:'linked',confirmedBy,level:accountLevel(confirmedBy.length),reasons,reason:reasons.map(item=>item.text).join(' '),
    trail:reasons.map(item=>({from:{...finding.subject},tool:finding.tool?.name||'Unknown tool',note:item.text}))};
}

function detailIdentifiers(details,isPlatform){
  const out=[];
  for(const value of details?.emails||[])out.push(normalizeIdentifier({type:'email',value}));
  for(const value of details?.usernames||[])out.push(normalizeIdentifier({type:'username',value}));
  for(const value of details?.phones||[])out.push(normalizeIdentifier({type:'phone',value}));
  for(const value of details?.websites||[]){
    if(isImage(value))continue;
    const target=detectDeepTarget(value);
    if(target?.type==='domain'&&!isPlatform(target.value))out.push(target);
  }
  return out.filter(Boolean);
}

function findingIdentifiers(finding,isPlatform){
  const identifiers=finding.kind==='account'?detailIdentifiers(finding.account?.details,isPlatform):evidenceIdentifiers(finding);
  return identifiers.filter(identifier=>identifier.type!=='domain'||!isPlatform(identifier.value));
}

// What a linked non-account finding confirms for rule b: its emails and usernames, and its addresses as full URLs.
// A bare platform host (e.g. youtube.com) is never added, so one channel link can't confirm every page on that site.
function addNonAccountRoots(set,finding,searchedKeys,isPlatform){
  const evidence=finding.evidence||{};
  const addUrl=value=>{const key=normalizeUrl(value);if(key&&!(!key.includes('/')&&isPlatform(key)))set.urls.add(key);};
  for(const value of evidence.emails||[]){const id=normalizeIdentifier({type:'email',value});if(id&&!searchedKeys.has(idKey(id)))set.emails.add(looseKey(id.value));}
  for(const value of evidence.usernames||[]){const id=normalizeIdentifier({type:'username',value});if(id&&!searchedKeys.has(idKey(id)))set.usernames.add(looseKey(id.value));}
  for(const value of evidence.urls||[])addUrl(value);
  if(finding.kind==='host'&&!searchedKeys.has(idKey({type:'domain',value:finding.host?.value})))addUrl(finding.host?.value);
  const lead=normalizeIdentifier(finding.lead);
  if(lead&&!searchedKeys.has(idKey(lead))){
    if(lead.type==='email')set.emails.add(looseKey(lead.value));
    else if(lead.type==='username')set.usernames.add(looseKey(lead.value));
    else if(lead.type==='domain')addUrl(lead.value);
  }
}

// ---- Everything else: today's path ("Found while checking …") ----

function classifyOthers(findings,known,trailsByIdentifier){
  const classified=new Map();
  for(const finding of findings){
    const match=matchingIdentifier(finding,known);
    classified.set(finding.id,match?linkedStep(finding,`Found while checking ${match.value}.`,trailsByIdentifier.get(idKey(match))||[]):dropped(finding));
  }
  let changed=true;
  while(changed){
    changed=false;
    for(const finding of findings){
      const current=classified.get(finding.id);
      if(current.status!=='linked')continue;
      for(const identifier of evidenceIdentifiers(finding)){
        const key=idKey(identifier);
        if(key&&!known.has(key)){known.set(key,identifier);trailsByIdentifier.set(key,current.trail||[]);changed=true;}
      }
    }
    for(const finding of findings){
      if(classified.get(finding.id).status==='linked')continue;
      const match=matchingIdentifier(finding,known);
      if(match){classified.set(finding.id,linkedStep(finding,`Found while checking ${match.value}.`,trailsByIdentifier.get(idKey(match))||[]));changed=true;}
    }
  }
  return classified;
}

function nameSourceCounts(findings){
  const names=new Map();
  for(const finding of findings){
    if(finding.status!=='linked')continue;
    const values=finding.kind==='account'?finding.account?.details?.names||[]:finding.evidence?.names||[];
    const sources=finding.kind==='account'?finding.sources||[]:[finding.tool];
    for(const name of values){
      const key=String(name).trim().toLowerCase();if(!key)continue;
      if(!names.has(key))names.set(key,new Set());
      for(const entry of sources)names.get(key).add(sourceKey(entry));
    }
  }
  return names;
}

export function linkFindings(input,seed,{searched=[]}={}){
  const normalizedSeed=normalizeIdentifier(seed);if(!normalizedSeed)return{findings:[],leads:[]};
  const raw=(input||[]).filter(Boolean);
  const searchedIds=[normalizedSeed,...searched.map(normalizeIdentifier).filter(Boolean)];
  const searchedKeys=new Set(searchedIds.map(idKey));
  const seedLoose=new Set([looseKey(normalizedSeed.value)]);
  // The seed is an echo everywhere. A searched lead was taken from a confirmed source, so it stays a real detail,
  // except on an account that a tool found for that very lead, where it is just the tool repeating its query.
  const sameAs=(value,field,identifier)=>{
    if(!identifier)return false;
    if(field==='phones'&&identifier.type==='phone')return normalizeIdentifier({type:'phone',value})?.value===identifier.value;
    const wanted=looseKey(identifier.value);
    return looseKey(value)===wanted||nameKey(value)===wanted;
  };
  const isEcho=(value,field,member)=>sameAs(value,field,normalizedSeed)||sameAs(value,field,normalizeIdentifier(member?.subject));
  const siteSearch=!PERSON_TYPES.has(normalizedSeed.type);
  const echoes=new Map();const accounts=[];const others=[];const sanctions=[];

  for(const finding of raw){
    if(echoOnly(finding)){echoes.set(finding.id,dropped(finding,'The answer only repeated the query or contained no finding.'));continue;}
    if(siteSearch){echoes.set(finding.id,linkedStep(finding,`Found for ${normalizedSeed.value}.`));continue;}
    if(finding.tool?.name==='get_opensanctions')sanctions.push(finding);
    else if(finding.kind==='account')accounts.push(finding);
    else others.push(finding);
  }

  const entries=mergeAccounts(accounts,isEcho,searchedKeys);
  const accountHosts=new Set(entries.filter(entry=>entry.ownUrl).map(entry=>platformKey(entry.host)));
  const isPlatform=host=>{const key=platformKey(host);return SHARED_HOSTS.has(key)||accountHosts.has(key);};
  let accountResults=new Map();let otherResults=new Map();let previous='';
  // Accounts and other findings feed each other (a confirmed detail can link a fact, a linked fact's email can
  // confirm an account), so both are re-judged until the set of linked findings stops changing.
  for(let pass=0;pass<10;pass++){
    const known=new Map();const trailsByIdentifier=new Map();
    for(const identifier of searchedIds){known.set(idKey(identifier),identifier);trailsByIdentifier.set(idKey(identifier),[]);}
    for(const result of accountResults.values()){
      if(result.status!=='linked')continue;
      for(const identifier of detailIdentifiers(result.account.details,isPlatform)){
        const key=idKey(identifier);
        if(key&&!known.has(key)){known.set(key,identifier);trailsByIdentifier.set(key,result.trail);}
      }
    }
    otherResults=classifyOthers(others,known,trailsByIdentifier);
    const rootSet=emptyConfirmed();
    for(const result of otherResults.values()){
      if(result.status==='linked')addNonAccountRoots(rootSet,result,searchedKeys,isPlatform);
    }
    const verdicts=judgeAccounts(entries,rootSet,seedLoose,isPlatform);
    accountResults=new Map(entries.map(entry=>[entry,accountResult(entry,verdicts.get(entry)||[])]));
    const signature=[...accountResults.values(),...otherResults.values()].filter(item=>item.status==='linked').map(item=>`${item.id}:${(item.confirmedBy||[]).join('')}`).sort().join('|');
    if(signature===previous)break;
    previous=signature;
  }

  const names=nameSourceCounts([...accountResults.values(),...otherResults.values()]);
  const sanctionResults=new Map(sanctions.map(finding=>{
    const matched=(finding.evidence?.names||[]).find(name=>(names.get(String(name).toLowerCase())?.size||0)>=2);
    return[finding.id,matched?possible(finding,`Possible sanctions match for ${matched}: check.`):dropped(finding,'The name was not established by two linked sources.')];
  }));

  const entryById=new Map(entries.flatMap(entry=>[...entry.ids].map(id=>[id,entry])));
  const ordered=[];const emitted=new Set();
  for(const finding of raw){
    if(echoes.has(finding.id)){ordered.push(echoes.get(finding.id));continue;}
    if(sanctionResults.has(finding.id)){ordered.push(sanctionResults.get(finding.id));continue;}
    if(otherResults.has(finding.id)){ordered.push(otherResults.get(finding.id));continue;}
    const entry=entryById.get(finding.id);
    if(entry&&!emitted.has(entry)){emitted.add(entry);ordered.push(accountResults.get(entry));}
  }

  const merged=mergeFindings(ordered);
  const leadMap=new Map();
  for(const finding of merged){
    if(finding.status!=='linked')continue;
    for(const identifier of findingIdentifiers(finding,isPlatform)){
      const key=idKey(identifier);
      if(key&&!searchedKeys.has(key)&&!leadMap.has(key))leadMap.set(key,identifier);
    }
  }
  return{findings:merged,leads:[...leadMap.values()]};
}
