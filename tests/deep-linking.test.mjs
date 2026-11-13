import test from 'node:test';
import assert from 'node:assert/strict';
import {accountLevel,linkFindings,normalizeUrl} from '../public/deep-linking.js';

const seed={type:'email',value:'owner@example.com'};
const evidence=overrides=>({emails:[],usernames:[],phones:[],urls:[],names:[],places:[],...overrides});
const accountWith=(id,{url=`https://example.com/${id}`,verified=false,ev=evidence({}),tool=id,subject=seed}={})=>({
  id,kind:'account',subject,tool:{name:tool,serverName:'Test MCP'},evidence:ev,
  account:{site:new URL(url).hostname,url,category:'other',verified}
});
const account=(site,url,{presence='found',note='',details={},verified=false,subject={type:'username',value:'ownername'},tool='maigret'}={})=>({
  id:`${tool}:${url||site}`,kind:'account',subject,tool:{name:tool,serverName:'Test MCP'},
  evidence:evidence({usernames:['ownername'],emails:subject.type==='email'?[subject.value]:[],urls:[url]}),
  account:{site,url,category:'other',verified,presence,...(note?{presenceNote:note}:{}),details:{names:[],usernames:[],emails:[],phones:[],ips:[],websites:[],places:[],...details}}
});
const byUrl=(result,key)=>result.findings.find(item=>item.kind==='account'&&normalizeUrl(item.account.url||item.account.rawUrl)===key);
const leadFinding=(value,type,statusEvidence=evidence({}))=>({
  id:`lead-${type}-${value}`,kind:'lead',subject:seed,tool:{name:'lead_tool',serverName:'Test MCP'},
  evidence:statusEvidence,lead:{type,value}
});

test('rule 1: a verified account for the searched email is linked with its reason',()=>{
  const result=linkFindings([accountWith('holehe',{verified:true,ev:evidence({emails:[seed.value]})})],seed,{searched:[seed]});
  assert.equal(result.findings[0].status,'linked');
  assert.match(result.findings[0].reason,/Registered with owner@example\.com/);
  assert.equal(result.findings[0].trail.length,1);
});

test('rule b: a profile showing a confirmed identifier that was not searched is linked, but the searched one never links it',()=>{
  const usernameSeed={type:'username',value:'ownername'};
  const fact={id:'ghunt-fact',kind:'fact',subject:seed,tool:{name:'ghunt',serverName:'Test MCP'},evidence:evidence({emails:[seed.value,'contact@owner-site.example']}),fact:{label:'Contact',value:'contact@owner-site.example',group:'owner'}};
  const shows=account('Example','https://social.example/ownername',{details:{emails:['contact@owner-site.example']}});
  const echo=account('Echo','https://echo.example/ownername',{details:{emails:[seed.value],usernames:['ownername']}});
  const result=linkFindings([fact,shows,echo],usernameSeed,{searched:[usernameSeed,seed]});
  const linked=byUrl(result,'social.example/ownername');
  assert.equal(linked.status,'linked');
  assert.deepEqual(linked.confirmedBy,['b']);
  assert.equal(linked.reason,'Profile links to contact@owner-site.example, which is confirmed.');
  assert.equal(byUrl(result,'echo.example/ownername').status,'possible');
});

test('rule b chains: a profile linking to a confirmed account is linked, with its rule in the trail',()=>{
  const first=accountWith('first',{url:'https://github.com/ownername',verified:true,ev:evidence({emails:[seed.value]})});
  const second={...account('Example','https://example.net/u/owner',{subject:seed,details:{websites:['https://github.com/ownername/']}}),id:'second'};
  const result=linkFindings([first,second],seed,{searched:[seed]});
  const linked=result.findings.find(item=>item.id==='second');
  assert.equal(linked.status,'linked');
  assert.match(linked.reason,/Profile links to https:\/\/github\.com\/ownername\/, which is confirmed\./);
  assert.equal(linked.trail.length,1);
  assert.match(linked.trail[0].note,/Profile links to/);
});

test('username-only and display-name-only matches are possible',()=>{
  const usernameSeed={type:'username',value:'ownername'};
  const finding=accountWith('sherlock',{subject:usernameSeed,url:'https://social.example/ownername'});
  const result=linkFindings([finding],usernameSeed,{searched:[usernameSeed]});
  assert.equal(result.findings[0].status,'possible');
  assert.match(result.findings[0].reason,/Same username/);
});

test('empty and query-echo facts are dropped',()=>{
  const echo={id:'echo',kind:'fact',subject:seed,tool:{name:'echo',serverName:'Test MCP'},evidence:evidence({}),fact:{label:'Target',value:seed.value,group:'other'}};
  const result=linkFindings([echo,null],seed,{searched:[seed]});
  assert.equal(result.findings[0].status,'dropped');
});

test('the same profile from two tools is one finding with both sources',()=>{
  const one=accountWith('one',{url:'https://github.com/ownername/',verified:true,ev:evidence({emails:[seed.value]}),tool:'maigret'});
  const two=accountWith('two',{url:'https://GITHUB.com/OwnerName',tool:'sherlock'});
  const result=linkFindings([one,two],seed,{searched:[seed]});
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].status,'linked');
  assert.equal(result.findings[0].sources.length,2);
});

test('normalised identifiers are never searched twice',()=>{
  const findings=[
    leadFinding('@OwnerName','username'),
    leadFinding('Jane@Mail.com','email')
  ];
  const {leads}=linkFindings(findings,{type:'username',value:'ownername'},{searched:[{type:'email',value:'jane@mail.com'}]});
  assert.deepEqual(leads,[]);
});

test('leads come only from linked findings',()=>{
  const usernameSeed={type:'username',value:'ownername'};
  const possible=accountWith('possible',{subject:usernameSeed,ev:evidence({emails:['lead@example.net']})});
  const result=linkFindings([possible],usernameSeed,{searched:[usernameSeed]});
  assert.deepEqual(result.leads,[]);
});

test('a sanctions hit stays possible and needs the name from two linked sources',()=>{
  const a={id:'name-a',kind:'fact',subject:seed,tool:{name:'ghunt',serverName:'A'},evidence:evidence({names:['Owner Example'],emails:[seed.value]}),fact:{label:'Name',value:'Owner Example',group:'owner'}};
  const b={id:'name-b',kind:'fact',subject:seed,tool:{name:'maigret',serverName:'B'},evidence:evidence({names:['Owner Example'],emails:[seed.value]}),fact:{label:'Name',value:'Owner Example',group:'owner'}};
  const sanctions={id:'sanctions',kind:'fact',subject:{type:'name',value:'Owner Example'},tool:{name:'get_opensanctions',serverName:'Open OSINT'},evidence:evidence({names:['Owner Example']}),fact:{label:'Sanctions result',value:'Possible record',group:'other'}};
  const result=linkFindings([a,b,sanctions],seed,{searched:[seed]});
  const hit=result.findings.find(item=>item.id==='sanctions');
  assert.equal(hit.status,'possible');
  assert.match(hit.reason,/Possible sanctions match/);
});

test('normalizes profile URLs for merging',()=>{
  assert.equal(normalizeUrl('HTTPS://WWW.GitHub.com/OwnerName/?tab=stars#top'),'github.com/ownername');
});

const U={type:'username',value:'ownername'};
const E={type:'email',value:'owner@example.com'};

test('the searched username alone never confirms an account',()=>{
  const echo=account('GitHub','https://github.com/ownername',{details:{usernames:['ownername'],names:['ownername'],websites:['https://github.com/ownername']}});
  const result=linkFindings([echo],U,{searched:[U]});
  assert.equal(result.findings[0].status,'possible');
  assert.deepEqual(result.findings[0].confirmedBy,[]);
  assert.equal(result.findings[0].level,null);
  assert.deepEqual(result.leads,[]);
});

test('rule a: a registered account for the searched email is level 3',()=>{
  const registered=account('Example','https://social.example/ownername',{verified:true,subject:E,tool:'holehe'});
  const result=linkFindings([registered],U,{searched:[U,E]});
  const found=result.findings[0];
  assert.equal(found.status,'linked');
  assert.deepEqual(found.confirmedBy,['a']);
  assert.equal(found.level,3);
  assert.deepEqual(found.reasons,[{rule:'a',text:'Registered with owner@example.com.'}]);
  assert.equal(found.reason,'Registered with owner@example.com.');
});

test('rule c: the same name on two different sites confirms both at level 3',()=>{
  const github=account('GitHub','https://github.com/ownername',{details:{names:['Owner Example']}});
  const gitlab=account('GitLab','https://gitlab.com/ownername',{details:{names:['  owner   example ']}});
  const result=linkFindings([github,gitlab],U,{searched:[U]});
  for(const key of ['github.com/ownername','gitlab.com/ownername']){
    const found=byUrl(result,key);
    assert.equal(found.status,'linked',key);
    assert.deepEqual(found.confirmedBy,['c']);
    assert.equal(found.level,3);
    assert.equal(found.reason,'2 profiles with this username share the name "Owner Example".');
  }
});

test('rule c ignores the same account reported twice',()=>{
  const twitter=account('Twitter','https://twitter.com/ownername',{details:{names:['Owner Example']},tool:'maigret'});
  const x=account('X','https://x.com/OwnerName/',{details:{names:['Owner Example']},tool:'blackbird'});
  const result=linkFindings([twitter,x],U,{searched:[U]});
  const accounts=result.findings.filter(item=>item.kind==='account');
  assert.equal(accounts.length,1);
  assert.equal(accounts[0].status,'possible');
  assert.equal(accounts[0].sources.length,2);
  assert.equal(normalizeUrl('https://www.twitter.com/OwnerName'),'x.com/ownername');
});

test('rule c ignores image hosts and the account\'s own site',()=>{
  const github=account('GitHub','https://github.com/ownername',{details:{websites:['https://avatars.cdn.example/u/1.png','https://github.com/ownername/project']}});
  const gitlab=account('GitLab','https://gitlab.com/ownername',{details:{websites:['https://avatars.cdn.example/u/1.png?s=40','https://github.com/ownername/project']}});
  const result=linkFindings([github,gitlab],U,{searched:[U]});
  assert.equal(byUrl(result,'github.com/ownername').status,'possible');
  assert.equal(byUrl(result,'gitlab.com/ownername').status,'possible');
});

test('rule b: an account linking to a confirmed website is confirmed, and confirmation spreads',()=>{
  const first=account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe'});
  const second=account('GitLab','https://gitlab.com/ownername',{details:{websites:['https://github.com/ownername']}});
  const third=account('Codeberg','https://codeberg.org/ownername',{details:{websites:['https://gitlab.com/ownername/']}});
  const result=linkFindings([first,second,third],U,{searched:[U,E]});
  assert.deepEqual(byUrl(result,'github.com/ownername').confirmedBy,['a']);
  const gitlab=byUrl(result,'gitlab.com/ownername');
  assert.equal(gitlab.status,'linked');
  assert.deepEqual(gitlab.confirmedBy,['b']);
  assert.equal(gitlab.level,3);
  assert.equal(gitlab.reason,'Profile links to https://github.com/ownername, which is confirmed.');
  const codeberg=byUrl(result,'codeberg.org/ownername');
  assert.equal(codeberg.status,'linked');
  assert.deepEqual(codeberg.confirmedBy,['b']);
});

test('rule b reverse: a confirmed profile linking to an account confirms it',()=>{
  const first=account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{websites:['https://gitlab.com/ownername']}});
  const second=account('GitLab','https://gitlab.com/ownername');
  const result=linkFindings([first,second],U,{searched:[U,E]});
  const gitlab=byUrl(result,'gitlab.com/ownername');
  assert.equal(gitlab.status,'linked');
  assert.deepEqual(gitlab.confirmedBy,['b']);
  assert.deepEqual(gitlab.reasons,[{rule:'b',text:'A confirmed profile links to this account.'}]);
  assert.deepEqual(byUrl(result,'github.com/ownername').confirmedBy,['a']);
});

test('levels count every rule that holds',()=>{
  assert.equal(accountLevel(3),1);
  assert.equal(accountLevel(2),2);
  assert.equal(accountLevel(1),3);
  assert.equal(accountLevel(0),null);
  const two=linkFindings([
    account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{names:['Owner Example']}}),
    account('GitLab','https://gitlab.com/ownername',{details:{names:['Owner Example']}})
  ],U,{searched:[U,E]});
  const both=byUrl(two,'github.com/ownername');
  assert.deepEqual(both.confirmedBy,['a','c']);
  assert.equal(both.level,2);
  assert.deepEqual(both.reasons.map(item=>item.rule),['a','c']);
  assert.equal(byUrl(two,'gitlab.com/ownername').level,3);
  const three=linkFindings([
    account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{names:['Owner Example'],websites:['https://owner-site.example']}}),
    account('GitLab','https://gitlab.com/ownername',{details:{names:['Owner Example']}}),
    account('Codeberg','https://codeberg.org/ownername',{details:{names:['Owner Example'],websites:['https://owner-site.example/']}})
  ],U,{searched:[U,E]});
  const all=byUrl(three,'github.com/ownername');
  assert.deepEqual(all.confirmedBy,['a','b','c']);
  assert.equal(all.level,1);
});

test('not found and couldn\'t check are dropped with their reasons',()=>{
  const missing=account('GitHub','https://github.com/ownername',{presence:'not-found',note:'404',tool:'omega_socmint',details:{names:['Owner Example']}});
  const blocked=account('GitLab','https://gitlab.com/ownername',{presence:'unchecked',note:'403',tool:'omega_socmint',details:{names:['Owner Example']}});
  const result=linkFindings([missing,blocked],U,{searched:[U]});
  const github=byUrl(result,'github.com/ownername');const gitlab=byUrl(result,'gitlab.com/ownername');
  assert.equal(github.status,'dropped');assert.equal(github.reason,'Not found.');
  assert.equal(gitlab.status,'dropped');assert.equal(gitlab.reason,'Couldn\'t check (403).');
  assert.deepEqual(github.confirmedBy,[]);assert.equal(github.level,null);
});

test('found beats not found when tools disagree, and the disagreement is kept',()=>{
  const socmint=account('GitHub','https://github.com/ownername',{presence:'not-found',note:'404',tool:'omega_socmint'});
  const maigret=account('GitHub','https://github.com/ownername/',{tool:'maigret'});
  const result=linkFindings([socmint,maigret],U,{searched:[U]});
  const accounts=result.findings.filter(item=>item.kind==='account');
  assert.equal(accounts.length,1);
  assert.equal(accounts[0].account.presence,'found');
  assert.equal(accounts[0].status,'possible');
  assert.ok(accounts[0].presenceNotes.includes('omega_socmint: not found (404)'));
});

test('an account with only a data address is merged and judged by its data address',()=>{
  const one=account('HackerNews','',{tool:'omega_socmint'});one.account.rawUrl='https://hacker-news.firebaseio.com/v0/user/ownername.json';
  const two=account('HackerNews','',{tool:'omega_identity'});two.account.rawUrl='https://hacker-news.firebaseio.com/v0/user/ownername.json';
  const other=account('Reddit','',{tool:'omega_socmint'});other.account.rawUrl='https://api.reddit.example/ownername.json';
  const result=linkFindings([one,two,other],U,{searched:[U]});
  assert.equal(result.findings.filter(item=>item.kind==='account').length,2);
});

test('older stored accounts without presence or details are treated as found with no details',()=>{
  const old=accountWith('old',{subject:U,url:'https://github.com/ownername',ev:evidence({usernames:['ownername'],emails:['other@example.net']})});
  const result=linkFindings([old],U,{searched:[U]});
  assert.equal(result.findings[0].status,'possible');
  assert.deepEqual(result.leads,[]);
});

test('leads come from confirmed details only',()=>{
  const possibleAccount=account('GitLab','https://gitlab.com/ownername',{details:{emails:['other@example.net']}});
  const confirmed=account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{emails:['contact@owner-site.example'],usernames:['owner-alt'],websites:['https://owner-site.example/about'],names:['Owner Example']}});
  const result=linkFindings([possibleAccount,confirmed],U,{searched:[U,E]});
  const keys=result.leads.map(item=>`${item.type}:${item.value}`).sort();
  assert.deepEqual(keys,['domain:owner-site.example','email:contact@owner-site.example','username:owner-alt']);
});

// ---- Fix round 1: shared hosts, searched leads, and the multi-round contract ----

const linkedFact=urls=>({id:'ghunt-youtube',kind:'fact',subject:E,tool:{name:'ghunt',serverName:'Test MCP'},
  evidence:evidence({emails:[E.value],urls}),fact:{label:'YouTube',value:'channel abc',group:'owner'}});
const statusesOf=result=>result.findings.filter(item=>item.kind==='account')
  .map(item=>[normalizeUrl(item.account.url||item.account.rawUrl),item.status,item.confirmedBy.join('')]).sort();

test('a URL on a big shared site in a linked fact never confirms a stranger on that site',()=>{
  const stranger=account('Tumblr','https://tumblr.com/ownername',{details:{websites:['https://youtube.com/@someoneelse']}});
  const result=linkFindings([linkedFact(['https://www.youtube.com/channel/abc']),stranger],U,{searched:[U,E]});
  assert.equal(result.findings.find(item=>item.id==='ghunt-youtube').status,'linked');
  assert.equal(byUrl(result,'tumblr.com/ownername').status,'possible');
  assert.ok(!result.leads.some(item=>item.type==='domain'&&item.value==='youtube.com'));
});

test('the exact URL from a linked fact still confirms a profile that links to it',()=>{
  const linker=account('Tumblr','https://tumblr.com/ownername',{details:{websites:['https://youtube.com/channel/abc/']}});
  const result=linkFindings([linkedFact(['https://www.youtube.com/channel/abc']),linker],U,{searched:[U,E]});
  assert.deepEqual(byUrl(result,'tumblr.com/ownername').confirmedBy,['b']);
});

test('a platform host is never a domain lead and never confirms other profiles on it',()=>{
  const confirmed=account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{websites:['https://github.com/someproject','https://youtube.com']}});
  const round1=linkFindings([confirmed],U,{searched:[U,E]});
  assert.ok(!round1.leads.some(item=>item.type==='domain'&&['github.com','youtube.com'].includes(item.value)));
  const github={type:'domain',value:'github.com'};
  const hostFinding={id:'host-github',kind:'host',subject:github,tool:{name:'whois_lookup',serverName:'Test MCP'},evidence:evidence({urls:['https://github.com']}),host:{value:'github.com',relation:'related'}};
  const elsewhere=account('Codeberg','https://codeberg.org/ownername',{details:{websites:['https://github.com/someoneelse']}});
  const video=account('Vimeo','https://vimeo.example/ownername',{details:{websites:['https://youtube.com/@someoneelse']}});
  const result=linkFindings([confirmed,hostFinding,elsewhere,video],U,{searched:[U,E,github]});
  assert.equal(byUrl(result,'codeberg.org/ownername').status,'possible');
  assert.equal(byUrl(result,'vimeo.example/ownername').status,'possible');
});

test('a bare personal site from a confirmed profile still confirms pages on that site',()=>{
  const confirmed=account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{websites:['https://owner-site.example']}});
  const blog=account('Blog','https://blog.example/ownername',{details:{websites:['https://owner-site.example/blog']}});
  const result=linkFindings([confirmed,blog],U,{searched:[U,E]});
  assert.deepEqual(byUrl(result,'blog.example/ownername').confirmedBy,['b']);
});

test('following a lead never changes the confirmations it came from',()=>{
  const alt={type:'email',value:'alt@owner-site.example'};const altUser={type:'username',value:'owner-alt'};
  const input=[
    account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{emails:['alt@owner-site.example'],usernames:['owner-alt']}}),
    account('GitLab','https://gitlab.com/ownername',{details:{emails:['alt@owner-site.example']}}),
    account('Codeberg','https://codeberg.org/ownername',{details:{usernames:['owner-alt']}})
  ];
  const without=linkFindings(input,U,{searched:[U,E]});
  const withLeads=linkFindings(input,U,{searched:[U,E,alt,altUser]});
  assert.deepEqual(statusesOf(withLeads),statusesOf(without));
  assert.deepEqual(byUrl(without,'gitlab.com/ownername').confirmedBy,['b','c']);
  assert.deepEqual(byUrl(without,'codeberg.org/ownername').confirmedBy,['b']);
  assert.deepEqual(byUrl(withLeads,'github.com/ownername').account.details.emails,['alt@owner-site.example']);
  assert.deepEqual(byUrl(withLeads,'github.com/ownername').account.details.usernames,['owner-alt']);
});

test('two rounds the way the engine runs them: leads are followed and round-one confirmations hold',()=>{
  const round1Input=[
    account('GitHub','https://github.com/ownername',{verified:true,subject:E,tool:'holehe',details:{usernames:['owner-alt'],names:['Owner Example']}}),
    account('GitLab','https://gitlab.com/ownername',{details:{names:['Owner Example']}}),
    account('Codeberg','https://codeberg.org/ownername',{details:{usernames:['owner-alt']}})
  ];
  const searched=[U,E];
  const round1=linkFindings(round1Input,U,{searched});
  assert.ok(round1.leads.some(item=>item.type==='username'&&item.value==='owner-alt'));
  searched.push(...round1.leads);
  const altUser={type:'username',value:'owner-alt'};
  const echo=account('Example','https://social.example/owner-alt',{subject:altUser,details:{usernames:['owner-alt','ownername']}});
  const round2=linkFindings([...round1Input,echo],U,{searched});
  for(const key of ['github.com/ownername','gitlab.com/ownername','codeberg.org/ownername'])
    assert.deepEqual(byUrl(round2,key).confirmedBy,byUrl(round1,key).confirmedBy,key);
  const echoed=byUrl(round2,'social.example/owner-alt');
  assert.equal(echoed.status,'possible');
  assert.deepEqual(echoed.account.details.usernames,[]);
});
