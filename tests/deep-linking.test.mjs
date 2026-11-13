import test from 'node:test';
import assert from 'node:assert/strict';
import {linkFindings,normalizeUrl} from '../public/deep-linking.js';

const seed={type:'email',value:'owner@example.com'};
const evidence=overrides=>({emails:[],usernames:[],phones:[],urls:[],names:[],places:[],...overrides});
const account=(id,{url=`https://example.com/${id}`,verified=false,ev=evidence({}),tool=id,subject=seed}={})=>({
  id,kind:'account',subject,tool:{name:tool,serverName:'Test MCP'},evidence:ev,
  account:{site:new URL(url).hostname,url,category:'other',verified}
});
const leadFinding=(value,type,statusEvidence=evidence({}))=>({
  id:`lead-${type}-${value}`,kind:'lead',subject:seed,tool:{name:'lead_tool',serverName:'Test MCP'},
  evidence:statusEvidence,lead:{type,value}
});

test('rule 1: a verified account for the searched email is linked with its reason',()=>{
  const result=linkFindings([account('holehe',{verified:true,ev:evidence({emails:[seed.value]})})],seed,{searched:[seed]});
  assert.equal(result.findings[0].status,'linked');
  assert.match(result.findings[0].reason,/Registered with owner@example\.com/);
  assert.equal(result.findings[0].trail.length,1);
});

test('rule 2: a profile showing a known identifier is linked',()=>{
  const result=linkFindings([account('maigret',{ev:evidence({emails:[seed.value]})})],seed,{searched:[seed]});
  assert.equal(result.findings[0].status,'linked');
  assert.match(result.findings[0].reason,/Profile shows owner@example\.com/);
});

test('rule 3: a profile linking to a linked account is linked',()=>{
  const first=account('first',{url:'https://github.com/ownername',verified:true,ev:evidence({emails:[seed.value]})});
  const second=account('second',{url:'https://example.net/u/owner',ev:evidence({urls:['https://github.com/ownername/']})});
  const result=linkFindings([first,second],seed,{searched:[seed]});
  assert.equal(result.findings.find(item=>item.id==='second').status,'linked');
  assert.match(result.findings.find(item=>item.id==='second').reason,/Links to github\.com\/ownername/);
});

test('rule 4: chains record every step',()=>{
  const first=account('first',{url:'https://github.com/ownername',verified:true,ev:evidence({emails:[seed.value]})});
  const second=account('second',{url:'https://example.net/u/owner',ev:evidence({urls:['https://github.com/ownername']})});
  const result=linkFindings([first,second],seed,{searched:[seed]});
  const linked=result.findings.find(item=>item.id==='second');
  assert.equal(linked.trail.length,2);
  assert.match(linked.trail[0].note,/Registered/);
  assert.match(linked.trail[1].note,/Links to/);
});

test('username-only and display-name-only matches are possible',()=>{
  const usernameSeed={type:'username',value:'ownername'};
  const finding=account('sherlock',{subject:usernameSeed,url:'https://social.example/ownername'});
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
  const one=account('one',{url:'https://github.com/ownername/',verified:true,ev:evidence({emails:[seed.value]}),tool:'maigret'});
  const two=account('two',{url:'https://GITHUB.com/OwnerName',tool:'sherlock'});
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
  const possible=account('possible',{subject:usernameSeed,ev:evidence({emails:['lead@example.net']})});
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
