import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/deep/${name}.json`,import.meta.url),'utf8'));

const source=(name='maigret_username_search',serverName='OSINT Toolbox')=>({name,serverName});
const accountDetails=overrides=>({names:[],usernames:[],emails:[],phones:[],ips:[],websites:[],places:[],...overrides});
const personRun=findings=>({
  id:'person-test',target:{type:'username',value:'ownername'},level:0,outcome:'completed',rounds:1,calls:[],
  findings,leadsNotFollowed:[]
});
const accountFinding=(id,{site='GitHub',url=`https://example.com/${id}`,status='linked',level=3,details={},reason='Registered with owner@example.com.',presence='found',presenceNote='',subject={type:'username',value:'ownername'}}={})=>({
  id,kind:'account',status,reason,level,confirmedBy:status==='linked'?['a']:[],reasons:status==='linked'?[{rule:'a',text:reason}]:[],
  subject,account:{site,url,category:'developer',presence,...(presenceNote?{presenceNote}:{}),details:accountDetails(details)},
  evidence:{names:[],emails:[],usernames:[],phones:[],urls:[],places:[]},sources:[source()],trail:[]
});

test('person results show connected details, grouped accounts, trails, leads and calls',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const html=renderPersonResults(await fixture('run-person'));
  assert.match(html,/<h2[^>]*>Connected details<\/h2>/);
  assert.match(html,/<h2[^>]*>Confirmed accounts \(1\)<\/h2>/);
  assert.match(html,/<h3[^>]*>Developer<\/h3>/);
  assert.match(html,/<h4[^>]*>GitHub &lt;script&gt;<\/h4>/);
  assert.match(html,/Level 3 · backed by 1 of 3 rules/);
  assert.match(html,/details: 1 name, 1 website, 1 location/);
  assert.doesNotMatch(html,/details:[^<]*email/);
  assert.match(html,/omega_gitrecon · Omega MCP/);
  assert.match(html,/<summary>How we found this<\/summary>/);
  assert.match(html,/Registered with owner@example\.com\./);
  assert.match(html,/Websites found[\s\S]*data-deep-target="owner-site\.example"/);
  assert.match(html,/More leads we didn&#39;t follow[\s\S]*data-deep-target="owner-alt"/);
  assert.match(html,/<details[^>]*><summary>Same username, not confirmed \(1\)<\/summary>/);
  assert.match(html,/Same username; nothing else links it/);
  assert.match(html,/<details><summary>Search details<\/summary>[\s\S]*Timed out/);
  assert.match(html,/data-deep-save/);assert.match(html,/data-deep-new/);
  assert.match(html,/Stopped early/);
  assert.doesNotMatch(html,/Run grant/i);
});

test('person results show connected details from confirmed sources only',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const confirmed=accountFinding('confirmed',{site:'GitHub',url:'https://github.com/ownername',details:{names:['Owner Example'],emails:['owner@example.com'],websites:['https://owner-site.example']}});
  const possible=accountFinding('possible',{site:'Forum',url:'https://forum.example/ownername',status:'possible',level:null,reason:'Same username; nothing else links it.',details:{names:['Stranger Name']}});
  const html=renderPersonResults(personRun([confirmed,possible]));
  const foldAt=html.indexOf('Same username, not confirmed (1)');
  assert.ok(foldAt>html.indexOf('Connected details'));
  assert.match(html.slice(0,foldAt),/Owner Example[\s\S]*from GitHub \(maigret_username_search · OSINT Toolbox\)/);
  assert.doesNotMatch(html.slice(0,foldAt),/Stranger Name/);
  assert.match(html.slice(foldAt),/Stranger Name/);
  assert.match(html,/data-pivot="owner@example\.com" aria-label="Pivot: investigate owner@example\.com"/);
});

test('confirmed accounts show exact level badges and sort strongest first',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const weak=accountFinding('weak',{site:'Alpha',url:'https://alpha.example/ownername',level:3});
  const strong={...accountFinding('strong',{site:'Zulu',url:'https://zulu.example/ownername',level:1}),confirmedBy:['a','b','c']};
  const html=renderPersonResults(personRun([weak,strong]));
  assert.match(html,/Level 1 · backed by 3 of 3 rules/);
  assert.match(html,/Level 3 · backed by 1 of 3 rules/);
  assert.ok(html.indexOf('Zulu')<html.indexOf('Alpha'));
});

test('not found and could not check accounts are folded and listed',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const missing=accountFinding('missing',{site:'Missing Site',url:'https://missing.example/ownername',status:'dropped',level:null,presence:'not-found',reason:'Not found.'});
  const blocked=accountFinding('blocked',{site:'Blocked Site',url:'https://blocked.example/ownername',status:'dropped',level:null,presence:'unchecked',presenceNote:'403',reason:"Couldn't check (403)."});
  const html=renderPersonResults(personRun([missing,blocked]));
  assert.match(html,/<summary>Not found or couldn&#39;t check \(2\)<\/summary>/);
  assert.match(html,/Missing Site — Not found/);
  assert.match(html,/Blocked Site — Couldn&#39;t check \(403\)/);
});

test('an account without a page address has no link or empty pivot',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const noPage=accountFinding('no-page',{site:'Data Only',url:'',details:{names:['Owner Example']}});
  noPage.account.rawUrl='https://api.example.com/users/ownername.json';
  const html=renderPersonResults(personRun([noPage]));
  const card=html.match(/<article class="card"><h4[^>]*>Data Only<\/h4>[\s\S]*?<\/article>/)?.[0]||'';
  assert.match(card,/No page address/);
  assert.doesNotMatch(card,/<a\b/);
  assert.doesNotMatch(card,/data-pivot=""/);
});

test('empty Connected details explains why and older account shapes still render',async()=>{
  const {renderPersonResults}=await import('../public/deep-results-view.js');
  const empty=personRun([accountFinding('possible-old',{site:'Forum',status:'possible',level:null,reason:'Same username; nothing else links it.'})]);
  delete empty.findings[0].account.presence;delete empty.findings[0].account.details;
  assert.match(renderPersonResults(empty),/No details were confirmed\. Accounts that only share the username are listed below\./);
  const old=await fixture('run-person');
  for(const item of old.findings)if(item.kind==='account'){delete item.account.presence;delete item.account.details;}
  const html=renderPersonResults(old);
  assert.match(html,/Confirmed accounts \(1\)/);
});

test('site results show an overview, ordered problems and other hosts',async()=>{
  const {renderSiteResults}=await import('../public/deep-results-view.js');
  const html=renderSiteResults(await fixture('run-site'));
  assert.match(html,/<h2[^>]*>Overview<\/h2>/);
  assert.match(html,/3 things to fix \(see below\)/);
  assert.match(html,/<details open>[\s\S]*<summary>Subdomains and hosts<\/summary>/);
  assert.match(html,/<details open>[\s\S]*<summary>Related sites<\/summary>/);
  assert.match(html,/Things to fix \(3\)/);
  assert.ok(html.indexOf('Open admin port')<html.indexOf('DMARC is not enforced'));
  assert.ok(html.indexOf('DMARC is not enforced')<html.indexOf('Old header'));
  assert.match(html,/An admin service is public\.[\s\S]*Restrict the service\.[\s\S]*omega_ports · Omega MCP/);
  assert.match(html,/Other hosts found[\s\S]*data-deep-target="api\.owner-site\.example"/);
  assert.match(html,/Example Org &lt;bad&gt;/);
});

test('low-level clean site results explain what higher levels check',async()=>{
  const {renderSiteResults}=await import('../public/deep-results-view.js');
  const run=await fixture('run-site');run.level=1;run.findings=run.findings.filter(item=>item.kind!=='problem');
  assert.match(renderSiteResults(run),/Active and Intrusive levels can check more deeply/);
});

test('both views escape hostile text, label external links, keep possible findings folded and show sources',async()=>{
  const {renderDeepResults}=await import('../public/deep-results-view.js');
  const person=renderDeepResults(await fixture('run-person'));
  const site=renderDeepResults(await fixture('run-site'));
  for(const html of [person,site]){
    assert.doesNotMatch(html,/<(?:bad|script)\b/i);
    assert.doesNotMatch(html,/Run grant/i);
    assert.match(html,/tool|omega|whois|maigret|sherlock/i);
    assert.match(html,/MCP|Toolbox/);
  }
  assert.match(person,/\(opens in a new tab\)/);
  assert.ok(person.indexOf('Same username; nothing else links it')>person.indexOf('<summary>Same username, not confirmed (1)</summary>'));
});

test('evidence records exclude raw answers',async()=>{
  const {deepEvidenceRecord}=await import('../public/deep-results-view.js');
  const run=await fixture('run-person');run.raw={secret:'must not be saved'};
  const record=deepEvidenceRecord(run);
  assert.equal(record.server,'Deep Search');
  const saved=JSON.parse(record.result.content[0].text);
  assert.equal(saved.target.value,'owner@example.com');
  assert.equal(saved.raw,undefined);
  assert.ok(saved.findings.every(item=>item.sources?.length));
});

test('skipped calls show their reason in Search details, escaped',async()=>{
  const {renderSiteResults}=await import('../public/deep-results-view.js');
  const run={...await fixture('run-site'),calls:[
    {tool:'get_greynoise',serverName:'Open OSINT',identifier:{type:'ip',value:'192.168.1.10'},outcome:'skipped',error:'Only covers public internet addresses.',ms:0},
    {tool:'get_bgp',serverName:'Open OSINT',identifier:{type:'ip',value:'192.168.1.10'},outcome:'error',error:'<img src=x>',ms:5}
  ]};
  const html=renderSiteResults(run);
  assert.match(html,/get_greynoise<\/strong> · Open OSINT — skipped: Only covers public internet addresses\./);
  assert.match(html,/&lt;img src=x&gt;/);
  assert.doesNotMatch(html,/<img src=x>/);
});
