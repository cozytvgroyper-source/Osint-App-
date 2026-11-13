import {isPersonType} from './deep-search.js';
import {TIERS} from './tool-tiers.js';
import {button,card,escapeHtml} from './ui.js';

const categories=Object.freeze([['social','Social'],['developer','Developer'],['forums','Forums'],['shopping','Shopping'],['other','Other']]);
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

function findingValues(finding){
  const evidence=finding.evidence||{};const values=[];
  if(finding.kind==='fact'&&finding.fact?.value)values.push([finding.fact.label||'Fact',finding.fact.value]);
  for(const [label,key] of [['Name','names'],['Email','emails'],['Username','usernames'],['Phone','phones'],['Place','places']]){
    for(const value of evidence[key]||[])values.push([label,value]);
  }
  if(finding.kind==='breach')values.push(['Data breach',[finding.breach?.name,finding.breach?.date].filter(Boolean).join(' · ')]);
  const seen=new Set();
  return values.filter(([,value])=>{const key=String(value).toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
}

function summaryCard(findings){
  const rows=findings.flatMap(finding=>findingValues(finding).map(([label,value])=>
    `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)} ${sourceLine(finding)}</li>`));
  return card({title:'What we know',headingLevel:2,body:rows.length?`<ul class="result-list">${rows.join('')}</ul>`:'<p>No linked identity details were found.</p>'});
}

function trailDetails(finding){
  const steps=(finding.trail||[]).map(step=>`<li><strong>${escapeHtml(step.from?.value||'Lead')}</strong> — ${escapeHtml(step.note||'Linked by evidence.')} <span class="result-source">${escapeHtml(step.tool||'Unknown tool')}</span></li>`).join('');
  return `<details><summary>How we found this</summary>${steps?`<ol>${steps}</ol>`:'<p>This account was linked directly to what you searched.</p>'}</details>`;
}

function accountCard(finding,headingLevel=4){
  const account=finding.account||{};const title=account.site||account.displayName||'Account';
  const body=`<p>${externalLink(account.url,account.displayName||account.url||title)}</p><p><strong>Why linked:</strong> ${escapeHtml(finding.reason||'Linked by matching evidence.')}</p>${sourceLine(finding)}${trailDetails(finding)}`;
  return card({title,headingLevel,body,actions:pivotButton(account.url||title)});
}

function groupedAccounts(findings){
  const accounts=findings.filter(item=>item.kind==='account'&&item.status==='linked');
  const groups=categories.map(([key,label])=>[label,accounts.filter(item=>(item.account?.category||'other')===key)]).filter(([,items])=>items.length);
  return `<section><h2>Linked accounts (${accounts.length})</h2>${groups.map(([label,items])=>`<section><h3>${label}</h3>${items.map(item=>accountCard(item)).join('')}</section>`).join('')||'<p>No linked accounts were found.</p>'}</section>`;
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

function possibleMatches(findings){
  const possible=findings.filter(item=>item.status==='possible');if(!possible.length)return'';
  return `<details><summary>Show ${possible.length} ${plural(possible.length,'possible match')}</summary>${possible.map(item=>item.kind==='account'?accountCard(item,3):card({title:item.problem?.title||item.fact?.label||item.kind,headingLevel:3,body:`<p>${escapeHtml(item.reason||'Not enough evidence to link this finding.')}</p>${sourceLine(item)}`})).join('')}</details>`;
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
  return `${resultHeader(run)}${summaryCard(linked)}${groupedAccounts(linked)}${websites(linked)}${unfollowed(run.leadsNotFollowed)}${possibleMatches(findings)}${searchDetails(run)}${resultActions()}`;
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
