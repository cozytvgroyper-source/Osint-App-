import {isPersonType} from './deep-search.js';
import {TIERS} from './tool-tiers.js';
import {button,card,escapeHtml} from './ui.js';

const categories=Object.freeze([['social','Social'],['developer','Developer'],['forums','Forums'],['shopping','Shopping'],['other','Other']]);
const detailGroups=Object.freeze([
  ['names','Names'],['usernames','Usernames'],['emails','Emails'],['phones','Phones'],['ips','IPs'],['websites','Websites'],['places','Locations']
]);
const severityOrder={high:0,medium:1,low:2};
const plural=(count,one,many=`${one}s`)=>count===1?one:many;

function sources(finding){
  const items=(finding?.sources?.length?finding.sources:[finding?.tool]).filter(Boolean);
  return items.map(item=>`${escapeHtml(item.name||'Unknown tool')} · ${escapeHtml(item.serverName||'Unknown MCP server')}`).join(', ');
}

function sourceLine(finding){return `<p class="result-source">${sources(finding)}</p>`;}

function safeUrl(value){
  try{const url=new URL(String(value));return ['http:','https:'].includes(url.protocol)?url.toString():'';}catch{return'';}
}

function externalLink(url,label){
  const href=safeUrl(url);if(!href)return escapeHtml(label||url);
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label||url)}<span aria-hidden="true"> ↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

function targetButton(value,label='Deep Search this site'){
  return button({label,kind:'secondary',attrs:{'data-deep-target':value}});
}

function pivotButton(value){
  return button({label:'Pivot →',kind:'secondary',attrs:{'data-pivot':value,'aria-label':`Pivot: investigate ${value}`}});
}

const emptyDetails=()=>Object.fromEntries(detailGroups.map(([key])=>[key,[]]));

function detailSourceNames(finding){
  const origin=finding.kind==='account'?(finding.account?.site||'Account'):(finding.fact?.label||finding.host?.value||finding.breach?.name||'Finding');
  return (finding.sources?.length?finding.sources:[finding.tool]).filter(Boolean)
    .map(item=>`${origin} (${item.name||'Unknown tool'} · ${item.serverName||'Unknown MCP server'})`);
}

function linkedDetailValues(finding){
  const values=emptyDetails();
  const source=finding.kind==='account'?(finding.account?.details||{}):(finding.evidence||{});
  for(const [key] of detailGroups)values[key].push(...(source[key]||[]));
  if(finding.kind!=='account')values.websites.push(...(source.urls||[]));
  if(finding.kind==='host'&&finding.host?.value)values.websites.push(finding.host.value);
  if(finding.kind==='lead'&&finding.lead?.value){
    const key={email:'emails',username:'usernames',phone:'phones',ip:'ips',domain:'websites'}[finding.lead.type];
    if(key)values[key].push(finding.lead.value);
  }
  if(finding.kind==='fact'&&finding.fact?.value){
    const label=String(finding.fact.label||'').toLowerCase();
    const key=/email/.test(label)?'emails':/user/.test(label)?'usernames':/phone/.test(label)?'phones':/\bip\b/.test(label)?'ips':/site|url|website/.test(label)?'websites':/place|location|city/.test(label)?'places':/name/.test(label)?'names':'';
    if(key)values[key].push(finding.fact.value);
  }
  return values;
}

function websiteKey(value){
  const raw=String(value??'').trim();
  try{
    const url=new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)?raw:`https://${raw}`);
    return`${url.hostname.toLowerCase().replace(/^www\./,'')}${url.pathname.replace(/\/+$/,'').toLowerCase()}`;
  }catch{return raw.toLowerCase().replace(/^https?:\/\/(?:www\.)?/,'').replace(/[?#].*$/,'').replace(/\/+$/,'');}
}

function isSeedDetail(key,value,seed){
  const type={usernames:'username',emails:'email',phones:'phone'}[key];
  if(!type||seed?.type!==type)return false;
  const clean=text=>{
    const raw=String(text??'').trim().toLowerCase();
    return type==='phone'?raw.replace(/\D/g,''):type==='username'?raw.replace(/^@/,''):raw;
  };
  return clean(value)===clean(seed.value);
}

function collectConnectedDetails(findings,seed){
  const collected=Object.fromEntries(detailGroups.map(([key])=>[key,new Map()]));
  for(const finding of findings.filter(item=>item.status==='linked')){
    const sources=detailSourceNames(finding);const values=linkedDetailValues(finding);
    for(const [key] of detailGroups){
      for(const raw of values[key]){
        const value=String(raw??'').trim();if(!value||isSeedDetail(key,value,seed))continue;
        const normalized=key==='websites'?websiteKey(value):value.toLowerCase();
        if(!collected[key].has(normalized))collected[key].set(normalized,{value,sources:new Set()});
        for(const source of sources)collected[key].get(normalized).sources.add(source);
      }
    }
  }
  return Object.fromEntries(detailGroups.map(([key])=>[key,[...collected[key].values()]]));
}

function connectedDetails(details){
  const rows=[];
  for(const [key,label] of detailGroups){
    for(const item of details[key]){
      const pivot=['websites','emails','usernames'].includes(key)?` ${pivotButton(item.value)}`:'';
      rows.push(`<li><strong>${label}:</strong> ${escapeHtml(item.value)} <span class="result-source">from ${escapeHtml([...item.sources].join(', '))}</span>${pivot}</li>`);
    }
  }
  return `<section class="connected-details"><h2>Connected details</h2>${rows.length?`<ul class="result-list">${rows.join('')}</ul>`:'<p>No details were confirmed. Accounts that only share the username are listed below.</p>'}</section>`;
}

function trailDetails(finding){
  const reasons=(finding.reasons||[]).map(item=>`<li>${escapeHtml(item.text||item)}</li>`);
  const trail=(finding.trail||[]).map(step=>`<li><strong>${escapeHtml(step.from?.value||'Lead')}</strong> — ${escapeHtml(step.note||'Linked by evidence.')} <span class="result-source">${escapeHtml(step.tool||'Unknown tool')}</span></li>`);
  const steps=reasons.length?reasons:trail;
  return `<details><summary>How we found this</summary>${steps.length?`<ol>${steps.join('')}</ol>`:'<p>No evidence beyond the matching username was found.</p>'}</details>`;
}

function accountOwnDetails(account,seed){
  const details=account?.details||{};const rows=[];
  for(const [key,label] of detailGroups){
    for(const value of details[key]||[])if(!isSeedDetail(key,value,seed))rows.push(`<li><strong>${label}:</strong> ${escapeHtml(value)}</li>`);
  }
  return rows.length?`<div class="account-details"><p><strong>Details from this profile</strong></p><ul>${rows.join('')}</ul></div>`:'';
}

function accountCard(finding,headingLevel=4,seed){
  const account=finding.account||{};const title=account.site||account.displayName||'Account';
  const address=account.url?externalLink(account.url,account.displayName||account.url):`${escapeHtml(title)} <span class="subtle">No page address</span>`;
  const count=(finding.confirmedBy||[]).length;const level=finding.level;
  const badge=finding.status==='linked'&&level?`<p class="deep-level-badge">Level ${escapeHtml(level)} · backed by ${count} of 3 rules</p>`:'';
  const why=finding.status==='linked'?'Why confirmed':'Why not confirmed';
  const body=`${badge}<p>${address}</p><p><strong>${why}:</strong> ${escapeHtml(finding.reason||'Linked by matching evidence.')}</p>${accountOwnDetails(account,seed)}${sourceLine(finding)}${trailDetails(finding)}`;
  return card({title,headingLevel,body,actions:account.url?pivotButton(account.url):''});
}

function groupedAccounts(findings,seed){
  const accounts=findings.filter(item=>item.kind==='account'&&item.status==='linked');
  const groups=categories.map(([key,label])=>[label,accounts.filter(item=>(item.account?.category||'other')===key)]).filter(([,items])=>items.length);
  const sort=(a,b)=>(Number(a.level)||9)-(Number(b.level)||9)||String(a.account?.site||'').localeCompare(String(b.account?.site||''));
  return `<section><h2>Confirmed accounts (${accounts.length})</h2>${groups.map(([label,items])=>`<section><h3>${label}</h3>${[...items].sort(sort).map(item=>accountCard(item,4,seed)).join('')}</section>`).join('')||'<p>No accounts were confirmed.</p>'}</section>`;
}

function websites(findings){
  const hosts=findings.filter(item=>item.kind==='host'&&item.status==='linked'&&item.host?.value);
  if(!hosts.length)return'';
  return `<section><h2>Websites found</h2>${hosts.map(item=>card({title:item.host.value,headingLevel:3,body:`<p>${escapeHtml(item.host.relation||'Website')}</p>${sourceLine(item)}`,actions:`${targetButton(item.host.value)}${pivotButton(item.host.value)}`})).join('')}</section>`;
}

function unfollowed(leads){
  if(!leads?.length)return'';
  return `<section><h2>More leads we didn&#39;t follow</h2><ul>${leads.map(item=>`<li>${escapeHtml(item.value)} ${targetButton(item.value,'Deep Search this lead')} ${pivotButton(item.value)}</li>`).join('')}</ul></section>`;
}

function possibleAccounts(findings,seed){
  const possible=findings.filter(item=>item.kind==='account'&&item.status==='possible');if(!possible.length)return'';
  const usernames=[...new Set(possible.map(item=>item.subject?.type==='username'?item.subject.value:'').filter(Boolean))];
  let body;
  if(usernames.length>1)body=usernames.map(username=>`<section><h3>${escapeHtml(username)}</h3>${possible.filter(item=>item.subject?.value===username).map(item=>accountCard(item,4,seed)).join('')}</section>`).join('');
  else body=possible.map(item=>accountCard(item,3,seed)).join('');
  return `<details><summary>Same username, not confirmed (${possible.length})</summary>${body}</details>`;
}

function droppedAccounts(findings){
  const dropped=findings.filter(item=>item.kind==='account'&&item.status==='dropped');if(!dropped.length)return'';
  const rows=dropped.map(item=>`<li>${escapeHtml(item.account?.site||'Unknown site')} — ${escapeHtml(item.reason||'Couldn\'t check.')}${sourceLine(item)}</li>`).join('');
  return `<details><summary>Not found or couldn&#39;t check (${dropped.length})</summary><ul>${rows}</ul></details>`;
}

function searchDetails(run){
  const calls=(run.calls||[]).map(call=>`<li><strong>${escapeHtml(call.tool)}</strong> · ${escapeHtml(call.serverName)} — ${escapeHtml(call.outcome)}${call.error?`: ${escapeHtml(call.error)}`:''} · ${Math.max(0,Number(call.ms)||0)} ms</li>`).join('');
  return `<details><summary>Search details</summary><p>${escapeHtml(String(run.rounds||0))} ${plural(run.rounds||0,'round')} · ${(run.calls||[]).length} ${plural((run.calls||[]).length,'tool')}</p><ul>${calls}</ul></details>`;
}

function resultHeader(run){
  const target=run.target?.value||'Unknown target';const tier=TIERS[Math.max(0,Math.min(3,Number(run.level)||0))];
  return `<header class="deep-results-header"><h2 id="deepResultsHeading" tabindex="-1">Deep Search results</h2><p><strong>${escapeHtml(target)}</strong> · ${escapeHtml(tier.label)}</p>${run.outcome==='stopped'?'<p class="notice">Stopped early. Everything found before stopping is shown below.</p>':''}</header>`;
}

function resultActions(){return `<div class="deep-result-actions">${button({label:'Save to evidence',kind:'primary',attrs:{'data-deep-save':true}})}${button({label:'New search',attrs:{'data-deep-new':true}})}</div>`;}

export function renderPersonResults(run){
  const findings=Array.isArray(run?.findings)?run.findings:[];const linked=findings.filter(item=>item.status==='linked');
  const details=collectConnectedDetails(findings,run.target);
  const accounts=findings.filter(item=>item.kind==='account');
  const found=accounts.filter(item=>!['not-found','unchecked'].includes(item.account?.presence||'found')).length;
  const confirmed=accounts.filter(item=>item.status==='linked').length;
  const counts=detailGroups.map(([key,label])=>details[key].length?`${details[key].length} ${plural(details[key].length,label.slice(0,-1).toLowerCase())}`:'').filter(Boolean);
  const summary=`<p class="deep-results-summary">${found} ${plural(found,'account')} found · ${confirmed} confirmed${counts.length?` · details: ${counts.join(', ')}`:''}</p>`;
  return `${resultHeader(run)}${summary}${connectedDetails(details)}${groupedAccounts(findings,run.target)}${websites(linked)}${unfollowed(run.leadsNotFollowed)}${possibleAccounts(findings,run.target)}${droppedAccounts(findings)}${searchDetails(run)}${resultActions()}`;
}

function siteOverview(findings,problemCount){
  const facts=findings.filter(item=>item.status==='linked'&&item.kind==='fact');
  const rows=facts.map(item=>`<li><strong>${escapeHtml(item.fact?.label||'Fact')}:</strong> ${escapeHtml(item.fact?.value||'')}${sourceLine(item)}</li>`).join('');
  return card({title:'Overview',headingLevel:2,body:`${rows?`<ul>${rows}</ul>`:'<p>No overview facts were returned.</p>'}<p><strong>${problemCount} ${plural(problemCount,'thing')} to fix (see below)</strong></p>`});
}

function hostSections(findings){
  const hosts=findings.filter(item=>item.status==='linked'&&item.kind==='host');
  const list=items=>items.length?`<ul>${items.map(item=>`<li>${escapeHtml(item.host?.value||'Unknown host')} — ${escapeHtml(item.host?.relation||'related')}${sourceLine(item)}</li>`).join('')}</ul>`:'<p>Nothing found in this section.</p>';
  const subdomains=hosts.filter(item=>/subdomain|host|ip/i.test(item.host?.relation||''));
  const related=hosts.filter(item=>!subdomains.includes(item));
  return `<section><h2>Site details</h2><details open><summary>Subdomains and hosts</summary>${list(subdomains)}</details><details open><summary>Related sites</summary>${list(related)}</details><details><summary>History</summary><p>Archive findings appear here when a source returns them.</p></details><details><summary>Email setup</summary><p>Email security findings appear below under Things to fix.</p></details><details><summary>Certificates</summary><p>Certificate findings appear here when a source returns them.</p></details></section>`;
}

function problemsSection(run,problems){
  const ordered=[...problems].sort((a,b)=>(severityOrder[a.problem?.severity]??9)-(severityOrder[b.problem?.severity]??9));
  if(!ordered.length){
    const note=Number(run.level)<=1?'<p>Active and Intrusive levels can check more deeply for exposed services and vulnerabilities.</p>':'<p>No problems were found by the tools that answered.</p>';
    return `<section><h2>Things to fix (0)</h2>${note}</section>`;
  }
  return `<section><h2>Things to fix (${ordered.length})</h2>${ordered.map(item=>card({title:item.problem?.title||'Problem',headingLevel:3,body:`<p><strong>${escapeHtml(item.problem?.severity||'unknown')}</strong></p><p><strong>What it means:</strong> ${escapeHtml(item.problem?.meaning||'')}</p><p><strong>What to do:</strong> ${escapeHtml(item.problem?.fix||'')}</p>${sourceLine(item)}`})).join('')}</section>`;
}

function otherHosts(findings){
  const hosts=findings.filter(item=>item.status==='linked'&&item.kind==='host'&&item.host?.value);if(!hosts.length)return'';
  return `<section><h2>Other hosts found</h2>${hosts.map(item=>card({title:item.host.value,headingLevel:3,body:`<p>${escapeHtml(item.host.relation||'Related host')}</p>${sourceLine(item)}`,actions:targetButton(item.host.value)})).join('')}</section>`;
}

export function renderSiteResults(run){
  const findings=Array.isArray(run?.findings)?run.findings:[];const linked=findings.filter(item=>item.status==='linked');
  const problems=linked.filter(item=>item.kind==='problem');
  return `${resultHeader(run)}${siteOverview(linked,problems.length)}${hostSections(linked)}${problemsSection(run,problems)}${otherHosts(linked)}${searchDetails(run)}${resultActions()}`;
}

export function renderDeepResults(run,options={}){
  void options;
  return isPersonType(run?.target?.type)?renderPersonResults(run):renderSiteResults(run);
}

export function deepEvidenceRecord(run){
  const saved={target:run?.target,level:run?.level,outcome:run?.outcome,findings:(run?.findings||[]).map(item=>({...item}))};
  return {title:`Deep Search: ${run?.target?.value||'results'}`,result:{content:[{type:'text',text:JSON.stringify(saved)}],isError:false},time:run?.finishedAt||new Date().toISOString(),server:'Deep Search'};
}
